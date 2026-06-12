import { calculateScheduleTimeMs, DEFAULT_CLIENT_RTT_MS } from "@/config";
import { IS_DEMO_MODE } from "@/demo";
import { uploadJSON, downloadJSON, listObjectsWithPrefix, deleteObject, getPublicUrlForKey } from "@/lib/r2";
import { ChatManager } from "@/managers/ChatManager";
import { debounce } from "@/utils/debounce";
import { sendBroadcast, sendUnicast } from "@/utils/responses";
import { positionClientsInCircle } from "@/utils/spatial";
import type { BunServer, WSData } from "@/utils/websocket";
import type {
  AudioSourceType,
  ChatMessageType,
  ClientDataType,
  DiscoveryRoomType,
  PauseActionType,
  PlayActionType,
  PositionType,
  RoomType,
  WSBroadcastType,
} from "@beatsync/shared";
import { ClientDataSchema, epochNow, LOW_PASS_CONSTANTS, NTP_CONSTANTS } from "@beatsync/shared";
import { AudioSourceSchema, GRID } from "@beatsync/shared/types/basic";
import type { SendLocationSchema } from "@beatsync/shared/types/WSRequest";
import type { ServerWebSocket } from "bun";
import { z } from "zod";

interface RoomData {
  audioSources: AudioSourceType[];
  clients: ClientDataType[];
  roomId: string;
  listeningSource: PositionType;
  globalVolume: number;
  lowPassFreq: number; // Low-pass filter cutoff frequency (20-20000 Hz)
}

const RoomPlaybackStateSchema = z.object({
  type: z.enum(["playing", "paused"]),
  audioSource: z.string(), // URL of the audio source
  serverTimeToExecute: z.number(), // When playback started/paused (server time)
  trackPositionSeconds: z.number(), // Position in track when started/paused (seconds)
});
type RoomPlaybackState = z.infer<typeof RoomPlaybackStateSchema>;

const RoomBackupSchema = z.object({
  clientDatas: z.array(ClientDataSchema),
  audioSources: z.array(AudioSourceSchema),
  globalVolume: z.number().min(0).max(1).default(1.0),
  lowPassFreq: z
    .number()
    .min(LOW_PASS_CONSTANTS.MIN_FREQ)
    .max(LOW_PASS_CONSTANTS.MAX_FREQ)
    .default(LOW_PASS_CONSTANTS.MAX_FREQ),
  playbackState: RoomPlaybackStateSchema,
});
export type RoomBackupType = z.infer<typeof RoomBackupSchema>;

export const ServerBackupSchema = z.object({
  timestamp: z.number(),
  data: z.object({
    rooms: z.record(z.string(), RoomBackupSchema),
  }),
});
export type ServerBackupType = z.infer<typeof ServerBackupSchema>;

// Default/initial playback state for rooms
const INITIAL_PLAYBACK_STATE: RoomPlaybackState = {
  type: "paused",
  audioSource: "",
  serverTimeToExecute: 0,
  trackPositionSeconds: 0,
};

interface PendingPlayState {
  clientsLoaded: Set<string>;
  timeout: NodeJS.Timeout;
  playAction: PlayActionType;
  initiatorClientId: string;
  server: BunServer;
}

/**
 * RoomManager handles all operations for a single room.
 * Each room has its own instance of RoomManager.
 */
export class RoomManager {
  private static readonly AUDIO_LOAD_TIMEOUT_MS = 30000; // 30 seconds max wait for audio loading

  private clientData = new Map<string, ClientDataType>(); // map of clientId -> client data
  private wsConnections = new Map<string, ServerWebSocket<WSData>>(); // map of clientId -> ws
  private audioSources: AudioSourceType[] = [];
  private listeningSource: PositionType = {
    x: GRID.ORIGIN_X,
    y: GRID.ORIGIN_Y,
  };
  private isSpatialAudioRunning = false;
  private spatialStartTime = 0;
  private cleanupTimer?: NodeJS.Timeout;
  private pendingClientChangeCb?: () => void;
  private readonly debouncedClientChange = debounce(() => {
    this.pendingClientChangeCb?.();
  }, 500);
  private readonly debouncedAudioReady = debounce(() => this.flushAudioReadyBroadcast(), 200);
  private heartbeatCheckInterval?: NodeJS.Timeout;
  private onClientCountChange?: () => void;
  private onBecameEmpty?: () => void;
  private playbackState: RoomPlaybackState = INITIAL_PLAYBACK_STATE;
  private globalVolume = 1.0;
  private lowPassFreq: number = LOW_PASS_CONSTANTS.MAX_FREQ; // Default bypassed (full spectrum)
  private isMetronomeEnabled = false;
  // Map of trackId to job status
  private activeStreamJobs = new Map<string, { status: string }>();
  private chatManager: ChatManager;
  private serverRef?: BunServer;

  private isPlaylistDirty = false;
  private isPlaylistLoaded = false;
  private autoSaveInterval?: NodeJS.Timeout;

  // Audio loading state for synchronized playback
  private pendingPlay?: PendingPlayState;
  private demoAudioReadyClients = new Set<string>();
  constructor(
    private readonly roomId: string,
    onClientCountChange?: () => void, // To update the global # of clients active
    onBecameEmpty?: () => void // To schedule room cleanup when the reaper removes the last client
  ) {
    this.onClientCountChange = onClientCountChange;
    this.onBecameEmpty = onBecameEmpty;
    this.chatManager = new ChatManager({ roomId });
    if (IS_DEMO_MODE) {
      this.globalVolume = 0.8;
    } else {
      this.autoSaveInterval = setInterval(
        () => {
          if (this.isPlaylistDirty) {
            console.log(`[AutoSave] Playlist changed in room ${this.roomId}, saving...`);
            this.savePlaylist()
              .then(() => this.cleanupUnusedFiles())
              .catch((err) => console.error(`[AutoSave] Error auto-saving/cleaning room ${this.roomId}:`, err));
          }
        },
        5 * 60 * 1000
      ); // Check every 5 minutes
    }
  }

  /**
   * Get the room ID
   */
  getRoomId(): string {
    return this.roomId;
  }

  clearAudioLoadingState(): void {
    if (!this.pendingPlay) return;
    // Clear the timeout
    if (this.pendingPlay.timeout) {
      clearTimeout(this.pendingPlay.timeout);
    }

    // Clear the pending play
    this.pendingPlay = undefined;
  }

  /**
   * Initiate audio source loading for all clients before playback
   */
  initiateAudioSourceLoad(playAction: PlayActionType, initiatorClientId: string, server: BunServer): void {
    // Clear any existing loading state
    this.clearAudioLoadingState();

    // Find the audio source to load
    const audioSource = this.audioSources.find((source) => source.url === playAction.audioSource);

    if (!audioSource) {
      console.warn(`Cannot load non-existent audio source: ${playAction.audioSource}`);
      return;
    }

    // Set up timeout to execute play even if some clients don't respond
    const timeout = setTimeout(() => {
      console.log(`Audio loading timeout reached after ${RoomManager.AUDIO_LOAD_TIMEOUT_MS}ms. Proceeding with play.`);
      this.executeScheduledPlay(server);
    }, RoomManager.AUDIO_LOAD_TIMEOUT_MS);

    // Store pending play state
    this.pendingPlay = {
      clientsLoaded: new Set([initiatorClientId]),
      timeout,
      playAction,
      initiatorClientId,
      server,
    };

    // Broadcast LOAD_AUDIO_SOURCE to all clients
    sendBroadcast({
      server,
      roomId: this.roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "LOAD_AUDIO_SOURCE",
          audioSourceToPlay: audioSource,
        },
      },
    });

    console.log(`Initiated audio loading for ${audioSource.url} in room ${this.roomId}`);
  }

  allClientsLoadedPendingSource(): boolean {
    if (!this.pendingPlay) {
      console.warn(`Room ${this.roomId}: No pending play state found`);
      return false;
    }

    const clientCount = this.getClients().length;
    // Don't start playback if there are no clients
    if (clientCount === 0) {
      return false;
    }

    return this.pendingPlay.clientsLoaded.size === clientCount;
  }

  /**
   * Process when a client reports they've loaded the audio source
   */
  processClientLoadedAudioSource(clientId: string, sourceUrl: string | BunServer, _server?: BunServer): void {
    const resolvedServer = _server ?? (sourceUrl as BunServer);
    const resolvedSourceUrl = typeof sourceUrl === "string" ? sourceUrl : undefined;

    if (IS_DEMO_MODE) {
      this.serverRef = resolvedServer;
      this.demoAudioReadyClients.add(clientId);
      this.debouncedAudioReady();
      return;
    }

    if (!this.pendingPlay) {
      return;
    }

    if (resolvedSourceUrl && this.pendingPlay.playAction.audioSource !== resolvedSourceUrl) {
      return;
    }

    // Add client to loaded set
    this.pendingPlay.clientsLoaded.add(clientId);

    const loadedCount = this.pendingPlay.clientsLoaded.size;
    const totalCount = this.getClients().length;
    console.log(`Room ${this.roomId}: ${loadedCount}/${totalCount} clients loaded audio`);

    // Check if all active clients have loaded
    if (this.allClientsLoadedPendingSource()) {
      console.log(`Room ${this.roomId}: All clients loaded. Starting playback.`);
      this.executeScheduledPlay(resolvedServer);
    }
  }

  getDemoAudioReadyCount(): number {
    return this.demoAudioReadyClients.size;
  }

  /**
   * Execute the scheduled play after audio loading is complete
   * Could be called by either the timeout or explicitly because all clients loaded
   */
  private executeScheduledPlay(server: BunServer): void {
    if (!this.pendingPlay) {
      return;
    }

    const { playAction } = this.pendingPlay;
    this.clearAudioLoadingState();
    this.broadcastPlay(playAction, server);
  }

  /**
   * Skip audio loading coordination and broadcast play immediately.
   * Used in demo mode where audio is pre-cached on clients.
   */
  executeImmediatePlay(playAction: PlayActionType, server: BunServer): void {
    this.broadcastPlay(playAction, server);
  }

  private broadcastPlay(playAction: PlayActionType, server: BunServer): void {
    const serverTimeToExecute = this.getScheduledExecutionTime();
    const success = this.updatePlaybackSchedulePlay(playAction, serverTimeToExecute);

    if (success) {
      sendBroadcast({
        server,
        roomId: this.roomId,
        message: {
          type: "SCHEDULED_ACTION",
          scheduledAction: playAction,
          serverTimeToExecute,
        },
      });
      console.log(`Scheduled play for ${playAction.audioSource} in room ${this.roomId}`);
    } else {
      console.warn(`Failed to execute play - track may have been removed: ${playAction.audioSource}`);
    }
  }

  getAudioSources(): AudioSourceType[] {
    return this.audioSources;
  }

  getPlaybackState(): RoomPlaybackState {
    return this.playbackState;
  }

  /**
   * Add a client to the room
   */
  addClient(ws: ServerWebSocket<WSData>): void {
    // Cancel any pending cleanup since room is active again
    this.cancelCleanup();

    const { username, clientId } = ws.data;

    // Check if this client has cached data from a previous connection
    const clientData: ClientDataType = {
      joinedAt: Date.now(),
      username,
      clientId,
      isCreator: ws.data.isCreator,
      rtt: 0,
      compensationMs: 0,
      nudgeMs: 0,
      position: { x: GRID.ORIGIN_X, y: GRID.ORIGIN_Y - 25 }, // Initial position at center
      lastNtpResponse: Date.now(), // Initialize last NTP response time
    };

    const cachedClient = this.clientData.get(clientId);

    // Restore some specific fields.
    if (cachedClient) {
      clientData.location = cachedClient.location;
      clientData.joinedAt = cachedClient.joinedAt;
      clientData.nudgeMs = cachedClient.nudgeMs;
    }

    this.clientData.set(clientId, clientData);
    this.wsConnections.set(clientId, ws);

    positionClientsInCircle(this.getClients());

    // Idempotently start heartbeat checking
    this.startHeartbeatChecking();

    // Notify that client count changed
    this.onClientCountChange?.();
  }

  /**
   * Remove a client from the room
   */
  removeClient(clientId: string): void {
    // Only remove from wsConnections, keep clientData for rejoin scenarios
    this.wsConnections.delete(clientId);
    if (this.demoAudioReadyClients.delete(clientId)) {
      this.debouncedAudioReady();
    }

    const activeClients = this.getClients();
    // Reposition remaining clients if any
    if (activeClients.length > 0) {
      positionClientsInCircle(activeClients);
    } else {
      // Stop heartbeat checking if no clients remain
      this.stopHeartbeatChecking();
    }

    // Check if we were waiting for this client to load audio
    if (this.pendingPlay) {
      // Remove client from loaded set if they were there
      this.pendingPlay.clientsLoaded.delete(clientId);

      // Recheck if all remaining clients have loaded
      if (this.allClientsLoadedPendingSource()) {
        console.log(`Client left during loading. All remaining clients loaded. Starting playback.`);
        // Use the stored server reference
        this.executeScheduledPlay(this.pendingPlay.server);
      }
    }

    // Notify that client count changed
    this.onClientCountChange?.();
  }

  /**
   * Add an audio source to the room
   */
  addAudioSource(source: AudioSourceType): AudioSourceType[] {
    this.audioSources.push(source);
    this.isPlaylistDirty = true;
    return this.audioSources;
  }

  replaceAudioSource(oldUrl: string, newSource: AudioSourceType): AudioSourceType[] {
    const index = this.audioSources.findIndex((source) => source.url === oldUrl);
    if (index === -1) {
      return this.audioSources;
    }

    this.audioSources[index] = newSource;
    this.isPlaylistDirty = true;

    if (this.playbackState.audioSource === oldUrl) {
      this.playbackState = {
        ...this.playbackState,
        audioSource: newSource.url,
      };
    }

    if (this.pendingPlay?.playAction.audioSource === oldUrl) {
      this.pendingPlay.playAction = {
        ...this.pendingPlay.playAction,
        audioSource: newSource.url,
      };
    }

    return this.audioSources;
  }

  // Set all audio sources (used in backup restoration)
  setAudioSources(sources: AudioSourceType[]): AudioSourceType[] {
    this.audioSources = sources;
    return this.audioSources;
  }

  removeAudioSources(urls: string[]): {
    updated: AudioSourceType[];
    removedCurrent: boolean;
    removedUrl?: string;
  } {
    const before = this.audioSources.length;
    const urlSet = new Set(urls);

    // Check if current playback url is being removed
    const removingCurrent = this.playbackState.type === "playing" && urlSet.has(this.playbackState.audioSource);

    const removedUrl = removingCurrent ? this.playbackState.audioSource : undefined;

    this.audioSources = this.audioSources.filter((s) => !urlSet.has(s.url));

    // Reset playback state if we removed the currently playing track
    if (removingCurrent) {
      console.log(`Room ${this.roomId}: Currently playing track was removed. Resetting playback state.`);
      this.playbackState = INITIAL_PLAYBACK_STATE;
    }

    const after = this.audioSources.length;
    if (before !== after) {
      console.log(`Removed ${before - after} sources from room ${this.roomId}: `);
      this.isPlaylistDirty = true;
    }
    return {
      updated: this.audioSources,
      removedCurrent: removingCurrent,
      removedUrl,
    };
  }

  /**
   * Get all clients in the room
   */
  getClients(): ClientDataType[] {
    // Only return clients that have an active WebSocket connection
    return Array.from(this.clientData.values()).filter((client) => this.wsConnections.has(client.clientId));
  }

  /**
   * Get a client's WebSocket connection
   */
  getClientWs(clientId: string): ServerWebSocket<WSData> | undefined {
    return this.wsConnections.get(clientId);
  }

  /**
   * Check if the room has any active clients based on recent NTP heartbeats
   * This is more reliable than checking WebSocket readyState which can be inconsistent
   */
  hasActiveConnections(): boolean {
    const now = Date.now();
    const clients = this.getClients();

    for (const client of clients) {
      // A client is considered active if they've sent an NTP request within the timeout window
      // This is more reliable than WebSocket readyState during network fluctuations
      const timeSinceLastResponse = now - client.lastNtpResponse;
      if (timeSinceLastResponse <= NTP_CONSTANTS.RESPONSE_TIMEOUT_MS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the room state
   */
  getState(): RoomData {
    return {
      audioSources: this.audioSources,
      clients: this.getClients(),
      roomId: this.roomId,
      listeningSource: this.listeningSource,
      globalVolume: this.globalVolume,
      lowPassFreq: this.lowPassFreq,
    };
  }

  /**
   * Get room statistics
   */
  getStats(): RoomType {
    return {
      roomId: this.roomId,
      clientCount: this.getClients().length,
      audioSourceCount: this.audioSources.length,
      hasSpatialAudio: this.isSpatialAudioRunning,
    };
  }

  getNumClients(): number {
    return this.getClients().length;
  }

  /**
   * Stream job management methods
   * Idempotently adds a stream job for a track if not already active.
   */
  addStreamJob(trackId: string): void {
    this.activeStreamJobs.set(trackId, { status: "active" });
  }

  removeStreamJob(trackId: string): void {
    this.activeStreamJobs.delete(trackId);
  }

  hasActiveStreamJob(trackId: string): boolean {
    return this.activeStreamJobs.has(trackId);
  }

  getActiveStreamJobCount(): number {
    return this.activeStreamJobs.size;
  }

  /**
   * Add a chat message to the room
   */
  addChatMessage({ clientId, text }: { clientId: string; text: string }): ChatMessageType {
    const client = this.clientData.get(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found in room ${this.roomId}`);
    }

    return this.chatManager.addMessage({ client, text });
  }

  /**
   * Get chat history
   */
  getFullChatHistory(): ChatMessageType[] {
    return this.chatManager.getFullHistory();
  }

  /**
   * Get the newest message ID
   */
  getNewestChatId(): number {
    return this.chatManager.getNewestId();
  }

  /**
   * Get the maximum RTT among all connected clients
   */
  getMaxClientRTT(): number {
    const activeClients = this.getClients();
    if (activeClients.length === 0) return DEFAULT_CLIENT_RTT_MS; // Default RTT if no clients

    let maxRTT = DEFAULT_CLIENT_RTT_MS; // Minimum default RTT
    for (const client of activeClients) {
      if (client.rtt > maxRTT) {
        maxRTT = client.rtt;
      }
    }

    return maxRTT;
  }

  /**
   * Get the maximum client compensation (outputLatency + nudge) among all connected clients
   */
  getMaxClientCompensation(): number {
    const activeClients = this.getClients();
    let maxCompensation = 0;
    for (const client of activeClients) {
      if (client.compensationMs > maxCompensation) {
        maxCompensation = client.compensationMs;
      }
    }
    return maxCompensation;
  }

  /**
   * Get the scheduled execution time based on dynamic RTT + max client compensation.
   * The scheduling delay must be large enough for all clients to receive the message
   * AND apply their local compensation (outputLatency + nudge) without going negative.
   */
  getScheduledExecutionTime(opts: { extraOffsetMs: number } = { extraOffsetMs: 0 }): number {
    const maxRTT = this.getMaxClientRTT();
    const maxCompensation = this.getMaxClientCompensation();
    const baseDelayMs = calculateScheduleTimeMs(maxRTT);
    // Ensure enough headroom for the client with the largest local compensation
    const scheduleDelayMs = Math.max(baseDelayMs, maxCompensation + 200);
    console.log(
      `Scheduling with dynamic delay: ${scheduleDelayMs}ms (max RTT: ${maxRTT}ms, max compensation: ${maxCompensation}ms)`
    );
    return epochNow() + scheduleDelayMs + opts.extraOffsetMs;
  }

  /**
   * Receive an NTP request from a client
   */
  processNTPRequestFrom(data: {
    clientId: string;
    clientRTT?: number;
    clientCompensationMs?: number;
    clientNudgeMs?: number;
  }): void {
    const { clientId, clientRTT, clientCompensationMs, clientNudgeMs } = data;
    const client = this.clientData.get(clientId);
    if (!client) return;
    this.touchClientActivity(clientId);

    // Log first NTP probe per client (confirms probes are flowing)
    if (client.rtt === 0 && clientRTT !== undefined && clientRTT > 0) {
      console.log(
        `[NTP] First probe from ${client.username} (${clientId}) in room ${this.roomId} | RTT=${clientRTT.toFixed(1)}ms`
      );
    }

    // Update RTT if provided (using exponential moving average for smoothing)
    if (clientRTT !== undefined && clientRTT > 0) {
      const alpha = 0.2; // Smoothing factor
      client.rtt =
        client.rtt > 0
          ? client.rtt * (1 - alpha) + clientRTT * alpha // Exponential moving average
          : clientRTT; // First measurement
    }

    // Store client's total local compensation (outputLatency + nudge)
    if (clientCompensationMs !== undefined && clientCompensationMs > 0) {
      client.compensationMs = clientCompensationMs;
    }

    // Store client's manual nudge value (always update, including 0)
    if (clientNudgeMs !== undefined) {
      client.nudgeMs = clientNudgeMs;
    }

    this.clientData.set(clientId, client);
  }

  touchClientActivity(clientId: string): void {
    const client = this.clientData.get(clientId);
    if (!client) return;
    client.lastNtpResponse = Date.now();
  }

  /**
   * Reorder clients, moving the specified client to the front
   */
  reorderClients(clientId: string, server: BunServer): ClientDataType[] {
    const clients = this.getClients();
    const clientIndex = clients.findIndex((client) => client.clientId === clientId);

    if (clientIndex === -1) return clients; // Client not found

    // Move the client to the front
    const [client] = clients.splice(clientIndex, 1);
    clients.unshift(client);

    // Update the clients map to maintain the new order
    this.clientData.clear();
    clients.forEach((client) => {
      this.clientData.set(client.clientId, client);
    });

    // Update client positions based on new order
    positionClientsInCircle(this.getClients());

    // Update gains
    this._calculateGainsAndBroadcast(server);

    return clients;
  }

  /**
   * Move a client to a new position
   */
  moveClient(clientId: string, position: PositionType, server: BunServer): void {
    const client = this.clientData.get(clientId);
    if (!client) return;

    client.position = position;
    this.clientData.set(clientId, client);

    sendBroadcast({
      server,
      roomId: this.roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "CLIENT_MOVED",
          clientId,
          position,
        },
      },
    });
  }

  /**
   * Update the listening source position
   */
  updateListeningSource(position: PositionType, server: BunServer): void {
    this.listeningSource = position;
    this._calculateGainsAndBroadcast(server);
  }

  /**
   * Set global volume for all clients
   */
  setGlobalVolume(volume: number, server: BunServer): void {
    this.globalVolume = Math.max(0, Math.min(1, volume)); // Clamp 0-1

    sendBroadcast({
      server,
      roomId: this.roomId,
      message: {
        type: "SCHEDULED_ACTION",
        serverTimeToExecute: epochNow(), // Execute ASAP
        scheduledAction: {
          type: "GLOBAL_VOLUME_CONFIG",
          volume: this.globalVolume,
          rampTime: 0.1,
        },
      },
    });
  }

  setLowPassFreq(freq: number, server: BunServer): void {
    this.lowPassFreq = Math.max(LOW_PASS_CONSTANTS.MIN_FREQ, Math.min(LOW_PASS_CONSTANTS.MAX_FREQ, freq));

    sendBroadcast({
      server,
      roomId: this.roomId,
      message: {
        type: "SCHEDULED_ACTION",
        serverTimeToExecute: epochNow(),
        scheduledAction: {
          type: "LOW_PASS_CONFIG",
          freq: this.lowPassFreq,
          rampTime: 0.05,
        },
      },
    });
  }

  setMetronome(enabled: boolean, server: BunServer): void {
    this.isMetronomeEnabled = enabled;

    sendBroadcast({
      server,
      roomId: this.roomId,
      message: {
        type: "SCHEDULED_ACTION",
        serverTimeToExecute: epochNow(),
        scheduledAction: {
          type: "METRONOME_CONFIG",
          enabled: this.isMetronomeEnabled,
        },
      },
    });
  }

  getIsMetronomeEnabled(): boolean {
    return this.isMetronomeEnabled;
  }

  getIsSpatialAudioRunning(): boolean {
    return this.isSpatialAudioRunning;
  }

  getSpatialStartTime(): number {
    return this.spatialStartTime;
  }

  /**
   * Start spatial audio interval (now client-side)
   */
  startSpatialAudio(server: BunServer): void {
    // Don't start if already running
    if (this.isSpatialAudioRunning) return;

    this.isSpatialAudioRunning = true;
    this.spatialStartTime = epochNow();

    // Send the updated configuration to all clients once
    const message: WSBroadcastType = {
      type: "SCHEDULED_ACTION",
      serverTimeToExecute: this.getScheduledExecutionTime(),
      scheduledAction: {
        type: "SPATIAL_CONFIG",
        centerX: GRID.ORIGIN_X,
        centerY: GRID.ORIGIN_Y,
        radius: 25,
        speed: Math.PI / 3000, // equivalent to (Math.PI / 30) per 100ms
        startTime: this.spatialStartTime,
      },
    };

    sendBroadcast({ server, roomId: this.roomId, message });
  }

  /**
   * Stop spatial audio interval
   */
  stopSpatialAudio(): void {
    this.isSpatialAudioRunning = false;
  }

  updatePlaybackSchedulePause(pauseSchema: PauseActionType, serverTimeToExecute: number): boolean {
    // Validate that the audio source exists in the room (if provided)
    // Pause can reference a track that might have been deleted, which is ok
    // But we should validate if the track is specified
    if (pauseSchema.audioSource) {
      const trackExists = this.audioSources.some((source) => source.url === pauseSchema.audioSource);

      if (!trackExists) {
        console.warn(`Room ${this.roomId}: Attempted to pause non-existent track: ${pauseSchema.audioSource}`);
        // For pause, we'll still update but with empty audioSource
        this.playbackState = {
          type: "paused",
          audioSource: "",
          trackPositionSeconds: 0,
          serverTimeToExecute: serverTimeToExecute,
        };
        return false;
      }
    }

    this.playbackState = {
      type: "paused",
      audioSource: pauseSchema.audioSource,
      trackPositionSeconds: pauseSchema.trackTimeSeconds,
      serverTimeToExecute: serverTimeToExecute,
    };
    return true;
  }

  updatePlaybackSchedulePlay(playSchema: PlayActionType, serverTimeToExecute: number): boolean {
    // Validate that the audio source exists in the room
    const trackExists = this.audioSources.some((source) => source.url === playSchema.audioSource);

    if (!trackExists) {
      console.warn(`Room ${this.roomId}: Attempted to play non-existent track: ${playSchema.audioSource}`);
      return false;
    }

    this.playbackState = {
      type: "playing",
      audioSource: playSchema.audioSource,
      trackPositionSeconds: playSchema.trackTimeSeconds,
      serverTimeToExecute: serverTimeToExecute,
    };
    return true;
  }

  syncClient(ws: ServerWebSocket<WSData>): void {
    // A client has joined late, and needs to sync with the room
    // Predict where the playback state will be after the dynamic scheduling delay
    // And make client play at that position then

    // Determine if we are currently playing or paused
    if (this.playbackState.type === "paused") {
      return; // Nothing to do - client will play on next scheduled action
    }

    const serverTimeWhenPlaybackStarted = this.playbackState.serverTimeToExecute;
    const trackPositionSecondsWhenPlaybackStarted = this.playbackState.trackPositionSeconds;
    const now = epochNow();

    // Use dynamic scheduling based on max client RTT
    const serverTimeToExecute = this.getScheduledExecutionTime({
      extraOffsetMs: 1500, // Another extra 1.5 seconds to sync
    });

    // Calculate how much time has elapsed since playback started
    const timeElapsedSincePlaybackStarted = now - serverTimeWhenPlaybackStarted;

    // Calculate how much time will have elapsed by the time the client responds
    // to the sync response
    const timeElapsedAtExecution = serverTimeToExecute - serverTimeWhenPlaybackStarted;

    // Convert to seconds and add to the starting position
    const resumeTrackTimeSeconds = trackPositionSecondsWhenPlaybackStarted + timeElapsedAtExecution / 1000;
    console.log(
      `Syncing late client: track started at ${trackPositionSecondsWhenPlaybackStarted.toFixed(2)}s, ` +
        `${(timeElapsedSincePlaybackStarted / 1000).toFixed(2)}s elapsed, ` +
        `will be at ${resumeTrackTimeSeconds.toFixed(2)}s when client starts`
    );

    sendUnicast({
      ws,
      message: {
        type: "SCHEDULED_ACTION",
        scheduledAction: {
          type: "PLAY",
          audioSource: this.playbackState.audioSource,
          trackTimeSeconds: resumeTrackTimeSeconds, // Use the calculated position
        },
        serverTimeToExecute: serverTimeToExecute,
      },
    });
  }

  processIP({
    ws,
    message: { location },
  }: {
    ws: ServerWebSocket<WSData>;
    message: z.infer<typeof SendLocationSchema>;
  }): void {
    const client = this.clientData.get(ws.data.clientId);
    if (!client) return;

    client.location = location;

    this.clientData.set(client.clientId, client);
  }

  getClient(clientId: string): ClientDataType | undefined {
    return this.clientData.get(clientId);
  }

  /**
   * Get the backup state for this room
   */
  createBackup(): RoomBackupType {
    return {
      clientDatas: Array.from(this.clientData.values()),
      audioSources: this.audioSources,
      globalVolume: this.globalVolume,
      lowPassFreq: this.lowPassFreq,
      playbackState: this.playbackState,
    };
  }

  /**
   * Schedule cleanup after a delay
   */
  scheduleCleanup(callback: () => Promise<void>, delayMs: number): void {
    // Cancel any existing timer
    this.cancelCleanup();

    // Schedule new cleanup after specified delay
    this.cleanupTimer = setTimeout(() => void callback(), delayMs);
    console.log(`⏱️ Scheduled cleanup for room ${this.roomId} in ${delayMs}ms`);
  }

  /**
   * Cancel pending cleanup
   */
  cancelCleanup(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = undefined;
      console.log(`🚫 Cleanup timer cleared for room ${this.roomId}`);
    }
  }

  /** Debounce a CLIENT_CHANGE broadcast. Coalesces rapid joins/leaves into one callback. */
  scheduleClientChangeBroadcast(callback: () => void): void {
    this.pendingClientChangeCb = callback;
    this.debouncedClientChange();
  }

  clearClientChangeBroadcast(): void {
    this.debouncedClientChange.cancel();
    this.pendingClientChangeCb = undefined;
  }

  private flushAudioReadyBroadcast(): void {
    if (!this.serverRef) return;
    sendBroadcast({
      server: this.serverRef,
      roomId: this.roomId,
      message: { type: "DEMO_AUDIO_READY_COUNT", count: this.demoAudioReadyClients.size },
    });
  }

  /**
   * Save playlist to R2 bucket
   */
  async savePlaylist(): Promise<void> {
    if (IS_DEMO_MODE) return;
    const key = `room-${this.roomId}/playlist.json`;
    await uploadJSON(key, this.audioSources);
    this.isPlaylistDirty = false;
    console.log(`Saved playlist to R2 for room ${this.roomId}: ${this.audioSources.length} tracks`);
  }

  /**
   * Load saved playlist from R2 if it exists
   */
  async loadPlaylistFromR2(server?: BunServer): Promise<void> {
    if (IS_DEMO_MODE || this.isPlaylistLoaded) return;
    this.isPlaylistLoaded = true; // Mark loaded early to prevent multiple calls

    const key = `room-${this.roomId}/playlist.json`;
    try {
      const savedSources = await downloadJSON<AudioSourceType[]>(key);
      if (savedSources && Array.isArray(savedSources) && savedSources.length > 0) {
        console.log(`Loaded ${savedSources.length} saved audio sources for room ${this.roomId} from R2`);
        this.audioSources = savedSources;
        this.isPlaylistDirty = false;

        // If clients exist, broadcast the restored playlist
        if (server && this.getClients().length > 0) {
          sendBroadcast({
            server,
            roomId: this.roomId,
            message: {
              type: "ROOM_EVENT",
              event: { type: "SET_AUDIO_SOURCES", sources: this.audioSources },
            },
          });
        }
      }
    } catch (error) {
      console.error(`Failed to load saved playlist for room ${this.roomId}:`, error);
    }
  }

  /**
   * Clean up unused files from the room's R2 directory
   */
  async cleanupUnusedFiles(): Promise<{ deletedCount: number }> {
    if (IS_DEMO_MODE) return { deletedCount: 0 };
    try {
      const prefix = `room-${this.roomId}/`;
      const objects = await listObjectsWithPrefix(prefix, { includeFolders: false });
      if (!objects || objects.length === 0) {
        return { deletedCount: 0 };
      }

      // Collect URLs of all tracks currently in the playlist
      const playlistUrls = new Set(this.audioSources.map((source) => source.url));
      const playlistKey = `${prefix}playlist.json`;

      let deletedCount = 0;
      for (const obj of objects) {
        if (!obj.Key) continue;
        if (obj.Key === playlistKey) continue;

        const publicUrl = getPublicUrlForKey(obj.Key);
        if (!playlistUrls.has(publicUrl)) {
          console.log(`[Cleanup] Deleting unused room file: ${obj.Key}`);
          await deleteObject(obj.Key);
          deletedCount++;
        }
      }

      return { deletedCount };
    } catch (error) {
      console.error(`Failed to cleanup unused files for room ${this.roomId}:`, error);
      return { deletedCount: 0 };
    }
  }

  /**
   * Clean up room resources (e.g., R2 storage)
   */
  async cleanup(): Promise<void> {
    console.log(`🧹 Starting room cleanup for room ${this.roomId}...`);

    // Stop any running intervals
    this.stopSpatialAudio();
    this.stopHeartbeatChecking();
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }

    if (!IS_DEMO_MODE) {
      try {
        if (this.isPlaylistDirty) {
          await this.savePlaylist();
        }
        const result = await this.cleanupUnusedFiles();
        console.log(`✅ Room ${this.roomId} cleanup finished: cleaned up ${result.deletedCount} unused files`);
      } catch (error) {
        console.error(`❌ Room ${this.roomId} cleanup failed:`, error);
      }
    }
  }

  /**
   * No longer needed as spatial audio is client-side.
   * Kept for interface compatibility if needed, but basically a no-op.
   */
  private _calculateGainsAndBroadcast(_server: BunServer): void {
    // Client handles spatial gains locally now.
  }

  /**
   * Start checking for stale client connections
   */
  private startHeartbeatChecking(): void {
    // Don't start if already running
    if (this.heartbeatCheckInterval) return;

    console.log(`💓 Starting heartbeat for room ${this.roomId}`);

    this.heartbeatCheckInterval = setInterval(() => {
      const now = Date.now();

      this.getClients().forEach((client) => {
        const timeSinceLastResponse = now - client.lastNtpResponse;
        if (timeSinceLastResponse <= NTP_CONSTANTS.RESPONSE_TIMEOUT_MS) return;

        console.warn(
          `⚠️ Client ${client.clientId} in room ${this.roomId} has not responded for ${timeSinceLastResponse}ms, disconnecting`
        );

        // terminate() hard-closes the socket without waiting for the peer. A graceful
        // close() never completes against a dead TCP peer (the close frame is never
        // acknowledged), which used to leak connections — and rooms — indefinitely.
        try {
          this.wsConnections.get(client.clientId)?.terminate();
        } catch (error) {
          console.error(`Error terminating WebSocket for client ${client.clientId}:`, error);
        }
        // Remove immediately rather than relying on the close handler to fire;
        // removeClient is idempotent if the close handler also runs.
        this.removeClient(client.clientId);
      });
      // Reaping bypasses handleClose's cleanup scheduling — make sure an empty room
      // still gets cleaned up.
      if (this.wsConnections.size === 0) {
        this.onBecameEmpty?.();
      }
    }, NTP_CONSTANTS.STEADY_STATE_INTERVAL_MS);
  }

  /**
   * Stop checking for stale client connections
   */
  private stopHeartbeatChecking(): void {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = undefined;
      console.log(`💔 Stopped heartbeat checking for room ${this.roomId}`);
    }
  }

  // For active rooms display endpoint:
  serialize(): DiscoveryRoomType {
    return {
      roomId: this.roomId,
      clients: this.getClients(),
      audioSources: this.audioSources,
      playbackState: this.playbackState,
    };
  }

  restoreClientData(clientData: ClientDataType[]): void {
    clientData.forEach((client) => {
      this.clientData.set(client.clientId, client);
    });
  }

  restorePlaybackState(playbackState: RoomPlaybackState): void {
    this.playbackState = playbackState;
  }

  /**
   * Restore chat history from backup
   */
  restoreChatHistory(chat: { messages: ChatMessageType[]; nextMessageId: number }): void {
    if (chat.messages.length > 0) {
      this.chatManager.restoreMessages(chat.messages, chat.nextMessageId);
    }
  }

  reorderAudioSource(newOrder: AudioSourceType[]): void | Error {
    if (newOrder.length !== this.audioSources.length) {
      console.warn(`Attempted to reorder audio sources with mismatched length in room ${this.roomId}`);
      return new Error(`Mismatched audio sources length`);
    }

    this.audioSources = newOrder;
    this.isPlaylistDirty = true;
  }
}

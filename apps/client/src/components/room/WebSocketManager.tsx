"use client";
import { useClientId } from "@/hooks/useClientId";
import { useNtpHeartbeat } from "@/hooks/useNtpHeartbeat";
import { useWebSocketReconnection } from "@/hooks/useWebSocketReconnection";
import { getWsUrl } from "@/lib/urls";
import { useChatStore } from "@/store/chat";
import { useGlobalStore } from "@/store/global";
import { toast } from "sonner";
import { useRoomStore } from "@/store/room";
import { validateProbePair, getProbeStats, NTPMeasurement } from "@/utils/ntp";
import { sendWSRequest } from "@/utils/ws";
import { ClientActionEnum, epochNow, NTPResponseMessageType, WSResponseSchema } from "@beatsync/shared";
import { useEffect, useRef } from "react";

/**
 * Process an NTP_RESPONSE into a measurement and attempt to complete a probe pair.
 * Returns a ProbePairResult if both probes in the pair have been received and validated,
 * or null if still waiting for the second probe or the pair was impure.
 */
const handleNTPResponse = (response: NTPResponseMessageType): NTPMeasurement | null => {
  const t3 = epochNow();
  const { t0, t1, t2, probeGroupId, probeGroupIndex } = response;

  const clockOffset = (t1 - t0 + (t2 - t3)) / 2;
  const roundTripDelay = t3 - t0 - (t2 - t1);
  const measurement: NTPMeasurement = { t0, t1, t2, t3, roundTripDelay, clockOffset };

  return validateProbePair({ measurement, probeGroupId, probeGroupIndex });
};

interface WebSocketManagerProps {
  roomId: string;
  username: string;
}

// No longer need the props interface
export const WebSocketManager = ({ roomId, username }: WebSocketManagerProps) => {
  // Get PostHog client ID
  const { clientId } = useClientId();

  // Room state
  const isLoadingRoom = useRoomStore((state) => state.isLoadingRoom);

  // WebSocket and audio state
  const setSocket = useGlobalStore((state) => state.setSocket);
  const socket = useGlobalStore((state) => state.socket);
  const schedulePlay = useGlobalStore((state) => state.schedulePlay);
  const schedulePause = useGlobalStore((state) => state.schedulePause);
  const processSpatialConfig = useGlobalStore((state) => state.processSpatialConfig);
  const addProbePairResult = useGlobalStore((state) => state.addProbePairResult);
  const setConnectedClients = useGlobalStore((state) => state.setConnectedClients);
  const updateClientPosition = useGlobalStore((state) => state.updateClientPosition);
  const isSpatialAudioEnabled = useGlobalStore((state) => state.isSpatialAudioEnabled);
  const setIsSpatialAudioEnabled = useGlobalStore((state) => state.setIsSpatialAudioEnabled);
  const processStopSpatialAudio = useGlobalStore((state) => state.processStopSpatialAudio);
  const processGlobalVolumeConfig = useGlobalStore((state) => state.processGlobalVolumeConfig);
  const processLowPassConfig = useGlobalStore((state) => state.processLowPassConfig);
  const processMetronomeConfig = useGlobalStore((state) => state.processMetronomeConfig);
  const handleSetAudioSources = useGlobalStore((state) => state.handleSetAudioSources);
  const applyFinalGain = useGlobalStore((state) => state.applyFinalGain);
  const setActiveStreamJobs = useGlobalStore((state) => state.setActiveStreamJobs);
  const setMessages = useChatStore((state) => state.setMessages);
  const handleLoadAudioSource = useGlobalStore((state) => state.handleLoadAudioSource);
  const hasConnectedOnceRef = useRef(false);

  // Use the NTP heartbeat hook
  const { startHeartbeat, stopHeartbeat } = useNtpHeartbeat();

  // Use the WebSocket reconnection hook
  const {
    onConnectionOpen,
    scheduleReconnection,
    cleanup: cleanupReconnection,
  } = useWebSocketReconnection({
    maxAttempts: 0,
    initialInterval: 1000,
    maxInterval: 3000,
    createConnection: () => createConnection(),
  });

  // Cache secrets from page URL (don't change across reconnections)
  const isClient = typeof window !== "undefined";
  const searchParams = isClient ? new URLSearchParams(window.location.search) : null;
  const adminSecret = searchParams?.get("admin") ?? null;
  // Check URL param first, then localStorage (set once via: localStorage.setItem("creatorSecret", "..."))
  const creatorSecret = searchParams?.get("creator") ?? (isClient ? localStorage.getItem("creatorSecret") : null);
  const adminParam = adminSecret ? `&admin=${encodeURIComponent(adminSecret)}` : "";
  const creatorParam = creatorSecret ? `&creator=${encodeURIComponent(creatorSecret)}` : "";

  const createConnection = () => {
    const SOCKET_URL = `${getWsUrl()}?roomId=${roomId}&username=${username}&clientId=${clientId}${adminParam}${creatorParam}`;
    console.log("Creating new WS connection to", SOCKET_URL);

    // Clear the actual current connection, including sockets created by a
    // previous reconnect attempt (the render closure can otherwise be stale).
    const previousSocket = useGlobalStore.getState().socket;
    if (previousSocket) {
      console.log("Clearing previous connection");
      previousSocket.onclose = () => {};
      previousSocket.onerror = () => {};
      previousSocket.onmessage = () => {};
      previousSocket.onopen = () => {};
      previousSocket.close();
    }

    const ws = new WebSocket(SOCKET_URL);

    setSocket(ws);

    ws.onopen = async () => {
      console.log("Websocket onopen fired.");
      hasConnectedOnceRef.current = true;

      // Reset reconnection state
      onConnectionOpen();

      // Start NTP heartbeat
      startHeartbeat();

      sendWSRequest({
        ws,
        request: { type: ClientActionEnum.enum.UPDATE_PROFILE, avatar: useRoomStore.getState().avatar },
      });

      // Resume an audio load that was requested while the backend was offline.
      const globalState = useGlobalStore.getState();
      const pendingAudio = globalState.audioSources.find(
        (source) => source.source.url === globalState.awaitingSyncAfterLoadUrl
      );
      if (pendingAudio && pendingAudio.status !== "loaded" && pendingAudio.status !== "loading") {
        handleLoadAudioSource({
          type: "LOAD_AUDIO_SOURCE",
          audioSourceToPlay: pendingAudio.source,
        });
      }

      // Request notification permission for chat alerts outside browser
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    };

    // This onclose event will only fire on unwanted websocket disconnects:
    // - Network chnage
    // - Server restart
    // So we should try to reconnect.
    ws.onclose = () => {
      console.log("Websocket closed unexpectedly");
      // Stop NTP heartbeat
      stopHeartbeat();

      // Clear NTP measurements on new connection to avoid stale data
      useGlobalStore.getState().onConnectionReset();

      // Schedule reconnection with exponential backoff
      scheduleReconnection();
    };

    ws.onerror = () => {
      // Closing guarantees the normal reconnection path runs on browsers that
      // otherwise leave a failed socket stuck in CONNECTING.
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
    };

    // TODO: Refactor into exhaustive handler registry
    ws.onmessage = async (msg) => {
      const response = WSResponseSchema.parse(JSON.parse(msg.data));
      if (response.type !== "NTP_RESPONSE") {
        // Avoid a global store update for every timing probe. UI actions only
        // need to observe actual application responses.
        useGlobalStore.setState({ lastMessageReceivedTime: Date.now() });
      }

      if (response.type === "NTP_RESPONSE") {
        const pairResult = handleNTPResponse(response);
        if (pairResult) {
          addProbePairResult(pairResult);
        }
        // Pair statistics only change on the second response. Skipping the
        // first response avoids one unnecessary global store update per pair.
        if (response.probeGroupIndex === 1) {
          useGlobalStore.setState({ probeStats: getProbeStats() });
        }
      } else if (response.type === "ROOM_EVENT") {
        const { event } = response;
        console.log("Room event:", event);

        if (event.type === "CLIENT_CHANGE") {
          setConnectedClients(event.clients);
          return;
        }

        if (event.type === "CLIENT_MOVED") {
          updateClientPosition(event.clientId, event.position);
          return;
        }

        if (event.type === "SET_AUDIO_SOURCES") {
          handleSetAudioSources(event);
        } else if (event.type === "CHAT_UPDATE") {
          // Handle chat messages
          setMessages(event.messages, event.isFullSync, event.newestId);
          if (!event.isFullSync && event.messages && event.messages.length > 0) {
            event.messages.forEach((msg) => {
              if (msg.clientId !== clientId) {
                // Play notification sound
                const notificationVolume = useChatStore.getState().notificationVolume;
                if (notificationVolume > 0) {
                  const notificationAudio = new Audio("/anime-ahh.mp3");
                  notificationAudio.volume = notificationVolume;
                  notificationAudio.play().catch(() => {});
                }

                // Show desktop notification even when user is outside the browser window
                if (typeof window !== "undefined" && "Notification" in window) {
                  if (Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
                    try {
                      const notif = new Notification(`💬 ${msg.username}`, {
                        body: msg.text,
                        icon: "/account.png",
                      });
                      notif.onclick = () => {
                        window.focus();
                        notif.close();
                      };
                    } catch (e) {
                      console.warn("Desktop notification error:", e);
                    }
                  }
                }
              }
            });
          }
        } else if (event.type === "LOAD_AUDIO_SOURCE") {
          handleLoadAudioSource(event);
        }
      } else if (response.type === "SCHEDULED_ACTION") {
        // handle scheduling action
        console.log("Received scheduled action:", response);
        const { scheduledAction, serverTimeToExecute } = response;

        if (scheduledAction.type === "PLAY") {
          schedulePlay({
            trackTimeSeconds: scheduledAction.trackTimeSeconds,
            targetServerTime: serverTimeToExecute,
            audioSource: scheduledAction.audioSource,
          });
        } else if (scheduledAction.type === "PAUSE") {
          schedulePause({
            targetServerTime: serverTimeToExecute,
          });
        } else if (scheduledAction.type === "SPATIAL_CONFIG") {
          processSpatialConfig(scheduledAction);
          if (!isSpatialAudioEnabled) {
            setIsSpatialAudioEnabled(true);
          }
        } else if (scheduledAction.type === "STOP_SPATIAL_AUDIO") {
          processStopSpatialAudio();
        } else if (scheduledAction.type === "GLOBAL_VOLUME_CONFIG") {
          processGlobalVolumeConfig(scheduledAction);
        } else if (scheduledAction.type === "LOW_PASS_CONFIG") {
          processLowPassConfig(scheduledAction);
        } else if (scheduledAction.type === "METRONOME_CONFIG") {
          processMetronomeConfig(scheduledAction);
        }
      } else if (response.type === "SEARCH_RESPONSE") {
        console.log("Received search response:", response);
        const { setSearchResults, setIsSearching, setIsLoadingMoreResults, setHasMoreResults, isLoadingMoreResults } =
          useGlobalStore.getState();

        // Determine if this is pagination or new search
        const isAppending = isLoadingMoreResults;

        // Update search results (append if pagination, replace if new search)
        setSearchResults(response.response, isAppending);

        // Update loading states
        setIsSearching(false);
        setIsLoadingMoreResults(false);

        // Update hasMoreResults based on response
        if (response.response.type === "success") {
          const { total, items, offset } = response.response.response.data.tracks;
          const hasMore = offset + items.length < total;
          setHasMoreResults(hasMore);
        } else {
          setHasMoreResults(false);
        }
      } else if (response.type === "STREAM_JOB_UPDATE") {
        console.log("Received stream job update:", response.activeJobCount);
        setActiveStreamJobs(response.activeJobCount);
      } else if (response.type === "DEMO_USER_COUNT") {
        if (useGlobalStore.getState().demoUserCount !== response.count) {
          useGlobalStore.setState({ demoUserCount: response.count });
        }
      } else if (response.type === "DEMO_AUDIO_READY_COUNT") {
        if (useGlobalStore.getState().demoAudioReadyCount !== response.count) {
          useGlobalStore.setState({ demoAudioReadyCount: response.count });
        }
      } else if (response.type === "WEBRTC_SIGNAL") {
        const onWebRTCSignal = useGlobalStore.getState().onWebRTCSignal;
        if (onWebRTCSignal) {
          onWebRTCSignal(response);
        }
      } else if (response.type === "SAVE_PLAYLIST_RESPONSE") {
        if (response.success) {
          toast.success(response.message);
        } else {
          toast.error(response.message);
        }
      } else {
        console.log("Unknown response type:", response);
      }
    };

    return ws;
  };

  // Once room has been loaded and we have clientId, connect to the websocket
  useEffect(() => {
    // Only run this effect once after room is loaded and clientId is available
    if (isLoadingRoom || !roomId || !username || !clientId) return;

    // Only the initial backend failure uses the static 404 page. Once a room has
    // opened successfully, later packet loss must preserve the mounted UI.
    const safetyTimer = setTimeout(() => {
      const currentSocket = useGlobalStore.getState().socket;
      if (!hasConnectedOnceRef.current && (!currentSocket || currentSocket.readyState !== WebSocket.OPEN)) {
        console.warn("Initial backend connection timed out; opening the static 404 page.");
        window.location.replace("/404.html");
      }
    }, 8000);

    // Don't create a new connection if we already have one
    if (socket) {
      return () => clearTimeout(safetyTimer);
    }

    const ws = createConnection();

    // Handle bfcache restoration (iOS Safari) — WebSocket is killed on freeze
    // but the page is restored without re-running effects
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log("Page restored from bfcache, reconnecting WebSocket");
        createConnection();
      }
    };
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      clearTimeout(safetyTimer);
      // Runs on unmount and dependency change
      console.log("Running cleanup for WebSocket connection");

      window.removeEventListener("pageshow", handlePageShow);

      // Clean up reconnection state
      cleanupReconnection();

      // Clear the onclose handler to prevent reconnection attempts - this is an intentional close
      ws.onclose = () => {
        console.log("Websocket closed by cleanup");
      };

      // Stop NTP heartbeat
      stopHeartbeat();
      ws.close();
    };
    // Not including socket in the dependency array because it will trigger the close when it's set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingRoom, roomId, username, clientId]);

  return null; // This is a non-visual component
};

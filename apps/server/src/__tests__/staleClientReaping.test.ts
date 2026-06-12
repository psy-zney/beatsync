import { afterEach, beforeEach, describe, expect, it, type Mock } from "bun:test";
import { NTP_CONSTANTS } from "@beatsync/shared";
import sinon from "sinon";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockWs } from "@/__tests__/mocks/websocket";
import { CLEANUP_DELAY_MS, globalManager } from "@/managers/GlobalManager";

mockR2();

const TICK_MS = NTP_CONSTANTS.STEADY_STATE_INTERVAL_MS;

describe("Stale Client Reaping", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({
      shouldClearNativeTimers: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const roomIds = globalManager.getRoomIds();
    for (const roomId of roomIds) {
      globalManager.deleteRoom(roomId);
    }
  });

  afterEach(() => {
    clock.restore();
  });

  it("reaps a dead connection whose close event never fires, then deletes the room", async () => {
    // Regression test: a dead TCP peer never completes the close handshake, so the
    // onClose handler can't be relied on to fire — the mock ws's close/terminate are
    // no-ops, simulating exactly that. Before the terminate-and-remove fix, the reaper
    // retried a graceful close() forever: the client was never removed and the room
    // lived (and was backed up) indefinitely.
    const roomId = "zombie-room";
    const room = globalManager.getOrCreateRoom(roomId);
    const ws = createMockWs({ clientId: "zombie", roomId });
    room.addClient(ws);

    // Go stale; the reaper terminates the socket and removes the client on its next tick
    clock.tick(NTP_CONSTANTS.RESPONSE_TIMEOUT_MS + TICK_MS);
    expect((ws.terminate as Mock<() => void>).mock.calls.length).toBe(1);
    expect(room.getClients().length).toBe(0);

    // Reaping bypassed handleClose, so the tick-end hook must have scheduled room cleanup
    await clock.tickAsync(CLEANUP_DELAY_MS + 1000);
    expect(globalManager.getRoom(roomId)).toBeUndefined();
  });

  it("does not reap clients that keep sending NTP requests", () => {
    const roomId = "healthy-room";
    const room = globalManager.getOrCreateRoom(roomId);
    const ws = createMockWs({ clientId: "healthy", roomId });
    room.addClient(ws);

    // Stay just within the response timeout across several reaper ticks
    for (let i = 0; i < 4; i++) {
      clock.tick(TICK_MS);
      const client = room.getClients()[0];
      expect(client).toBeDefined();
      client.lastNtpResponse = Date.now();
    }

    expect((ws.terminate as Mock<() => void>).mock.calls.length).toBe(0);
    expect(room.getClients().length).toBe(1);
  });
});

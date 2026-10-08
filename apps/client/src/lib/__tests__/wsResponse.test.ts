import { expect, test, spyOn } from "bun:test";
import { decodeWSResponse } from "../wsResponse";

test("Go server errors are accepted and preserve the error message", () => {
  expect(decodeWSResponse('{"type":"ERROR","message":"Invalid message format"}')).toEqual({
    type: "ERROR",
    message: "Invalid message format",
  });
});

test("invalid packets never throw and do not prevent the next valid response", () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const data of ["{", "null", "[]", '{"type":"FUTURE_RESPONSE"}', '{"type":"ERROR","message":1}', new Blob()]) {
      expect(decodeWSResponse(data)).toBeNull();
    }
    expect(decodeWSResponse('{"type":"ROOM_JOINED","isNewRoom":false}')).toEqual({
      type: "ROOM_JOINED",
      isNewRoom: false,
    });
    expect(warning.mock.calls.flat().join(" ")).not.toContain('FUTURE_RESPONSE"}');
  } finally {
    warning.mockRestore();
  }
});

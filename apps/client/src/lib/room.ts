export const validatePartialRoomId = (roomId: string) => {
  return /^\d*$/.test(roomId);
};

export const validateFullRoomId = (roomId: string) => {
  return /^[0-9]{6}$/.test(roomId);
};

export const generateRoomId = (excluded: string[] = []) => {
  let roomId: string;
  do {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    roomId = value.toString().padStart(6, "0");
  } while (roomId === "090624" || excluded.includes(roomId));
  return roomId;
};

export const createUserId = () => {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  } else {
    // Fallback for insecure contexts
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
};

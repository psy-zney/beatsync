export interface LocalProfile {
  name: string;
  avatar: string;
}

const PROFILE_STORAGE_KEY = "beatsync-profile";
export const DEFAULT_AVATAR = "🎧";

export const readLocalProfile = (): LocalProfile | null => {
  if (typeof window === "undefined") return null;

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { name, avatar } = value as Partial<LocalProfile>;
    if (typeof name !== "string" || !name.trim()) return null;
    return { name: name.trim().slice(0, 32), avatar: typeof avatar === "string" && avatar ? avatar : DEFAULT_AVATAR };
  } catch {
    return null;
  }
};

export const saveLocalProfile = (profile: LocalProfile): void => {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
};

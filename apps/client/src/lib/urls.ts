/**
 * Resolves API and WS base URLs.
 *
 * If NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL are set, uses those (explicit mode).
 * Otherwise, derives from window.location (same-origin mode, for Caddy reverse proxy).
 */

let cached: { apiUrl: string; wsUrl: string } | null = null;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function shouldIgnoreExplicitLocalUrls(apiUrl: string, wsUrl: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const currentHostname = window.location.hostname;
  if (isLocalHost(currentHostname)) {
    return false;
  }

  try {
    const apiHostname = new URL(apiUrl).hostname;
    const wsHostname = new URL(wsUrl).hostname;
    return isLocalHost(apiHostname) && isLocalHost(wsHostname);
  } catch {
    return false;
  }
}

function resolve(): { apiUrl: string; wsUrl: string } {
  if (cached) return cached;

  const envApi = process.env.NEXT_PUBLIC_API_URL;
  const envWs = process.env.NEXT_PUBLIC_WS_URL;

  if (envApi && envWs && !shouldIgnoreExplicitLocalUrls(envApi, envWs)) {
    cached = { apiUrl: envApi, wsUrl: envWs };
  } else if (typeof window !== "undefined") {
    const { protocol, host } = window.location;
    const isSecure = protocol === "https:";
    cached = {
      apiUrl: `${protocol}//${host}`,
      wsUrl: `${isSecure ? "wss" : "ws"}://${host}/ws`,
    };
  } else {
    // SSR fallback — don't cache empty strings so client can resolve properly after hydration
    return { apiUrl: "", wsUrl: "" };
  }

  return cached;
}

export function getApiUrl(): string {
  return resolve().apiUrl;
}

export function getWsUrl(): string {
  return resolve().wsUrl;
}

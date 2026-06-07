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

function resolve(): { apiUrl: string; wsUrl: string } {
  if (cached) return cached;

  const envApi = process.env.NEXT_PUBLIC_API_URL;
  const envWs = process.env.NEXT_PUBLIC_WS_URL;

  if (typeof window !== "undefined") {
    const currentHostname = window.location.hostname;
    const isLocalIP =
      currentHostname.startsWith("192.168.") ||
      currentHostname.startsWith("10.") ||
      currentHostname.startsWith("172.") ||
      currentHostname.startsWith("100."); // Tailscale

    if (isLocalIP || isLocalHost(currentHostname)) {
      cached = {
        apiUrl: `http://${currentHostname}:8080`,
        wsUrl: `ws://${currentHostname}:8080/ws`,
      };
      return cached;
    }
  }

  // Fallback to explicit env URLs (like ngrok/localtunnel) for remote users
  if (envApi && envWs) {
    cached = { apiUrl: envApi, wsUrl: envWs };
  } else if (typeof window !== "undefined") {
    const { protocol, host } = window.location;
    const isSecure = protocol === "https:";
    cached = {
      apiUrl: `${protocol}//${host}`,
      wsUrl: `${isSecure ? "wss" : "ws"}://${host}/ws`,
    };
  } else {
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

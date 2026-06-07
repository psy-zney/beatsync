import { ADMIN_SECRET, IS_DEMO_MODE } from "@/demo";
import { BackupManager } from "@/managers/BackupManager";
import { getActiveRooms } from "@/routes/active";
import { handleGetDefaultAudio } from "@/routes/default";
import { handleServeAudio } from "@/routes/demoAudio";
import { handleDiscover } from "@/routes/discover";
import { handleRoot } from "@/routes/root";
import { handleStats } from "@/routes/stats";
import { handleGetPresignedURL, handleUploadComplete } from "@/routes/upload";
import { handleYoutubeUpload, handleYoutubeProxy } from "@/routes/youtube";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleClose, handleMessage, handleOpen } from "@/routes/websocketHandlers";
import { corsHeaders, errorResponse } from "@/utils/responses";
import type { WSData } from "@/utils/websocket";

// Bun.serve with WebSocket support
const SERVER_HOST = process.env.HOST ?? "0.0.0.0";
const SERVER_PORT = Number(process.env.PORT ?? "8080");

const server = Bun.serve<WSData>({
  hostname: SERVER_HOST,
  port: SERVER_PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Demo mode: serve local audio files
      if (IS_DEMO_MODE && url.pathname.startsWith("/audio/")) {
        return handleServeAudio(url.pathname);
      }

      // Proxy MinIO requests so Vercel client can access local MinIO through backend Ngrok/LocalTunnel
      if (url.pathname.startsWith("/minio-proxy/")) {
        try {
          const minioUrl = url.pathname.replace("/minio-proxy/", "http://localhost:9000/");
          const headersToSend = new Headers();
          const range = req.headers.get("range");
          if (range) headersToSend.set("range", range);

          const minioResponse = await fetch(minioUrl, {
            headers: headersToSend,
            method: req.method,
          });

          const newHeaders = new Headers(minioResponse.headers);
          newHeaders.set("Access-Control-Allow-Origin", "*");
          newHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
          newHeaders.set("Access-Control-Allow-Headers", "*");
          newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");

          return new Response(minioResponse.body, {
            status: minioResponse.status,
            statusText: minioResponse.statusText,
            headers: newHeaders,
          });
        } catch (error) {
          console.error("MinIO proxy error:", error);
          return errorResponse("Failed to proxy MinIO request", 500);
        }
      }

      switch (url.pathname) {
        case "/":
          return handleRoot(req);

        case "/ws":
          return handleWebSocketUpgrade(req, server);

        case "/upload/get-presigned-url":
          if (IS_DEMO_MODE) return errorResponse("Uploads disabled in demo mode", 403);
          return handleGetPresignedURL(req);

        case "/upload/complete":
          if (IS_DEMO_MODE) return errorResponse("Uploads disabled in demo mode", 403);
          return handleUploadComplete(req, server);

        case "/upload/youtube":
          if (IS_DEMO_MODE) return errorResponse("Uploads disabled in demo mode", 403);
          return handleYoutubeUpload(req, server);

        case "/youtube/proxy":
          return handleYoutubeProxy(req);

        case "/stats":
          return handleStats();

        case "/default":
          return handleGetDefaultAudio(req);

        case "/active-rooms":
          return getActiveRooms(req);

        case "/discover":
          return handleDiscover(req);

        default:
          return errorResponse("Not found", 404);
      }
    } catch {
      return errorResponse("Internal server error", 500);
    }
  },

  websocket: {
    open(ws) {
      handleOpen(ws, server);
    },

    message(ws, message) {
      void handleMessage(ws, message, server);
    },

    close(ws) {
      handleClose(ws, server);
    },
  },
});

console.log(`HTTP listening on http://${server.hostname}:${server.port}`);

if (IS_DEMO_MODE) {
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
}

if (!IS_DEMO_MODE) {
  // Restore state from backup on startup
  BackupManager.restoreState().catch((error) => {
    const msg = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`Failed to restore state on startup: ${msg}`);
  });

  // Set up periodic backups every minute (for Render persistence issues)
  const BACKUP_INTERVAL_MS = 60 * 1000; // 1 minute
  setInterval(() => {
    console.log("🔄 Performing periodic backup at", new Date().toISOString());
    BackupManager.backupState().catch((error) => {
      const msg = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.error(`Failed to perform periodic backup: ${msg}`);
    });
  }, BACKUP_INTERVAL_MS);
}

// Simple graceful shutdown
const shutdown = async () => {
  console.log("\n⚠️ Shutting down...");

  void server.stop(); // Stop accepting new connections
  if (!IS_DEMO_MODE) {
    await BackupManager.backupState(); // Save state
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

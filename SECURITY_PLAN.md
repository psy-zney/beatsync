# 🛡️ Beatsync — Kế hoạch bảo vệ khi bị tấn công / Traffic Spike

> **Trạng thái**: Chưa thực hiện — Đây là tài liệu kế hoạch  
> **Ngày tạo**: 2026-07-05  
> **Phạm vi**: `apps/server` + tầng infrastructure

---

## 📋 Mục lục

1. [Phân tích điểm yếu hiện tại](#1-phân-tích-điểm-yếu-hiện-tại)
2. [Giai đoạn 1 — Quick Wins (Code changes)](#2-giai-đoạn-1--quick-wins-code-changes)
3. [Giai đoạn 2 — Infrastructure Layer](#3-giai-đoạn-2--infrastructure-layer)
4. [Giai đoạn 3 — Architectural Changes](#4-giai-đoạn-3--architectural-changes)
5. [Thứ tự ưu tiên triển khai](#5-thứ-tự-ưu-tiên-triển-khai)

---

## 1. Phân tích điểm yếu hiện tại

| # | Vấn đề | File liên quan | Mức độ rủi ro |
|---|--------|----------------|---------------|
| 1 | Không có rate limiting khi kết nối WebSocket | `routes/websocket.ts` | 🔴 Cao |
| 2 | Không giới hạn số client tối đa trong room | `managers/GlobalManager.ts` | 🔴 Cao |
| 3 | Spatial audio broadcast mỗi 100ms — scale tuyến tính theo số client | `managers/RoomManager.ts` | 🟠 Trung bình |
| 4 | Không có idle timeout cho WebSocket (zombie connections tích lũy) | `index.ts` | 🟠 Trung bình |
| 5 | In-memory state → OOM crash khi quá tải → mất toàn bộ state | `managers/GlobalManager.ts` | 🟠 Trung bình |
| 6 | `clientId` do client tự generate, không verify → dễ giả mạo | `routes/websocket.ts` | 🟡 Thấp |
| 7 | Không có HTTP rate limiting trên các route upload/youtube | `routes/upload.ts`, `routes/youtube.ts` | 🟡 Thấp |

---

## 2. Giai đoạn 1 — Quick Wins (Code changes)

> Không breaking, triển khai nhanh trong vài giờ.

### 2.1 Rate limiting khi upgrade WebSocket

**File**: `apps/server/src/routes/websocket.ts`

**Mô tả**: Thêm in-memory rate limiter dựa theo IP. Mỗi IP chỉ được tạo tối đa N kết nối mới trong vòng 1 phút.

```typescript
// Ý tưởng implementation
const connectionAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_IP = 5; // 5 connections/phút/IP
const RATE_LIMIT_WINDOW_MS = 60_000;

// Trong handleWebSocketUpgrade:
// 1. Lấy IP từ header x-forwarded-for
// 2. Kiểm tra và cập nhật counter
// 3. Trả về 429 nếu vượt quá giới hạn
// 4. Cleanup map định kỳ để tránh memory leak
```

**Kết quả mong đợi**: Chặn flood connections từ 1 IP duy nhất.

---

### 2.2 Giới hạn số client tối đa (per room & global)

**File**: `apps/server/src/managers/GlobalManager.ts`, `apps/server/src/routes/websocket.ts`

**Mô tả**: Thêm 2 lớp giới hạn:
- `MAX_CLIENTS_PER_ROOM`: tối đa N user trong 1 room (ví dụ: 100)
- `MAX_GLOBAL_CLIENTS`: tổng số user toàn server (ví dụ: 500)

```typescript
// Kiểm tra trước khi upgrade WebSocket:
const MAX_CLIENTS_PER_ROOM = 100;
const MAX_GLOBAL_CLIENTS = 500;

// Nếu room.getNumClients() >= MAX_CLIENTS_PER_ROOM → 503 Service Unavailable
// Nếu globalManager.getActiveUserCount() >= MAX_GLOBAL_CLIENTS → 503
```

**Kết quả mong đợi**: Server không nhận kết nối mới khi đã đầy, thay vì bị OOM.

---

### 2.3 WebSocket idle timeout

**File**: `apps/server/src/index.ts`

**Mô tả**: Bun hỗ trợ native `idleTimeout` trong config WebSocket. Connections không gửi message trong N giây sẽ tự động bị đóng.

```typescript
// Trong Bun.serve config:
websocket: {
  idleTimeout: 60, // 60 giây không activity → đóng connection
  open(ws) { ... },
  message(ws, message) { ... },
  close(ws) { ... },
}
```

**Kết quả mong đợi**: Zombie connections tự dọn dẹp sau 60 giây.

---

### 2.4 Circuit breaker cho spatial audio broadcast

**File**: `apps/server/src/managers/RoomManager.ts`

**Mô tả**: Khi số client trong room vượt ngưỡng, giảm tần suất broadcast spatial audio từ 100ms lên 500ms, hoặc tắt hẳn.

```typescript
const SPATIAL_INTERVAL_NORMAL = 100;    // ms
const SPATIAL_INTERVAL_HIGH_LOAD = 500; // ms
const HIGH_LOAD_THRESHOLD = 50;         // clients

// Khi client join/leave: tính lại interval và reset setInterval
```

**Kết quả mong đợi**: Giảm 5x CPU/bandwidth khi room đông.

---

### 2.5 HTTP rate limiting cho các route nặng

**File**: `apps/server/src/index.ts` (middleware layer)

**Mô tả**: Thêm rate limiter cho các endpoint tốn tài nguyên:
- `/upload/get-presigned-url`: max 10 req/phút/IP
- `/upload/youtube`: max 5 req/phút/IP
- `/youtube/proxy`: max 20 req/phút/IP

**Kết quả mong đợi**: Ngăn abuse các endpoint upload/stream.

---

## 3. Giai đoạn 2 — Infrastructure Layer

> Cần cấu hình deployment, không thay đổi code ứng dụng.

### 3.1 Nginx reverse proxy với rate limiting

**Mô tả**: Đặt Nginx trước Bun server để xử lý rate limiting ở network level.

```nginx
# /etc/nginx/sites-available/beatsync
limit_conn_zone $binary_remote_addr zone=ws_conn:10m;
limit_req_zone  $binary_remote_addr zone=http_req:10m rate=30r/m;

server {
    listen 80;
    server_name beatsync.yourdomain.com;

    location /ws {
        limit_conn ws_conn 3;
        limit_req zone=http_req burst=5 nodelay;
        proxy_pass http://127.0.0.1:1001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 3600s;
    }

    location / {
        limit_req zone=http_req burst=10 nodelay;
        proxy_pass http://127.0.0.1:1001;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

**Kết quả mong đợi**: Chặn DDoS ở network level, trước khi đến Bun process.

---

### 3.2 Cloudflare (nếu expose public)

**Mô tả**: Cấu hình Cloudflare làm CDN + DDoS protection layer.

**Các bước**:
- [ ] Bật **Bot Fight Mode** trong Cloudflare dashboard
- [ ] Tạo **Rate Limiting Rule**: max 10 req/phút đến path `/ws*`
- [ ] Tạo **Firewall Rule**: block các country không cần thiết (tuỳ chọn)
- [ ] Bật **Under Attack Mode** thủ công khi phát hiện tấn công
- [ ] Cấu hình **WebSocket** trong Cloudflare Network settings

> **Lưu ý**: Cloudflare terminate SSL và proxy WebSocket — cần test kỹ độ trễ NTP sync sau khi bật.

---

### 3.3 PM2 cluster mode

**File**: `pm2.config.js`

**Mô tả**: Chạy nhiều Bun instances với PM2 để tận dụng multi-core.

> **Điều kiện tiên quyết**: Phải hoàn thành Giai đoạn 3 (Redis migration) trước, vì hiện tại state là in-memory và không share được giữa các instances.

---

## 4. Giai đoạn 3 — Architectural Changes

> Thay đổi lớn, cần kế hoạch migration cẩn thận. Chỉ làm sau khi Giai đoạn 1 & 2 ổn định.

### 4.1 Migrate state sang Redis

**Mô tả**: Thay thế `GlobalManager` in-memory state bằng Redis để không mất state khi crash và cho phép horizontal scaling.

**Scope thay đổi**:
- `managers/GlobalManager.ts` → lưu rooms vào Redis Hash
- `managers/RoomManager.ts` → lưu clients, playback state, audio sources vào Redis
- `managers/BackupManager.ts` → có thể loại bỏ (Redis đã persistent)
- `managers/ChatManager.ts` → lưu chat history vào Redis List

> **Rủi ro**: Thay đổi toàn bộ state management. Cần test kỹ, đặc biệt với NTP sync timing.

---

### 4.2 Redis Pub/Sub cho WebSocket broadcast

**Mô tả**: Để nhiều Bun instances broadcast cho nhau, dùng Redis Pub/Sub thay cho `server.publish()` native của Bun.

```
Client A → Instance 1 → Redis Pub/Sub → Instance 2 → Client B
```

---

### 4.3 Horizontal scaling với load balancer

**Mô tả**: Chạy N Bun instances sau Nginx upstream với sticky sessions cho WebSocket.

```nginx
upstream beatsync_backend {
    ip_hash;  # sticky sessions — WS phải về cùng instance
    server 127.0.0.1:1001;
    server 127.0.0.1:1002;
    server 127.0.0.1:1003;
}
```

> **Điều kiện tiên quyết**: Phải hoàn thành 4.1 và 4.2 trước.

---

## 5. Thứ tự ưu tiên triển khai

```
Giai đoạn 1 — Code changes (làm ngay, rủi ro thấp)
├── [P0] 2.3 — WebSocket idle timeout          (1 dòng, không breaking)
├── [P0] 2.1 — Rate limiting per IP            (20-30 dòng)
├── [P1] 2.2 — Max clients cap                 (10 dòng + config constants)
├── [P1] 2.5 — HTTP rate limiting              (tái sử dụng logic từ 2.1)
└── [P2] 2.4 — Spatial audio circuit breaker  (cần test UX kỹ hơn)

Giai đoạn 2 — Infrastructure (sau khi P0/P1 xong)
├── [P1] 3.1 — Nginx rate limiting             (nếu self-hosted)
└── [P2] 3.2 — Cloudflare                      (nếu expose public)

Giai đoạn 3 — Architectural (kế hoạch dài hạn)
├── [P3] 4.1 — Redis state migration
├── [P3] 4.2 — Redis Pub/Sub
└── [P3] 4.3 — Horizontal scaling
```

---

## 📝 Ghi chú bổ sung

- **Giám sát trước**: Trước khi triển khai, nên thêm metrics endpoint (`/metrics` — số connections, memory, room count) để có baseline đo lường hiệu quả.
- **Load testing**: Dùng `artillery` hoặc `k6` để load test sau mỗi giai đoạn.
- **Rollback**: Các thay đổi Giai đoạn 1 đều dễ rollback — chỉ cần remove/comment code. Giai đoạn 3 cần migration plan riêng.

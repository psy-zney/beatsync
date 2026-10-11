# Vận hành backend Go trên VPS nhỏ

## Luồng chịu lỗi

- Server chạy một process để room/WebSocket state không bị chia cắt.
- Tối đa 1 download chạy và 12 job chờ theo mặc định.
- File nhạc được stream vào file tạm rồi upload S3/R2; không giữ cả bài trong RAM.
- Ở 220 MiB RSS, server giải phóng bộ nhớ và bỏ một phần job chờ.
- Ở 320 MiB RSS, server hủy download đang chạy, bỏ toàn bộ job chờ và ghi snapshot cục bộ.
- systemd đặt `MemoryHigh=300M`, `MemoryMax=420M`, tự restart khi crash/OOM và khởi động lại sau reboot.
- Swap 2 GiB là lớp đệm cuối, không phải nơi chạy workload thường xuyên.

Snapshot được ghi nguyên tử vào `apps/server/data/state-backup-latest.json` trước khi upload R2. Khi khởi động, server chọn snapshot local/remote mới hơn. Playlist riêng vẫn được lưu tại `room-<id>/playlist.json`.

## Hybrid worker local

VPS luôn là control plane và giữ toàn bộ kết nối user. Máy local kết nối outbound
tới `/internal/worker`, nhận Spotify/YouTube job khi còn capacity và không cần
CNAME riêng. Nếu heartbeat/WebSocket local mất, lease đang chạy được trả về để
VPS fallback; queue stream chưa chạy vẫn ở VPS.

Kiểm tra nhanh:

```bash
curl -fsS http://127.0.0.1:3001/health | jq .hybridWorker
journalctl -u beatsync.service -n 100 --no-pager | grep -i hybrid
```

`workers: 0` là trạng thái hợp lệ, không phải backend down. Chỉ rotate
`HYBRID_WORKER_SECRET` khi có thể cập nhật VPS và local gần nhau; trong khoảng
hai phía lệch secret, VPS tự fallback và user vẫn đi qua endpoint cũ.

## Deploy tự động

Mỗi push lên `main` chạy `.github/workflows/deploy.yml`:

1. test và build Go/Rust trên GitHub runner;
2. tải `yt-dlp` và kiểm tra SHA-256 chính chủ;
3. gửi bundle qua SSH đã pin host fingerprint;
4. cài release vào `/opt/beatsync/releases/<commit>`;
5. đổi symlink, restart `beatsync.service`, kiểm tra `/health`;
6. tự quay lại release trước nếu health check thất bại.

Repository secrets cần có: `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY`, `VPS_FINGERPRINT`. Không đưa S3/LiveKit/creator secret vào GitHub Actions; các giá trị đó tiếp tục nằm trong `apps/server/.env` trên VPS.

## Lệnh kiểm tra trên VPS

```bash
systemctl status beatsync.service
journalctl -u beatsync.service -n 100 --no-pager
curl -fsS http://127.0.0.1:1001/health
swapon --show
```

Các giới hạn production 220/320 MiB và queue 1/12 được khóa trong unit do script cài đặt tạo ra, nên `.env` cũ 600/750 MiB không thể vô tình vượt `MemoryMax=420M`. Muốn đổi chúng, sửa đồng thời `ExecStart`, `MemoryHigh` và `MemoryMax` trong `scripts/install-go-backend.sh`, luôn giữ `soft < hard < MemoryMax`.

## LiveKit tự quản lý trên VPS

Container LiveKit mở signaling nội bộ tại `127.0.0.1:9002` (trong container là cổng `7880`) và công bố dải media UDP `50000–50100`. Nginx dùng `/etc/nginx/sites-enabled/voice-public.conf`: cổng `80` phục vụ ACME và chuyển hướng HTTPS, cổng `443` kết thúc TLS rồi chuyển HTTP/WebSocket tới LiveKit. Chứng chỉ `voice.zney295.id.vn` nằm trong `/etc/letsencrypt/live/`; `certbot.timer` cùng deploy hook tự gia hạn và reload Nginx.

Cloudflare cần bản ghi A proxied cho `voice.zney295.id.vn` và **không** rewrite hostname này sang cổng `9000`; HTTPS dùng cổng mặc định `443`. Giữ nguyên Origin Rule của `beatsync-server.zney295.id.vn` tới gateway `9000`. Backend chỉ cần `LIVEKIT_URL=wss://voice.zney295.id.vn` cùng `LIVEKIT_API_KEY` và `LIVEKIT_API_SECRET`; frontend lấy URL qua `/voice/token`.

Sau khi đổi Cloudflare, kiểm tra `https://voice.zney295.id.vn/`, kết nối WebSocket LiveKit bằng token thật và chạy `sudo certbot renew --dry-run --cert-name voice.zney295.id.vn` trên VPS. API và WebSocket chạy qua Nginx; media WebRTC dùng UDP `50000–50100` trực tiếp tới VPS, nên cần mở dải này trong firewall của nhà cung cấp VPS ngoài iptables và Docker.

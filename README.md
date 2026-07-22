# 🎵 Beatsync (Fork Version)

Beatsync là ứng dụng phát nhạc đồng bộ thời gian thực chuẩn từng miligiây trên nhiều thiết bị (Multi-device Realtime Audio Sync).

Phiên bản Fork này đã được nâng cấp, tối ưu hóa toàn diện và bổ sung nhiều tính năng vượt trội như giải mã YouTube qua Rust binary, kết nối Voice Chat RTC với LiveKit, quản lý hồ sơ người dùng, hệ thống thông báo âm thanh anime và hỗ trợ triển khai Cloudflare Tunnels.

---

## 🌟 Các tính năng & Cải tiến nổi bật (Features & Improvements)

1. **⚡ Tự động Tải / Biên dịch Rust YouTube Audio Extractor (`yt-rust-extractor`)**:
   - Hệ thống tích hợp sẵn công cụ giải mã âm thanh YouTube viết bằng Rust (`yt-rust-extractor.exe` trên Windows / Linux).
   - Tự động tải file thực thi binary từ GitHub Release hoặc tự động biên dịch bằng Cargo khi khởi chạy server, giúp bóc tách link stream YouTube cực nhanh, ổn định và không phụ thuộc API bên ngoài.

2. **🔍 YouTube Search & Fix lỗi clear tên bài hát**:
   - Tích hợp tìm kiếm bài hát trực tiếp từ YouTube.
   - Sửa triệt để lỗi tự động xóa/ghi đè tên bài hát (title clear issue) khi tìm kiếm và thêm nhạc YouTube vào hàng chờ.
   - Khôi phục tiêu đề gốc (title healing) và đồng bộ bản sao lưu kép (dual-storage backup) giữa Cloudflare R2 / S3 Storage và ổ cứng Local.

3. **🎙️ Tích hợp LiveChat Voice chất lượng cao (LiveKit RTC)**:
   - Tích hợp **LiveKit Audio RTC** cho kết nối thoại mượt mà, độ trễ thấp.
   - Nút **Join/Leave Voice** chủ động kèm giao diện điều khiển riêng.
   - Tự động cấp JWT token bảo mật tại server (`/voice/token`), không làm rò rỉ secret key ở client.
   - Hỗ trợ khuếch đại âm lượng mic lên **200%**, tích hợp **AI Noise Suppression** (lọc tiếng ồn thông minh) và loại bỏ hiện tượng đúp tiếng.

4. **👤 Quản lý Hồ sơ Người dùng (User Profile & Avatar)**:
   - Modal thiết lập biệt danh (Username) và Avatar cá nhân (`ProfileSetup.tsx`).
   - Lưu trữ cấu hình local (`localStorage`) tự động khôi phục khi truy cập lại các phòng nghe nhạc.

5. **💬 Hệ thống Chat & Âm thanh Thông báo (Anime Sound Notification)**:
   - Trò chuyện nhắn tin thời gian thực giữa các thành viên trong phòng.
   - Phát âm thanh hiệu ứng thông báo tin nhắn kiểu Anime ngộ nghĩnh khi có tin nhắn tới.

6. **🌐 Hỗ trợ Cloudflare Tunnels (CF Tunnels) & Vercel**:
   - Chuyển đổi default port server sang **`1001`**.
   - Dễ dàng chạy backend sau **Cloudflare Tunnels** (`cloudflared`) để mở khóa kết nối HTTPS/WSS công cộng miễn phí mà không cần Port Forwarding.
   - Tối ưu hóa sẵn sàng cho việc deploy Client trên **Vercel** và Server trên VPS/Cloud.

7. **⚡ Script Khởi chạy Nhanh 1-Click (`start_servers.bat`)**:
   - File `.bat` dành cho người dùng Windows giúp khởi động server backend nhanh chóng chỉ với 1 cú click.

---

## 🛠️ Hướng dẫn Khởi chạy Nhanh (Quickstart)

### 1. Cấu hình biến môi trường (`.env`)

Sao chép các file mẫu:
```bash
cp apps/client/.env.example apps/client/.env
cp apps/server/.env.example apps/server/.env
```

Cấu hình trong `apps/server/.env`:
```env
HOST=0.0.0.0
PORT=1001

# Cấu hình LiveKit (Dùng cho tính năng Voice Chat)
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=YOUR_API_KEY
LIVEKIT_API_SECRET=YOUR_API_SECRET

# Cấu hình Storage (S3 / Cloudflare R2 - Tùy chọn nếu lưu file)
S3_BUCKET_NAME=beatsync-bucket
S3_PUBLIC_URL=https://your-storage-domain.com
S3_ENDPOINT=https://your-r2-endpoint
S3_ACCESS_KEY_ID=your_key
S3_SECRET_ACCESS_KEY=your_secret
```

Cấu hình trong `apps/client/.env`:
```env
NEXT_PUBLIC_API_URL=http://localhost:1001
NEXT_PUBLIC_WS_URL=ws://localhost:1001/ws
NEXT_PUBLIC_DEMO_MODE=0
```

---

### 2. Cài đặt & Chạy ứng dụng

Cài đặt tất cả các gói phụ thuộc (Dependencies):
```bash
bun install
```

Khởi chạy môi trường phát triển (Dev):

* **Cách 1**: Sử dụng lệnh Turbo
  ```bash
  bun dev
  ```
* **Cách 2 (Windows)**: Nhấp đúp file `start_servers.bat` để chạy backend riêng biệt.

📍 Sau khi chạy:
- **Frontend Client**: `http://localhost:3000`
- **Backend Server**: `http://localhost:1001`

---

## 🌐 Triển khai Vercel + Cloudflare Tunnels (CF Tunnels)

Do ứng dụng sử dụng Server Bun duy trì WebSocket kết nối thời gian thực (`apps/server`), mô hình triển khai đề xuất:

1. **Backend (`apps/server`)**: Chạy trên máy local/VPS kết hợp **Cloudflare Tunnels**.
2. **Frontend (`apps/client`)**: Triển khai trên **Vercel**.

### 1. Thiết lập Cloudflare Tunnels cho Backend
Tạo tunnel trỏ domain công cộng của bạn tới port `1001`:
```bash
cloudflared tunnel run --url http://localhost:1001 your-tunnel-name
```
Hoặc định tuyến trên Cloudflare Zero Trust Dashboard: `https://api.yourdomain.com` -> `http://localhost:1001`.

### 2. Deploy Frontend trên Vercel
Khai báo các biến môi trường trên Vercel:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws
NEXT_PUBLIC_DEMO_MODE=0
```

---

## 📁 Cấu trúc Thư mục Dự án

| Thư mục | Mô tả |
| :--- | :--- |
| `apps/server` | Bun HTTP + WebSocket Server, LiveKit token handler & Rust YouTube Extractor |
| `apps/client` | Next.js 15 Frontend, TailwindCSS, Shadcn/ui, User Profiles & LiveKit Voice Client |
| `packages/shared` | Types, schemas và helper functions chia sẻ giữa Client & Server |

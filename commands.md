# Hướng Dẫn Chạy Dự Án (Backend Local & Frontend Vercel)

Lưu ý: Bạn cần mở 3 Terminal riêng biệt để chạy song song.

## 1. Khởi chạy MinIO Server
Mở Terminal 1 (PowerShell) để chạy MinIO lưu trữ nhạc:
```powershell
$env:MINIO_ROOT_USER="admin"
$env:MINIO_ROOT_PASSWORD="password123"
cd C:\minio
.\minio.exe server C:\minio\data --console-address ":9001"
```

## 2. Khởi chạy Backend Server
Mở Terminal 2. Vì dự án quản lý bằng TurboRepo, bắt buộc phải chạy từ **thư mục gốc**:
```bash
cd C:\Users\Admin\MyProject\beatsync
bun turbo run dev --filter=server
```
*(Server sẽ tự động khởi chạy tại port 8080)*

## 3. Khởi chạy Ngrok
Mở Terminal 3. Cần mở port 8080 của Backend ra ngoài internet để frontend Vercel có thể kết nối vào:
```bash
ngrok http 8080
```

---

> **Lưu ý khi cấu hình Vercel:** 
> Sau khi chạy lệnh ngrok ở trên, bạn sẽ được cấp một đường dẫn (ví dụ: `https://abcd.ngrok-free.app`). Hãy lên Vercel chỉnh lại biến môi trường:
> - `NEXT_PUBLIC_API_URL` = `https://abcd.ngrok-free.app`
> - `NEXT_PUBLIC_WS_URL` = `wss://abcd.ngrok-free.app/ws`
> *(Lưu ý: Thay `https://` bằng `wss://` đối với link websocket)*
> 
> Cuối cùng, hãy nhớ Deploy lại dự án trên Vercel để áp dụng đường link mới!

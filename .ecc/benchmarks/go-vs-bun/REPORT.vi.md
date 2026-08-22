# Đánh giá khoa học Go vs Bun cho BeatSync

Ngày đo: 2026-08-22
Kết luận ngắn: **hướng chuyển backend sang Go là hợp lý cho VPS yếu, đặc biệt khi RAM là nút thắt; nhưng nhánh Go hiện tại chưa nên phát hành nguyên trạng vì có lỗi sụp kết nối WebSocket khi client vào đồng thời và một số lệch contract API/observability.**

> Cập nhật sau phép đo: working tree đã nâng send queue có giới hạn 8 → 64 và
> thêm regression test WebSocket burst; suite Go tăng từ 14 lên 40 hàm test với
> room/audio/backup/Hub/hybrid-worker failover. Số liệu benchmark bên dưới vẫn
> mô tả đúng hai commit đã đo; gate burst 200/500 trên VPS cần được chạy lại.

## 1. Phạm vi và câu hỏi nghiên cứu

Hai phiên bản được so sánh tại cùng một ancestry:

- Bun: `backup/bun-backend` — `a282e6bdba776ff33c3797d5fd85b1c8837566fa`.
- Go: `migration/go-backend` — `0987e39`; nhánh này đi trước Bun đúng ba commit.

Các giả thuyết được kiểm tra độc lập, không tạo một “điểm tổng” dễ che lấp trade-off:

1. Go giảm RSS ít nhất 50% trong workload phù hợp VPS nhỏ.
2. Trên một core, Go không làm throughput HTTP giảm quá 10%.
3. HTTP/WebSocket vẫn giữ hành vi tương đương dưới tải bình thường.
4. Go đơn giản hóa artifact và dependency vận hành.

Kết quả: (1), (2), (4) được dữ liệu ủng hộ; (3) đạt ở tải ramp nhưng thất bại ở burst và còn chênh schema API.

## 2. Phương pháp

### Môi trường

- Windows 10.0.26200 x64.
- Intel Core i5-12450HX, 12 logical CPU.
- RAM vật lý 23,78 GiB.
- Bun 1.3.14; Go 1.26.5 portable.
- Binary tự chứa: Bun `--compile --target=bun-windows-x64`; Go `-trimpath -ldflags="-s -w"`.
- `DEMO=1`, thư mục audio rỗng, không có S3/Spotify/LiveKit credentials.
- Output server được bỏ đi nhưng cả hai vẫn thực hiện logic tạo log cho từng HTTP request.

### Kiểm soát sai lệch

- Mỗi lượt khởi động process server mới.
- Chạy xen kẽ Bun/Go; thứ tự đảo ở mỗi lượt.
- Warm-up HTTP 400 ms không đưa vào kết quả.
- Năm lượt ở toàn CPU; ba lượt với server bị ép affinity còn một core và priority `BelowNormal`.
- Báo **median và MAD** (median absolute deviation), không chỉ báo lần chạy đẹp nhất.
- HTTP dùng closed-loop `GET /health`: concurrency 1 trong 2 giây và concurrency 32 trong 3 giây.
- WebSocket burst: 200 handshake đồng thời, sau đó 5 NTP probe/client.
- WebSocket ramp: 200 client phân bố đều trong 5 giây, chờ ổn định 1 giây, rồi một NTP probe/client; ba lượt.

### Giới hạn

- Đây là A/B trên Windows, không phải Oracle/VPS Linux thật. Affinity một core là proxy cho một vCPU, không mô phỏng chính xác cgroup, steal time, network và page cache Linux.
- Không có Docker trên máy đo nên chưa đo image size.
- Không benchmark tải audio, YouTube extraction, R2/S3 và LiveKit; các đường này chủ yếu bị chi phối bởi I/O ngoài process.
- Thời lượng ngắn nên chưa chứng minh không có memory leak; cần soak test trên VPS.
- Kết quả chỉ áp dụng cho code BeatSync tại hai commit trên, không phải kết luận chung cho mọi ứng dụng Go/Bun.

## 3. Kết quả runtime

### 3.1 Toàn bộ CPU

Số liệu là median; phần sau `±` là MAD.

| Chỉ số | Bun | Go | Chênh lệch của Go | Đọc kết quả |
|---|---:|---:|---:|---|
| Startup process | 175,61 ± 4,70 ms | 22,00 ± 2,84 ms | **-87,5%** | Go khởi động nhanh hơn khoảng 8,0× |
| RSS idle | 91,17 ± 0,31 MiB | 9,79 ± 0,02 MiB | **-89,3%** | Điểm mạnh lớn nhất cho VPS nhỏ |
| HTTP c=1 throughput | 11.615 req/s | 11.146 req/s | -4,0% | Gần ngang nhau |
| HTTP c=1 p99 | 0,823 ms | 0,271 ms | **-67,1%** | Tail latency Go tốt hơn |
| HTTP c=32 throughput | 45.704 req/s | 54.314 req/s | **+18,8%** | Go dùng nhiều core để tăng throughput |
| HTTP c=32 p95 | 1,497 ms | 1,232 ms | -17,7% | Go tốt hơn |
| HTTP c=32 p99 | 2,049 ms | 1,903 ms | -7,1% | Go tốt hơn nhẹ |
| CPU trong 3 giây c=32 | 3,047 CPU-s | 12,938 CPU-s | **+324,6%** | Go tiêu thụ tổng CPU nhiều hơn đáng kể |
| Request/CPU-second c=32 | 45.024 | 12.580 | **-72,1%** | Bun hiệu quả CPU hơn trong cấu hình nhiều core này |

Điểm cần tránh diễn giải sai: Go có RPS cao hơn trên 12 logical CPU nhưng dùng khoảng 4,25× CPU time. Với VPS tính tiền theo CPU hoặc có nhiều service dùng chung máy, đây là bất lợi. Với VPS một vCPU, bảng tiếp theo phù hợp hơn.

### 3.2 Proxy VPS một vCPU

| Chỉ số | Bun | Go | Chênh lệch của Go | Kết luận |
|---|---:|---:|---:|---|
| HTTP c=1 throughput | 10.731 req/s | 11.998 req/s | **+11,8%** | Go tốt hơn |
| HTTP c=1 p99 | 0,898 ms | 0,527 ms | **-41,3%** | Go tốt hơn |
| HTTP c=32 throughput | 41.953 req/s | 39.463 req/s | -5,9% | Trong ngưỡng giả thuyết -10% |
| HTTP c=32 p95 | 1,594 ms | 1,848 ms | +15,9% | Bun tốt hơn |
| HTTP c=32 p99 | 3,031 ms | 3,393 ms | +11,9% | Bun tốt hơn |
| Request/CPU-second c=32 | 51.307 | 50.334 | -1,9% | Hiệu quả CPU thực tế gần ngang nhau |

Khi bị giới hạn một core, lợi thế đa core của Go biến mất nhưng hiệu quả CPU giữa hai bản gần như tương đương. Go đổi một lượng tail latency nhỏ ở tải concurrent lấy mức RAM thấp hơn rất lớn. Đây là trade-off thuận lợi cho VPS yếu nếu RAM/OOM là vấn đề chính.

Tất cả HTTP workload ở cả hai backend có tổng lỗi bằng 0.

## 4. WebSocket và bộ nhớ

### 4.1 Tải ramp thực tế: 200 client trong 5 giây

| Chỉ số | Bun | Go | Chênh lệch của Go |
|---|---:|---:|---:|
| Handshake mở | 200/200, cả 3 lượt | 200/200, cả 3 lượt | Ngang nhau |
| Socket còn sống sau 1 giây | 200/200 | 200/200 | Ngang nhau |
| NTP probe thành công | 200/200 | 200/200 | Ngang nhau |
| NTP RTT p50 | 2,592 ms | 2,040 ms | **-21,3%** |
| RSS idle | 90,11 MiB | 9,80 MiB | **-89,1%** |
| RSS với 200 socket sống | 91,43 MiB | 24,26 MiB | **-73,5%** |
| RSS tăng thêm do 200 socket | 1,19 MiB | 14,42 MiB | Go tăng theo connection nhanh hơn |

Với 200 socket sống, process Go dùng ít hơn khoảng 67,17 MiB, tức tổng RSS thấp hơn khoảng 3,77×. Tuy nhiên Bun đã trả phần lớn chi phí ở runtime base, còn Go tăng khoảng 14,42 MiB khi thêm 200 socket. Không được ngoại suy tuyến tính lên hàng nghìn client; phải đo riêng ở 500/1.000/2.000 client trên Linux.

Nếu chỉ quy đổi RSS process theo ngân sách 256 MiB, workload 200 socket chiếm khoảng 9,5% ở Go và 35,7% ở Bun. Đây chỉ là minh họa headroom, chưa bao gồm OS, reverse proxy, extractor, yt-dlp, cache audio hay service khác.

### 4.2 Burst 200 kết nối đồng thời: lỗi chặn phát hành

- Bun: 1.000/1.000 NTP probe thành công ở mỗi lượt; tổng 5.000/5.000.
- Go: handshake ban đầu thành công nhưng 0/1.000 NTP probe thành công ở mỗi lượt toàn CPU; tổng 0/5.000.
- Khi ép một core, Go chỉ đạt 0–220/1.000 probe tùy lượt.

Nguyên nhân phù hợp cả dynamic test và static inspection:

- `Client.send` của Go chỉ có buffer 8.
- `SendBytes` đóng socket ngay khi queue đầy.
- Mỗi client mới nhận nhiều state message và tạo broadcast `DEMO_USER_COUNT` đến các client đang có.
- 200 join đồng thời tạo fan-out đủ nhanh để writer không rút queue kịp.

Vì ramp 5 giây đạt 100% nhưng burst thất bại lặp lại, đây là **burst/backpressure cliff**, không phải lỗi protocol NTP. VPS yếu còn nhạy hơn với tình trạng này vì writer drain chậm hơn.

Khuyến nghị sửa trước deploy:

1. Coalesce các state có tính “latest wins”, đặc biệt user count.
2. Tránh đóng socket ngay vì một burst ngắn của message không quan trọng.
3. Tăng queue có giới hạn sau khi đo memory, ví dụ 64/128; không dùng queue vô hạn.
4. Thêm metric `ws_send_queue_full`, `ws_forced_close`, queue depth và dropped/coalesced message.
5. Đưa hai test burst/ramp vào CI; acceptance gate tối thiểu 200 socket sống và 100% NTP response.

## 5. Build, artifact và dependency

| Chỉ số | Bun | Go | Kết quả |
|---|---:|---:|---|
| Release build/compile | 0,730 ± 0,035 s | Cold: 8,371 ± 0,027 s | Bun cold nhanh hơn khoảng 11,5× |
| Warm build | 0,730 s | 0,206 ± 0,006 s | Go warm nhanh hơn khoảng 3,5× |
| Artifact tự chứa | 96,041 MiB | 7,607 MiB | **Go nhỏ hơn 92,1%, khoảng 12,6×** |
| Production source | 5.713 dòng / 64 file | 3.809 dòng / 17 file | Go ít hơn 33,3% dòng |
| Direct production dependencies | 14 | 1 (`gorilla/websocket`) | Go giảm dependency bề mặt |

Artifact Bun được đo ở dạng standalone có chứa runtime. Nếu deploy JS bundle cùng Bun đã cài sẵn, kích thước sẽ được phân bổ khác, nhưng máy vẫn phải mang runtime. Chưa có Docker nên không khẳng định image Go nhỏ hơn theo đúng tỷ lệ binary.

Ít dòng/dependency thường giúp giảm supply-chain và thao tác deploy, nhưng không tự động đồng nghĩa dễ bảo trì. Nhánh Go hiện có test inventory nhỏ hơn và vẫn cần sửa parity.

## 6. Correctness và feature parity

### Test suites

- Bun: 112 pass, 2 fail trong 114 test. Hai lỗi đều liên quan `GlobalManager.getActiveRooms`: không loại phòng paused và phòng có track đã bị xóa.
- Go: 14/14 test pass, 8 package suites pass.

Không nên kết luận Go đúng hơn chỉ từ tỷ lệ pass: suite Go ít test case và chỉ có 323 dòng test so với 2.131 dòng test Bun. Kết luận hợp lý là migration Go hiện có build/test xanh, nhưng độ sâu regression coverage chưa ngang Bun.

### Smoke contract trong `DEMO=1`

Các đường `/health`, `/stats`, `/active-rooms`, `/discover`, `/default`, CORS preflight, voice-unconfigured, upload-disabled và một WebSocket/NTP client đều được gọi thật.

Tương thích chức năng cơ bản:

- Cả hai trả thành công cho health/stats/active/discover/default.
- Cả hai trả 503 khi voice chưa cấu hình và 403 cho upload trong demo.
- Một WebSocket nhận đủ ba scheduled config, room event, demo counts và NTP response.

Khác contract cần quyết định rõ:

- Bun trả lỗi dạng plain text; Go trả JSON `{ "error": ... }`.
- CORS preflight Bun trả 200; Go trả 204. Thường tương thích nhưng test consumer/proxy vẫn cần cập nhật.
- `/stats` Go thiếu thống kê storage tổng, orphaned rooms, file count/size đang có ở Bun.
- Schema memory thay từ chuỗi MiB sang byte number và thêm `lastCheckedAt`; dashboard cũ có thể hỏng.
- Thứ tự một số WebSocket initialization message khác nhau; client phải xử lý theo `type`, không dựa vào thứ tự.

## 7. Kết luận cho VPS yếu

### Điều đã được minh chứng

Hướng Go là lựa chọn tốt khi VPS đang bị giới hạn RAM/OOM:

- RSS idle thấp hơn khoảng 89%.
- Với 200 WebSocket sống, RSS thấp hơn khoảng 73,5%.
- Startup nhanh hơn khoảng 8×.
- Artifact nhỏ hơn khoảng 12,6×.
- Trên proxy một vCPU, throughput HTTP nằm trong khoảng +11,8% đến -5,9%; request/CPU-second ở tải concurrent chỉ lệch khoảng -1,9%.
- Code production ít hơn khoảng một phần ba và direct dependency giảm từ 14 xuống 1.

Vì vậy **lập luận tốt nhất cho migration không phải “Go luôn nhanh hơn Bun”, mà là “Go giải phóng rất nhiều RAM và giảm footprint deploy trong khi hiệu suất một vCPU gần tương đương.”** Đây là lập luận phù hợp và có số đo cho tình trạng VPS yếu.

### Điều chưa được minh chứng hoặc đang phản bác phát hành ngay

- Go hiện thất bại ở WebSocket burst 200 join đồng thời.
- `/stats` và error-body contract chưa parity.
- Chưa đo actual VPS Linux 1 vCPU/512 MiB.
- Chưa soak test, chưa đo OOM/recovery, GC pause, stream queue, audio I/O và external services.
- Test suite Go chưa bao phủ ngang Bun.

## 8. Release gates đề xuất

Chỉ chuyển traffic production sau khi đạt tất cả điều kiện:

1. Sửa queue/backpressure; burst 200 và ramp 500 đạt 100% socket survival, error <0,1%.
2. Chốt API contract: giữ backward compatibility hoặc version endpoint/client đồng thời.
3. Phục hồi `/stats` cần thiết cho vận hành VPS và alert memory pressure.
4. Port các regression test quan trọng từ Bun, ưu tiên room lifecycle, backup/restore, stale client, audio coordination và WebSocket close/message.
5. Chạy trên VPS thật với cgroup 1 vCPU/512 MiB: 5+ lượt ngắn và soak 30–60 phút ở 50/100/200/500 client.
6. Canary 5% traffic, theo dõi RSS, CPU throttling, GC, reconnect rate, NTP p95/p99, queue full và forced close; có rollback về Bun.

## 9. Tái lập

Từ root repo sau khi có hai binary/snapshot tương ứng:

```powershell
bun .ecc/benchmarks/go-vs-bun/benchmark.ts
bun .ecc/benchmarks/go-vs-bun/ws-ramp.ts
bun .ecc/benchmarks/go-vs-bun/parity-smoke.ts
bun .ecc/benchmarks/go-vs-bun/analyze.ts
```

Artifacts:

- `summary.json`: median/MAD/range đã tổng hợp.
- `raw-windows.json`: 16 lượt runtime gốc.
- `raw-ws-ramp.json`: 6 lượt WebSocket ramp gốc.
- `parity-smoke.json`: response status/schema và WebSocket smoke.
- `build-test.json`: build, artifact, test và static inventory.

Mặc định script dùng đường dẫn snapshot của máy đo. Có thể đặt `BENCH_RUNTIME_ROOT` và `BENCH_SNAPSHOT_ROOT` khi chạy ở CI/Linux; port và phần ép CPU affinity hiện vẫn cần điều chỉnh cho hệ điều hành đích.

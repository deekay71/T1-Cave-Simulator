# Room lifecycle và networking

## State machine đích

`ALLOCATING → OPEN ↔ FULL → DRAINING → DISPOSED`; crash → LOST. Reconnecting là trạng thái của từng seat, không phải cả room.

1. Client lấy guest/account JWT qua HTTPS. Colyseus joinOrCreate xác thực trước khi nhận avatar. Reservation có TTL do Colyseus quản lý; auth chậm không giữ ghế vô hạn.
2. Matchmaker tìm `hub_v1` đúng region/build/privacy. Foundation mới có một public pool, chưa filter region/private ACL.
3. Room tạo state rỗng, clock simulation 50 ms, patch 50 ms, tối đa 30 client. Đủ ghế thì framework khóa admission; rời ghế thì có thể nhận người mới.
4. `onJoin`: avatar xuất hiện ở spawn. `onDrop`: đánh dấu offline, ngừng input, giữ seat 15 giây qua allowReconnection. SDK 0.17 hỗ trợ reconnect; cần test mất mạng thật trước release. `onReconnect` phục hồi connected; input cũ bị xóa.
5. `onLeave`: xóa avatar/input/rate buckets. Room rỗng dùng auto-dispose mặc định, không giữ hàng nghìn phòng idle. Đích có AFK warning 5 phút, kick 10 phút; chưa implement.
6. Deploy đích: đặt worker DRAINING, loại khỏi lựa chọn create-room, lock room mới join, báo client countdown, cho minigame hoàn thành (deadline 120 giây), chuyển người chơi sang room mới có xác thực; sau deadline đóng WS. Foundation chỉ có graceful shutdown mặc định của Colyseus, **không** có handoff/drain coordinator.
7. Process crash: room state không durable. Client retry với exponential backoff + jitter, hết reconnect TTL thì join room mới. Không replay reward client gửi. Minigame chưa commit được mark aborted bằng reconciler.

Không đưa cùng room sang process khác bằng Redis. Nếu cần continuity về sau, snapshot có sequence + room fencing lease, rồi restore với ownership mới; cần spike riêng, không có trong MVP.

## Protocol v1 đã implement

| Hướng | Message | Contract | Giới hạn |
|---|---|---|---|
| C→S | input | `{seq,x,z}` số hữu hạn; x/z ∈[-1,1]; seq tăng | 30/s, client gửi 20/s |
| C→S | chat | string trim 1–240 ký tự | 2/s |
| C→S | emote | wave/laugh/cheer | 2/s |
| C→S→C | ping/pong | timestamp hữu hạn | 2/s |
| S→C | state | players: name, x, z, seq, connected | patch 20 Hz |
| S→C | chat | name, text | room scope |
| S→C | emote | session id, emote | room scope |

Client gửi **ý định**, không gửi tọa độ cuối hoặc dt. Server giữ input cuối, bỏ seq cũ, timeout 250 ms nếu không có input; tốc độ 4 đơn vị/s, normalize đường chéo, clamp biên ±14. Foundation dùng timer fixed step và bỏ catch-up khi server lag, nên lag làm game chậm thay vì teleport. Cần event-loop metrics để thấy vấn đề này. Collision hiện chỉ có biên phẳng; chưa có navmesh/collision cho đồ trang trí.

Client hiện dùng exponential smoothing về state server. Đây chưa phải snapshot interpolation buffer có timestamp và chưa có local prediction/reconciliation. Spike giai đoạn sau đo latency rồi thêm buffer 100–150 ms cho remote và input ack/replay cho local nếu cần. Không hứa vận động cạnh tranh chính xác bằng smoothing hiện tại.

## Minigame contract đích: “Nhặt tinh thể”

Room riêng 2–8 người: WAITING (15 s) → COUNTDOWN (3 s) → RUNNING (60 s) → RESULTS (10 s) → CLOSED. Server sinh seed/spawn và xác nhận pickup theo khoảng cách + trạng thái collectible; client không gửi điểm. Mỗi crystal chỉ có một owner; xử lý tick tuần tự. Kết quả gắn run_id/rules_version, transaction ghi results + reward ledger + inventory + outbox; UNIQUE chống cấp thưởng lặp. Trả về hub bằng reservation mới, thất bại thì hiện retry; không giữ hai ghế lâu dài. Đây là spec M2, chưa có gameplay trong scaffold.

## Test bắt buộc trước launch

30→31 người tạo room mới; reconnect trong/ngoài TTL; explicit leave; packet loss/RTT 50/150/300 ms; input cũ và flood; Unicode chat/XSS; reservation timeout; ban trong room; mất Redis; kill worker; schema v1/v2 cùng tồn tại; drain khi minigame đang commit. Bài bot hiện tự động kiểm tra auth sai, capacity, movement và chat; các case còn lại phải được ghi nhận riêng.

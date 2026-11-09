# Animation list — backlog, không kèm clip
Tất cả clip dưới đây cần dựng/rig sau. Avatar dùng skeleton thống nhất; dự kiến ≤45 bones, tối đa 4 influences/vertex. Cấu trúc Root → Hips → Spine/Chest/Neck/Head, hai tay và hai chân; phụ kiện dùng sockets. Tên xương cuối cùng chốt trước khi dựng variant.

| Clip | Thời lượng gợi ý | Loop | Gameplay |
|---|---|---|---|
| idle_relaxed | 3s | có | mặc định |
| walk_forward | 1s | có | locomotion in-place |
| walk_backward | 1s | có | in-place |
| strafe_left/right | 1s mỗi clip | có | blending |
| turn_left/right | 0.5s mỗi clip | không | optional |
| sit_down | 0.8s | không | server cấp seat trước |
| sit_idle | 4s | có | giữ anchor |
| stand_up | 0.8s | không | trả seat |
| wave | 1.5s | không | emote |
| cheer | 2s | không | emote |
| laugh | 2s | không | emote |
| read_plaque | 3s | có | local tương tác |
| point_at_plaque | 1.2s | không | social emote |
| arcade_play | 2s | có | tương tác arcade |
| collect_crystal | 0.6s | không | cosmetic; server quyết pickup |
| disappointed_soft | 2s | không | tự trào, không nhắm người khác |

State machine: locomotion ↔ interaction ↔ emote; movement hủy emote; interaction cần grant/revoke từ server. Animation event không tự cấp điểm/vật phẩm. Avatar reconnect áp state server và blend 0.15–0.25s. Walk không root motion để tránh lệch authoritative position. Rig test trên bốn variant trước khi tạo thêm cosmetics.

## Bổ sung hạng v3 (chưa có clip)
slump_idle 4s loop; head_in_hands 2s; comfort_friend 2s consent interaction; wheelchair_idle 3s loop; wheelchair_move bánh xoay theo velocity; oxygen_rest 4s loop nhẹ, không tiếng khó thở; bed_rest 4s loop; blanket_pull 1s; bed_wave 1.5s. Tất cả in-place/cosmetic, movement do server. Không rig riêng bốn lần: dùng skeleton chung + sockets/pose overrides; kiểm tra pose ngồi/nằm và collision không đổi.

## Ưu tiên triển khai trong repo
Phần hình ảnh theo concept v3. Quyết định backend theo tech-decisions.md: Colyseus 0.18, React UI, quiz/minigame là activity trong cùng room hub; nội dung alpha là file versioned trong repo. Bản chơi thử hiện tại theo playtest.md, chưa triển khai toàn bộ GDD.

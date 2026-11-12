# Dedicated shrine prototype — 2026-11-10

> Implementation snapshot, not a current deployment report. Read [Opus visual handoff](opus-visual-handoff.md) first.
>
> **Đã thay thế (2026-11-11), đọc phần này trước:**
> - Cửa vào không còn ở cạnh lửa trại (4, 4) hay (0, −15,8): hang lớn đã rộng ra, cửa điện thờ nằm trong hầm cửa hang phía sau, khung cửa ở (0, −22,45), chỗ đứng bấm E ở (0, −19,9); về hang thì đứng lại ở (0, −17,7).
> - Đảo điện thờ dời từ (48, 0) sang **(120, 0)** để tránh hai hang nhỏ phía đông; `isInShrine` = x > 80. Hình học khác (ghế 3 m / 5 m, đi được r 8) giữ nguyên.
> - Điện thờ giờ là một **hang đá** (grotto) dựng từ GLB, không còn là hình khối procedural: tượng thần (idol) trên bệ, vòng dây thừng, cờ, nến, ghế đá, cổng gỗ; cửa phía hang lớn là cửa gỗ hai cánh có biển "ĐIỆN THỜ FAKER" (`apps/web/src/world/shrine.ts`). Nó dùng lại vỏ hang cũ `environment/tl_env_cave_*`, nên các GLB đó phải ở lại repo.
> - **2026-11-12:** thêm vòng ghế thứ ba. `SHRINE_SEATS` giờ có **35 ghế**: 8 ghế ở 3 m, 12 ghế ở 5 m và 15 ghế vòng rìa ở 7 m (lưới 18 ô cách nhau 20°, bỏ trống 3 ô phía lối vào +Z). Tượng Faker đổi sang tư thế **"Silent"** (ngón trỏ tay phải đặt lên môi, tay trái buông), không còn cầm cốc; **cúp vô địch** là model riêng `tl_env_shrine_trophy_v01` (phát sáng, không logo/chữ) lơ lửng ở neo `trophy` (y = 3,75 m) trên đầu tượng, xoay 36°/s, nhấp nhô ±7 cm, kèm một đèn omni xanh nhạt nhịp thở. Vùng chặn camera của tượng cao lên 4,9 m.
> - Tượng Faker và bốn chủ sạp là **chân dung cách điệu low-poly** của năm tuyển thủ theo yêu cầu của người dùng ngày 2026-11-11 (xem `docs/art-direction.md`), không logo, không dấu nhà tài trợ; câu "no claim of likeness" bên dưới là của bản cũ.
> - Camera trên đảo vẫn là hình trụ quanh tâm đảo (r 14); trong hang là hợp các phòng (`docs/cameras-and-layout.md`).

## Player flow

Open the local game at http://127.0.0.1:5191/. Walk toward the glowing portal to the right of the campfire at(4,4), press E or open **Điện thờ**, then **Vào điện thờ** within3m. The server transports you into a separate temple island in the same multiplayer room.

The central statue is an original low-poly, bespectacled red-cloaked esports-champion homage to Faker, with no downloaded asset or claim of official/licensed likeness.20 carved stone seats face the statue:8 evenly spaced on the3m inner circle and12 on the5m outer circle. Walk within2m and click a stone, use the nearby-seat button, or select a free seat in the shrine panel.

When seated, **Giơ tay cầu nguyện**, **Cúi lạy**, **Đứng dậy** and **Về hang** replace ordinary movement actions. Gestures last3seconds and use server timestamps; remote players see the same pose. Leaving/disconnecting releases the chair immediately, and reconnect does not reclaim it. No wagering, real match effect, currency or persistent reward.

## Implementation

- shared/shrine.ts defines geometry, strict messages and deterministic translated movement.
- game/shrine.ts owns synchronous exclusive reservation, portal proximity, pose expiry and cleanup.
- HubRoom syncs shrineSeat/shrineGesture/shrineGestureAt and rejects movement while seated.
- world/shrine.ts builds procedural geometry, batches static parts and provides camera blockers.
- avatar.ts supplies grounded seated legs and distinct prayer/bow animation.
- main/UI support direct stone picking, seat map, nearest-seat button and dedicated quick actions.
- Local prediction resets across zone/seat changes; remote teleport snapping avoids sliding through the void.
- Camera follows translated island bounds and avoids statue/pillars/elevated arch beams.

The prior temporary30second altar remains server-compatible but is no longer the player-facing shrine flow. The shrine replaces the old floor-circle interaction.

## Verification

- Full automated suite158/158; TypeScript and production build passed.
- Two real localhost SDK clients: portal entry, same-seat race (one winner), separate second seat, prayer observed remotely, seated movement blocked, gesture expiry, disconnect release/reclaim, bow and exit.
- Real desktop/mobile browser: walk from spawn to portal, enter, select seat, pray, bow, exit. Mobile390×844 action layout checked.20-avatar pose/crowd renders checked across all7 existing outfits.
- Independent review fixed teleport rebound/idle stand delay, camera clipping, and right-click/returning-drag seat selection. Real SDK transitions plus2,880 camera poses verified; no remaining P0–P2 in reviewed scope.
- Match panel regression after server restart: defaults mask30 score labels for15 real cached matches; **Hiện kết quả đã đấu** reveals all30 numeric scores. Feed remains real, no fabricated live match.

## Limits

Local prototype only; no commit/push/public deployment or external asset/likeness rights claim. Persistent progression remains disabled. No60-person device/network soak or actual ongoing-match latency validation. The cave and shrine share room chat; they are visually separate spaces, not separate privacy channels.

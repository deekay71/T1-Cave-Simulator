# Cave stalls update — local prototype, 2026-11-10

> Implementation snapshot, not a current deployment report. Read [Opus visual handoff](opus-visual-handoff.md) first.
>
> **Đã thay thế (2026-11-11), đọc phần này trước:**
> - **Sạp nằm trong hang nhỏ.** Chỉ còn ĐIỂM DANH (Oner) ở hang lớn, cạnh chỗ xuất hiện. Bốn sạp kia mỗi sạp một hang nhỏ, vào qua đường hầm: BẢNG QUEST (Doran) ở Hang Quest (32; −18,5; trước là Hang xem trận, nay lịch đấu xem ở màn hình lớn của hang lớn), KÝ ỨC HUY HOÀNG ở Hang ký ức (−32; −18,5), ĐỐ VUI T1 (Keria) ở Hang đố vui (−32; 18,5), QUẦY TRANG PHỤC (Peyz) ở Hang chợ (32; 18,5). Toạ độ chỗ bấm E: `docs/cameras-and-layout.md`. TV "DEFEAT" bên trái lửa trại đã bỏ: thay bằng màn hình lớn bắt thẳng vào vách sau-trái hang lớn (lịch đấu T1, không hiện tỉ số); 3 TV trong Hang xem trận cũng thay bằng một màn hình gắn vách trong hốc đá, cùng hình; trước mỗi cửa hầm có cổng gỗ treo biển tên hang.
> - **Cửa điện thờ** ở hầm cửa hang phía sau: chỗ bấm E (0; −19,9), không còn là (0; −15,8). Điện thờ là hang đá có tượng thần (xem `docs/shrine-update.md`).
> - **Chủ sạp Oner, Peyz, Keria, Doran (và tượng Faker ở điện thờ) là chân dung cách điệu** của năm tuyển thủ theo yêu cầu của người dùng ngày 2026-11-11 (GLB có rig, biển gỗ sơn tay), không logo / dấu nhà tài trợ; câu "not … accurate facial likenesses" bên dưới là của bản cũ. Quy ước ở `docs/art-direction.md`.
> - **Hạng 3 (300 XP, "Tê Nạng") chống nạng**, không phải khung tập đi (walker) như ghi bên dưới.
> - Nút "Các sạp trong hang" vẫn hiện khoảng cách đường chim bay; đường đi thật vòng qua miệng hầm.

## Open the game

http://127.0.0.1:5191/ on this Mac. API 3310, game 2571, game health 9111. These are local processes, not an installed service. The existing match-feed worker and frontend remain running. No commit, push or deployment was performed.

## Player flow

- Shrine is now a signed doorway at the back cave wall, portal (0, −15.8). Walk close, press E or the on-screen entry button, then enter the existing separate shrine. Seats and gestures remain server-authoritative.
- Five physical, signed stalls use a shared 2.5 m approach-zone interaction: Oner check-in, Peyz apparel, Keria quiz, Doran match results, and the glorious-memory gallery.
- “Các sạp trong hang” shows host and distance. Selecting a distant destination tracks the remaining distance rather than opening a stall remotely. Nearby selections enter normally.
- Desktop stall screens put an illustrated host on the left and scrollable actions on the right. Mobile uses a compact host header. Escape, close, focus wrapping, answer radio buttons, loading/error notices and responsive layouts are supported.
- Hosts and equipment are original coarse low-poly fan interpretations, not official models or accurate facial likenesses. Oner has a jacket; Keria has glasses. There are no borrowed player image assets.

## Explicit local preview

Persistent guest sessions remain OFF. On this development preview, progression uses only JavaScript memory in the current tab. Every reward screen says that a reload loses XP, coins and inventory. These values are not shared with other players or stored in an account. No persistent token was issued, migration applied to the live database, or credential configuration changed.

- Check-in: proposed interpretation is cumulative attendance days, not an unbroken streak. Days 1–15 reward 25 Xu + 20 XP. Afterwards, reward on days 18, 21, 24, etc; other attendance days still count. Reset is 00:00 UTC / 07:00 Vietnam.
- Quiz: three starts/day, five questions/attempt, 10 XP/correct answer. Starting consumes the attempt; closing the screen preserves the active attempt, but unsent selections need re-entering. Fifteen separate local practice questions are used in the tab preview.
- Ranks: 0 XP Tê con mới nhú, 100 Tê Thở with oxygen trolley, 300 Tê Nạng with walker, 700 Tê Lăn with wheelchair, 1500 Tê Liệt on a bed. “Xem dáng” previews a shape without granting rank or XP.
- Shop: six implemented cave looks, shorts, T-shirt, tank top, jersey, glasses, handheld keyboard. “Thử lên nhân vật” is a free local preview; ownership/purchase uses earned tab coins. One look at a time, no layering system. Original legacy catalog entries remain server-compatible but are not sold by this stall until their live try-on is supported.
- Gallery: four original commemorative poster illustrations, explicitly labelled as illustrations rather than event photos. A user-selected JPEG/PNG/WebP ≤ 5 MB can be previewed only in the tab using an object URL. It is not uploaded, published or charged. Proposed future cost is 25 Xu on successful approved publication, with contributor credit. Storage, moderation and shared submissions are not enabled.
- Doran retains the existing real cached match feed, spoiler protection and source/freshness notices. There is no invented match result.

## Dormant backend

Migration 004 and progression routes implement cumulative attendance, XP, ranks, style selection and a 30-question historical server-only quiz bank. Quiz starts and grading are serialized by wallet row locks, full question sets are saved, answers never appear in the question API, submissions are idempotent and exactly three attempts are allowed per UTC day. A stale conflicting/expired submission refreshes client state. Delayed GETs cannot overwrite a successful mutation.

Before persistent play: obtain specific approval for the existing 30-day guest-session cookie, review/apply migrations 003 and 004, enable the existing flag consistently, verify real PostgreSQL multi-connection contention and durable browser flows, and synchronize rank/style to other players. This update does not perform those actions. Public image submissions additionally need validation, moderation, secure storage, privacy/consent handling and publish/refund semantics.

## Verification

- 173/173 automated tests, TypeScript, production build and diff whitespace check pass on the final tree. The existing large-main-bundle warning remains.
- Isolated PGlite tests verify attendance milestones, no double award, wrong/cross-account submissions, quota, UTC expiry, rollback and style ownership. No live account database migration was used.
- Client tests verify tab rollover preserves earned points, duplicate claims/purchases, quiz resume/expiry/limit, conflict reconciliation and delayed GET success/failure after mutation.
- Headless Chrome with actual WebGL: desktop 1440×900 and mobile 390×844, physical Oner proximity/E entry, check-in, purchase/equip, three complete quizzes and cap, gallery, match panel and rank/bed preview. No page errors or horizontal document overflow. The other panels were rendered through the app's development module for targeted UI QA; their shared world approach geometry is covered by movement tests.
- Screenshots: .renders/stalls-update/. Actual keyboard movement via a collision-safe route reached the wall doorway; server entry, seat, prayer, bow and return passed. The updated game is also open in a retained Chrome tab on the Mac.

## Remaining limitations

This is a local prototype. Apparel and character art are coarse procedural previews; garment combinations, full character likenesses, networked rank/style presentation, shared uploads and durable accounts are not complete. No 60-player device/network soak or ongoing live-match latency validation was performed.

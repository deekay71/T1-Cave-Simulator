# Tê Liệt — Hang trú thua

Bản chơi thử low-poly: multiplayer 30 người/phòng, WASD, chat/emote, camera theo avatar, Vách ký ức đọc thử và panel thâm niên.

Đọc [hướng dẫn chơi thử](docs/playtest.md), [review repository](docs/review-2026-11-09.md), [quyết định kỹ thuật](docs/tech-decisions.md), [GDD](docs/GDD.md) và [art direction v3](docs/art-direction.md).

```sh
npm ci
npm run dev:api
# terminal 2: npm run dev:game
# terminal 3: npm run dev:web
```

Mở http://localhost:5173. Dev không cần PostgreSQL/Redis nếu chỉ thử RAM. Không phải bản public production; hạng thâm niên, minigame và moderation còn đang triển khai. Không có model GLB, hình học cảnh dựng trực tiếp bằng PlayCanvas.

```sh
npm run build
npm test
# khi game server đang chạy:
npm run spike
```

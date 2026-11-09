# Tê Liệt — Hang trú thua

Bản chơi thử low-poly: hang trú cho fan sau trận thua, 60 người/phòng. Hang dựng từ model GLB theo concept v3 (`design/concepts/v3`), fan có animation đi/đứng/cảm xúc, camera góc ba bám sau vai, chat, ba cảm xúc, bảng tên, Vách ký ức, TV trú thua và góc thâm niên (bấm E).

Đọc [hướng dẫn chơi thử](docs/playtest.md), [camera và bố cục](docs/cameras-and-layout.md), [review repository](docs/review-2026-11-09.md), [quyết định kỹ thuật](docs/tech-decisions.md), [GDD](docs/GDD.md) và [art direction v3](docs/art-direction.md).

## Chạy local

```sh
npm ci
npm run dev:api     # API khách, cổng 3000 (API_PORT)
npm run dev:game    # game server Colyseus, cổng 2567 (GAME_PORT)
npm run dev:web     # Vite, http://localhost:5173
```

Mở http://localhost:5173 ở hai tab, đặt hai tên. Không cần PostgreSQL/Redis nếu chỉ thử RAM. API hoặc game ở cổng khác thì chạy web với `VITE_API_URL=http://127.0.0.1:<cổng>/v1/guest VITE_GAME_URL=ws://127.0.0.1:<cổng>`. Không phải bản public production: thâm niên, minigame và moderation còn đang triển khai.

## Lệnh

```sh
npm run check       # tsc
npm test            # unit test (scripts/*.test.ts)
npm run build       # tsc + vite build + bundle server (dist/)
npm run bots        # fan bot lang thang trong hang, xem docs/playtest.md
npm run spike       # load test khi game server đang chạy
```

## Model và trang dev

- Model GLB sinh bằng code: `npx tsx tools/models/build.ts <environment|fire|furniture|props|characters|all>` → `apps/web/public/models/<nhóm>/<tên>.glb` và `manifest.<nhóm>.json` (anchor, đèn, pose, collider gợi ý). Vị trí đặt trong hang và collider dùng chung client/server ở `packages/shared/src/layout.ts`.
- Trang chỉ có ở bản dev (bản build chỉ có `index.html`): `gallery.html?model=fire/tl_fx_campfire_v01` (xem từng model), `preview.html?view=concept` (cả hang theo preset camera), `avatar-lab.html` (avatar + camera bám theo). Tham số ghi ở đầu `apps/web/src/{gallery,preview,avatar-lab}.ts`.
- Game ở bản dev nhận `?view=<preset>`, `?autojoin=<tên>`, `?stats=1`, `?batch=0` (đầu `apps/web/src/main.ts`).
- Ảnh headless (Chrome + WebGL2 thật): `node tools/models/render.mjs --url "http://localhost:5173/?autojoin=Anh" --out .renders/anh.png`.

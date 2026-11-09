# Concept chốt — Hang trú thua v3

Các ảnh là concept AI và tham khảo thiết kế, không phải screenshot game. Bản game hiện tại dựng hang
theo các ảnh này từ model low-poly sinh bằng code.

- [Hang và camera](concepts/v3/01-environment.png)
- [Vách ký ức, sinh hoạt và minigame](concepts/v3/02-memory-wall.png)
- [Bốn hạng thâm niên](concepts/v3/03-tenure.png)
- [Đồ vật](concepts/v3/04-props.png)

Ảnh trong references do người dùng cung cấp: chuẩn bối cảnh low-poly và biểu tượng biển hang. Chưa xác minh quyền sử dụng thương mại; không dùng screenshot tham khảo làm texture. Hình AI có thể có chữ/logo không chính xác, cần dựng lại khi triển khai: trong game không có chữ hay logo đội tuyển, biểu tượng duy nhất là biểu tượng tự dựng trên biển cửa hang và lưng một áo hoodie.

Art direction: hang trần cao, đá bất quy tắc mảng lớn, đất nâu, đuốc ấm, props chắp vá. Đỏ–đen–trắng là điểm nhấn áo fan. Không dùng lại concept v1 lộng lẫy. Chi tiết xem docs/art-direction.md và docs/tenure-ranks.md.

## Từ concept tới game

- Model: `tools/models/groups/<nhóm>.ts` → `npx tsx tools/models/build.ts <nhóm|all>` →
  `apps/web/public/models/` (GLB + manifest). Xem từng model ở `/gallery.html` (dev).
- Bố cục, camera preset, ánh sáng và cách chụp so sánh với concept (`/preview.html?view=concept&time=3.2`):
  `docs/cameras-and-layout.md`.

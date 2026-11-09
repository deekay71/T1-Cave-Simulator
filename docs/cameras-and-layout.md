# Camera và layout v3
Origin tại lửa trại. X phải, Y lên, Z vào sâu hang; bán kính hub 15m, trần 10–14m. Cửa vào Z=-13; Vách ký ức ở (-11,0,5); TV/minigame ở (9,0,4); hốc nghỉ ở (8,0,10). Lối chính ≥2m, vùng quay đầu ≥2.5m, đá vụn nhỏ cosmetic không collider.

| Camera | Position m | Look-at m | FOV | Dùng cho |
|---|---|---|---|---|
| Main gameplay | (0,2.2,-10) | (0,1.5,3) | 65° | cảm nhận hang lớn, lửa giữa |
| Campfire | (5,1.8,-4) | (0,1,0) | 55° | nhóm fan |
| Rest nook | (10,1.8,5) | (8,1,10) | 55° | thâm niên |
| Memory wall | (-7,1.7,2) | (-11,1.5,5) | 50° | đọc ký ức |
| TV | (5,1.8,0) | (9,1,4) | 50° | góc minigame |
| Layout | (0,38,0) | (0,0,0) | ortho 34m | zoning, không gameplay |

Gameplay camera third-person boom 4–6m, target 1.3m, spherecast để tránh xuyên đá; điều chỉnh framing theo skin nhưng không tạo lợi thế. Đảm bảo fan trên xe/giường không che hết màn hình. Camera detail khi đọc plaque là tùy chọn, có reduced motion; nội dung ở DOM UI, không bắt đọc chữ nhỏ trong mesh.

## Ưu tiên triển khai trong repo
Phần hình ảnh theo concept v3. Quyết định backend theo tech-decisions.md: Colyseus 0.18, React UI, quiz/minigame là activity trong cùng room hub; nội dung alpha là file versioned trong repo. Bản chơi thử hiện tại theo playtest.md, chưa triển khai toàn bộ GDD.

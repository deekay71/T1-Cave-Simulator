# Art bible v3 — Low-poly hang trú thua
## Chuẩn hình ảnh chốt
Hang rộng trần cao 10–14m, vách đá bằng vài mặt phẳng lớn, silhouette góc cạnh; nhìn như game realtime low-poly, không phải tranh minh họa giàu nếp vải hoặc diorama bóng bẩy. Camera gameplay nhìn từ bên trong hang ở tầm người. Lửa trại trung tâm, nhiều khoảng sàn trống cho 20–30 người, hốc nghỉ bên vách, đuốc thưa và ánh sáng yếu.

## Palette và vật liệu
Nâu đất #493325, đá ochre #72513A, bóng tối #211C19, áo/biển crimson phai #AD2936, vải trắng cũ #CEC5B2, đuốc #FFB24C. Môi trường khoảng 80% đất/đá/tối; 15% đỏ/đen/trắng của áo/đạo cụ; 5% điểm sáng. Không sơn cả hang đỏ–đen–trắng. Flat shading, matte, ít vật liệu; wornness bằng mảng màu/bản vá lớn, không noise texture chi chít.

## Bố cục và cảm xúc
TV cũ trên thùng hiện DEFEAT, bạt vá, cốc mì, ấm móp, ghế gỗ lẻ, chăn cũ; fan ngồi thẫn thờ nhưng có tương tác an ủi. Vách ký ức là bảng gỗ đóng vào đá, báo cũ và thẻ nguồn; không bục cúp, không hành lang chiến thắng, không sàn marble. Giữ đường đi và camera rõ; bóng tối dùng cho mood, không che prompt.

## Nhân vật và thâm niên
Adult stylized, đầu khoảng 1/5 chiều cao, tay khối đơn giản, tóc thành mảng; cùng độ đơn giản với đá và props. Bốn hạng trong tenure-ranks.md, đa dạng màu da/tóc; không dùng gương mặt tuyển thủ thật. Xe lăn, bình oxy và giường là đạo cụ cosmetic hư cấu, không mô tả chấn thương hoặc bệnh thật. Không âm thanh đau đớn, không hình ảnh máu.

## Biểu tượng và nội dung tham khảo
Dùng phần biểu tượng đỏ ở nửa trái ảnh logo người dùng cung cấp trên biển cửa hang cũ. Không lấy ảnh móc khóa hoặc nền ảnh vào texture. Logo trong hình AI chỉ là bản tái hiện concept, không phải vector master; khi triển khai cần master riêng và xác nhận quyền. Không coi việc người dùng gửi ảnh là giấy phép thương mại. Tham khảo hang chỉ về bố cục/low-poly/ánh sáng; bỏ lính, súng và nhân vật xanh phát sáng.

## Quy chuẩn dựng hình sau
Mét; Y-up; convention avatar +Z, adapter engine xử lý camera. Pivot đáy giữa, avatar tại chân; asset name tl_<category>_<name>_v01. Avatar 1.75m; chiều rộng xe lăn ≤0.8m, giường 0.9×0.65×2m (W×H×D). Lối chính ≥2m, quay đầu ở hốc nghỉ ≥2.5m; capsule gameplay thống nhất cho mọi skin, kiểm tra clipping khi quay camera.

Budget đề xuất: avatar LOD0 ≤5k triangles/LOD1 ≤2.5k, prop nhỏ ≤500, xe lăn/giường ≤2k, module đá ≤3k. Shared materials, atlas 1024 cho props, không mặc định 4K. Dựng collider đơn giản riêng. Đo 30 avatar + props trên thiết bị trước nâng detail. Các budget chưa phải benchmark.

## Quy tắc duyệt
Hình concept có thể khác chi tiết giữa các panel; ưu tiên GDD/manifest về kích thước, collision, lối đi. Chữ/biểu tượng do AI vẽ phải dựng lại ở implementation. Không thêm vũ khí, trophy, neon hoặc kiến trúc lộng lẫy. Giữ low-poly bằng hình khối thật, không chỉ dùng filter lên mesh high-poly. Không có model trong gói này.

## Ưu tiên triển khai trong repo
Phần hình ảnh theo concept v3. Quyết định backend theo tech-decisions.md: Colyseus 0.18, React UI, quiz/minigame là activity trong cùng room hub; nội dung alpha là file versioned trong repo. Bản chơi thử hiện tại theo playtest.md, chưa triển khai toàn bộ GDD.

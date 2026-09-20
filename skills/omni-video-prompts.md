---
name: omni-video-prompts
description: |
  Hệ thống viết prompt video tối ưu hóa cho Google Omni 1.1 qua gflow/Google Flow. Chuyển đổi từng phân cảnh kịch bản (storyboard/scene beat dài 5–8 giây) thành một câu lệnh prompt duy nhất, tập trung vào hành động thực tế, không gian cụ thể, ánh sáng tự nhiên và bố cục khung hình chuẩn điện ảnh, loại bỏ hoàn toàn các từ ngữ sáo rỗng (AI slop). Tự động kích hoạt khi người dùng hoặc Firstmate yêu cầu tạo prompt cho video, render cảnh, hoặc đưa vào danh sách cảnh trong scenes.json.
---

# Google Omni 1.1 Video Prompt Engineer

Bạn tạo ra **MỘT prompt duy nhất, hoàn chỉnh và sẵn sàng để gửi trực tiếp cho Google Omni 1.1 qua gflow** cho mỗi phân cảnh. 

Mục tiêu cốt lõi: Tận dụng khả năng thấu hiểu ngữ cảnh và tính nhất quán vật thể của Omni 1.1, triệt tiêu hoàn toàn **hình ảnh giả tạo (AI slop)** và **những góc máy bất động, nhàm chán**[cite: 2].

---

## 1. Nguyên tắc cốt lõi: Mô tả những gì nhìn thấy (Show, Don't Tell)

Chỉ mô tả những gì ống kính camera thực sự ghi lại: hành động vật lý, chất liệu bề mặt, tương tác không gian và nguồn sáng cụ thể[cite: 2].

- **Nói KHÔNG với tính từ cảm xúc sáo rỗng:** Cấm tiệt các từ như "cinematic", "epic", "stunning", "hyperrealistic", "masterpiece"[cite: 2]. Chất lượng điện ảnh phải đến từ ánh sáng, kết cấu và bố cục[cite: 2].
- **Mô tả hành động có động lực:** Vật thể chuyển động vì có lực tác động, camera di chuyển vì đi theo chủ thể[cite: 2].
- **Ví dụ so sánh:**
  - ❌ *"Một cảnh quay cyberpunk hoành tráng, cinematic về chiếc điện thoại scan tài liệu."*
  - ✅ *"Góc nhìn thứ nhất từ trên xuống: một bàn tay cầm chiếc smartphone di chuyển chậm qua tờ hóa đơn nhăn trên bàn gỗ tối màu, chùm sáng xanh lam phát ra từ camera quét đều qua các dòng chữ, ánh sáng đèn bàn vàng nhạt tạo bóng mờ phía sau."*

---

## 2. Nguyên tắc tạo câu lệnh khẳng định (Positive-only Prompting)

Mô hình AI xem mọi danh từ trong prompt là yêu cầu tạo hình[cite: 2]. Nếu bạn viết "không có người", mô hình sẽ vẽ người[cite: 2].

- Luôn mô tả **những gì ĐANG CÓ** trong khung hình[cite: 2].
- Định hình môi trường bằng trạng thái khẳng định[cite: 2]: 
  - Thay vì: *"Không có bóng người, không có xe cộ"*
  - Hãy viết: *"Căn phòng làm việc trống trải chỉ gồm một màn hình máy tính đang chạy mã lệnh, rèm cửa khẽ đung đưa theo gió, không gian tĩnh lặng dưới ánh sáng màn hình hắt ra."*

---

## 3. Cấu trúc chuẩn của một Prompt (Omni 1.1)

Mỗi prompt cho phân cảnh (thời lượng 5–8 giây) được viết thành một đoạn văn liền mạch theo đúng 4 thành phần[cite: 1]:

1. **Góc máy & Bố cục (Camera Framing & Movement):**
   - Định nghĩa rõ góc nhìn: Góc cận cảnh (Close-up), góc trung (Medium shot), góc rộng toàn cảnh (Wide shot), góc nhìn thứ nhất (POV), góc nhìn từ trên cao (Top-down)[cite: 2].
   - Chuyển động máy quay mượt mà: Di chuyển tịnh tiến chậm (slow push-in), lia máy theo chiều ngang (smooth pan left to right), nâng máy quay lên từ từ (tilt up), hoặc camera cố định quan sát hành động[cite: 2].
2. **Chủ thể & Chuỗi hành động (Subject & Concrete Action):**
   - Ai/cái gì đang làm gì? Trọng tâm là sự thay đổi vị trí hoặc tương tác thực tế giữa các vật thể[cite: 2].
3. **Môi trường & Ánh sáng (Environment & Practical Lighting):**
   - Nguồn sáng tự nhiên đến từ đâu (ánh sáng cửa sổ ban ngày, đèn huỳnh quang văn phòng, ánh đèn xe lướt qua, ánh sáng màn hình phát ra)[cite: 2].
   - Chất liệu và bề mặt: kim loại xước, mặt kính phản chiếu, mặt gỗ sần, khói mờ nhẹ[cite: 2].
4. **Quy chuẩn âm thanh hiện trường (Diegetic Audio / SFX Only):**
   - Đính kèm dòng định dạng âm thanh thực tế ở cuối prompt:  
     `AUDIO: SFX ONLY — [Mô tả 2-3 âm thanh thực tế: tiếng gõ bàn phím, tiếng giấy sột soạt, tiếng gió thổi]. NO MUSIC.`[cite: 2]

---

## 4. Quy chuẩn thời lượng, Tỷ lệ khung hình & Mô hình Google Flow

- **Mô hình mục tiêu:** Luôn chọn **`Omni 1.1 Flash`** trong số 4 mô hình của Google Flow (`Omni 1.1 Flash`, `Veo 3.1 - Lite`, `Veo 3.1 - Fast`, `Veo 3.1 - Quality`) để tối ưu tốc độ và độ nhất quán vật thể.
- **Thời lượng chuẩn:** Mỗi phân cảnh được thiết lập mặc định **10 giây (10s)** cho mỗi lần generate (khớp với tùy chọn 10s trên giao diện Google Flow).
- **Tỷ lệ khung hình (Aspect Ratio):**
  - **Ngang (16:9 - `crop_16_9`):** Dành cho video YouTube chuẩn / Long-form.
  - **Dọc (9:16 - `crop_9_16`):** Dành cho YouTube Shorts / Reels / TikTok.
- **1 Scene = 1 Prompt độc lập:** Mỗi câu prompt đại diện cho một cú máy duy nhất kéo dài 10 giây. Không ép Omni tự cắt cảnh (cuts), việc nối ghép do `ffmpeg` đảm nhiệm.
- **Bố cục chủ thể:** Luôn đặt trọng tâm lệch nhẹ theo quy tắc một phần ba hoặc tập trung ở nửa dưới khung hình để tạo chiều sâu thị giác.

---

## 5. Mẫu Output chuẩn cho Agent

Khi nhận yêu cầu phân cảnh từ kịch bản của Firstmate, xuất dữ liệu theo định dạng JSON để Pi Worker có thể đưa thẳng vào lệnh điều khiển Google Flow:

```json
{
  "aspect_ratio": "16:9",
  "model": "Omni 1.1 Flash",
  "scenes": [
    {
      "scene_id": "scene_01",
      "duration_seconds": 10,
      "prompt": "Góc nhìn cận cảnh từ trên cao xuống bàn làm việc bằng gỗ: một chiếc smartphone được cầm trên tay đang lia chậm qua một tập tài liệu có viền nét mực xanh. Ánh đèn bàn vàng ấm chiếu từ góc trái tạo bóng nghiêng tự nhiên, màn hình điện thoại hiển thị khung quét màu xanh lá cây bám sát mép giấy theo thời gian thực. Camera hạ thấp dần về phía màn hình. AUDIO: SFX ONLY — tiếng giấy cọ xát nhẹ trên mặt bàn, tiếng chạm màn hình tinh chỉnh góc. NO MUSIC."
    }
  ]
}
```
---
name: omni-video-prompts
description: |
  Hệ thống viết prompt video tối ưu hóa cho Google Omni 1.1 Flash qua Google Flow. Hỗ trợ kỹ thuật Timeline Prompting đa phân cảnh (multi-cut timeline prompts) tạo chuyển cảnh dồn dập 1.5s–2s chuẩn YouTube Shorts và cú máy điện ảnh đơn lẻ cho video dài. Tập trung vào hành động thực tế, góc máy vật lý, ánh sáng tự nhiên và âm thanh hiện trường SFX, loại bỏ hoàn toàn từ ngữ sáo rỗng (AI slop).
---

# Google Omni 1.1 Video Prompt Engineer & Image Generation Standards

Tạo ra **MỘT prompt duy nhất, hoàn chỉnh và sẵn sàng để gửi trực tiếp cho Google Omni 1.1 qua Google Flow** hoặc các mô hình tạo sinh hình ảnh/video cao cấp.

---

## 1. Bản Chất Cơ Chế Hoạt Động Của AI Tạo Sinh (Deep Architecture Insights)

Hiểu rõ bản chất toán học và cơ chế chú ý (attention mechanism) của các mô hình Diffusion và Transformer là nền tảng để viết prompt chính xác, loại bỏ hoàn toàn tỷ lệ gacha hỏng:

- **Nghịch lý độ phức tạp (Complexity Paradox):**
  AI rất giỏi vẽ những bối cảnh khoa học viễn tưởng hoành tráng, kỳ ảo đồ sộ (vũ trụ, lâu đài thần thoại, hào quang ma pháp) nhưng lại thường xuyên thất bại trước các chi tiết sinh hoạt đời thường giản dị (bàn ăn gia đình, cử chỉ ngón tay cầm cốc nước, căn phòng ngủ bình thường) do bị quá tải hoặc thiếu thông tin định hình cụ thể.
- **Hiện tượng "Ô nhiễm từ khóa" (Keyword Contamination):**
  Khi prompt nhồi nhét quá nhiều từ thừa, từ khóa tối nghĩa hoặc các thuật ngữ đối nghịch (như vừa muốn "vintage" vừa muốn "futuristic neon"), mô hình sẽ bị phân tán ma trận chú ý (attention weights) và gán ghép sai lệch chi tiết vào bức ảnh/video.
- **Cơ chế "Bù trừ hình ảnh" (Image Compensation):**
  Khi câu lệnh có khoảng trống thông tin hoặc quá sơ sài, AI sẽ tự động "bù trừ" bằng cách lấp đầy không gian trống bằng các yếu tố quen thuộc/thường gặp nhất trong tập dữ liệu huấn luyện (dẫn đến việc ảnh tự ý xuất hiện đồ vật, đám đông hoặc chi tiết kỳ lạ lệch hoàn toàn so với ý định).
- **Hiệu ứng "Đừng nghĩ về con voi" (Tâm lý phủ định - Negative Prompt Paradox):**
  AI học dựa trên các khái niệm (tokens). Khi nhận các câu lệnh mang tính cấm đoán/phủ định (như "không có xe", "không vẽ người", "không có cây cối"), mô hình vẫn kích hoạt token embedding của "xe", "người", "cây cối" và vẽ chúng ra.
- **Cơ chế mở rộng prompt ngầm (Prompt Expansion):**
  Các mô hình hiện đại (như DALL-E 3, Midjourney, Google Omni/Imagen) thường có một bước ngầm dùng LLM viết lại hoặc mở rộng câu lệnh trước khi nạp vào diffusion model; do đó prompt gốc cần mạch lạc, ngữ nghĩa trong sáng để tránh bị AI diễn giải sai lệch.

---

## 2. Quy Tắc Viết Prompt Vàng (Core Prompting Rules)

### 2.1. Chỉ nói điều bạn muốn, TUYỆT ĐỐI KHÔNG dùng từ phủ định
- ❌ **Sai:** *"Căn phòng trống không có bàn ghế, không có người, không có đèn chùm."* (AI sẽ vẽ người hoặc bàn ghế).
- ✅ **Đúng:** *"Một căn phòng trống trải hoàn toàn, sàn gỗ sồi sáng bóng phản chiếu ánh ban mai, bốn bức tường trắng sạch sẽ, không gian thoáng đãng tĩnh lặng."*

### 2.2. Chủ động mô tả chi tiết để chặn triệt để cơ chế bù trừ
Với các cảnh tối giản hoặc đời thường, bắt buộc phải chủ động miêu tả rõ chất liệu, nền, ánh sáng, nhiệt độ màu và khoảng trống không gian để AI không có cơ hội tự ý bù trừ thêm các chi tiết kỳ quặc ngoài ý muốn.

### 2.3. Cú pháp mạch lạc, phân tách tầng thông tin rõ ràng
Sử dụng dấu phẩy, dấu chấm để phân định rõ các tầng thông tin theo cấu trúc chuẩn:
`[Chủ thể chính] + [Hành động/Trạng thái/Động học] + [Bối cảnh/Môi trường xung quanh] + [Ánh sáng, Góc chụp, Phong cách nghệ thuật/Màu sắc]`

### 2.4. Súc tích và loại bỏ rác từ (No Slop / High-Signal Tokens)
- Chỉ giữ lại các danh từ và tính từ mang giá trị thị giác cao (visual weight).
- Loại bỏ hoàn toàn các từ ngữ cảm xúc sáo rỗng vô nghĩa như: *"cinematic"*, *"epic"*, *"stunning"*, *"hyperrealistic"*, *"masterpiece"*. Chất lượng hình ảnh phải được định hình bằng: nguồn sáng cụ thể (volumetric backlight, rim light), chất liệu vật lý (brushed silver, weathered leather), tiêu cự camera (35mm lens, f/1.8, shallow depth of field) và phong cách dựng hình (Unreal Engine 5 render, octane render, 3D CGI anime).

---

## 3. Nguyên tắc cốt lõi: Mô tả những gì nhìn thấy (Show, Don't Tell)

Chỉ mô tả những gì ống kính camera thực sự ghi lại: hành động vật lý, chất liệu bề mặt, tương tác không gian và nguồn sáng cụ thể.

- **Nói KHÔNG với tính từ cảm xúc sáo rỗng:** Cấm tiệt các từ như "cinematic", "epic", "stunning", "hyperrealistic", "masterpiece". Độ sắc nét và chất lượng điện ảnh phải đến từ nguồn sáng cụ thể, bề mặt vật liệu và bố cục khung hình.
- **Mô tả hành động có động lực:** Vật thể chuyển động vì có lực tác động, camera di chuyển vì bám theo chủ thể.
- **Nguyên tắc khẳng định (Positive-only):** Không dùng câu phủ định ("không có bóng người", "không có xe"). Luôn mô tả trực tiếp những gì ĐANG XUẤT HIỆN trong khung hình.

---

## 4. Kỹ Thuật Timeline Prompting (Dành riêng cho Series Dài Tập & YouTube Shorts)

Trong cả anime series dài tập lẫn Shorts, giữ 1 góc máy quá 2.5–3.0s sẽ làm nhịp phim bị chậm và lê thê. Omni 1.1 Flash có khả năng hiểu các mốc thời gian trong prompt và thực hiện chuyển cảnh trực tiếp trong clip 10 giây.

### 4.1. Cấu trúc Timeline Prompting Linh Hoạt Theo Tiết Tấu (3–7 Micro-Scenes)
Không giới hạn cứng nhắc số nhát cắt cảnh trong một clip 10 giây. Tùy thuộc vào bản chất của phân cảnh:
- **Cảnh khám phá / thám hiểm / hội thoại tĩnh:** Chia làm **3 đến 5 micro-scenes** (mỗi cảnh con dài **2.0s đến 3.0s**) để camera quan sát, bắt biểu cảm và không gian.
- **Cảnh hành động chiến đấu cao trào / combat Boss:** Cho phép từ **6 đến 7 micro-scenes** (mỗi cảnh con dài **1.2s đến 1.8s**, thay đổi góc máy liên tục: Low-angle -> Rapid cut to Close-up -> Whip pan -> Snap zoom) để tạo tiết tấu võ thuật/ma pháp dồn dập, nghẹt thở chuẩn điện ảnh AAA.

```
[Khung hình & Phong cách tổng quan]
[00:00 - 00:02] Cảnh 1: [Góc máy 1: Low-angle / Wide shot] + [Hành động dồn dập 1]
[00:02 - 00:04] Cảnh 2: [Từ khóa chuyển cảnh: Rapid cut to] + [Góc máy 2: Medium] + [Hành động 2]
[00:04 - 00:06] Cảnh 3: [Từ khóa chuyển cảnh: Hard cut to] + [Góc máy 3: Tight Close-up] + [Hành động then chốt 3]
[00:06 - 00:08] Cảnh 4: [Từ khóa chuyển cảnh: Whip pan to] + [Góc máy 4: Orbital tilt] + [Đòn đánh 4]
[00:08 - 00:10] Cảnh 5: [Từ khóa chuyển cảnh: Snap zoom on] + [Góc máy 5] + [Điểm chốt thị giác 5]
AUDIO: SFX ONLY — [Mô tả âm thanh hiện trường đồng bộ]. NO MUSIC. CLEAN FOOTAGE ONLY. STRICTLY NO ON-SCREEN TEXT. NO SUBTITLES. NO CAPTIONS.
```

### 4.2. Từ vựng chuyển cảnh kỹ thuật điện ảnh (Cinematic Cut Keywords)
Sử dụng các từ khóa điều hướng camera rõ ràng để mô hình thực hiện cắt cảnh:
- **`Rapid cut to:`** / **`Hard cut to:`** Cắt cảnh đột ngột sang một góc nhìn mới hoặc chủ thể cận cảnh.
- **`Whip pan to:`** Lia máy cực nhanh sang một hướng khác tạo vệt mờ chuyển động.
- **`Snap zoom in on:`** / **`Fast push-in to:`** Phóng nhanh vào một chi tiết gây tò mò.
- **`Match cut to:`** Cắt cảnh nối tiếp hình dạng hoặc hướng chuyển động tương đồng giữa 2 vật thể.
- **`Smash cut to:`** Chuyển cảnh đối lập mạnh mẽ giữa tĩnh sang động, hoặc tối sang sáng.

---

## 5. Quy Chuẩn Âm Thanh & Lồng Tiếng Chuẩn Hóa (Standardized Audio Architecture 2026-09-27)

### 5.1. Google Flow: 100% Âm Thanh Hiện Trường & SFX Thuần Túy (SFX Only — BẮT BUỘC)
Omni 1.1 Flash chỉ đảm nhiệm tạo âm thanh môi trường, tiếng động võ thuật, đao kiếm, tiếng bước chân, nổ ma thuật, sấm sét và tiếng quái thú.
**TUYỆT ĐỐI CẤM đưa lời thoại nhân vật, trích dẫn tiếng Nhật hay yêu cầu lồng tiếng vào prompt của Google Flow!**
Mọi prompt gửi lên Flow BẮT BUỘC kết thúc bằng chỉ thị âm thanh sau:
`AUDIO: SFX ONLY — [Mô tả chi tiết 3–4 âm thanh tương ứng với từng giai đoạn chuyển cảnh]. NO MUSIC. CLEAN FOOTAGE ONLY. STRICTLY NO ON-SCREEN TEXT. NO SUBTITLES. NO CAPTIONS.`

- **Lý do kiến trúc:**
  1. Triệt tiêu hoàn toàn hiện tượng choải giọng (voice clash) hoặc 2 giọng nói đè lên nhau.
  2. Triệt tiêu 100% nguy cơ Flow hallucinate tự vẽ phụ đề tiếng Nhật vào video.
  3. Video clip xuất xưởng luôn là footage sạch sẽ (clean footage) chuẩn 1080p sẵn sàng để burn phụ đề ASS 2 tầng.

### 5.2. ElevenLabs: 100% Lồng Tiếng Nhân Vật & Hệ Thống (Single Source of Dialogue)
Toàn bộ lời thoại nhân vật, độc thoại nội tâm và thông báo hệ thống được đảm nhiệm 100% độc quyền bởi ElevenLabs:
- **Dàn diễn viên chuẩn (Voice Cast Presets):**
  - Nhân vật chính (Ashel): Voice **`Adam`** (Eleven v3, Speed 1.0x, Stability 50%, Similarity 75%) — Giọng trầm tối, dũng mãnh, đầy quyền uy.
  - Nữ đối thủ / Kiếm thủ (Selena): Voice **`Rachel`** (Eleven v3, Speed 1.0x, Stability 50%, Similarity 75%) — Giọng sắc sảo, kiêu kỳ quý tộc.
  - Hệ thống / AI Thái Cổ (Protocol: Root): Voice **`Marcus`** (Eleven v3, Speed 0.95x, Stability 60%, Similarity 85%) — Giọng robot trầm tĩnh, phẳng lặng, uy nghiêm.
- **Hòa âm tự động (`videogen assemble`):**
  - Engine tự động nạp file voice ElevenLabs cho toàn bộ các phân cảnh có phụ đề/lời thoại.
  - Bộ lọc FFmpeg `amix=inputs=2:duration=first:dropout_transition=2:normalize=0` ghép trực tiếp đường tiếng ElevenLabs studio lên nền SFX sạch của Flow mà không làm suy giảm âm lượng SFX.
  - Khóa đồng bộ chính xác từng miligiây giữa mốc bắt đầu của phụ đề ASS (`subStart`) và độ trễ âm thanh FFmpeg (`adelay = voice_delay_sec`).

---

## 6. Quy chuẩn thông số kỹ thuật (Google Flow)

- **Mô hình:** Luôn dùng **`Omni 1.1 Flash`** (ưu tiên số 1 về tốc độ render và tính nhất quán).
- **Thời lượng:** Chuẩn **10 giây (10s)** cho mỗi lần generate.
- **Tỷ lệ khung hình:**
  - **Dọc `9:16` (`crop_9_16`):** Chuẩn bắt buộc cho YouTube Shorts, TikTok, Instagram Reels.
  - **Ngang `16:9` (`crop_16_9`):** Dành cho video dài chuẩn YouTube và series dài tập.

---

## 7. Ví Dụ Mẫu Timeline Prompt (Video 30s = 3 Scene x 10s Timeline)

```json
{
  "aspect_ratio": "9:16",
  "model": "Omni 1.1 Flash",
  "scenes": [
    {
      "scene_id": "scene_01",
      "duration_seconds": 10,
      "timecode": "00:00 - 00:10",
      "voiceover": "For 138 years, people thought Coca-Cola's secret formula was locked in an Atlanta vault. The truth is far stranger.",
      "prompt": "Vertical 9:16 fast-paced sequence with rapid cuts: [00:00 - 00:02] Low-angle extreme close-up of heavy steel bank vault door locking bolts spinning shut. [00:02 - 00:05] Rapid hard cut to high-angle medium shot: an unmarked white truck speeds through open barbed-wire security gates under harsh sun. [00:05 - 00:08] Whip pan to concrete loading dock: gloved workers haul rough burlap sacks from truck. [00:08 - 00:10] Snap zoom in on burlap texture as a sack drops with dust puff. AUDIO: SFX ONLY — heavy vault clank, accelerating diesel truck engine, rattling chain link fence, heavy burlap thud on concrete. NO MUSIC."
    }
  ]
}
```

---

## 8. Quy Chuẩn Timeline Prompting cho Series Anime / Cinematic 3D CGI (16:9)

Đối với series dài tập 16:9, clip luôn generate ở mốc **10 giây** nhưng bên trong prompt chia thành **2 đến 3 nhịp điện ảnh (2s–4s/nhịp)**:

### Cấu trúc Timeline Anime 10s Chuẩn:
- **`[00:00 - 00:03]` (3s):** Góc máy toàn cảnh/trung cảnh thiết lập tư thế và bối cảnh (`Wide/Medium shot`).
- **`[00:03 - 00:07]` (4s):** Cú máy động (`Camera push-in / Pan / Tilt`) kết hợp hành động then chốt.
- **`[00:07 - 00:10]` (3s):** Góc cận cảnh (`Close-up`) bắt trọn biểu cảm và điểm chốt cao trào.

---

## 9. Bảng Từ Vựng Né Vi Phạm Chính Sách Google Flow (Safety Filter Hygiene)

Google Flow kiểm duyệt các từ ngữ mô tả máu me, thương tích và bạo lực trực diện. Luôn dùng bộ từ vựng điện ảnh / CGI thay thế:

| Từ Bị Cấm / Rủi Ro Cao | Từ Thay Thế Chuẩn Điện Ảnh / CGI |
| :--- | :--- |
| `blood`, `bleed`, `dripping blood` | `purple/crimson cosmic particles`, `energy residue`, `shattered crystal sparks` |
| `severely injured`, `wounded`, `dying` | `exhausted battle stance`, `kneeling in fatigue`, `battle-worn posture` |
| `dagger`, `knife stabbing`, `slash throat` | `shattered crystalline blade`, `blade hilt`, `energy saber`, `defensive stance` |
| `piercing chest`, `impaling` | `thrusting glowing rapier close to chest`, `impact shockwave`, `energy burst` |
| `kill`, `murder`, `corpse` | `vanquish`, `fallen warrior`, `motionless silhouette in dark void` |
| `screaming in agony` | `gasp of shock`, `sharp intake of breath`, `fierce determined glare` |

---

## 10. Quy Chuẩn Vàng: Tuyệt Đối Cấm Miêu Tả Ngoại Hình Nhân Vật Khi Đã Gắn Thẻ (`@Character`)

### 8.1. Nguyên Lý Cốt Lõi Về Thẻ Nhân Vật (Character Ingredient Chip)
Trong Google Flow, các nhân vật đã lưu trong project của bạn được gắn qua thẻ thành phần (`<flow-character-ingredient-chip>`). Khi gắn thẻ nhân vật, mô hình Google Omni 1.1 Flash **tự động thừa hưởng 100% nhận diện thị giác cố định** từ asset đã lưu:
- Khuôn mặt, đường nét ngũ quan, màu da.
- Kiểu tóc, độ dài và **màu tóc nguyên bản** của nhân vật.
- Trang phục, giáp trụ, phù hiệu và vũ khí biểu tượng.

### 8.2. Những Điều CẤM KỴ Trong Prompt Chữ
Khi shot đã có thẻ nhân vật, **TUYỆT ĐỐI KHÔNG ĐƯỢC MIÊU TẢ CHI TIẾT NGOẠI HÌNH** trong phần text prompt:
- **CẤM tả màu tóc và kiểu tóc:** Không viết `flowing lavender hair`, `crimson hair`, `silver spiky hair`. Viết màu tóc vào prompt sẽ **gây xung đột với asset gốc**, làm AI sinh ra nhân vật sai màu tóc hoặc biến dạng khuôn mặt.
- **CẤM tả chi tiết giáp trụ và quần áo:** Không viết `ornate silver-plated duelist armor with violet amethyst gems`. Hãy để character chip tự render phục trang chuẩn.
- **CẤM tả đặc điểm khuôn mặt cố định:** Không viết `sharp jawline, porcelain pale skin, golden eyes`.

### 8.3. Tránh Bộ Lọc Tên Riêng (Celebrity Filter)
Google Flow có thể chặn các tên nhân vật trùng với tên người nổi tiếng trong văn bản prompt. Giải pháp:
- Gắn thẻ nhân vật `@YourCharacterName` để khóa ngoại hình.
- Trong text prompt, thay thế tên nhân vật bằng danh xưng vai trò: **`the warrior`**, **`the duelist`**, **`the protagonist`**, **`she`**, **`he`**, **`the hero`**.

### 8.4. Prompt Chữ Phải Tập Trung 100% Vào 5 Yếu Tố Điện Ảnh
1. **Hành động & Động học (Action & Kinetics):** Lướt kiếm, rút kiếm, thủ thế phòng thủ, ngã quỵ, xoay người góc 3/4.
2. **Biểu cảm & Diễn xuất (Facial Expression):** Nụ cười khinh bỉ, ánh mắt sắc lạnh kiên nghị, mím môi, thở dốc.
3. **Chuyển động Camera (Cinematography):** `Low-angle tracking push-in`, `smooth orbital pan`, `tight close-up`, `shallow depth of field`.
4. **Ánh sáng & Môi trường (Lighting & FX):** `swirling cosmic dust`, `cyan/purple lighting reflection`, `volumetric atmospheric fog`.
5. **Âm thanh & Khẩu hình (Audio & Lip-Sync):** Câu thoại có mấp máy môi hoặc `AUDIO: SFX ONLY... NO MUSIC.`

### 8.5. Ví Dụ Đối Chiếu Chuẩn - Sai

❌ **SAI (Xung đột màu tóc & thừa thãi phục trang):**
> `Medium shot of the warrior standing on an ancient marble altar, flowing lavender hair and ornate silver-plated armor with violet amethyst gems. Smooth tracking push-in as she turns...`

✅ **ĐÚNG (Tinh gọn, giao nhận diện cho Character Chip, chỉ đạo thuần điện ảnh):**
> `[00:00 - 00:03] Ethereal memory flashback with violet vignette. Medium shot of the warrior standing on an ancient marble altar against dark swirling cosmos. [00:03 - 00:07] Smooth tracking push-in as she turns in three-quarter profile, holding her luminous crystal rapier with effortless poise, a cold smirk on her lips. [00:07 - 00:10] Tight close-up on her face, eyes narrowing with ruthless arrogance, cosmic lightning reflecting in her gaze, cinematic shallow depth of field, photorealistic 3D CGI, UE5 render. AUDIO: SFX ONLY — ethereal memory chime, low ominous wind hum, distant lightning crackle. NO MUSIC.`

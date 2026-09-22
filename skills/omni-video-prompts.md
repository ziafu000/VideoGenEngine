---
name: omni-video-prompts
description: |
  Hệ thống viết prompt video tối ưu hóa cho Google Omni 1.1 Flash qua Google Flow (gflow). Hỗ trợ kỹ thuật Timeline Prompting đa phân cảnh (multi-cut timeline prompts) tạo chuyển cảnh dồn dập 1.5s–2s chuẩn YouTube Shorts và cú máy điện ảnh đơn lẻ cho video dài. Tập trung vào hành động thực tế, góc máy vật lý, ánh sáng tự nhiên và âm thanh hiện trường SFX, loại bỏ hoàn toàn từ ngữ sáo rỗng (AI slop).
---

# Google Omni 1.1 Video Prompt Engineer

Bạn tạo ra **MỘT prompt duy nhất, hoàn chỉnh và sẵn sàng để gửi trực tiếp cho Google Omni 1.1 qua Google Flow** cho mỗi lần sinh video (10s).

Mục tiêu cốt lõi: Tận dụng khả năng thấu hiểu thời gian (temporal understanding) và tính nhất quán vật thể của Omni 1.1 Flash, áp dụng **kỹ thuật Timeline Prompting** để tạo nhịp chuyển cảnh dồn dập (1.5s–2s mỗi cảnh) cho YouTube Shorts, triệt tiêu hoàn toàn góc máy tĩnh buồn ngủ và hình ảnh giả tạo (AI slop).

---

## 1. Nguyên tắc cốt lõi: Mô tả những gì nhìn thấy (Show, Don't Tell)

Chỉ mô tả những gì ống kính camera thực sự ghi lại: hành động vật lý, chất liệu bề mặt, tương tác không gian và nguồn sáng cụ thể.

- **Nói KHÔNG với tính từ cảm xúc sáo rỗng:** Cấm tiệt các từ như "cinematic", "epic", "stunning", "hyperrealistic", "masterpiece". Độ sắc nét và chất lượng điện ảnh phải đến từ nguồn sáng cụ thể, bề mặt vật liệu và bố cục khung hình.
- **Mô tả hành động có động lực:** Vật thể chuyển động vì có lực tác động, camera di chuyển vì bám theo chủ thể.
- **Nguyên tắc khẳng định (Positive-only):** Không dùng câu phủ định ("không có bóng người", "không có xe"). Luôn mô tả trực tiếp những gì ĐANG XUẤT HIỆN trong khung hình.

---

## 2. Kỹ Thuật Timeline Prompting (Dành riêng cho YouTube Shorts & Video Nhịp Nhanh)

Trong YouTube Shorts, giữ 1 góc máy quá 2 giây là quá dài và khiến người xem lướt đi. Omni 1.1 Flash có khả năng hiểu các mốc thời gian trong prompt và thực hiện chuyển cảnh trực tiếp trong clip 10 giây.

### 2.1. Cấu trúc một Timeline Prompt (10 Giây = 4 đến 5 Cú Cắt Cảnh)
Mỗi clip 10 giây được chia thành các nhịp nhỏ từ **1.5s đến 2.5s**:

```
[Khung hình & Phong cách tổng quan]
[00:00 - 00:02] Cảnh 1: [Góc máy 1] + [Hành động dồn dập 1]
[00:02 - 00:05] Cảnh 2: [Từ khóa chuyển cảnh] + [Góc máy 2] + [Chi tiết tương phản 2]
[00:05 - 00:07] Cảnh 3: [Từ khóa chuyển cảnh] + [Góc máy 3] + [Hành động then chốt 3]
[00:07 - 00:10] Cảnh 4: [Từ khóa chuyển cảnh] + [Góc máy 4] + [Điểm chốt thị giác 4]
AUDIO: SFX ONLY — [Mô tả âm thanh hiện trường đồng bộ với các hành động trên]. NO MUSIC.
```

### 2.2. Từ vựng chuyển cảnh kỹ thuật điện ảnh (Cinematic Cut Keywords)
Sử dụng các từ khóa điều hướng camera rõ ràng để mô hình thực hiện cắt cảnh:
- **`Rapid cut to:`** / **`Hard cut to:`** Cắt cảnh đột ngột sang một góc nhìn mới hoặc chủ thể cận cảnh.
- **`Whip pan to:`** Lia máy cực nhanh sang một hướng khác tạo vệt mờ chuyển động.
- **`Snap zoom in on:`** / **`Fast push-in to:`** Phóng nhanh vào một chi tiết gây tò mò (nhãn mác, ổ khóa, giọt nước).
- **`Match cut to:`** Cắt cảnh nối tiếp hình dạng hoặc hướng chuyển động tương đồng giữa 2 vật thể.
- **`Smash cut to:`** Chuyển cảnh đối lập mạnh mẽ giữa tĩnh sang động, hoặc tối sang sáng.

---

## 3. Quy Chuẩn Âm Thanh Hiện Trường & Thoại Nhân Vật (Audio & Dialogue)

### 3.1. Âm Thanh Hiện Trường Thuần Túy (SFX Only — Cảnh hành động / Bối cảnh)
Omni 1.1 Flash tự động tạo âm thanh đồng bộ với video. Đặt dòng này ở cuối prompt cho các cảnh không thoại:
`AUDIO: SFX ONLY — [Mô tả chi tiết 3–4 âm thanh tương ứng với từng giai đoạn chuyển cảnh]. NO MUSIC.`
Tuyệt đối cấm nhạc nền (NO MUSIC) để không lấn át giọng thuyết minh (voiceover) và cho phép hậu kỳ hòa âm chuẩn xác.

### 3.2. Thoại Nhân Vật Trực Tiếp & Khẩu Hình Môi (Native Dialogue & Lip-Sync — Đã xác minh thực nghiệm)
Omni 1.1 Flash có khả năng **tự sinh giọng nói nhân vật và nhép môi (lip-sync)** trực tiếp theo câu thoại trong prompt.
- **Cách viết trong mô tả hình ảnh:**
  `[00:03 - 00:07] Close-up push-in to Ashel's face as he speaks aloud with natural mouth and lip movement: "裏切りの代償を払え" ("Pay the price of betrayal"), his electric cyan terminal eyes glowing...`
- **Cách viết trong chỉ thị AUDIO:**
  `AUDIO: Clear Japanese character voiceover speaking: "裏切りの代償を払え", deep male seiyuu tone, synced lip motion, subtle cosmic wind ambient in background.`
- **Đặc tính kỹ thuật:**
  - Mô hình tự động tạo chuyển động mấp máy môi, hở răng và phát âm khớp ngữ âm tiếng Nhật.
  - Luồng âm thanh xuất ra là AAC stereo 48kHz.
  - Sử dụng cho các cảnh cận mặt nhân vật phát ngôn, tuyên chiến hoặc đối thoại trực tiếp. Đối với độc thoại nội tâm hoặc dẫn chuyện kéo dài, tiếp tục sử dụng ElevenLabs để giữ chất lượng kể chuyện đồng nhất.

---

## 4. Quy chuẩn thông số kỹ thuật (Google Flow)

- **Mô hình:** Luôn dùng **`Omni 1.1 Flash`** (ưu tiên số 1 về tốc độ render và tính nhất quán).
- **Thời lượng:** Chuẩn **10 giây (10s)** cho mỗi lần generate.
- **Tỷ lệ khung hình:**
  - **Dọc `9:16` (`crop_9_16`):** Chuẩn bắt buộc cho YouTube Shorts, TikTok, Instagram Reels.
  - **Ngang `16:9` (`crop_16_9`):** Dành cho video dài chuẩn YouTube.

---

## 5. Ví Dụ Mẫu Timeline Prompt (Video 30s = 3 Scene x 10s Timeline)

```json
{
  "aspect_ratio": "9:16",
  "model": "Omni 1.1 Flash",
  "scenes": [
    {
      "scene_id": "scene_01",
      "duration_seconds": 10,
      "timecode": "00:00 - 00:10",
      "voiceover": "For 138 years, people thought Coca-Cola's secret formula was locked in an Atlanta vault. The truth is far stranger. Only one company in America has a federal license to import raw coca leaves:",
      "prompt": "Vertical 9:16 fast-paced sequence with rapid cuts: [00:00 - 00:02] Low-angle extreme close-up of heavy steel bank vault door locking bolts spinning shut. [00:02 - 00:05] Rapid hard cut to high-angle medium shot: an unmarked white truck speeds through open barbed-wire security gates with official US federal warning signs under harsh sun. [00:05 - 00:08] Whip pan to concrete loading dock: gloved workers haul rough burlap sacks stamped 'COCA LEAVES' from truck. [00:08 - 00:10] Snap zoom in on burlap texture and stencil text as a sack drops with dust puff. AUDIO: SFX ONLY — heavy vault clank, accelerating diesel truck engine, rattling chain link fence, heavy burlap thud on concrete. NO MUSIC."
    }
  ]
}
```

---

## 6. Quy Chuẩn Timeline Prompting cho Series Anime 3D CGI (16:9)

Dành riêng cho series dài tập (như *"Ashel: Mã Nguồn Tái Sinh"*), clip luôn generate ở mốc **10 giây** (tiết kiệm credit nhất: 15 credits/10s), nhưng bên trong prompt chia thành **2 đến 3 nhịp điện ảnh (2s–4s/nhịp)** để góc máy và động tác liên tục biến chuyển, không bị đơ hoặc kéo dài lê thê:

### Cấu trúc Timeline Anime 10s Chuẩn:
- **`[00:00 - 00:03]` (3s):** Góc máy toàn cảnh/trung cảnh thiết lập tư thế và bối cảnh không gian (`Wide/Medium shot`).
- **`[00:03 - 00:07]` (4s):** Cú máy động (`Camera push-in / Pan / Tilt`) kết hợp hành động then chốt hoặc tương tác năng lượng/chiêu thức.
- **`[00:07 - 00:10]` (3s):** Góc cận cảnh (`Close-up`) bắt trọn biểu cảm mắt/khuôn mặt, hiệu ứng hạt và điểm chốt cao trào của cảnh.

---

## 7. Bảng Từ Vựng Né Vi Phạm Chính Sách Google Flow (Safety Filter Hygiene)

Google Flow kiểm duyệt cực kỳ gắt gao các từ ngữ mô tả máu me, thương tích và bạo lực trực diện. Vi phạm sẽ bị báo lỗi `Không thành công / vi phạm chính sách`. Luôn dùng bộ từ vựng điện ảnh / CGI thay thế sau:

| Từ Bị Cấm / Rủi Ro Cao | Từ Thay Thế Chuẩn Điện Ảnh / CGI |
| :--- | :--- |
| `blood`, `bleed`, `dripping blood` | `purple/crimson cosmic particles`, `energy residue`, `shattered crystal sparks` |
| `severely injured`, `wounded`, `dying` | `exhausted battle stance`, `kneeling in fatigue`, `battle-worn posture` |
| `dagger`, `knife stabbing`, `slash throat` | `shattered crystalline blade`, `blade hilt`, `energy saber`, `defensive stance` |
| `piercing chest`, `impaling` | `thrusting glowing rapier close to chest`, `impact shockwave`, `energy burst` |
| `kill`, `murder`, `corpse` | `vanquish`, `fallen warrior`, `motionless silhouette in dark void` |
| `screaming in agony` | `gasp of shock`, `sharp intake of breath`, `fierce determined glare` |

---

## 8. Quy Chuẩn Vàng: Tuyệt Đối Cấm Miêu Tả Ngoại Hình Nhân Vật Khi Đã Gắn Thẻ (`@Character`)

### 8.1. Nguyên Lý Cốt Lõi Về Thẻ Nhân Vật (Character Ingredient Chip)
Trong Google Flow, các nhân vật chính (`Ashel`, `Valerie`, `Kiran`, `Selena`, `Master Eldrin`) đã được huấn luyện và lưu trữ sẵn dưới dạng thẻ thành phần (`<flow-character-ingredient-chip>`). Khi gắn thẻ nhân vật (bằng cách gõ `@` hoặc bấm thêm nhân vật), mô hình Google Omni 1.1 Flash **tự động thừa hưởng 100% nhận diện thị giác cố định**:
- Khuôn mặt, đường nét ngũ quan, màu da.
- Kiểu tóc, độ dài và **màu tóc nguyên bản** (ví dụ: tóc đỏ thẫm của Selena, tóc bạch kim của Ashel).
- Trang phục, giáp trụ, phù hiệu và vũ khí biểu tượng.

### 8.2. Những Điều CẤM KỴ Trong Prompt Chữ
Khi shot đã có thẻ nhân vật (`characters: ["Selena"]` hoặc `["Ashel"]`), **TUYỆT ĐỐI KHÔNG ĐƯỢC MIÊU TẢ CHI TIẾT NGOẠI HÌNH** trong phần text prompt:
- **CẤM tả màu tóc và kiểu tóc:** KHÔNG viết `flowing lavender hair`, `crimson hair`, `silver spiky hair`. Viết màu tóc vào prompt sẽ trực tiếp **gây xung đột với asset gốc**, khiến AI sinh ra nhân vật sai màu tóc, biến dạng khuôn mặt hoặc tạo ra người hoàn toàn khác.
- **CẤM tả chi tiết giáp trụ và quần áo:** KHÔNG viết `ornate silver-plated duelist armor with violet amethyst gems`, `leather straps and high-collar trench coat`. Hãy để character chip tự render phục trang chuẩn của nhân vật.
- **CẤM tả đặc điểm khuôn mặt cố định:** KHÔNG viết `sharp jawline, porcelain pale skin, golden eyes`.

### 8.3. Danh Xưng Thay Thế An Toàn Cho Nhân Vật Nữ Nhạy Cảm (Selena / Phụ Nữ)
Bộ lọc chính sách của Google Flow chặn từ khóa đơn lẻ `Selena` vì quét nhầm ca sĩ nổi tiếng. Do đó:
- Dùng thẻ nhân vật `@Selena` để khóa hình ảnh.
- Trong prompt chữ, gọi nhân vật bằng vai trò/danh xưng: **`the duelist`**, **`she`**, **`her`**, **`the female duelist`**. Tuyệt đối không viết chữ `Selena` trần trụi trong text prompt.

### 8.4. Prompt Chữ Phải Tập Trung 100% Vào 5 Yếu Tố Điện Ảnh
Prompt chỉ phục vụ chỉ đạo diễn xuất và điện ảnh:
1. **Hành động & Động học (Action & Kinetics):** Lướt kiếm, rút kiếm, chém ngang (*iaijutsu flash-step*), thủ thế phòng thủ, ngã quỵ, xoay người góc 3/4.
2. **Biểu cảm & Diễn xuất (Facial Expression):** Nụ cười khinh bỉ thoáng qua, ánh mắt sắc lạnh kiên nghị, mím môi, thở dốc, mắt mở to vì kinh ngạc.
3. **Chuyển động Camera (Cinematography):** `Low-angle tracking push-in`, `smooth orbital pan`, `tight close-up`, `shallow depth of field`.
4. **Ánh sáng & Môi trường (Lighting & FX):** `swirling cosmic dust`, `cyan/purple lighting reflection`, `volumetric atmospheric fog`, `marble altar ruins`.
5. **Âm thanh & Khẩu hình (Audio & Lip-Sync):** Câu thoại tiếng Nhật có mấp máy môi hoặc chỉ định `AUDIO: SFX ONLY... NO MUSIC.`

### 8.5. Ví Dụ Đối Chiếu Chuẩn - Sai

❌ **SAI (Cũ - Xung đột màu tóc & thừa thãi phục trang):**
> `Medium shot of the duelist Selena standing on an ancient marble altar, flowing lavender hair and ornate silver-plated duelist armor with violet amethyst gems. Smooth tracking push-in as she turns in three-quarter profile...`

✅ **ĐÚNG (Mới - Tinh gọn, giao nhận diện cho Character Chip, chỉ đạo thuần điện ảnh):**
> `[00:00 - 00:03] Ethereal memory flashback with violet vignette. Medium shot of the duelist standing on an ancient marble altar against dark swirling cosmos. [00:03 - 00:07] Smooth tracking push-in as she turns in three-quarter profile, holding her luminous crystal rapier with effortless poise, a haughty cold smirk on her lips. [00:07 - 00:10] Tight close-up on her face, eyes narrowing with ruthless arrogance, cosmic lightning reflecting in her gaze, cinematic shallow depth of field, photorealistic 3D CGI anime, UE5 render. AUDIO: SFX ONLY — ethereal memory chime, low ominous wind hum, distant purple lightning crackle. NO MUSIC.`



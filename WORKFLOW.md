# VideoGen: Automated Faceless YouTube Video Production Workflow

Production-grade automated system for creating cinema-quality faceless YouTube Shorts and explainer videos in English using **Google Flow** (Google Omni 1.1 / Veo 3.1) and **ElevenLabs** via browser automation (0 API token cost).

---

## 1. System Components & Architecture

### 1.1. Visual & Sound Effects Engine (Google Flow)
- Operated via Chrome DevTools Protocol (CDP) through Windows Chrome profile `AutomationProfile`.
- Uses **Omni 1.1 Flash** (10-second clips, 720p native download).
- Generates natural ambient SFX embedded in the video stream (truck rumble, glass pouring, fizzing carbonation).

### 1.2. Voiceover Engine (ElevenLabs)
- Operated via CDP directly on the active ElevenLabs Text-to-Speech tab.
- Generates natural native English voiceover using the user's active default voice (e.g. **Alistair** - Clear, Neutral, Informative).
- Auto-downloads MP3 files to `audio/`.

### 1.3. Post-Production & Mixing Engine (FFmpeg)
- Stitches all scenes sequentially into a master video (`engine/compositor.js`).
- Dynamically scales voiceover speed (`atempo`) to align with exact video duration (`engine/compositor.js`).
- Balances audio levels: Voiceover at 100% volume, background ambient SFX at 25%–30% volume.

### 1.4. System One AI Decider (TypeSafe Jev)
- Powered by `browser-jev` CLI / python module `browser_jev` connecting directly to TypeSafe API (`jev-latest`).
- **Pre-flight Prompt Screening:** Uses `noul` primitive to evaluate policy risk before prompt submission, guarding against account flags.
- **Fast-Fail Early Detection:** Uses `choice` primitive in the render polling loop to detect Google Flow policy refusal (`policy_refusal`), terminating within 5–10 seconds instead of blocking for 180–240 seconds.
- **TTS Verification:** Uses `noul` primitive to confirm ElevenLabs speech synthesis completion prior to triggering MP3 download.

---

## 2. Environment Setup & Browser Bridge

To bypass Cloudflare / Google bot protections, the system attaches to the user's authentic Windows Chrome browser via remote debugging.

### 2.1. Port Architecture
- **Windows Chrome:** Launched with `--remote-debugging-port=9222` and profile at `C:\Users\ASUS\AppData\Local\Google\Chrome\AutomationProfile`.
- **CDP Proxy (`engine/cdp_proxy.js`):** Node.js TCP bridge on Windows forwarding `0.0.0.0:9223` -> `127.0.0.1:9222`.
- **WSL Client:** Accesses CDP at `http://$WIN_HOST:9223` using `chrome-devtools-axi` or `engine/cdp.js`.

### 2.2. Starting the Bridge
```bash
~/ai/project/VideoGen/videogen bridge
```
Runs automatically at session start or whenever a browser disconnect is detected.

---

## 3. Storyboard Specification (`storyboards/scenes.json`)

The storyboard serves as the contract between the scriptwriter (Director) and the video/audio automators (Workers):

```json
{
  "title": "Why Nobody Can Copy Coca-Cola's 138-Year Formula",
  "niche": "explainer",
  "language": "en",
  "aspect_ratio": "9:16",
  "model": "Omni 1.1 Flash",
  "voice": "Alistair",
  "target_duration_seconds": 30,
  "title_options": [
    "Why Nobody Can Copy Coca-Cola's 138-Year Formula",
    "The DEA Secret Inside Every Bottle of Coke"
  ],
  "thumbnail_line": "THE 138-YEAR LIE",
  "script_full": "Full voiceover script in English...",
  "scenes": [
    {
      "scene_id": "scene_01",
      "characters": ["Ashel"],
      "duration_seconds": 10,
      "timecode": "00:00 - 00:10",
      "voiceover": "First scene narration...",
      "prompt": "Vertical 9:16 eye-level medium shot... [Action]... [Lighting]... AUDIO: SFX ONLY — [sound details]. NO MUSIC."
    }
  ]
}
```

---

## 4. VideoGen Unified Engine v2.0 & CLI Reference (`./videogen`)

To eliminate fragmented scripts and prevent codebase bloat, VideoGen consolidates all production phases into a modular engine (`engine/`) operated via a single central CLI `./videogen`:

| Command | Function | Description / Example |
| :--- | :--- | :--- |
| `./videogen bridge [status]` | Kiểm tra/Bật kết nối CDP | Tự động khởi động Chrome Windows & CDP proxy, kiểm tra các tab Flow, ElevenLabs. |
| `./videogen render <sb> [shots...]` | Render Google Flow | Tự động cấu hình, gắn chip `@Character`, kiểm duyệt Jev, render và tải clip 720p. |
| `./videogen voice <sb> [shots...]` | Voiceover ElevenLabs | Đọc `voice_profiles` từ storyboard, tự chỉnh slider Radix UI và tải MP3 đa nhân vật. |
| `./videogen subs <sb>` | Sinh phụ đề ASS | Tạo phụ đề điện ảnh (Dual-Zone ASS cho Anime hoặc Bouncy Yellow cho Shorts). |
| `./videogen assemble <sb>` | Hậu kỳ tổng hợp | Ghép video, time-padding khớp thoại, hòa âm đa tầng (Voice + Ambient), burn sub ASS. |
| `./videogen verify <video> [ts...]` | Kiểm định visual | Trích xuất các keyframe tại các mốc thời gian để nghiệm thu hình ảnh và phụ đề. |
| `./videogen archive <sb>` | Sao lưu & dọn dẹp | Đẩy nguyên liệu + video master sang Windows D: drive và dọn sạch repo VideoGen. |
| `./videogen upload <sb>` | Đăng YouTube Studio | Tự động tải video thành phẩm lên YouTube Studio ở chế độ Không công khai (Unlisted). |
| **`./videogen run <sb>`** | **Quy trình A -> Z** | **Tự động hóa toàn bộ: Bridge -> Render -> Voice -> Assemble -> Verify -> Archive -> Upload!** |

### Engine v2.0 Architecture
Toàn bộ logic cốt lõi đã được nâng cấp và tối ưu hóa tập trung trong `engine/` (`bridge.js`, `flow.js`, `tts.js`, `subtitles.js`, `compositor.js`, `archive.js`, `youtube.js`, `cdp_proxy.js`, `youtube_uploader.js`). Folder `scripts/` cũ đã được loại bỏ hoàn toàn để tránh phân mảnh.

---

## 5. End-to-End Production Checklist (v2.0)

1. **Chuẩn bị Kịch bản (Director):** Soạn thảo kịch bản JSON vào `storyboards/<tên_tập>.json` với schema chuẩn SSOT (định nghĩa thông số dự án, `voice_profiles` các nhân vật và mảng `shots`).
2. **Thực thi Sản xuất Tự động (Worker):**
   - Chạy 1 lệnh duy nhất để hoàn tất toàn bộ quy trình:
     ```bash
     ./videogen run storyboards/<tên_tập>.json
     ```
   - Hoặc chạy từng công đoạn độc lập nếu cần tinh chỉnh chi tiết:
     ```bash
     ./videogen bridge                     # Bước 1: Khởi động kết nối
     ./videogen render storyboards/ep.json  # Bước 2: Render video Google Flow
     ./videogen voice storyboards/ep.json   # Bước 3: Tạo giọng đọc ElevenLabs
     ./videogen assemble storyboards/ep.json# Bước 4: Hậu kỳ hòa âm & burn phụ đề
     ./videogen verify <master_video.mp4>  # Bước 5: Kiểm định khung hình
     ./videogen archive storyboards/ep.json # Bước 6: Lưu trữ D: drive & dọn dẹp repo
     ```

---

## 6. Auto-Edit Mode 1: Technical Specifications

### 6.1. Dynamic Subtitle Specifications
- **Format:** Advanced SubStation Alpha (`.ass`) rendered via `libass`.
- **Timing & Alignment:** Transcribed with local Whisper model (`ggml-tiny.en.bin`), aligned against the ground-truth text in `storyboards/scenes.json` to guarantee 100% spelling and grammar accuracy.
- **Pacing:** Micro-chunks of 2 to 3 words each (~0.8s to 1.5s display time) matching high-retention YouTube Shorts pacing.
- **Visual Styling:**
  - **Font:** `Arial Black` / `Impact`, all-caps.
  - **Font Size:** `50` (proportional to 720x1280 resolution).
  - **Base Text Color:** Pure White (`&H00FFFFFF&`).
  - **Highlight Color:** Vibrant Neon Yellow (`&H0000FFFF&`).
  - **Border & Shadow:** 4.5px solid black outline (`&H00000000&`) + 2.0px drop shadow for 100% contrast on dark and light backgrounds.
  - **Screen Position:** Lower-third center (`MarginV=280`), safe from YouTube Shorts bottom channel title and right-side interactive buttons.

### 6.2. Sound Effects (SFX) Layering
- **Opening Hook Impact (00:00 – 00:01):** Deep cinematic sub-bass drop (`impact.mp3`, 50% volume) at second 0.0 to immediately grab viewer attention.
- **Scene Transition Swishes (~10.0s, ~20.0s):** Crisp swoosh sound (`whoosh.mp3`, 40% volume) placed at the exact boundary of scene changes.
- **Emphasis Pop (~05.5s):** Subtle UI accent pop (`pop.mp3`, 35% volume) emphasizing key story pivots.
- **Voiceover & Ambient Balance:** Voiceover at 100% volume with tempo alignment; video background SFX at 20% volume.

---

## 7. Post-Production Archival & Storage Policy (D: Drive)

To prevent Git repository bloat and ensure all high-resolution video assets are organized permanently for video editors:

1. **Raw Assets & Materials Directory (`File video original`):**
   - **Path:** `D:\Billy\Work\Editing\File video original` (WSL: `/mnt/d/Billy/Work/Editing/File video original`)
   - **Structure:** Each video production gets a dedicated subfolder:
     `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\`
   - **Contents:**
     - `scene_01.mp4`, `scene_02.mp4`, ... (uncompressed 720p clips from Google Flow).
     - `voiceover_en.mp3` (native ElevenLabs voice recording).
     - `storyboard_backup.json` (exact prompts, timeline cuts, and full narration script).
     - Intermediate draft concatenations and mixing iterations.

2. **Master Video Delivery Directory (`File video after edit`):**
   - **Path:** `D:\Billy\Work\Editing\File video after edit` (WSL: `/mnt/d/Billy/Work/Editing/File video after edit`)
   - **Contents:** Final master MP4 videos with tempo-synced voiceover and ambient SFX, named cleanly after the video topic (e.g. `Why_Nobody_Can_Copy_Coca-Colas_138-Year_Formula.mp4`).

3. **Repository Cleanliness Standard:**
   - The `VideoGen` repository must **never** retain heavy media assets in working tree.
   - `renders/`, `audio/`, and `output/` must only hold `.gitkeep`.
   - `archive_and_cleanup.sh` is executed after every production run so `git status` always stays clean.

---

## 8. Mode 2: Original AI Anime Series Production Pipeline ("Ashel: Mã Nguồn Tái Sinh")

Production pipeline for the 16-episode story-driven 3D CGI anime series adapting `ASHEL_SERIES_BIBLE.md`.

### 8.1. Episode Architecture & Budgeting
- **Episode Duration:** 5 minutes (300 seconds) per episode.
- **Shot Formula:** Exactly **30 shots x 10 seconds** per episode.
- **Credit Economics:** Google Flow costs **15 credits per 10s video clip** (Omni 1.1 Flash 720p).
  - 1 episode (30 shots) = **450 credits total**.
- **Default Generation Duration:** Always set Flow duration setting to **10s** (`10 giây`). Never drop the generation duration to 4s or 6s in settings because 10s maximizes duration per 15 credits (most economical). Pacing is controlled internally via **Timeline Prompting**.
- **Aspect Ratio:** **16:9** widescreen for main episodes (`configure 16:9 10s`). Climax scenes can be reformatted to **9:16** for auxiliary YouTube Shorts / TikTok teasers (30s–60s).

### 8.2. Character Asset Binding System (Google Flow)
Google Flow maintains character visual consistency via **Ingredient Chips** (`<flow-character-ingredient-chip>`):
- **Pre-saved Characters in Project `Main series`:**
  - `Ashel` (Male protagonist, dark hair, blue terminal eyes)
  - `Valerie` (Female technomancer, teal glow accents)
  - `Kiran` (Agile blade-wielder, crimson energy)
  - `Selena` (High-tier duelist, dark rapier, cold demeanor)
  - `Master Eldrin` (Elder guild master)
- **Character Attachment Mechanics:**
  - **Programmatic (CLI):**
    ```bash
    ./scripts/flow_operator.sh add-character "Ashel"
    # Multi-character scene (e.g. betrayal scene):
    ./scripts/flow_operator.sh add-character "Ashel" "Selena"
    ```
  - **Manual / Hotkey in Flow UI:**
    - Type `@` in the prompt input field to summon the "Thêm thành phần" menu.
    - Switch to tab **Nhân vật** and click the character name.
    - Flow automatically attaches the visual reference chip above the prompt and inserts the character name at the cursor.
  - **Prompting Rule:** Never re-describe baseline physical features (hair, eyes, face structure) if the character chip is attached. Prompts must focus strictly on **Action, Expression, Lighting, Camera Framing, and Environment**.
  - **Multi-Character Scenes:** Flow supports attaching 2 or more character chips simultaneously. The Omni 1.1 Flash model references all attached visual anchors and binds them to the respective character names mentioned in the prompt text.

### 8.3. Dual-Tier Audio Architecture: Flow Native Dialogue & Narrative Monologue
The anime series utilizes an integrated two-tier audio production model:

1. **Tier 1 — Flow Native Character Dialogue & Lip-Sync (Thoại trực tiếp nhân vật):**
   - **Mechanism:** Google Flow's **Omni 1.1 Flash** model natively synthesizes spoken character voice and synchronized facial lip movement directly from the prompt.
   - **When to Use:** Close-up and medium shots where a character delivers on-screen spoken dialogue (battle shouts, confrontations, direct conversations).
   - **Prompting Pattern:**
     ```text
     [00:03 - 00:07] Close-up push-in to Ashel's face as he speaks aloud with natural mouth and lip movement: "裏切りの代償を払え" ("Pay the price of betrayal"), his electric cyan terminal eyes glowing...
     AUDIO: Clear Japanese character voiceover speaking: "裏切りの代償を払え", deep male seiyuu tone, synced lip motion, subtle cosmic wind ambient in background.
     ```
   - **Output:** Native AAC 48,000Hz stereo audio stream embedded in the video clip, with realistic mouth articulation (opening/closing mouth, teeth, syllable matching) requiring zero external lip-sync post-processing.

2. **Tier 2 — ElevenLabs Voice Profiles & Automated Slider Presets:**
   - **Mechanism:** Synthesized via ElevenLabs CDP operator with automated Radix UI slider configuration for each character.
   - **Voice Roster & Calibration Presets (Approved 2026-09-22):**
     * **Ashel (Protagonist / Reborn Swordsman):**
       - Model: `Daisuke` (*Serious, Balanced and Guttural*).
       - Sliders: Speed `1.0x`, Stability `40%`, Similarity `80%`, Style Exaggeration `15%`.
       - Persona: Deep, resilient, guttural male tone with dramatic emotional inflection for battle cries and inner anguish.
     * **Selena (Female Duelist / Betrayer):**
       - Model: `Lime` (*Japanese Kyushu*).
       - Sliders: Speed `1.0x`, Stability `35%`, Similarity `80%`, Style Exaggeration `25%`.
       - Persona: Sharp, haughty, aristocratic, sarcastic and ruthlessly cold.
     * **Protocol: Root (Ancient System AI / Giao Thức Cội Nguồn):**
       - Model: `Koichi` (*Japanese Deep Calm Narrator*).
       - Sliders: Speed `0.95x`, Stability `85%`, Similarity `85%`, Style Exaggeration `0%`.
       - Persona: Deep, calm, perfectly unfeeling machine cadence, pronouncing system statuses with monolithic solemnity.

3. **Dual-Zone Subtitle Architecture & Visual Typography (Chuẩn Phụ Đề 2 Tầng Điện Ảnh):**
   - **Format:** Advanced SubStation Alpha (`.ass`) rendered via `libass` with two distinct typographic layers:
   - **Tier A — Thoại & Độc thoại nội tâm nhân vật (Character Dialogue & Inner Monologue):**
     * **Vị trí:** Cạnh dưới màn hình (Bottom Center: `Alignment 2`, `MarginV 35`).
     * **Màu sắc & Viền:** Trắng tinh khôi (`PrimaryColour: &H00FFFFFF`), viền đen mảnh chống lóa (`OutlineColour: &H00000000`, `Outline: 2.0`), đổ bóng nhẹ (`Shadow: 1.0`).
     * **Phông chữ:** `Arial` (size 28), chữ thường thanh thoát, dễ đọc chuẩn Vietsub anime rạp chiếu.
   - **Tier B — Giao Thức Cội Nguồn (Protocol: Root System AI):**
     * **Vị trí:** Cạnh trên màn hình (Top Center: `Alignment 8`, `MarginV 30`).
     * **Màu sắc & Viền:** Xanh Cyan Neon (`PrimaryColour: &H00FFFF00`), viền đen kỹ thuật (`OutlineColour: &H00112222`, `Outline: 1.8`).
     * **Phông chữ:** **`Consolas`** (size 24), In hoa, Bold (`\b1`), Spacing 1.0. Mang phong cách Sci-fi / Terminal HUD / Hacker Code sắc sảo, dứt khoát chuẩn công nghệ thái cổ (Visual reference: `renders/subtitle_preview/preview_sub_rendered.jpg`).
     * **Cấu trúc nhãn hiển thị:**  
       `{\b1}[ GIAO THỨC CỘI NGUỒN ]{\b0}\N< KÍCH HOẠT: TÁI CẤU TRÚC HỒN HẠCH THỂ NGHIỆM ASHEL >`
   - **Cinematic Audio Balance:** Dialogue / voiceover at 100%, background OST at 25–35%, diegetic SFX at 40%.
   - **NO** rapid Shorts transition sound effects (whooshes, pops, braams, camera shutters). Only clean cinematic cuts aligned with seiyuu breath pauses, orchestral swells, or combat impacts.

### 8.4. Timeline Prompting Formula (Pacing Inside 10s Clips)
To prevent shots from lingering, dragging, or freezing for 8–10 seconds, every 10-second clip prompt must be subdivided into **2 to 3 dynamic micro-scenes (2–4 seconds each)** using explicit bracketed timecodes:

```text
[00:00 - 00:03] <Micro-Scene 1: Establishing framing & initial character stance (3s)>
[00:03 - 00:07] <Micro-Scene 2: Dynamic camera motion (push-in/pan/tilt) & motivated action beat (4s)>
[00:07 - 00:10] <Micro-Scene 3: Dramatic close-up / reaction / climax expression (3s)>.
<Lighting, Rendering Aesthetics, Engine>.
AUDIO: SFX ONLY — <diegetic sounds>. NO MUSIC.
```

**Benefits:**
- Forces the Omni 1.1 Flash diffusion model to execute sequential camera moves and action beats within one generation pass.
- Yields 60 to 90 cinematic angles across a 30-shot (5-minute) episode without spending extra credits.

### 8.5. Policy & Safety Filter Hygiene (Zero-Flag Guarantee)
Google Flow strictly filters violent and harmful terms, rejecting prompts and aborting generations with `Không thành công / Câu lệnh này có thể vi phạm chính sách`. To ensure 100% first-pass generation success, apply the following vocabulary replacements:

| Prohibited / High-Risk Term | Safe Cinematic Alternative |
| :--- | :--- |
| `blood`, `bleeding`, `blood dripping` | `purple/crimson cosmic particles`, `energy residue`, `shattered crystal sparks` |
| `severely injured`, `wounded`, `dying` | `exhausted battle stance`, `kneeling in fatigue`, `battle-worn posture` |
| `dagger`, `knife stabbing`, `slash throat` | `shattered crystalline blade`, `blade hilt`, `energy saber`, `defensive stance` |
| `piercing chest`, `impaling` | `thrusting glowing rapier close to chest`, `impact shockwave`, `energy burst` |
| `kill`, `murder`, `corpse` | `vanquish`, `fallen warrior`, `motionless silhouette in dark void` |
| `screaming in agony` | `gasp of shock`, `sharp intake of breath`, `fierce determined glare` |

### 8.6. Automated Unlisted YouTube Uploading (YouTube Studio via CDP)
To share finished episodes or review drafts without burning official YouTube Data API v3 quota (1,600 units/upload):
- **Zero API Quota / Zero Cost:** Operates directly inside the active Google session on `studio.youtube.com` via Chrome CDP bridge.
- **Safety & Verification by TypeSafe Jev:** Performs pre-flight screening on video title and description before upload.
- **CLI Commands:**
  ```bash
  # Check YouTube Studio session status
  ./videogen upload status

  # Upload video as Unlisted (default)
  ./videogen upload storyboards/<storyboard.json>
  ```
- **Pipeline Integration:** `./videogen run <storyboard.json>` automatically handles rendering, voice, assembly, verification, archival, and uploading in one pass.

### 8.7. Character Asset Chip Binding vs. Zero Physical Appearance In Prompts
**Quy tắc bất di bất dịch của Đạo diễn:**
Khi nhân vật đã được lưu trữ trong Google Flow và gắn thẻ thành phần (`<flow-character-ingredient-chip>` `@Character`), **TUYỆT ĐỐI KHÔNG MIÊU TẢ CHI TIẾT NGOẠI HÌNH TRONG TEXT PROMPT**.
- **Lý do:** Thẻ nhân vật đã cố định 100% nhận diện khuôn mặt, tỷ lệ vóc dáng, trang phục, và màu tóc gốc (ví dụ: tóc đỏ của Selena, tóc bạc của Ashel). Việc mô tả màu tóc hoặc giáp trụ trong text prompt sẽ trực tiếp gây xung đột giữa prompt chữ và asset gốc (AI hallucination), làm vỡ màu tóc hoặc sinh ra nhân vật sai lệch.
- **Cấm tiệt:** Tả màu tóc (`lavender hair`, `silver hair`, `crimson hair`), tả chi tiết trang phục (`ornate silver-plated armor with amethyst gems`), tả mắt/khuôn mặt.
- **Tập trung 100% vào:**
  1. **Hành động & Động tác (Action & Kinetics):** Lướt kiếm, rút kiếm, chém ngang (*iaijutsu flash-step*), thủ thế phòng thủ, ngã quỵ, xoay người góc 3/4.
  2. **Biểu cảm & Diễn xuất (Facial Expression):** Nụ cười khinh bỉ thoáng qua, ánh mắt sắc lạnh kiên nghị, mím môi, thở dốc.
  3. **Chuyển động Camera (Cinematography):** `Low-angle tracking push-in`, `smooth orbital pan`, `tight close-up`, `shallow depth of field`.
  4. **Ánh sáng & Môi trường (Lighting & FX):** `swirling cosmic dust`, `cyan/purple lighting reflection`, `volumetric atmospheric fog`.
  5. **Âm thanh & Khẩu hình (Audio & Lip-Sync):** Câu thoại tiếng Nhật có mấp máy môi hoặc chỉ định `AUDIO: SFX ONLY... NO MUSIC.`
- **Tránh bộ lọc tên riêng (Celebrity Filter):** Đối với nhân vật có tên dễ trùng người nổi tiếng như `Selena`, dùng chip `@Selena` để khóa ngoại hình nhưng trong văn bản prompt gọi bằng danh xưng vai trò: `the duelist`, `she`, `her`.




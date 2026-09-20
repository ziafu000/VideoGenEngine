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
- Stitches all scenes sequentially into a master video (`scripts/stitch_video.sh`).
- Dynamically scales voiceover speed (`atempo`) to align with exact video duration (`scripts/mix_audio.sh`).
- Balances audio levels: Voiceover at 100% volume, background ambient SFX at 25% volume.

---

## 2. Environment Setup & Browser Bridge

To bypass Cloudflare / Google bot protections, the system attaches to the user's authentic Windows Chrome browser via remote debugging.

### 2.1. Port Architecture
- **Windows Chrome:** Launched with `--remote-debugging-port=9222` and profile at `C:\Users\ASUS\AppData\Local\Google\Chrome\AutomationProfile`.
- **CDP Proxy (`scripts/cdp_proxy.js`):** Node.js TCP bridge on Windows forwarding `0.0.0.0:9223` -> `127.0.0.1:9222`.
- **WSL Client:** Accesses CDP at `http://$WIN_HOST:9223` using `chrome-devtools-axi`.

### 2.2. Starting the Bridge
```bash
~/ai/project/VideoGen/scripts/start_bridge.sh
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
      "duration_seconds": 10,
      "timecode": "00:00 - 00:10",
      "voiceover": "First scene narration...",
      "prompt": "Vertical 9:16 eye-level medium shot... [Action]... [Lighting]... AUDIO: SFX ONLY — [sound details]. NO MUSIC."
    }
  ]
}
```

---

## 4. Automation Toolchain Reference

| Script | Function | Command / Usage |
| :--- | :--- | :--- |
| `scripts/start_bridge.sh` | Verifies and starts Chrome & CDP proxy on Windows | `./scripts/start_bridge.sh` |
| `scripts/flow_operator.sh` | Google Flow automation (status, configure, character binding, submit, wait, download) | `./scripts/flow_operator.sh status`<br>`./scripts/flow_operator.sh configure 16:9 10s`<br>`./scripts/flow_operator.sh add-character "Ashel" ["Selena"]`<br>`./scripts/flow_operator.sh clear-characters`<br>`./scripts/flow_operator.sh submit "<prompt>"`<br>`./scripts/flow_operator.sh wait 180`<br>`./scripts/flow_operator.sh download renders/scene_01.mp4` |
| `scripts/elevenlabs_operator.sh` | ElevenLabs TTS automation (preserves active voice, generates speech, downloads MP3) | `./scripts/elevenlabs_operator.sh generate "<text>" [output_path]` |
| `scripts/stitch_video.sh` | Concatenates rendered MP4 scene clips via FFmpeg | `./scripts/stitch_video.sh` |
| `scripts/generate_subtitles.js` | Generates dynamic ASS captions (Whisper timestamps + script alignment) | `node ./scripts/generate_subtitles.js [voice_path] [output_ass] [dur]` |
| `scripts/edit_video.sh` | Full Auto-Edit Mode 1: burns dynamic captions, layers SFX & syncs voice | `./scripts/edit_video.sh [video_path] [voice_path]` |
| `scripts/mix_audio.sh` | Basic multi-track audio mixer & tempo sync | `./scripts/mix_audio.sh [video_path] [voice_path]` |
| `scripts/archive_and_cleanup.sh` | Migrates raw materials & master product to D: drive, cleans repo | `./scripts/archive_and_cleanup.sh` |
| `scripts/render_pipeline.sh` | Master end-to-end runner (renders all scenes in `scenes.json`, stitches, edits & archives) | `./scripts/render_pipeline.sh` |

---

## 5. End-to-End Production Checklist

1. **Verify Bridge:** Ensure Windows Chrome is open with Google Flow and ElevenLabs tabs. Run `./scripts/start_bridge.sh`.
2. **Draft Storyboard:** Write the English script & visual prompts into `storyboards/scenes.json` following `skills/faceless-script-writer.md` and `skills/omni-video-prompts.md`.
3. **Render Scenes:** Execute `./scripts/render_pipeline.sh` to configure Flow, submit each scene prompt, wait for rendering, and download clips to `renders/`.
4. **Generate Voiceover:** Run `./scripts/elevenlabs_operator.sh generate "$SCRIPT_EN"` to generate voiceover via ElevenLabs and download to `audio/voiceover_en.mp3`.
5. **Auto-Edit Mode 1 (Subtitles & SFX):** Run `./scripts/edit_video.sh` (or let `render_pipeline.sh` run it automatically):
   - Transcribes voiceover with Whisper and aligns with approved script into rapid 2–3 word ASS subtitles.
   - Highlights active words in vibrant neon yellow with bold Arial Black font, thick black stroke, and drop shadow.
   - Layers opening sub-bass impact (0.0s), scene transition whooshes (at ~10s and ~20s cuts), and accent pops.
   - Burns subtitles and mixes audio tracks into a master MP4 video in a single GPU-accelerated FFmpeg pass.
6. **Archive & Clean Repo:** Execute `./scripts/archive_and_cleanup.sh` (triggered automatically at pipeline end):
   - Migrates raw scene clips, voiceover files, intermediate drafts, and `storyboard_backup.json` to:  
     `D:\Billy\Work\Editing\File video original\<Project_Name>_materials_<Timestamp>/`
   - Migrates the final master video to:  
     `D:\Billy\Work\Editing\File video after edit\<Project_Name>.mp4`
   - Purges all temporary binary files inside `renders/`, `audio/`, and `output/` (leaving only `.gitkeep`), keeping the repository ultra-lightweight (<200KB) and eliminating repetitive large binary git pushes.

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

### 8.3. Dual-Scripting & Cinematic Audio Standard
- **Voiceover Language:** **Japanese** (narrative monologue & sharp seiyuu dialogue), generating authentic anime dramatic tension via ElevenLabs.
- **Subtitles:** **Vietnamese** with manhwa/anime cultivation & RPG terminologies (Tái sinh, Giao diện Cội Nguồn, Rank F, Khế ước, Bị phản bội).
- **Cinematic Pacing (Anti-Shorts Aesthetic):**
  - **NO** rapid Shorts transition sound effects (whooshes, pops, braams, camera shutters).
  - Only clean cinematic cuts aligned with seiyuu breath pauses, orchestral swells, or heavy combat impacts.
  - Video clips retain embedded diegetic ambient sounds (`AUDIO: SFX ONLY — ... NO MUSIC`).
  - Soundtrack and dialogue are mixed with broadcast cinema dynamics (dialogue 100%, background OST 25–35%, diegetic SFX 40%).

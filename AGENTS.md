# VideoGen Agent Guide

This file provides instructions for coding agents and automated supervisors working on the VideoGen project (`~/ai/project/VideoGen`).

---

## 1. Project Mission & Channel Orientation
- **Niche:** English Faceless YouTube Shorts & Explainer Videos (History, Science, Business Mysteries, Tech Anomalies).
- **Language:** **English** for all public outputs: voiceover scripts, title options, description, and scene audio.
- **Zero API Cost Rule:** Leverages the user's existing Google AI Pro (Google Flow) and ElevenLabs subscriptions via Chrome DevTools Protocol (CDP). Never call paid external API endpoints.

---

## 2. System Architecture & Directory Structure
```
~/ai/project/VideoGen/
├── AGENTS.md                 # Agent instructions (this file)
├── README.md                 # Public project overview
├── WORKFLOW.md               # Detailed end-to-end operational guide
├── skills/
│   ├── faceless-script-writer.md  # Scriptwriting principles & retention rules
│   └── omni-video-prompts.md      # Google Omni 1.1 / Veo prompt formula
├── storyboards/
│   └── scenes.json           # Active storyboard, English script & scene prompts
├── scripts/
│   ├── start_bridge.sh       # Verifies Windows Chrome & CDP proxy on port 9223
│   ├── cdp_proxy.js          # Node.js bridge (0.0.0.0:9223 -> 127.0.0.1:9222)
│   ├── flow_operator.sh      # CDP automation for Google Flow
│   ├── elevenlabs_operator.sh# CDP automation for ElevenLabs TTS
│   ├── stitch_video.sh       # FFmpeg scene concatenation
│   ├── mix_audio.sh          # Multi-track audio mixing & tempo sync
│   ├── archive_and_cleanup.sh# Migrates assets to D: drive & purges temp binaries
│   └── render_pipeline.sh    # Automated end-to-end render runner
├── renders/                  # Downloaded raw clips (gitignored)
├── audio/                    # Voiceover MP3s (gitignored)
└── output/                   # Final rendered & mixed videos (gitignored)
```

---

## 3. Standard Operating Procedures (SOP)

### 3.1. Browser Bridge Connection
Before any browser automation, ensure the CDP bridge is alive:
```bash
./scripts/start_bridge.sh
```
- Windows Chrome runs on remote debugging port `9222` with profile `AutomationProfile`.
- Proxy forwards port `9222` to `0.0.0.0:9223`.
- Access from WSL using:
  ```bash
  WIN_HOST=$(ip route | awk '/default/ {print $3}')
  export CHROME_DEVTOOLS_AXI_BROWSER_URL="http://$WIN_HOST:9223"
  ```

### 3.2. Scriptwriting & Storyboards (`storyboards/scenes.json`)
- Use `skills/faceless-script-writer.md` for high-retention English storytelling (Hook/Anomaly -> Mechanism -> Resolution/Turn).
- **Canonical Pacing & Word Count Formula (Standing Captain Rule):**
  - **30s Short (Baseline):** Exactly **80–85 words** (~2.75 words/sec, ~165 WPM).
  - **Scaling for longer videos:** Scale linearly using the 2.75 words/sec ratio:
    - **45s Video:** 120–125 words
    - **60s Video (1 min):** 160–170 words
    - **90s Video:** 245–255 words
    - **120s Video (2 min):** 325–335 words
    - **300s Video (5 min):** 800–850 words
- Prompts must follow `skills/omni-video-prompts.md` format (Shot framing, Motivated Action, Physical Lighting, and `AUDIO: SFX ONLY — ... NO MUSIC`).

### 3.3. Video Generation (Google Flow)
- Operated via `scripts/flow_operator.sh`.
- Default model: **Omni 1.1 Flash** (highest visual detail and fastest generation).
- Default duration: **10s**.
- Aspect ratio: `9:16` for Shorts (`crop_9_16`), `16:9` for long-form (`crop_16_9`).
- Downloads are triggered natively through UI menu: "Tuỳ chọn khác" -> "Tải xuống" -> "720p Kích thước gốc" (direct CDN curl links return 403).

### 3.4. Voiceover (ElevenLabs)
- Operated via `scripts/elevenlabs_operator.sh generate "<script_text>" [output_file]`.
- Preserves the active voice selected by the user on ElevenLabs (default: **Alistair** – Clear, Neutral, Informative).
- Does NOT override or reset user voice preferences.

### 3.5. Audio Mixing & Final Delivery (`scripts/mix_audio.sh`)
- Stitches clips into a single video stream using `scripts/stitch_video.sh`.
- Mixes voiceover with video's native ambient SFX:
  - Voiceover volume: `1.0` (100%).
  - Ambient SFX volume: `0.25` (25% background presence).
  - Automatic `atempo` calculation to match exact video duration.
- Automatically copies the final master video to Windows Downloads (`C:\Users\ASUS\Downloads`) for user review.

### 3.6. Post-Production Archival & Repo Cleanup (`scripts/archive_and_cleanup.sh`)
- Executed automatically at the end of `render_pipeline.sh` or standalone.
- **Materials Archive:** Moves all raw clips from `renders/`, voiceover MP3s from `audio/`, intermediate drafts, and `storyboard_backup.json` to:
  `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\` (WSL: `/mnt/d/Billy/Work/Editing/File video original/...`).
- **Master Video Migration:** Copies/moves the final master video to:
  `D:\Billy\Work\Editing\File video after edit\<Video_Title>.mp4` (WSL: `/mnt/d/Billy/Work/Editing/File video after edit/...`).
- **Repo Cleanup:** Purges all files in `renders/`, `audio/`, and `output/` except `.gitkeep`, keeping repo size minimal (<200KB) and eliminating git bloat across video productions.

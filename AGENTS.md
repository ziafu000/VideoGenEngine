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
│   ├── jev_decider.py        # TypeSafe Jev (System One AI) semantic decider
│   ├── flow_operator.sh      # CDP automation for Google Flow
│   ├── elevenlabs_operator.sh# CDP automation for ElevenLabs TTS
│   ├── stitch_video.sh       # FFmpeg scene concatenation
│   ├── generate_subtitles.js # Dynamic ASS subtitles (Whisper + script alignment)
│   ├── edit_video.sh         # Auto-Edit Mode 1 (burns subtitles, layers SFX & audio)
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
- Aspect ratio: `9:16` for Shorts (`crop_9_16`), `16:9` for long-form / anime series (`crop_16_9`).
- Character consistency: Attach character ingredient chips via `scripts/flow_operator.sh add-character "<Name>"` or by typing `@` in Flow prompt UI. Clear via `scripts/flow_operator.sh clear-characters`.
- Downloads are triggered natively through UI menu: "Tuỳ chọn khác" -> "Tải xuống" -> "720p Kích thước gốc" (direct CDN curl links return 403).

### 3.4. Voiceover (ElevenLabs)
- Operated via `scripts/elevenlabs_operator.sh generate "<script_text>" [output_file]`.
- Preserves the active voice selected by the user on ElevenLabs (default: **Alistair** – Clear, Neutral, Informative).
- Does NOT override or reset user voice preferences.

### 3.5. Video Editing Mode 1: Dynamic Captions & SFX (`scripts/edit_video.sh`)
- Stitches clips into a single video stream using `scripts/stitch_video.sh`.
- Transcribes voiceover with Whisper and generates dynamic ASS subtitles using `scripts/generate_subtitles.js`. Subtitles use all-caps Arial Black/Impact font, neon yellow highlighting on active words, thick black outline, and lower-third center placement (`MarginV=280`).
- Layers multi-track audio:
  - Voiceover: `1.0` (100% volume, tempo-aligned).
  - Opening Hook Sub-bass Impact: `0.50` at 0.0s.
  - Scene Transition Swishes: `0.40` at scene cuts (~10s, ~20s).
  - Accent Pop: `0.35` at story pivot points (~5.5s).
  - Ambient Video Audio: `0.20` (20% background presence).
- Burns dynamic subtitles and renders the edited master video in a single FFmpeg pass.
- Automatically copies the final master video to Windows Downloads (`C:\Users\ASUS\Downloads`) for instant review.

### 3.6. Post-Production Archival & Repo Cleanup (`scripts/archive_and_cleanup.sh`)
- Executed automatically at the end of `render_pipeline.sh` or standalone.
- **Materials Archive:** Moves all raw clips from `renders/`, voiceover MP3s from `audio/`, intermediate drafts, and `storyboard_backup.json` to:
  `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\` (WSL: `/mnt/d/Billy/Work/Editing/File video original/...`).
- **Master Video Migration:** Copies/moves the final master video to:
  `D:\Billy\Work\Editing\File video after edit\<Video_Title>.mp4` (WSL: `/mnt/d/Billy/Work/Editing/File video after edit/...`).
- **Repo Cleanup:** Purges all files in `renders/`, `audio/`, and `output/` except `.gitkeep`, keeping repo size minimal (<200KB) and eliminating git bloat across video productions.

### 3.7. TypeSafe Jev System One AI Decider (`scripts/jev_decider.py`)
- **Engine:** Direct integration with TypeSafe System One API (`jev-latest`), reading `TYPESAFE_API_KEY` with fallback to `/home/asus/ai/firstmate/.env`.
- **Pre-flight Prompt Screening (`screen-prompt`):** Evaluates prompt safety risk via primitive `noul` before sending to Google Flow. Alerts when risk score > 0.40 and halts unsafe submissions (> 0.70).
- **Fast Policy Refusal Detection (`classify-tile`):** Evaluates video tile state via primitive `choice` (`ready`, `generating`, `policy_refusal`, `error`) in `flow_operator.sh wait`. Exits immediately in 5–10s when Google Flow displays refusal messages, avoiding 180–240s timeouts.
- **Scene Character Synchronization:** `render_pipeline.sh` automatically parses the `characters` array for each scene, clearing prior chips and attaching required character assets before prompt submission.
- **TTS Synthesis Verification (`verify-elevenlabs`):** Validates audio completion state via primitive `noul` in `elevenlabs_operator.sh` before triggering download.

---

## 4. Mode 2: Original AI Anime Series Production ("Ashel: Mã Nguồn Tái Sinh")

Operating standard for the 16-episode 3D CGI anime series adapting `ASHEL_SERIES_BIBLE.md`.

### 4.1. Core Production Specifications
- **Episode Duration:** 5 minutes (300 seconds) per episode.
- **Shot Count:** Exactly **30 shots x 10 seconds** per episode.
- **Credit Budget:** 15 credits per shot x 30 shots = **450 credits per 5-min episode** on Google Flow.
- **Aspect Ratio:** **16:9** (Omni 1.1 Flash 720p).
- **Audio Language:** **Japanese Voiceover** (authentic seiyuu narrative & battle dialogue) with **Vietnamese Subtitles**.

### 4.2. Character Ingredient Attachment
- 5 main character assets are pre-saved in Google Flow project `Main series`: `Ashel`, `Valerie`, `Kiran`, `Selena`, and `Master Eldrin`.
- When generating shots:
  1. Call `./scripts/flow_operator.sh add-character "<CharName>"` (supports multiple characters: `./scripts/flow_operator.sh add-character "Ashel" "Selena"`).
  2. In the prompt, do NOT re-describe baseline hair, eye color, or costume details. Reference character names directly in actions and camera angles.
  3. Clear character chips when transitioning to environmental or non-character cutaways (`./scripts/flow_operator.sh clear-characters`).

### 4.3. Cinematic Pacing & Audio Rules
- **Anti-Shorts Aesthetic:** Strictly NO fast-cut transition SFX (whooshes, pops, braams).
- Pacing relies on cinematic camera movement, atmospheric lighting, Japanese voice acting timing, and diegetic ambient sound effects embedded in clips (`AUDIO: SFX ONLY — ... NO MUSIC`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

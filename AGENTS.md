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
├── videogen                  # Unified Central CLI Orchestrator (v2.0)
├── engine/                   # Modular Engine Core
│   ├── config.js             # Paths, host IP, Windows path translation
│   ├── cdp.js                # Unified CDP WebSocket & HTTP client
│   ├── bridge.js             # Windows Chrome & proxy verification
│   ├── cdp_proxy.js          # TCP proxy on Windows (forwarding 9223 -> 9222)
│   ├── flow.js               # Google Flow automation (settings, chips, prompt, dl)
│   ├── tts.js                # ElevenLabs TTS automation (voice profiles, sliders)
│   ├── subtitles.js          # Subtitle generator (Dual-Zone ASS & Shorts ASS)
│   ├── compositor.js         # FFmpeg concatenation, audio padding/mixing, hardsub
│   ├── archive.js            # D: drive archival & working tree cleanup
│   ├── youtube.js            # YouTube Studio unlisted uploader
│   └── youtube_uploader.js   # CDP script for YouTube Studio UI upload
├── skills/
│   ├── faceless-script-writer.md  # Scriptwriting principles & retention rules
│   └── omni-video-prompts.md      # Google Omni 1.1 / Veo prompt formula
├── storyboards/
│   ├── scenes.json           # Active storyboard (Mode 1: Shorts/Explainer)
│   └── example_anime_series.json # Example template (Mode 2: Anime Series)
├── renders/                  # Downloaded raw clips (gitignored, temp workspace)
├── audio/                    # Voiceover MP3s (gitignored, temp workspace)
└── output/                   # Final rendered & mixed videos (gitignored, temp workspace)
```

---

## 3. Standard Operating Procedures (SOP)

### 3.1. Browser Bridge Connection
Before any browser automation, ensure the CDP bridge is alive:
```bash
./videogen bridge [status]
```
- Windows Chrome runs on remote debugging port `9222` with profile `AutomationProfile`.
- Proxy forwards port `9222` to `0.0.0.0:9223`.
- Access from WSL using:
  ```bash
  WIN_HOST=$(ip route | awk '/default/ {print $3}')
  export CHROME_DEVTOOLS_AXI_BROWSER_URL="http://$WIN_HOST:9223"
  ```

### 3.2. Scriptwriting & Storyboards (`storyboards/scenes.json` & `storyboards/example_anime_series.json`)
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
- Operated via `./videogen render <storyboard.json> [shots...]`.
- Default model: **Omni 1.1 Flash** (highest visual detail and fastest generation).
- Default duration: **10s**.
- Aspect ratio: `9:16` for Shorts (`crop_9_16`), `16:9` for long-form / anime series (`crop_16_9`).
- Character consistency: Attach character ingredient chips automatically or via `./videogen render`.
- Downloads are triggered natively through Signed CDN URLs directly from the UI tile.

### 3.4. Voiceover (ElevenLabs)
- Operated via `./videogen voice <storyboard.json> [shots...]`.
- Reads `voice_profiles` from the storyboard, dynamically selects character voice models and calibrates Radix UI stability/similarity/style sliders.

### 3.5. Video Post-Production & Mixing
- Operated via `./videogen assemble <storyboard.json>`.
- Concatenates video clips, pads audio dialogue to align with scene cuts, layers background ambient SFX (at 30%), and burns dual-zone ASS subtitles (or Bouncy Shorts subtitles).
- Subtitles are generated via `./videogen subs <storyboard.json>`.

### 3.6. Post-Production Archival & Repo Cleanup
- Operated via `./videogen archive <storyboard.json>`.
- **Materials Archive:** Moves all raw clips from `renders/`, voiceover MP3s from `audio/`, intermediate drafts, and `storyboard_backup.json` to:
  `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\` (WSL: `/mnt/d/Billy/Work/Editing/File video original/...`).
- **Master Video Migration:** Copies/moves the final master video to:
  `D:\Billy\Work\Editing\File video after edit\<Video_Title>.mp4` (WSL: `/mnt/d/Billy/Work/Editing/File video after edit/...`).
- **Repo Cleanup:** Purges all files in `renders/`, `audio/`, and `output/` except `.gitkeep`, keeping repo size minimal (<200KB) and eliminating git bloat across video productions.

### 3.7. TypeSafe Jev System One AI Decider
- Direct integration via `browser-jev` CLI / python module `browser_jev` connecting to TypeSafe System One API (`jev-latest`).
- **Pre-flight Prompt Screening:** Evaluates prompt safety risk via primitive `noul` before sending to Google Flow. Alerts when risk score > 0.40 and halts unsafe submissions (> 0.70).
- **Fast Policy Refusal Detection:** Evaluates video tile state via primitive `choice` (`ready`, `generating`, `policy_refusal`, `error`). Exits immediately in 5–10s when Google Flow displays refusal messages, avoiding 180–240s timeouts.
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

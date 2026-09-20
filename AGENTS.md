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
- For a 30-second Short:
  - 3 scenes x 10 seconds.
  - Total voiceover word count: 70–85 words (~140–160 wpm for dynamic YouTube Shorts pacing).
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

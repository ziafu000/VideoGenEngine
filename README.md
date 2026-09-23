# 🎬 VideoGen Engine (v2.0)

> **Autonomous, production-grade video generation engine orchestrating Google Flow, ElevenLabs, and TypeSafe Jev AI via Chrome DevTools Protocol (0 API token cost) to produce viral YouTube Shorts and full Youtube Series.**

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green?logo=node.js)](https://nodejs.org/)
[![Google Flow](https://img.shields.io/badge/Google%20Flow-Omni%201.1%20Flash%20%7C%20Veo%203.1-4285F4?logo=google)](https://flow.google.com/)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Multi--Voice%20TTS-F97316)](https://elevenlabs.io/)
[![TypeSafe Jev](https://img.shields.io/badge/TypeSafe%20AI-System%20One%20(Jev)-7C3AED)](https://typesafe.ai/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-libass%20hardsub-007808?logo=ffmpeg)](https://ffmpeg.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌟 Why VideoGen?

Building automated video pipelines with commercial APIs is notoriously expensive and fragile: raw video generation APIs cost dollars per minute, and basic scripts break on bot checks. 

**VideoGen Engine v2.0** solves this by acting as an **Autonomous Director-Worker System** that drives authentic, logged-in browser workspaces directly through the **Chrome DevTools Protocol (CDP)**:

1. 💰 **Zero API Token Cost:** Leverages your existing Google AI Pro (Google Flow) and ElevenLabs subscriptions directly in the browser. Zero paid API keys required.
2. 🧠 **TypeSafe Jev System One AI Decider:** Sub-second semantic decision engine (`jev-latest`) evaluating pre-flight prompt safety, detecting Google Flow policy refusals in 5–10s (instead of 240s hanging timeouts), and confirming ElevenLabs audio synthesis readiness.
3. 🎭 **Dual-Mode Production:**
   - **Mode 1: Faceless Explainer & Shorts (English):** 9:16 vertical, rapid 2.75 words/sec retention pacing, dynamic animated word-by-word subtitles, automated cinematic SFX (sub-bass impacts, scene swishes, accent pops).
   - **Mode 2: Original 3D CGI Anime Series:** 16:9 widescreen, multi-character asset consistency via `@Character` chips, multi-voice Japanese voice acting, and cinema-grade **Dual-Zone ASS Subtitles**.
4. 🎙️ **Automated ElevenLabs Voice Calibration:** Automatically selects character voices and adjusts Radix UI sliders (Stability, Similarity, Style Exaggeration, Speed) via simulated CDP mouse events according to your storyboard's `voice_profiles`.
5. 🎞️ **Dual-Zone Subtitle Architecture (`.ass` via `libass`):**
   - **Tier A (Dialogue & Inner Monologue):** Bottom-center white Arial with black stroke for character dialogue.
   - **Tier B (AI System HUD Captions):** Top-center cyan neon Consolas for ancient AI terminal/HUD alerts.
6. 📦 **Single Source of Truth (SSOT):** Entire episodes are defined in pure declarative JSON (`storyboards/example_anime_series.json`). The engine contains zero hardcoded episode text or character names.
7. 🚀 **Unified CLI (`./videogen`):** Single executable command to control every phase or execute end-to-end autonomous runs (`./videogen run storyboard.json`).
8. 💾 **Automated D: Drive Archival & Clean Git:** Automatically migrates hundreds of megabytes of raw scene clips, voice files, and master videos to external storage, keeping the Git repository ultra-lightweight (<200KB).

---

## 📐 Architecture Overview

```
                 [ Declarative Storyboard (JSON) ]
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ./videogen CLI Orchestrator                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. BRIDGE VERIFICATION (`engine/bridge.js`, `engine/cdp.js`)          │
│     └── Windows Chrome Remote Debugging (9222) ──> TCP Proxy (9223)   │
│                                                                        │
│  2. VISUAL GENERATION (`engine/flow.js` + TypeSafe Jev)                │
│     ├── Jev pre-flight prompt safety screening (noul risk eval)        │
│     ├── Configure resolution, 16:9 / 9:16, 10s duration               │
│     ├── Attach character asset chips (`<flow-character-chip>` `@`)     │
│     ├── Fast policy refusal early abort (5s fail-fast vs 240s wait)    │
│     └── Cloud AI Super-Resolution (Native 1080p Full HD download)      │
│                                                                        │
│  3. VOICEOVER GENERATION (`engine/tts.js`)                             │
│     ├── Read `voice_profiles` from storyboard                          │
│     ├── Switch ElevenLabs voice models and calibrate character-specific sliders   │
│     ├── Programmatic Radix UI slider calibration (stability/style)     │
│     └── Download high-fidelity dialogue MP3s                           │
│                                                                        │
│  4. SUBTITLE ENGINE (`engine/subtitles.js`)                            │
│     ├── Mode 1: Dynamic Bouncy Neon Yellow Subtitles (Shorts)          │
│     └── Mode 2: Cinema Dual-Zone ASS (Bottom: Dialogue | Top: HUD)     │
│                                                                        │
│  5. POST-PRODUCTION COMPOSITOR (`engine/compositor.js`)                │
│     ├── Multi-clip seamless concatenation                              │
│     ├── Dynamic silence padding & dialogue-to-cut synchronization      │
│     ├── Multi-track audio mix: Voice (100%) + Ambient SFX (30%)        │
│     └── Hardware-accelerated subtitle burn-in (`libass`)               │
│                                                                        │
│  6. POST-PRODUCTION ARCHIVAL (`engine/archive.js`)                     │
│     ├── Migrate raw clips & voiceover to `File video original/`        │
│     ├── Save final video to `File video after edit/`                   │
│     └── Purge workspace (`renders/`, `audio/`, `output/`)              │
│                                                                        │
│  7. YOUTUBE STUDIO UPLOAD (`engine/youtube.js`)                        │
│     └── Automated Unlisted upload via Chrome CDP (0 YouTube API cost)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (3 Minutes)

### 1. Prerequisites
- **OS:** Linux or Windows with WSL2 (Ubuntu 22.04 / 24.04).
- **Node.js:** v20+ (Node.js v24 recommended for native WebSocket/fetch).
- **FFmpeg:** Installed with `libass` and `freetype` support:
  ```bash
  sudo apt-get update && sudo apt-get install -y ffmpeg
  ```
- **Google Chrome (Windows or Linux):** Logged into Google AI Pro (Google Flow) and ElevenLabs.
- **TypeSafe AI API Key (Recommended):** Export `TYPESAFE_API_KEY="your-key"` in `~/.bashrc` or `.env` for System One semantic decisions.

### 2. Installation
```bash
# Clone the open-source repository
git clone https://github.com/ziafu000/VideoGenEngine.git VideoGen
cd VideoGen
chmod +x ./videogen

# Optional: Link globally so you can run 'videogen' from any directory
npm link

# Optional: Copy environment configuration
cp .env.example .env
```

### 3. Launch Chrome Remote Debugging Bridge
Start Windows Chrome with remote debugging enabled on port `9222`:

**Option A — Automatic Launch via VideoGen:**
```bash
./videogen bridge
```
*(If the bridge is offline, VideoGen automatically triggers Windows Chrome and the CDP proxy on port 9223!)*

**Option B — Manual Launch from Windows PowerShell:**
```powershell
# In Windows PowerShell:
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\AutomationProfile"
```

Verify connectivity from WSL/Linux terminal:
```bash
./videogen bridge status
```
*Output:*
```
=== CDP BRIDGE STATUS ===
URL: http://192.168.1.100:9223
Trạng thái: ĐANG HOẠT ĐỘNG (READY)
Tổng số tabs: 2
  * Google Flow – Main series -> https://flow.google.com/...
  * Text to Speech | ElevenLabs -> https://elevenlabs.io/...
```

---

## 🕹️ CLI Command Reference (`./videogen`)

All production phases are orchestrated through the central `./videogen` CLI:

| Command | Action | Description |
| :--- | :--- | :--- |
| `./videogen bridge [status]` | **Bridge Health** | Checks or auto-spawns Windows Chrome & CDP proxy. |
| `./videogen render <sb> [shots...] [--720p]` | **Render Video** | Controls Google Flow: configures settings, attaches `@Character` chips, submits prompts, activates Cloud AI 1080p Super-Resolution (or `--720p` for fast draft). |
| `./videogen voice <sb> [shots...]` | **Voiceover** | Synthesizes dialogue on ElevenLabs with automated character slider calibration and Jev obstacle clearance. |
| `./videogen subs <sb>` | **Subtitles** | Generates Cinema Dual-Zone ASS subtitles or dynamic Shorts subtitles. |
| `./videogen assemble <sb>` | **Compositor** | Stitches clips, dynamically pads audio dialogue, balances audio, and burns hardsubs. |
| `./videogen verify <video> [ts...]` | **Visual QA** | Extracts high-res keyframes at specified timestamps for visual inspection. |
| `./videogen shorts <sb> [video]` | **Shorts Clips** | Automatically extracts and renders viral 9:16 vertical teaser clips with **Option B (Cinematic Blur Overlay)** and high-impact CTA banners (0 Credit cost). |
| `./videogen thumb <sb> [prompt]` | **Thumbnails** | Generates 4 cinematic 16:9 thumbnails via Google Flow image mode, upscales to 1080p, and syncs to drive. |
| `./videogen archive <sb>` | **Archival** | Migrates all raw materials and master video to storage drive; purges temp files. |
| `./videogen upload <sb>` | **YouTube** | Uploads master video directly to YouTube Studio as Unlisted via CDP with Jev verification. |
| **`./videogen run <sb> [--720p]`** | **Full Pipeline** | **Executes the entire end-to-end pipeline autonomously from A to Z!** |

---

## 📖 Storyboard Specification (SSOT)

Every video is completely defined in a declarative JSON storyboard file under `storyboards/`:

```json
{
  "project": {
    "id": "anime_ep01_demo",
    "title": "Cyber Samurai: The Awakening - Episode 1",
    "series": "Protocol: Cyber",
    "aspect_ratio": "16:9",
    "model": "Omni 1.1 Flash",
    "duration_per_clip": 10
  },
  "voice_profiles": {
    "Ren": {
      "voice": "YourChosenVoice",
      "speed": 1.0,
      "stability": 40,
      "similarity": 80,
      "style": 15
    },
    "Aria": {
      "voice": "YourSecondVoice",
      "speed": 1.0,
      "stability": 35,
      "similarity": 80,
      "style": 25
    },
    "System AI": {
      "voice": "YourNarratorVoice",
      "speed": 0.95,
      "stability": 85,
      "similarity": 85,
      "style": 0
    }
  },
  "shots": [
    {
      "id": "shot_01",
      "characters": ["Ren"],
      "dialogue_tier": "A",
      "speaker": "Ren",
      "dialogue_jp": "何者だ...？ どこから入ってきた？",
      "dialogue_vi": "Kẻ nào đó...? Ngươi đột nhập từ đâu?",
      "prompt": "Widescreen 16:9 cinematic eye-level medium tracking shot: A dark futuristic dojo illuminated by flickering blue neon lights... AUDIO: SFX ONLY — heavy rain pattering against glass. NO MUSIC."
    }
  ]
}
```

---

## 🧠 TypeSafe Jev System One AI Decider

VideoGen integrates **TypeSafe System One AI (`jev-latest`)** via `browser-jev` for sub-second semantic evaluation:

1. **Pre-flight Prompt Safety Screening:** Runs prompt text through the `noul` primitive before submission to Google Flow. Alerts if risk score > 0.40 and halts unsafe submissions (> 0.70) to prevent account flags.
2. **Fast Policy Refusal Early Exit:** Continuously evaluates tile DOM text during generation using the `choice` primitive (`ready`, `generating`, `policy_refusal`, `error`). If Google Flow displays a policy refusal ("Không thành công..."), the engine exits in **5–10 seconds** instead of hanging for 180–240 seconds.
3. **ElevenLabs Audio Synthesis Confirmation:** Verifies that audio wave generation has completed before triggering MP3 downloads.
4. **YouTube Upload Title Screening:** Semantically verifies video titles and descriptions before submitting to YouTube Studio.

---

## 🎬 Prompt Engineering Rules (The Secret Sauce)

Included in `skills/omni-video-prompts.md` and `skills/faceless-script-writer.md`:

### 1. The Zero Physical Descriptors Rule
When attaching character ingredient chips (`<flow-character-chip>` `@Character`), **NEVER describe baseline physical features** (hair color, armor details, facial structure) in the text prompt. 
- *Why:* The character chip already anchors 100% of the 3D model visual identity. Writing "crimson hair" or "silver armor" causes AI hallucination and visual degradation.
- *Focus prompt strictly on:* Motivated Action, Emotional Expression, Camera Framing, Physical Lighting, and Audio cues.

### 2. Timeline Prompting (10-Second Clips)
Divide 10-second clips into 2–3 micro-scenes to eliminate static shots:
```
[00:00 - 00:03] Wide low-angle shot: The warrior deflects a crystalline blast.
[00:03 - 00:07] Rapid whip-pan to: Extreme close-up of his glowing cyan eye.
[00:07 - 00:10] Push-in medium shot: He steps forward as shockwaves dissipate.
AUDIO: SFX ONLY — energy deflection clangs, mechanical hum. NO MUSIC.
```

### 3. Native Lip-Sync Prompting
Omni 1.1 Flash can synthesize character speech with synchronized lip motion:
```
AUDIO: Clear Japanese character voiceover speaking: "Kono sekai wa...", synced lip motion. NO MUSIC.
```

---

## 🛡️ Creator IP Protection & Setup for New Agents

To safeguard proprietary intellectual property, channel assets, and series storylines from accidental public leaks:
- Both `storyboards/` and `assets/` are strictly **gitignored** in `.gitignore`.
- Your private storyboards, character designs, and channel branding are 100% safe locally and will never be pushed to Git.

### 🤖 Automatic Directory Initialization (For Agents & New Clones)
When you or an automated coding agent clones this repository:
1. Running any `./videogen` command **automatically initializes** the missing empty runtime directories (`storyboards/`, `assets/`, `renders/`, `audio/`, `output/`).
2. Alternatively, an agent can explicitly run:
   ```bash
   mkdir -p storyboards assets renders audio output
   ```
3. To start production, copy the open-source sample storyboard from `examples/storyboards/` into `storyboards/`:
   ```bash
   cp examples/storyboards/example_anime_series.json storyboards/my_series.json
   ./videogen run storyboards/my_series.json
   ```

---

## 📂 Directory Layout

```
VideoGen/
├── videogen                  # Unified Central Executable CLI
├── engine/                   # Modular Engine Core
│   ├── config.js             # Environment paths, auto-directory creation & Windows path translation
│   ├── cdp.js                # WebSocket & HTTP Chrome DevTools client
│   ├── bridge.js             # Windows Chrome & proxy health verification
│   ├── cdp_proxy.js          # TCP forwarder (0.0.0.0:9223 -> 127.0.0.1:9222)
│   ├── flow.js               # Google Flow automation (settings, chips, prompts, signed CDN dl)
│   ├── tts.js                # ElevenLabs TTS automation (voice profiles & slider calibration)
│   ├── thumbnail.js          # Google Flow image-mode 16:9 thumbnail generator & 1080p scaler
│   ├── subtitles.js          # Subtitle generator (Dual-Zone ASS & Shorts ASS)
│   ├── compositor.js         # FFmpeg concatenation, audio padding/ducking, hardsub
│   ├── archive.js            # Storage archival & local working tree purge
│   ├── youtube.js            # YouTube Studio unlisted upload automation
│   └── youtube_uploader.js   # CDP script for YouTube Studio UI interactions
├── examples/                 # Public Open-Source Templates (Committed to Git)
│   └── storyboards/
│       ├── example_anime_series.json # Public template for 3D CGI Anime Series
│       └── scenes.json               # Public template for Faceless Shorts
├── storyboards/              # Private Declarative Storyboards (Gitignored, 100% Private IP)
├── assets/                   # Private Channel Branding & SFX Assets (Gitignored, 100% Private IP)
├── skills/                   # Prompt & Scriptwriting Playbooks (Permanent Director Cognitive Core)
│   ├── omni-video-prompts.md # Google Omni 1.1 prompt engineering formulas
│   └── faceless-script-writer.md # High-retention script pacing standards
├── renders/                  # Temporary video workspace (gitignored, clean)
├── audio/                    # Temporary audio workspace (gitignored, clean)
└── output/                   # Temporary master video workspace (gitignored, clean)
```

---

## 🤝 Contributing & Community

Contributions, issue reports, and prompt playbooks are welcome!
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'feat: add support for new TTS model'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  <b>Built with ❤️ for AI Directors, Anime Creators, and Content Automators worldwide.</b>
</p>

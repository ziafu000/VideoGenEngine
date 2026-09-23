# VideoGen Agent Guide

This file provides instructions for coding agents and automated supervisors working on the VideoGen project (`~/ai/project/VideoGen`).

---

## 1. Project Mission & Core Principle
- **Tool-First Design:** VideoGen is a generic video production engine. Engine source code, skills, and templates must contain **zero hardcoded series titles, character names, plotlines, or personal branding**. Every series-specific element (characters, voice profiles, story beats) lives exclusively in the user's private `storyboards/` directory (gitignored).
- **Zero API Cost Rule:** Leverages the user's existing Google AI Pro (Google Flow) and ElevenLabs subscriptions via Chrome DevTools Protocol (CDP). Never call paid external API endpoints.
- **Supported Modes:**
  - **Mode 1 (Faceless Explainer & Shorts):** 9:16 vertical, English narration, dynamic word-by-word yellow-neon subtitles, rapid multi-cut Timeline Prompting, automated SFX layering.
  - **Mode 2 (Story-Driven Cinematic Series):** 16:9 widescreen, multi-character asset chip binding, multi-voice dialogue casting, cinema-grade Dual-Zone ASS subtitles.

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
│   ├── archive.js            # External drive archival & working tree cleanup
│   ├── youtube.js            # YouTube Studio unlisted uploader
│   └── youtube_uploader.js   # CDP script for YouTube Studio UI upload
├── skills/
│   ├── faceless-script-writer.md  # Scriptwriting principles & retention rules
│   └── omni-video-prompts.md      # Google Omni 1.1 / Veo prompt formula
├── examples/
│   └── storyboards/          # Generic community templates (public, tracked)
├── storyboards/              # User's private storyboards (gitignored — never tracked)
├── assets/                   # User's private assets: SFX, branding, thumbnails (gitignored)
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

### 3.2. Resolution Mode Selection (REQUIRED before every render)
**Before starting any render workflow, the agent MUST ask the user which download resolution they want for this session:**

```
Bạn muốn render ở chế độ nào?
  [1] 1080p Full HD (Cloud AI Super-Resolution) — Chất lượng cao nhất, ~8.4 Mbps/clip
      ⚠️  Lưu ý: Chế độ 1080p phụ thuộc vào hàng đợi AI đám mây của Google. Có thể gặp
          timeout hoặc crash nếu Google Cloud quá tải hoặc phiên trình duyệt bị mất kết nối.
          Engine có fallback tự động về 720p nếu phát hiện lỗi trong 70ms qua TypeSafe Jev.
  [2] 720p (Tải trực tiếp CDN) — Nhanh hơn (~0.8s/clip), ổn định 100%, không phụ thuộc cloud.
      Dùng làm bản nháp xem trước hoặc khi cần render nhanh.

Nhập 1 hoặc 2:
```

- If user selects **1080p**: use `./videogen render <sb>` (default cloud super-resolution).
- If user selects **720p**: use `./videogen render <sb> --720p` (direct CDN download).
- Never silently default to either mode without asking first.

### 3.3. Scriptwriting & Storyboards
- All storyboards reside in `storyboards/<your_project>.json` — private and gitignored.
- Use `skills/faceless-script-writer.md` for high-retention English storytelling (Hook/Anomaly → Mechanism → Resolution/Turn).
- **Canonical Pacing & Word Count Formula:**
  - **30s Short (Baseline):** Exactly **80–85 words** (~2.75 words/sec, ~165 WPM).
  - Scale linearly using 2.75 words/sec for longer videos:
    - **60s:** 160–170 words | **90s:** 245–255 words | **300s (5 min):** 800–850 words
- Prompts must follow `skills/omni-video-prompts.md` format.

### 3.4. Video Generation (Google Flow)
- Operated via `./videogen render <storyboard.json> [shots...]` (+ optional `--720p`).
- Default model: **Omni 1.1 Flash** (highest visual detail and fastest generation).
- Default duration: **10s**.
- Aspect ratio: `9:16` for Shorts (`crop_9_16`), `16:9` for long-form / series (`crop_16_9`).
- Character consistency: Attach character ingredient chips automatically or via `./videogen render`.
- TypeSafe Jev (`browser-jev classify`) monitors every render for policy refusals (fast-fail 5s) and cloud 1080p upscale state.

### 3.5. Voiceover (ElevenLabs)
- Operated via `./videogen voice <storyboard.json> [shots...]`.
- Reads `voice_profiles` from the storyboard, dynamically selects character voice models and calibrates Radix UI stability/similarity/style sliders.
- TypeSafe Jev (`browser-jev obstacle`) auto-dismisses popup dialogs that may block automation.

### 3.6. Video Post-Production & Mixing
- Operated via `./videogen assemble <storyboard.json>`.
- Concatenates video clips, pads audio dialogue to align with scene cuts, layers background ambient SFX (at 30%), and burns dual-zone ASS subtitles (or Bouncy Shorts subtitles).
- Subtitles are generated via `./videogen subs <storyboard.json>`.

### 3.7. Post-Production Archival & Repo Cleanup
- Operated via `./videogen archive <storyboard.json>`.
- Moves all raw clips from `renders/`, voiceover MP3s from `audio/`, and storyboard backup to user-configured `DEST_ORIGINAL` path in `.env`.
- Copies final master video to user-configured `DEST_FINAL` path in `.env`.
- Purges all files in `renders/`, `audio/`, and `output/` except `.gitkeep`.

### 3.8. TypeSafe Jev System One AI Decider
- Direct integration via `browser-jev` CLI / python module `browser_jev` connecting to TypeSafe System One API (`jev-latest`).
- **Pre-flight Prompt Screening:** Evaluates prompt safety risk via primitive `noul` before sending to Google Flow. Alerts when risk score > 0.40 and halts unsafe submissions (> 0.70).
- **Fast Policy Refusal Detection:** Evaluates video tile state via primitive `choice` (`ready`, `generating`, `policy_refusal`, `error`). Exits immediately in 5–10s when Google Flow displays refusal messages, avoiding 180–240s timeouts.
- **Cloud 1080p Upscale Monitoring:** Classifies toast state (`in_progress`, `error`, `neutral`) to trigger immediate 720p fallback on cloud error detection in ~70ms.
- **ElevenLabs Error Detection:** Classifies TTS synthesis banners for quota/error states; clears popup obstacles automatically.
- **YouTube Upload Verification:** Verifies published video link via `browser-jev verify`.

### 3.9. Character Asset Chip Binding Rule (Mode 2 — Series)
When a user's Google Flow project has saved character assets and a shot uses `characters: ["CharacterName"]` in the storyboard, the engine attaches the visual reference chip via CDP (`@CharacterName`). This locks 100% of the character's visual identity (face, proportions, outfit, hair color). Prompt text for that shot **must NOT re-describe physical appearance** — focus exclusively on: Action, Expression, Camera, Lighting/FX, and Audio cues.

---

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
Engine code, skills, and examples must remain generic — no user-specific series names, characters, or personal paths belong here.

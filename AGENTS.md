# VideoGen Agent Guide

This file provides comprehensive, self-contained instructions for coding agents (Codex, Cursor, Claude Code, Pi) and automated supervisors working on the VideoGen project (`projects/VideoGen`).

---

## 1. Project Mission & Core Principles
- **Universal Declarative Video Engine:** VideoGen is a generic, modular, parameter-driven video production engine. Engine source code, CLI commands, and templates contain **zero hardcoded series titles, episode scripts, character names, or private channel branding**. Any video format—regardless of genre, duration, or platform—is defined purely through declarative parameters in storyboard JSON.
- **Zero API Cost Rule:** Leverages the user's existing Google AI Pro (Google Flow) and local neural models (VieNeu-TTS v3 Turbo) / ElevenLabs via Chrome DevTools Protocol (CDP). Never call paid external API endpoints.
- **The 6-Dimensional Parameter Matrix:**
  Every video format is composed of 6 independent parameter dimensions configured in the storyboard JSON:
  1. **Geometry:** `aspect_ratio` (`9:16`, `16:9`, `1:1`, `4:5`) & `resolution` (`1080p` Cloud Super-Res vs. `720p` Direct CDN).
  2. **Timeline:** `shots_count` (N shots) & `duration_per_shot_sec` (4s, 6s, 8s, 10s) → `total_duration_sec` = N × D.
  3. **Voice & Pacing:** `provider` (`vieneu` vs. `elevenlabs`), `target_density_wps` (words/sec), and neural TTS settings (`temperature`, `watermark`).
  4. **Visuals & Guardrails:** `model` (`omni_flash` vs. `veo`), character asset chips (`@Character`), and prompt cleanliness guardrails.
  5. **Subtitles & Typography:** `hardsub` (`true` vs. `false`) and style presets (`clean`, `bouncy_neon`, `dual_zone_cinema`).
  6. **Audio Mixing Bus:** 3-channel balance (`voice_volume`, `sfx_volume`, `bgm_path`, `bgm_volume`).

- **Reference Presets (Configurable Case Studies):**
  - **Preset A — Clean Documentary Shorts:** `9:16`, 40s (4×10s), clean footage (`hardsub: false`), 36–39 words/shot (~3.8 wps), BGM at 15%, SFX at 25%, Voice at 100%.
  - **Preset B — Kinetic Explainer Shorts:** `9:16`, 30s–60s, word-by-word animated yellow-neon subtitles (`hardsub: true`, `bouncy_neon`), rapid 2.75 wps pacing, layered UI SFX.
  - **Preset C — Story-Driven Cinematic Series:** `16:9`, multi-shot episodes (e.g. 30×10s = 5m), character asset consistency via `@Character` chips, cinema-grade Dual-Zone ASS subtitles.
  - **Custom Formats:** Any combination of parameters configured via `examples/storyboards/universal_template.json`.

---

## 2. System Architecture & Directory Structure
```
projects/VideoGen/
├── AGENTS.md                 # Agent instructions (this file — self-contained guide)
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
│   ├── vieneu_engine.py      # Local VieNeu-TTS v3 Turbo neural engine (48 kHz)
│   ├── subtitles.js          # Subtitle generator (Dual-Zone ASS & Shorts ASS)
│   ├── compositor.js         # FFmpeg concatenation, audio padding/mixing, hardsub
│   ├── archive.js            # External drive archival & working tree cleanup
│   ├── youtube.js            # YouTube Studio uploader module
│   ├── youtube_uploader.js   # CDP script for YouTube Studio UI upload
│   ├── meta_uploader.js      # CDP script for Meta Business Suite (Facebook Reels)
│   └── tiktok_uploader.js    # CDP script for TikTok Studio upload
├── examples/
│   └── storyboards/          # Universal declarative template & reference presets
│       ├── universal_template.json              # Generic schema template with placeholders
│       ├── preset_clean_documentary_40s.json    # Clean documentary reference (9:16, 40s)
│       ├── preset_kinetic_explainer_shorts.json # Kinetic explainer reference (9:16, 30s)
│       └── example_anime_series.json            # Cinematic 16:9 reference
├── storyboards/              # User's private storyboards (gitignored — never tracked)
├── assets/                   # User's private assets: SFX, BGM, branding (gitignored)
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
- Windows Chrome runs on remote debugging port `9222`.
- Proxy forwards port `9222` to `0.0.0.0:9223`.
- In WSL/Linux environments, ensure Chrome shortcut `C:\Users\<user>\Desktop\Gia Phú - Chrome.lnk` is used when launching.

### 3.2. Scriptwriting & Storyboard Standards

#### A. Prompt Cleanliness Guardrails (All Formats)
Prompts sent to Google Flow must describe camera, lighting, environment, and physical dynamics, strictly terminating with:
`AUDIO: SFX ONLY. STRICTLY NO VOICE. NO SPEECH. NO DIALOGUE. CLEAN FOOTAGE ONLY. STRICTLY NO ON-SCREEN TEXT. NO SUBTITLES. NO CAPTIONS.`
This prevents model hallucination of unwanted burned-in text or clashing audio.

#### B. Voiceover Pacing & Density Calibration
- **Documentary & Narrative Pacing (~3.8 – 4.0 words/sec):**
  - For a **10-second shot**, target density is **36 – 39 words**.
  - On VieNeu-TTS 48kHz, this produces an audio duration of **8.5s – 9.5s**, filling the 10-second visual cut naturally without awkward silence.
- **Fast-Paced Explainer Pacing (~2.75 words/sec):**
  - Baseline: **80–85 words per 30 seconds**. Scale proportionally.

#### C. Subtitle Mode Selection
- Set `"hardsub": false` in storyboard for clean footage without burned-in captions.
- Set `"hardsub": true` with `subtitle_style.preset: "kinetic_neon_yellow"` for animated word-by-word subtitles.
- Set `"hardsub": true` with `subtitle_style.preset: "dual_zone"` for 16:9 cinema dialogue + HUD.

---

### 3.3. Voiceover & Multi-Engine TTS Protocols

VideoGen supports two TTS engines: `vieneu` (local neural TTS, default, 0 cost) and `elevenlabs` (browser CDP).

#### A. VieNeu-TTS v3 Turbo Rules for Studio-Grade Quality
When generating voice via `./videogen voice <storyboard.json>` with `tts_provider: "vieneu"`:
1. **Low Sampling Temperature (0.4 – 0.5):** Default temperature (0.8) causes phonetic slurring and consonant lisping. Lowering temperature to **`0.4`** produces crisp, authoritative, clear consonants and steady pitch cadence.
2. **Disable Watermark (`apply_watermark = False`):** Disabling the copyright audio watermark removes high-frequency sizzling artifacts from sibilant sounds ("s", "x", "ch", "tr").
3. **Phonetic Transliteration for Loanwords:** Transliterate foreign geographical names and proper nouns into natural Vietnamese phonetics (e.g., "Ô-rê-gơn", "Tho", "ba-dan", "ki-lô-gam") so the model articulates clearly without swallowing syllables.
4. **Voice Presets:**
   - `Hải Đăng`: Natural conversational cadence, balanced tone.
   - `Thiện Minh`: Warm, deep, cinematic documentary narrator.
   - `Minh Đức`: Crisp, broadcast news anchor cadence.
5. **Channel Profiles:**
   - Profile `ZFstudio`: Default narrator for documentary science shorts (`vieneu`, preset `Hải Đăng` / `Thiện Minh`, 48 kHz).
   - Profile `AthenaStock`: Zero-shot voice cloning for financial content.

#### B. Anti-Voice Doubling Rule (Strict MD5 Hash Check)
- **ElevenLabs History Latency Caveat:** ElevenLabs History API has a 2–5s indexing delay on newly generated audio. Fetching `/v1/history` immediately may return the audio of the *previous* shot, resulting in identical duplicate voice clips across consecutive shots.
- **Mitigation:**
  1. `engine/tts.js` stores `previousHistoryId` before generating and waits until `latestItem.history_item_id !== previousHistoryId` with matching text before downloading.
  2. `engine/compositor.js` enforces an MD5 assertion across all voice files before assembling; any duplicate hash halts the build immediately.

---

### 3.4. Video Generation (Google Flow)
- Operated via `./videogen render <storyboard.json> [shots...]`.
- Default model: **Omni 1.1 Flash** (15 credits per 10s clip; 4 shots = 60 credits).
- Default duration: **10s** (or 4s, 6s, 8s per storyboard configuration).
- Aspect ratio: `9:16` for vertical (`crop_9_16`), `16:9` for widescreen (`crop_16_9`).
- **Cloud 1080p Super-Resolution:** Engine triggers cloud 1080p upscale and monitors progress via TypeSafe Jev (`browser-jev classify`). If cloud AI reports an error or rate-limit in 70ms, it falls back to 720p direct CDN download.
- **Cache Isolation:** Render cache must always be isolated under `renders/<project_name>/`. Never read or write loose files in root `renders/`.

---

### 3.5. Master Video Assembly & Audio Mixing
- Operated via `./videogen assemble <storyboard.json>`.
- **Configurable Audio Mixing Bus:**
  - **Voice:** Configurable via `audio_mix.voice_volume` (default `1.0`).
  - **SFX (Flow Ambience):** Configurable via `audio_mix.sfx_volume` (default `0.25`).
  - **BGM (Background Music):** Configurable via `audio_mix.bgm_path` and `audio_mix.bgm_volume` (e.g. `0.15`, `-ss 8.5`).
- **MD5 Integrity Assertion:** Verifies unique MD5 checksums for all video files and audio files before FFmpeg concatenation.

---

### 3.6. Multi-Platform Publishing & Scheduling SOP
- Operated via `./videogen upload <storyboard.json>`.
- **Publishing Order:** Always schedule **YouTube Studio first**, then **Meta Business Suite (Facebook Reels)**. Skip TikTok unless explicitly requested.
- **Navigation & Dialog Hygiene:**
  - Video upload pages retain dirty state; navigation triggers native Chrome `beforeunload` dialogs or platform "Discard changes?" modals.
  - Automation must listen to `Page.javascriptDialogOpening` and respond with `Page.handleJavaScriptDialog({ accept: true })` or click the platform Confirm/Leave buttons.
  - If a flow appears blocked, capture a screenshot via CDP (`Page.captureScreenshot`) for visual diagnosis instead of waiting for timeout.

---

## 4. Git Discipline & IP Security for Agents
1. **Never Commit Private Media or Credentials:**
   - `storyboards/` and `assets/` are 100% gitignored. Never add or force-track files in these directories.
   - `renders/`, `audio/`, and `output/` are temporary scratch workspaces (gitignored).
2. **Clean Engine Code Only:**
   - Any test or diagnostic script must use the `local_*.js` naming convention (gitignored).
   - Never add episode-specific or channel-specific logic into `engine/`.
3. **Branch & PR Hygiene:**
   - Work in an isolated branch or worktree (`fm/<task-id>`).
   - Do not push to remote or merge PRs without explicit confirmation.

---

## 5. Audit & Sync Directive for Agents
When reviewing or maintaining this repository:
1. **Code vs. Docs Parity:** Ensure any newly added engine CLI flags, config options, or uploader scripts are reflected in this file and `README.md`.
2. **Self-Contained Knowledge:** Ensure all rules, thresholds, and formulas are fully articulated here so any fresh agent session can operate with 100% autonomy without external memory.

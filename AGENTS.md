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
  - **Preset A — Clean Documentary Shorts (Vertical 9:16):** `9:16`, 40s (4×10s), clean footage (`hardsub: false`), 36–39 words/shot (~3.8 wps), BGM at 15%, SFX at 25%, Voice at 100% via VieNeu-TTS v3 Turbo 48kHz.
  - **Preset B — Kinetic Explainer Shorts:** `9:16`, 30s–60s, word-by-word animated yellow-neon subtitles (`hardsub: true`, `bouncy_neon`), rapid 2.75 wps pacing, layered UI SFX.
  - **Preset C — Minimalist Hand-Drawn Explainer (Widescreen 16:9):** `16:9`, 2D Motion Stills via Google Flow Nano Banana Pro (0 credits, free), micro-shot pacing (**1.5s – 2.5s per cut**, 20–25 cuts/min), 2D Ken Burns camera moves, Kokoro-82M local English voice (Puck 80% + Adam 20% + Studio De-Nasal EQ, speed 1.12x, tight ~0.15s pauses), **STRICTLY NO BGM** (`bgm_volume: 0`).
  - **Preset D — Story-Driven Cinematic Series:** `16:9`, multi-shot episodes (e.g. 30×10s = 5m), character asset consistency via `@Character` chips, cinema-grade Dual-Zone ASS subtitles.
  - **Custom Formats:** Any combination of parameters configured via `examples/storyboards/universal_template.json`.

- **Multi-Channel Co-Existence:**
  The VideoGen engine actively produces and automates uploads for multiple independent channels concurrently:
  1. **Primary Vertical Channel (Shorts 9:16):** World exploration, science mysteries, and breathtaking phenomena (Preset A 9:16 Shorts).
  2. **Secondary Widescreen Channel (Explainer 16:9):** History, human curiosity, and educational storytelling via hand-drawn stickman animations (Preset C 16:9 Ink Explainer format).
  - Target channel is resolved automatically via storyboard `"youtube": { "channel": "${CHANNEL_ALIAS_OR_ID}" }` or CLI `./videogen upload <sb> --channel <id_or_alias>`. Custom channel alias mapping can be defined locally in gitignored `.env` (`YOUTUBE_CHANNELS_JSON='{"alias":"CHANNEL_ID"}'`).

---

## 2. System Architecture & Directory Structure
```
projects/VideoGen/
├── AGENTS.md                 # Agent instructions (this file — self-contained guide)
├── README.md                 # Public project overview
├── WORKFLOW.md               # Detailed end-to-end operational guide
├── videogen                  # Unified Central CLI Orchestrator (v2.0)
├── engine/                   # Modular Engine Core
│   ├── config.js             # Paths, host IP, Windows path translation, channel resolution
│   ├── cdp.js                # Unified CDP WebSocket & HTTP client
│   ├── bridge.js             # Windows Chrome & proxy verification
│   ├── cdp_proxy.js          # TCP proxy on Windows (forwarding 9223 -> 9222)
│   ├── flow.js               # Google Flow automation (settings, chips, prompt, dl)
│   ├── tts.js                # Multi-engine TTS coordinator (VieNeu, Kokoro, ElevenLabs)
│   ├── vieneu_engine.py      # Local VieNeu-TTS v3 Turbo neural engine (48 kHz, Vietnamese)
│   ├── kokoro_engine.py      # Local Kokoro-82M neural engine (English, Puck-Adam blend, studio EQ)
│   ├── subtitles.js          # Subtitle generator (Dual-Zone ASS & Shorts ASS)
│   ├── compositor.js         # FFmpeg concatenation, Ken Burns motion stills, audio mixing
│   ├── archive.js            # External drive archival & working tree cleanup
│   ├── youtube.js            # YouTube Studio uploader module
│   ├── youtube_uploader.js   # CDP script for YouTube Studio UI upload (multi-channel support)
│   ├── facebook_uploader.js  # CDP script for Meta Business Suite (Facebook Reels)
│   └── tiktok_uploader.js    # CDP script for TikTok Studio upload
├── examples/
│   └── storyboards/          # Universal declarative template
│       └── universal_template.json # Generic schema template with format-agnostic placeholders
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
- In WSL/Linux environments, ensure Chrome shortcut on Windows Desktop or `CHROME_SHORTCUT_PATH` is configured.

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

VideoGen supports three distinct TTS engines configured via `voice.provider` (or `tts_provider`) in the storyboard JSON:
1. `vieneu`: Local VieNeu-TTS v3 Turbo 48kHz (Vietnamese, GPU/CPU CUDA, 0 cost).
2. `kokoro`: Local Kokoro-82M neural engine (English, GPU/CPU CUDA, 0 cost).
3. `elevenlabs`: Cloud CDP synthesis for multi-language global voice acting.

#### A. VieNeu-TTS v3 Turbo Rules for Studio-Grade Quality
When generating voice via `./videogen voice <storyboard.json>` with `voice.provider: "vieneu"`:
1. **Low Sampling Temperature (0.4 – 0.5):** Default temperature (0.8) causes phonetic slurring and consonant lisping. Lowering temperature to **`0.4`** produces crisp, authoritative, clear consonants and steady pitch cadence.
2. **Disable Watermark (`apply_watermark = False`):** Disabling the copyright audio watermark removes high-frequency sizzling artifacts from sibilant sounds ("s", "x", "ch", "tr").
3. **Phonetic Transliteration for Loanwords:** Transliterate foreign geographical names and proper nouns into natural Vietnamese phonetics (e.g., "Ô-rê-gơn", "Tho", "ba-dan", "ki-lô-gam") so the model articulates clearly without swallowing syllables.
4. **Voice Presets:**
   - `Hải Đăng`: Natural conversational cadence, balanced tone.
   - `Thiện Minh`: Warm, deep, cinematic documentary narrator.
   - `Minh Đức`: Crisp, broadcast news anchor cadence.
5. **Channel Profiles:**
   - Pre-calibrated presets and voice cloning profiles are loaded dynamically from gitignored `assets/voice_profiles.json` (zero hardcoded channel branding in engine code).

#### B. Kokoro-82M Local English Voiceover Rules (Minimalist Explainer Series)
When generating voice via `./videogen voice <storyboard.json>` with `voice.provider: "kokoro"`:
1. **Voice Blending & Persona:** Uses custom tensor blend `puck_open_throat` = **80% `am_puck` + 20% `am_adam`**. This replicates the witty, curious, storytelling cadence of top explainer channels while keeping the throat resonance natural.
2. **Speed Scaling & Micro-Pauses:** Run at **1.12x speed** with punctuation pause compression. Clauses are linked tightly with micro-pauses of **0.12s – 0.18s**, and sentence transitions under **0.35s** to eliminate dead air.
3. **Studio De-Nasal EQ Chain:**
   - High-pass filter at **75 Hz** (removes mic rumble).
   - Narrow notch filter at **1350 Hz (-4.5 dB, Q=3.0)** (surgically removes Kokoro's boxy nasal congestion).
   - Gentle high-shelf presence boost at **7 kHz (+2.5 dB)** (restores studio air and intimacy).

#### C. Anti-Voice Doubling Rule (Strict MD5 Hash Check)
- **ElevenLabs History Latency Caveat:** ElevenLabs History API has a 2–5s indexing delay on newly generated audio. Fetching `/v1/history` immediately may return the audio of the *previous* shot, resulting in identical duplicate voice clips across consecutive shots.
- **Mitigation:**
  1. `engine/tts.js` stores `previousHistoryId` before generating and waits until `latestItem.history_item_id !== previousHistoryId` with matching text before downloading.
  2. `engine/compositor.js` enforces an MD5 assertion across all voice files before assembling; any duplicate hash halts the build immediately.

---

### 3.4. Visual Production (Google Flow & 2D Motion Stills)

#### A. Cinematic Video Generation (Omni 1.1 Flash)
- Operated via `./videogen render <storyboard.json> [shots...]`.
- Default model: **Omni 1.1 Flash** (15 credits per 10s clip; 4 shots = 60 credits).
- Aspect ratio: `9:16` for vertical (`crop_9_16`), `16:9` for widescreen (`crop_16_9`).
- **Cloud 1080p Super-Resolution:** Engine triggers cloud 1080p upscale and monitors progress via TypeSafe Jev (`browser-jev classify`). If cloud AI reports an error or rate-limit in 70ms, it falls back to 720p direct CDN download.

#### B. 2D Motion Stills Pipeline (Nano Banana Pro — 0 Credits / 100% Free)
For educational explainers (like Ink Explainer / hand-drawn minimalist style):
- **Model:** Google Flow Image Mode with 🍌 **Nano Banana Pro in 16:9** (1376×768 native high-resolution).
- **Zero Credit Cost:** Image generation consumes 0 Flow credits, enabling unlimited batch generation for long-form episodes (10–15 minutes).
- **Parallel CDP Queueing:** Prompts are injected into the ProseMirror editor and queued rapidly in parallel via CDP mouse clicks without waiting sequentially.
- **Art Style Specification:** Standardized on warm amber/ochre gradient backgrounds (`scene_demo_04`), primitive cave art accents, and bold comic contour lines.
- **Pacing Standard (Empirical Ink Explainer Law):** 
  - Each micro-shot lasts **1.5s – 2.5s** (maximum 3.0s). Never allow a static illustration to linger beyond 3 seconds.
  - Video cut frequency: **20 to 25 visual cuts per minute**, tightly synchronized with voiceover visual punchlines/keywords.
- **Automated Ken Burns Motion:** `./videogen assemble` automatically detects image inputs (`.png`/`.jpg`) and applies smooth camera moves (`zoom_in`, `pan_left`, `zoom_out`, `pan_right`) matching exact voiceover clip durations.

---

### 3.5. Master Video Assembly & Audio Mixing
- Operated via `./videogen assemble <storyboard.json>`.
- **Configurable Audio Mixing Bus:**
  - **Voice:** Configurable via `audio_mix.voice_volume` (default `1.0`).
  - **SFX (Flow Ambience / Foley):** Configurable via `audio_mix.sfx_volume` (default `0.25`).
  - **BGM (Background Music):** Configurable via `audio_mix.bgm_path` and `audio_mix.bgm_volume`.
  - **Strictly No BGM Rule for Minimalist Explainers:** When producing for hand-drawn explainer series (Ink Explainer style), set `"bgm_volume": 0` or `"bgm": "none"`. The engine automatically omits the background music track, delivering a pristine, intimate podcast-style voiceover with crisp sound effects.
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

## 4. Git Discipline & Automated Zero-Leak Security
1. **Automated Pre-Commit Guard:**
   - The repository enforces automated pre-commit scanning (`.githooks/pre-commit` & `.git/hooks/pre-commit`).
   - Any attempt to commit private YouTube Channel IDs (`UC...`), production channel aliases, personal names, or secret keys is blocked at the git level before the commit is written.
   - Run `./videogen doctor` before staging changes to verify `Zero Leak Audit` is green.
2. **Strict Separation of Code vs. Data:**
   - `storyboards/` and `assets/` are 100% gitignored. Never force-add files in these directories.
   - Private channel IDs, passwords, and custom paths must live exclusively in gitignored `.env` (e.g. `YOUTUBE_CHANNELS_JSON='{"alias":"UC..."}'`).
   - `engine/`, CLI `./videogen`, and documentation must remain 100% generic, reusable, and free of proprietary markers.
3. **Clean Engine Code Only:**
   - Any test or diagnostic script must use the `local_*.js` naming convention (gitignored).
   - Never add episode-specific or channel-specific logic into `engine/`.
4. **Branch & PR Hygiene:**
   - Work in an isolated branch or worktree (`fm/<task-id>`).
   - Do not push to remote or merge PRs without explicit confirmation.
   - Never include agent co-author trailers in commit messages.

---

## 5. Audit & Sync Directive for Agents
When reviewing or maintaining this repository:
1. **Code vs. Docs Parity:** Ensure any newly added engine CLI flags, config options, or uploader scripts are reflected in this file and `README.md`.
2. **Self-Contained Knowledge:** Ensure all rules, thresholds, and formulas are fully articulated here so any fresh agent session can operate with 100% autonomy without external memory.

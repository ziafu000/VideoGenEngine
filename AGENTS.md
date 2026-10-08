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
  - **Preset C — Minimalist Hand-Drawn Explainer (Widescreen 16:9 & Vertical 9:16):** `16:9` (or `9:16`), static micro-shot cuts via Google Flow Nano Banana Pro (0 credits, free), clause-locked semantic timing (**1.0s – 2.8s per cut**, average ~2.2s/cut, ~110–220 cuts per episode), **Pure Static Hard Cuts (Strictly 0 Ken Burns)**, F5-TTS local zero-shot English voice (profile: `f5-tts-latest`, speed standardized to **0.90x** with micro-pauses ~0.15s for slow, emotive, sarcastic wit delivery + Studio De-Nasal EQ chain), **STRICTLY NO BGM** (`bgm_volume: 0`). Automated transcript segmentation into semantic visual clauses via `./videogen explainer` with 5 cognitive visual strategies (`LITERAL`, `METAPHOR`, `TITLE_CARD`, `SPLIT_SCREEN`, `POSE_CHURN`). Authentic Ink Explainer art style ("Voice gì thị giác đó" — direct 1-to-1 visual correspondence to the spoken science/anatomy/metaphor). Rapid 1-pass assembly in ~0.5s via FFmpeg Concat Demuxer (`ffconcat version 1.0`).
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
│   ├── explainer.js          # Semantic clause segmenter & visual strategy explainer engine
│   ├── tts.js                # Multi-engine TTS coordinator (VieNeu, F5-TTS, ElevenLabs)
│   ├── vieneu_engine.py      # Local VieNeu-TTS v3 Turbo neural engine (48 kHz, Vietnamese)
│   ├── f5_engine.py          # Local F5-TTS zero-shot voice cloning engine (English, Studio Clone)
│   ├── subtitles.js          # Subtitle generator (Dual-Zone ASS & Shorts ASS)
│   ├── compositor.js         # FFmpeg concatenation, Ken Burns motion stills, audio mixing
│   ├── shorts.js             # Vertical 9:16 Shorts highlight extractor (Option B Cinematic Blur)
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
2. `f5-tts`: Local F5-TTS Zero-Shot Studio Clone (English, GPU CUDA, 0 cost, replaces Kokoro).
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

#### B. F5-TTS Local English Voiceover Rules (Minimalist Explainer Series)
When generating voice via `./videogen voice <storyboard.json>` with `voice.provider: "f5-tts"` (or `"f5"`):
1. **Zero-Shot Voice Cloning & Persona:**
   - Powered by F5-TTS DiT architecture with Vocos 24kHz vocoder.
   - Reference voice: `assets/voices/f5_tts_latest_ref.wav` (Voice: `f5-tts-latest`, punchy, clear articulation, keyword emphasis).
   - Reference text: `"Most of us never think twice about any of this. We eat when we're hungry, sleep when we're tired."`
2. **Speed Scaling & Dead-Silence Trimming:**
   - Standardized at **0.90x speed** for deliberate, emotive, dry sarcastic wit delivery (preventing hurried delivery and allowing dry humor and scientific concepts to sink in).
   - Micro-pauses (~0.15s) with 2-tier padding:
     * Intra-sentence clause padding: **0.08s (80ms)**.
     * Sentence-end breath pause: **0.22s (220ms)**.
     * Micro fade-in (**5ms**) / fade-out (**10ms**) to eliminate boundary clicks.
   - **Automatic Audio Duration Measurement:** `createExplainerStoryboard` in `engine/explainer.js` measures exact durations via `ffprobe` directly from generated F5-TTS audio clips (`voice_shot_001.mp3` ...) and sets `duration` dynamically, guaranteeing millisecond audio-video synchronization in FFmpeg.
3. **Broadcast Studio EQ Chain:**
   - High-pass filter at **70 Hz** (removes low-end sub rumble).
   - Warmth EQ at **250 Hz (+1.2 dB)** (adds chest resonance).
   - Presence clarity at **3500 Hz (+1.5 dB)** (crisp articulate voice).
   - High-shelf air at **10000 Hz (+2.0 dB)** (restores broadcast brilliance).
4. **Windows FFmpeg UNC Pathing in WSL2:**
   - In WSL2 environments where FFmpeg is linked to Windows `ffmpeg.exe`, all paths passed to `ffmpeg` and `ffprobe` must be converted to Windows UNC paths (`//wsl.localhost/Ubuntu-24.04/...`) via `config.toWinPath()`.

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
- **In-Browser Base64 Download via CDP:** Signed CDN URLs from Google Flow (`flow-content.google`) return 403 Forbidden when requested directly from external Node/curl due to active session cookie requirements. Image downloading is performed inside the Chrome session via CDP `evaluate()` executing `fetch(url)` and returning Base64 directly to Node.js buffers.
- **MD5 Deduplication Guard:** Google Flow sometimes generates an identical image when prompt variance is low. `engine/flow.js` hashes every downloaded image buffer (`crypto.createHash('md5')`) against `seenHashes` and automatically re-rolls if a collision is detected.
- **Anti-Watermark / Zero-Leak Guard:** Prompts strictly forbid 3D, CGI, realistic textures, and watermarks/logos via standardized negative prompts (`NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO WATERMARK, NO LOGO, NO BLURRY ARTIFACTS, NO STOCK PHOTO`). All frames must be free of intrusive external branding before master assembly.
- **Authentic Ink Explainer Art Style & Visual Grammar ("Voice Gì Thị Giác Đó"):**
  - **Core Philosophy:** Direct 1-to-1 visual correspondence between the spoken narration and on-screen educational illustrations. Never draw generic standing stickmen. If the narration discusses adrenal glands, lungs expanding, liver dumping glucose, a tachometer redlining at 200 BPM, flipping an SUV, or punching a bear, the image must literally and humorously illustrate that exact science, organ, feat, or metaphor with the stickman mascot.
  - **Character Anatomy:** Minimalist white stick figure mascot (`#ffffff`), round white head, bold clean black comic ink contours, solid white body and limbs, cartoon meme eyes, dynamic expressive body language.
  - **Infographics & Educational Overlays:** Fully embraces cutaway diagrams, anatomical cross-sections, pointer sticks, chalkboard formulas (`7 + 5 = ?`), tachometer speedometers, indicator arrows, dotted guide lines, and labeled props (e.g. `ADRENAL GLANDS`, `CLOSED` lock).
  - **Contextual Color Palettes (Calibrated to Benchmark @Inkexplainer96):**
    * *Dark Vignette (Signature Ink Explainer):* Deep charcoal slate watercolor wash vignette framing a bright circular warm spotlight halo in the center on subtle cream paper texture.
    * *Clean Diagram (Infographic / Chalkboard / Anatomy):* Stark clean cream-white parchment paper (`#fbf9f5`) with subtle texture, generous negative space, dotted guide lines, and indicator arrows.
    * *Prehistoric Savanna:* Warm apricot and terracotta watercolor wash arch with minimalist dry cracked earth ground line and delicate acacia silhouettes.
    * *Ice Age / Cold Threat:* Pale slate-blue watercolor wash vignette (`#a0c0d0`), black-and-white snowflake doodles, flat jagged white ice ground line.
    * *Modern Interior (Office, Bedroom, Living Room):* Muted olive and tan flat walls, horizontal wooden plank floorboards, minimalist black-line furniture.
    * *Clean Card (Punchline / Title Card):* Stark clean cream-white parchment paper with soft warm spotlight, 80%+ negative breathing space.
  - **Negative Prompt:**
    ```text
    NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO WATERMARK, NO LOGO, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
    ```
  - **Standardized Prompt Formula for Nano Banana Pro:**
    ```text
    An authentic Ink Explainer style 2D comic illustration. SCENE: [SCENE_DESCRIPTION]. CHARACTERS: Expressive minimalist white stickman mascot with round white head (#ffffff), solid white limbs, clean bold black comic ink contours, big expressive cartoon meme eyes, interacting directly with the scene. ENVIRONMENT: [SELECTED_PALETTE_BG]. STYLE: High-contrast educational graphic novel explainer, bold black ink line art, flat vibrant color accents on focal elements, clean paper texture, comic motion lines and indicator arrows. NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO WATERMARK, NO LOGO, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
    ```
- **CLI Workflow for Minimalist Explainers:**
  ```bash
  # 1. Generate storyboard from transcript with 1-to-1 visual clauses
  ./videogen explainer storyboards/transcript.txt --title="Episode Title" --series="series_name" --ep="ep01" --ratio=16:9 --out="storyboards/series_name_ep01.json"
  # 2. Render all static clause illustrations via Nano Banana Pro (0 credits)
  ./videogen render storyboards/series_name_ep01.json
  # 3. Synthesize F5-TTS English narration (speed: 0.90x) & measure exact durations
  ./videogen voice storyboards/series_name_ep01.json
  # 4. Ultrafast 1-pass FFmpeg concat demuxer assembly
  ./videogen assemble storyboards/series_name_ep01.json
  ```
- **Ultrafast 1-Pass Concat Demuxer:** `./videogen assemble` compiles all static cuts in ~0.5s via `compositor.assembleStaticCuts` using FFmpeg `ffconcat version 1.0` muxed directly with the master voiceover (`master_voice_tight.wav`), perfectly synchronized to 1080p Full HD.

---

### 3.5. Vertical 9:16 Shorts Extraction SOP (From 16:9 Master)
For converting high-performing 16:9 segments into viral vertical Shorts (`engine/shorts.js`):
1. **Option B — Cinematic Blur Overlay Canvas (1080×1920):**
   - Layer 0 (Background): Master video scaled to `1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5`.
   - Layer 1 (Foreground Center): Crisp 16:9 master video centered at `1080×608` with subtle drop shadow and gold separator accent lines (`#D4AF37`).
   - Layer 2 (Top Branding): High-contrast category Badge (Segoe UI 32px Bold) and Hook Title (Segoe UI 56px Bold) + Neon Accent (Segoe UI 64px Bold).
   - Layer 3 (Bottom Call-to-Action): CTA Button banner (Segoe UI 48px Bold) and CTA Subtitle (Segoe UI 40px Bold).
2. **Kinetic Subtitle Micro-Splitting (ASS Subtitles):**
   - Split subtitles into **1.2s – 1.8s micro-chunks** (3–5 words per chunk) matching spoken cadence verbatim.
   - Highlight key punch words in glowing yellow (`&H0000FFFF`).
   - Apply a clean **0.25s audio outro fade** (`afade=t=out:st=<dur-0.25>:d=0.25`) to eliminate audio spill from adjacent scenes.

---

### 3.6. Master Video Assembly & Audio Mixing
- Operated via `./videogen assemble <storyboard.json>`.
- **Configurable Audio Mixing Bus:**
  - **Voice:** Configurable via `audio_mix.voice_volume` (default `1.0`).
  - **SFX (Flow Ambience / Foley):** Configurable via `audio_mix.sfx_volume` (default `0.25`).
  - **BGM (Background Music):** Configurable via `audio_mix.bgm_path` and `audio_mix.bgm_volume`.
  - **Strictly No BGM Rule for Minimalist Explainers:** When producing for hand-drawn explainer series (Ink Explainer style), set `"bgm_volume": 0` or `"bgm": "none"`. The engine automatically omits the background music track, delivering a pristine, intimate podcast-style voiceover with crisp sound effects.
- **MD5 Integrity Assertion:** Verifies unique MD5 checksums for all video files and audio files before FFmpeg concatenation.

---

### 3.7. Multi-Platform Publishing & Scheduling SOP
- Operated via `./videogen upload <storyboard.json>`.
- **Publishing Order:** Always schedule **YouTube Studio first**, then **Meta Business Suite (Facebook Reels)**. Skip TikTok unless explicitly requested.
- **YouTube Daily Upload Quota & Verification Handling:**
  - New YouTube channels have a standard upload limit of ~3–10 videos per day. Reaching this limit triggers the dialog: *"Đã đạt giới hạn tải video lên hằng ngày"* (Daily upload limit reached).
  - Unlocking advanced limits requires Advanced Features verification (6-second video KYC or government ID) in YouTube Studio settings. If locked, schedule remaining videos after the 24-hour quota reset.
- **Navigation & Dialog Hygiene:**
  - Video upload pages retain dirty state; navigation triggers native Chrome `beforeunload` dialogs or platform "Discard changes?" modals.
  - Automation must listen to `Page.javascriptDialogOpening` and respond with `Page.handleJavaScriptDialog({ accept: true })` or click the platform Confirm/Leave buttons.
  - If a flow appears blocked, capture a screenshot via CDP (`Page.captureScreenshot`) for visual diagnosis instead of waiting for timeout.
- **YouTube Prechecks Warning Dialog Auto-Bypass:**
  - When uploading videos or batching uploads, YouTube Studio may not finish preliminary checks before the Save/Publish button (`#done-button`) is clicked. This triggers the modal `ytcp-prechecks-warning-dialog` ("Chúng tôi vẫn đang kiểm tra nội dung của bạn" / "We are still checking your content").
  - **Handling:** Automation in `engine/youtube_uploader.js` waits 3.5s after clicking `#done-button` to allow the modal to render in the DOM, then clicks `#secondary-action-button` ("Vẫn xuất bản" / "Publish anyway"). Without this step, the video remains trapped in the Draft state.
- **High-CTR Thumbnail SOP (Golden Typography & Visual Conflict):**
  - **Geometry:** `16:9` widescreen (1920×1080).
  - **Anchor Position:** Always anchor big typography in the **Top-Left corner** over dark slate or textured background for maximum contrast.
  - **The 2-Word Hook Formula:** Short punchline `[WHY / STILL / HOW] + [KEYWORD]` (e.g. `WHY WORK?`, `WHY TIRED?`, `ADRENALINE?`, `STILL BROKE?`).
  - **Typography:** Heavy non-serif font (Impact, Montserrat Black, Bangers), lemon yellow fill (`#FFE500`), thick black stroke (18–24px), deep drop shadow.
  - **Accents & Conflict:** White mascot head (`#ffffff`) with warm vibrant scene accents (red heart, yellow organs, orange fire, blue car) on dark textured paper. Must showcase an ironic visual conflict or scientific paradox.
- **Mobile Notification Integration:**
  - Instant dispatch notifications to the project operator are sent via the local notification bridge CLI: `~/.local/bin/zalo-notify "<message>"`.

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

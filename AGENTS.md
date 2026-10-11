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
  - **Preset C — Minimalist Hand-Drawn Explainer (Widescreen 16:9 & Vertical 9:16):** `16:9` (or `9:16`), static micro-shot cuts via Google Flow Nano Banana Pro (0 credits, free).
    * **Flexible 3-Tier Contextual Pacing Matrix (0.8s to 3.5s):** Avoids rigid uniform timing (which is exhausting), adapting visual rhythm dynamically to content complexity:
      1. *Tier 1 — High-Tempo / Gag / Micro-phrases / Opening Hook (~0.8s–1.2s, avg ~1.0s):* Rapid sequential visual pops (e.g. 4-second opening hook split across 4 images to capture attention from second 0).
      2. *Tier 2 — Standard Narrative Flow (~1.5s–2.0s):* Natural conversational visual cadence matching sentence progression.
      3. *Tier 3 — Complex Infographics / Anatomy / Deep Diagrams / Punchlines (~2.5s–3.5s):* Extended hold times providing cognitive breathing room to absorb detailed anatomical cross-sections, formulas, and visual punchlines.
    * **Multi-Image Semantic Clause Mapping:** A single voice clause/sentence (**2.5s – 4.5s**) is dynamically paired with **2–4 sequential static images** describing each micro-phrase in the spoken sentence (*"Voice reading to where the image pops up"*).
    * **Concrete Opening Hook Example:** Instead of holding 1 static image across a 4-second opening voice clip (which causes boredom and drop-off), that 4-second segment is dynamically paired with 4 high-tempo Tier 1 images (~1.0s each): e.g., `0–1s`: stickman enters puzzled -> `1–2s`: close-up insomnia eyes -> `2–3s`: sweating reaction -> `3–4s`: giant visual metaphor/diagram pops up, hooking viewer attention from second 0.
    * **100% Static Hard Cuts:** Pure static cuts via FFmpeg Concat Demuxer (`ffconcat version 1.0`) with **strictly 0 pan/zoom or Ken Burns latency**, rapid 1-pass assembly in ~0.5s.
    * **Voice & Audio:** Local F5-TTS zero-shot English voice (profile: `f5-tts-latest`, speed standardized to **0.90x** with micro-pauses ~0.15s for slow, emotive, sarcastic wit delivery + Studio De-Nasal EQ chain), **STRICTLY NO BGM** (`bgm_volume: 0`). Automated transcript segmentation into semantic visual clauses via `./videogen explainer` with 5 cognitive visual strategies (`LITERAL`, `METAPHOR`, `TITLE_CARD`, `SPLIT_SCREEN`, `POSE_CHURN`). Authentic Ink Explainer art style ("Voice gì thị giác đó" — direct 1-to-1 visual correspondence to the spoken science/anatomy/metaphor).
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
│   ├── board.js              # Director's visual review board generator (Lavish HTML & DaisyUI)
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

#### D. Visual Review & Human-in-the-Loop Inspection Gate (Mandatory Agent Rule)
- **Mandatory Board Generation:** Whenever an agent creates or modifies a storyboard JSON, it **MUST** generate and inspect the storyboard via `./videogen board <storyboard.json>` before triggering batch generation (`./videogen run` or `./videogen loop`).
- **Studio Cutting Room Architecture (`engine/board.js`):**
  - Generates `.lavish/board_<name>.html` and mirrors to `.lavish/director_board.html` (viewable via `lavish-axi` or direct browser).
  - **Single Warm Studio Palette (Zero AI-Slop):** Unified warm dark cutting room aesthetic (`#1c1917` body background, `#292524` cards/panels, `#44403c` tech borders, `#f59e0b` amber hover accents). Completely eliminates extraneous theme switchers and cold blue templates for focused editorial review.
  - **Enlarged Typography Hierarchy:** Spoken narration clauses boosted to **`16.5px` (font-semibold)** in warm cream `#fffbeb`; prompt blueprints rendered in **`13px` (font-mono)** in warm sand `#e2d6c3`; shot timecode headers in **`15px` (font-bold)** in warm amber `#fbbf24`.
  - **Centered Modal Lightbox:** Fixed overlay centered dead-center in the viewport (`fixed inset-0 z-50 flex items-center justify-center my-auto`), with clean backdrop blur, backdrop click / `Esc` to close, keyboard arrows (`←`/`→`) to navigate cuts, and `C` to copy prompts.
  - **Zero Full-Page Reloads & Hot-DOM In-Place Polling:** Full-page reloads (`location.reload()`) are strictly banned. Background poller tests pending shot cards via `new Image()` probes every 2.5s. As soon as a rendered PNG appears in `renders/<project>/`, the placeholder card transforms in-place to the rendered illustration, flips the status badge to `Ready`, and ticks the dynamic tab title `[X/315 · Y%]`.
  - **6 Cognitive Strategy Semantic Badges:** Visually color-coded across all cards: `HOOK` (rose), `METAPHOR` (purple), `POSE_CHURN` (amber/orange), `SPLIT_SCREEN` (emerald), `TITLE_CARD` (yellow), and `LITERAL` (warm amber).
  - **Syntax-Safe Metadata Map:** Shot data is encapsulated in a client-side map `const SHOTS_MAP = {...}`, and zoom click handlers use `openLightboxFor(this.dataset.shotId)` with `data-shot-id`, eliminating quote-escaping conflicts and runtime syntax crashes.
  - **Live Floating Status Pill:** A floating badge in the bottom-right corner (`🟢 Live Hot-Sync: X/Y ready`) displays real-time progress and includes an on/off toggle switch.
- **Inspection Checklist for Agents:**
  1. Verify visual pacing and density: Explainer calibrated to the flexible 3-tier contextual matrix (0.8s–1.2s high-tempo hooks/gags, 1.5s–2.0s standard narrative, 2.5s–3.5s complex diagrams/punchlines) with 2–4 sequential images per clause/sentence (2.5s–4.5s). Documentary calibrated to 36–39 words/10s shot.
  2. Confirm prompt cleanliness guardrails and negative prompt hygiene are present on every shot.
  3. Validate character chips (`@Character`) and visual strategies (`HOOK`, `LITERAL`, `METAPHOR`, `TITLE_CARD`, `SPLIT_SCREEN`, `POSE_CHURN`).
  4. Test single-shot re-rendering (`./videogen render <sb> <shot_id>`) for direct feedback iterations prior to full pipeline execution.

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
- **Automated Model Preflight & Lock (`ensureFlowSettings` in `engine/flow.js`):**
  - Prior to submitting prompts, `flow.js` automatically inspects the Flow settings trigger.
  - If settings drift, it automatically clicks the settings panel, switches mode to `Hình ảnh` (Image), selects `16:9` (`crop_16_9`), opens the model selector dropdown, clicks `Nano Banana Pro`, dismisses via ESC, and verifies.
  - Prevents Google Flow from drifting into Video mode or `Nano Banana 2.1/Lite` during unattended batch runs.
- **In-Browser Base64 Download via CDP:** Signed CDN URLs from Google Flow (`flow-content.google`) return 403 Forbidden when requested directly from external Node/curl due to active session cookie requirements. Image downloading is performed inside the Chrome session via CDP `evaluate()` executing `fetch(url)` and returning Base64 directly to Node.js buffers.
- **MD5 Deduplication Guard:** Google Flow sometimes generates an identical image when prompt variance is low. `engine/flow.js` hashes every downloaded image buffer (`crypto.createHash('md5')`) against `seenHashes` and automatically re-rolls if a collision is detected.
- **Prompt Hygiene Distinction (Crucial Rule):**
  - **Episode Video Shots:** MUST include `STRICTLY NO TITLE BANNER, NO TOP HEADER, NO "INK EXPLAINER" TEXT, NO "MINIMALIST" TEXT` to eliminate AI-generated header banners.
  - **Thumbnails:** MUST NOT include `NO TITLE BANNER` or `NO TOP HEADER` (which deletes the top hook text).
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
  - **Negative Prompt for Shots:**
    ```text
    STRICTLY NO TITLE BANNER, NO TOP HEADER, NO "INK EXPLAINER" TEXT, NO "MINIMALIST" TEXT, NO CHANNEL NAME, NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
    ```
  - **Standardized Prompt Formula for Nano Banana Pro:**
    ```text
    2D comic illustration of [SCENE_DESCRIPTION]. CHARACTERS: Expressive minimalist white stickman mascot with round white head (#ffffff), solid white limbs, clean bold black comic ink contours, big expressive cartoon meme eyes, interacting directly with the scene. ENVIRONMENT: [SELECTED_PALETTE_BG]. STYLE: High-contrast educational graphic novel illustration, bold black ink line art, flat vibrant color accents on focal elements, clean paper texture, comic motion lines and indicator arrows. STRICTLY NO TITLE BANNER, NO TOP HEADER, NO "INK EXPLAINER" TEXT, NO "MINIMALIST" TEXT, NO CHANNEL NAME, NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
    ```
- **Automated Multi-Image Semantic Clause Mapping (`applyMultiImagePacing` in `engine/explainer.js`):**
  Pacing avoids rigid uniform timing (which is exhausting), adapting dynamically to information density (0.8s to 3.5s). The engine hardcodes this logic automatically:
  1. **Opening 4-Second Golden Hook:** Mandatory 4 cuts (~1.0s each) across the first 4 seconds to capture viewer attention instantly from second 0. E.g.:
     * `0.0s – 1.0s`: Stickman enters frame with puzzled posture (`HOOK`).
     * `1.0s – 2.0s`: Extreme close-up of unblinking cartoon insomnia eyes (`HOOK`).
     * `2.0s – 3.0s`: Trembling panic reaction with exaggerated blue sweat drops (`HOOK`).
     * `3.0s – 4.0s`: Giant visual metaphor or chalkboard anatomy diagram pops up (`HOOK`).
  2. **Short Clauses (<= 1.8s) & Title Cards:** Preserved as snappy single cuts (~0.8s–1.8s).
  3. **Medium Clauses (> 1.8s and <= 3.2s):** Automatically split into 2 visual cuts (~0.9s–1.5s/cut: Action/Focal Setup + Reaction/Punchline via `POSE_CHURN`).
  4. **Long Clauses (> 3.2s):** Automatically split into 3 visual cuts (~1.0s–1.4s/cut: Setup Context + Key Action/Metaphor + Consequence/Meme Reaction).
  - **70% Fast Velocity Guarantee:** Guarantees ~70% fast cuts (<= 1.5s) on any transcript automatically.
  - **100% Static Hard Cuts:** Pure static cuts via FFmpeg concat demuxer (`ffconcat version 1.0`) with **zero pan/zoom or Ken Burns latency**, keeping pacing razor-sharp and rendering in < 2 seconds.
- **CLI Workflow for Minimalist Explainers:**
  ```bash
  # 1. Generate storyboard from transcript with automated multi-image clause mapping
  ./videogen explainer storyboards/transcript.txt --title="Episode Title" --series="series_name" --ep="ep01" --ratio=16:9 --out="storyboards/series_name_ep01.json"
  # 2. Render all static clause illustrations via Nano Banana Pro (0 credits, auto-locked)
  ./videogen render storyboards/series_name_ep01.json
  # 3. Synthesize F5-TTS English narration (speed: 0.90x) & measure exact durations
  ./videogen voice storyboards/series_name_ep01.json
  # 4. Ultrafast 1-pass FFmpeg concat demuxer assembly
  ./videogen assemble storyboards/series_name_ep01.json
  ```
- **Ultrafast 1-Pass Concat Demuxer:** `./videogen assemble` compiles all static cuts in ~0.5s via `compositor.assembleStaticCuts` using FFmpeg `ffconcat version 1.0` muxed directly with the master voiceover (`master_voice.wav`), perfectly synchronized to 1080p Full HD.

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
- **Dual Assembly Architecture (Static Cuts vs. Video Clips):**
  - **Static Hard Cuts (Explainer Series):** Assembled via `compositor.assembleStaticCuts` using FFmpeg Concat Demuxer (`ffconcat version 1.0`). Instant 0.5s assembly, zero pan/zoom or Ken Burns latency, perfectly synchronized with master voiceover.
  - **Google Flow Video Concat (Anti-Frozen-Video Concat Filter):** When stitching video clips generated by Google Flow, **FFmpeg Concat Demuxer (`-c copy`) is strictly banned**. Flow clips possess variable containers and timebases (`mp42 90k tbn` vs `isom 12288 tbn`); copying streams causes Non-monotonic DTS packet drops, freezing the video at shot 1 while audio continues. `engine/compositor.js` enforces **FFmpeg Concat Filter** (`filter_complex "...concat=n=X:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 17 -c:a aac`) to decode frames and resynchronize Presentation Timestamps (PTS) to a unified timebase, eliminating frozen frames forever.
- **Configurable Audio Mixing Bus:**
  - **Voice:** Configurable via `audio_mix.voice_volume` (default `1.0`).
  - **SFX (Flow Ambience / Foley):** Configurable via `audio_mix.sfx_volume` (default `0.25`).
  - **BGM (Background Music):** Configurable via `audio_mix.bgm_path` and `audio_mix.bgm_volume`.
  - **Strictly No BGM Rule for Minimalist Explainers:** When producing for hand-drawn explainer series (Ink Explainer style), set `"bgm_volume": 0` or `"bgm": "none"`. The engine automatically omits the background music track, delivering a pristine, intimate podcast-style voiceover with crisp sound effects.
- **MD5 Integrity Assertion:** Verifies unique MD5 checksums for all video files and audio files before FFmpeg concatenation to prevent duplicate cuts or repeated voice lines.

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
- **High-CTR Thumbnail SOP (Golden Hook Typography & Visual Paradox):**
  - **Geometry:** `16:9` widescreen (1920×1080 / 1376×768 native Flow).
  - **Top Golden Hook Text:** One single line of giant, massive hook text anchored at the very top edge, bright golden-yellow (`#FFE500`), thick black comic outline, dynamic tilt. E.g. `ADRENALINE?`, `WHY TIRED?`, `WIZARDS?`.
  - **Two-Sided Visual Paradox (Extreme Contrast):**
    * *Left Side (Superhuman Feat):* Stickman one-hand lifting a giant SUV (`RUMBLE`), bending a steel girder, or radiating cosmic aura.
    * *Right Side (Derpy Logic Fail):* Stickman with cartoon meme sweat drops, insomnia eyes, staring helplessly at a childish puzzle `7 + 5 = ?` with red `???` and brain turned into a question mark.
  - **Prompt Hygiene Distinction for Thumbnails:**
    * NEVER add `NO TITLE BANNER` or `NO TOP HEADER` to thumbnail prompts (which would eliminate the top hook text).
    * Standardized Thumbnail Prompt:
      ```text
      A high-contrast 2D comic YouTube thumbnail. SCENE: At the very top, one single line of giant, massive comic hook text in bold bright golden-yellow typography with thick black outlines reads exactly: "[HOOK]?". Below the text, on the left, [EXTREME_FEAT]. On the right, [DERPY_LOGIC_FAIL]. ENVIRONMENT: Warm apricot and terracotta gradient watercolor wash vignette on subtle cream parchment paper, educational indicator arrows. STYLE: High-contrast educational graphic novel illustration, bold black ink line art, flat vibrant color accents, clean paper texture. STRICTLY NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM.
      ```
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

# VideoGen: Automated Video Production Workflow

Production-grade automated system for creating cinema-quality faceless YouTube Shorts, explainer videos, and story-driven animated series using **Google Flow** (Google Omni 1.1 / Veo 3.1), **VieNeu-TTS v3 Turbo** (local 48 kHz neural TTS), and **ElevenLabs** via browser automation (0 API token cost).

> **IP Protection Notice:** This workflow is a generic engine guide. All series-specific storyboards, character names, voice calibrations, and plotlines are stored privately in each user's `storyboards/` directory (gitignored) and are never part of this public repository.

---

## 1. System Components & Architecture

### 1.1. Visual & Sound Effects Engine (Google Flow)
- Operated via Chrome DevTools Protocol (CDP) through Windows Chrome profile `AutomationProfile`.
- Uses **Omni 1.1 Flash** (10-second clips, Cloud AI 1080p Full HD upscale & download).
- Generates natural ambient SFX embedded in the video stream.

### 1.2. Multi-Engine Voiceover Architecture
VideoGen supports three high-performance voice generation engines:
- **Mode A (Local Neural TTS — Vietnamese):** Powered by **VieNeu-TTS v3 Turbo** (`engine/vieneu_engine.py`), synthesizing **48 kHz studio-grade** voiceover directly on local GPU/CPU in ~3.5s per shot. Zero API tokens, zero credit consumption.
  - **Temperature Tuning:** Set sampling temperature to **`0.4`–`0.5`** (default 0.8 causes slurring/lisping; lowering ensures sharp, crisp consonant articulation).
  - **Watermark Off:** Set `apply_watermark = False` to eliminate high-frequency sizzling artifacts from sibilant sounds.
  - **Phonetic Transliteration:** Transliterate foreign proper nouns/locations into natural Vietnamese phonetics (e.g. "Ô-rê-gơn", "Tho", "ba-dan", "ki-lô-gam").
  - **Presets & Profiles:** Presets "Hải Đăng" (conversational natural), "Thiện Minh" (warm documentary narrator), and "Minh Đức" (broadcast news). Custom profiles loaded dynamically from gitignored `assets/voice_profiles.json`.
- **Mode B (Local Neural TTS — English Zero-Shot Clone):** Powered by **F5-TTS** (`engine/f5_engine.py`), synthesizing **broadcast studio-grade** English narration via zero-shot voice cloning directly on local CUDA GPU. Zero API tokens, 100% free offline.
  - **Zero-Shot Voice Cloning & Persona:**
    * Clone reference: `assets/voices/f5_tts_latest_ref.wav` (Voice: `f5-tts-latest`, articulate, punchy, dynamic inflection, keyword emphasis).
    * Model architecture: F5-TTS DiT with Vocos 24 kHz vocoder.
  - **Dead-Silence Trimming:** Automatically trims trailing silence down to 2-tier natural pauses:
    * Intra-sentence clause padding: **0.08s (80ms)**.
    * Sentence-end breath pause: **0.22s (220ms)**.
    * Micro fade-in (**5ms**) / fade-out (**10ms**) to eliminate boundary clicks.
  - **Broadcast Studio EQ Chain:** High-pass filter at **70 Hz**, warmth EQ at **250 Hz (+1.2 dB)**, presence clarity at **3.5 kHz (+1.5 dB)**, and high-shelf air at **10 kHz (+2.0 dB)**.
  - **Windows FFmpeg UNC Pathing:** Automatically resolves paths to `//wsl.localhost/Ubuntu-24.04/...` via `config.toWinPath()` for Windows `ffmpeg.exe` compatibility.
- **Mode C (Browser CDP):** Operated via CDP directly on the active ElevenLabs Text-to-Speech tab (`engine/tts.js`). Auto-downloads MP3 files to `audio/<project_id>/`.
  - **Anti-Voice Doubling Assertion:** Guarded against ElevenLabs History API 2–5s indexing delays via `previousHistoryId` checks and strict MD5 checksum assertions in `engine/compositor.js`.

### 1.3. Post-Production, Motion Stills & Audio Mixing (FFmpeg)
- Stitches all scenes sequentially into a master video (`engine/compositor.js`).
- **2D Static Hard Cuts (Pure Ink Explainer Aesthetic):** For educational explainer animations, the engine assembles static illustrations using crisp hard cuts (0 Ken Burns pan/zoom) via FFmpeg `ffconcat version 1.0` demuxer, matching exact voiceover clip durations. (Ken Burns motion remains available as an opt-in flag for documentary still photo sequences).
- Dynamically scales voiceover speed (`atempo`) or aligns voice onset delay (`adelay`).
- Balances audio levels: Voiceover at 100% volume, background ambient SFX at 20–25% volume, background music (BGM) at 12–15% volume.
- **Strictly No BGM Rule (Minimalist Explainer Series):** For hand-drawn explainer animations (Ink Explainer style), set `"bgm_volume": 0` or `"bgm": "none"`. The BGM track is completely omitted, leaving a pure, intimate monologue with punchy SFX.
- Performs mandatory MD5 checksum verification across all video and audio clips to prevent duplicate shots or repeated voices.

### 1.4. System One AI Decider (TypeSafe Jev)
- Powered by `browser-jev` CLI / python module `browser_jev` connecting to TypeSafe API (`jev-latest`).
- **Pre-flight Prompt Screening:** Uses `noul` primitive to evaluate policy risk before prompt submission.
- **Fast-Fail Early Detection:** Uses `choice` primitive to detect Google Flow policy refusal in 5–10s instead of hanging 180–240s.
- **Cloud 1080p Monitoring:** Uses `classify` primitive to detect upscale queue errors in ~70ms and trigger immediate 720p fallback.
- **TTS Error Detection:** Detects ElevenLabs quota exhaustion or synthesis failure within ~3s.

---

## 2. Environment Setup & Browser Bridge

To bypass Cloudflare / Google bot protections, the system attaches to the user's authentic Windows Chrome browser via remote debugging.

### 2.1. Port Architecture
- **Windows Chrome:** Launched with `--remote-debugging-port=9222` and profile at `C:\Users\<YourUser>\AppData\Local\Google\Chrome\AutomationProfile`.
- **CDP Proxy (`engine/cdp_proxy.js`):** Node.js TCP bridge on Windows forwarding `0.0.0.0:9223` -> `127.0.0.1:9222`.
- **WSL Client:** Accesses CDP at `http://$WIN_HOST:9223` using `chrome-devtools-axi` or `engine/cdp.js`.

### 2.2. Starting the Bridge
```bash
./videogen bridge
```
Runs automatically at session start or whenever a browser disconnect is detected.

---

## 3. ⚠️ Resolution Mode Selection (REQUIRED at Every Render Session)

**Before executing any render workflow, the agent MUST ask the user to choose their download resolution for this session.** Never silently default to either mode.

```
Which download resolution do you want for this render session?

  [1] 🎬 1080p Full HD  (Cloud AI Super-Resolution)
      Quality:   1920×1080, ~8.4 Mbps per clip — highest visual fidelity.
      Mechanism: Google Cloud queues each clip for AI upscaling after generation.
      ⚠️  Risk: Dependent on Google's cloud queue. Can crash or time out if:
          - The cloud queue is overloaded or rate-limited.
          - The browser session loses connection mid-upscale.
          - The Windows Chrome process is interrupted.
          Engine has automatic 70ms Jev-monitored safe fallback to 720p on error.
      Command:   ./videogen render <storyboard.json>  (default)

  [2] ⚡ 720p  (Direct CDN Download)
      Quality:   1280×720, ~3–4 Mbps per clip — fast and perfectly stable.
      Mechanism: Pulls directly from Google's signed CDN URL (~0.8s per clip).
      ✅ Zero cloud dependency. Recommended for draft previews or fast iterations.
      Command:   ./videogen render <storyboard.json> --720p

Enter 1 for 1080p or 2 for 720p:
```

Propagate the user's selection:
- **1080p selected:** use `./videogen render <sb>` or `./videogen run <sb>`.
- **720p selected:** use `./videogen render <sb> --720p` or `./videogen run <sb> --720p`.

---

## 4. Storyboard Specification (SSOT)

The storyboard JSON file is the **Single Source of Truth** (SSOT) for every production. Create it in your private `storyboards/<project_id>.json`:

```json
{
  "project": {
    "id": "my_series_ep01",
    "title": "My Series — Episode 1: The Beginning",
    "series": "My Original Series",
    "aspect_ratio": "16:9",
    "model": "Omni 1.1 Flash",
    "duration_per_clip": 10
  },
  "voice_profiles": {
    "Hero": {
      "voice": "YourChosenVoiceModel",
      "speed": 1.0,
      "stability": 40,
      "similarity": 80,
      "style": 15
    },
    "Narrator": {
      "voice": "YourNarratorVoiceModel",
      "speed": 0.95,
      "stability": 85,
      "similarity": 85,
      "style": 0
    }
  },
  "shots": [
    {
      "id": "shot_01",
      "characters": ["Hero"],
      "dialogue_tier": "A",
      "speaker": "Hero",
      "dialogue_vi": "Character dialogue or narration text here.",
      "prompt": "Widescreen 16:9 cinematic tracking shot: ... AUDIO: SFX ONLY — ambient sounds. NO MUSIC."
    }
  ]
}
```

**Storyboard JSON fields reference:**

| Field | Description |
| :--- | :--- |
| `project.aspect_ratio` | `"16:9"` for series/long-form, `"9:16"` for Shorts |
| `project.model` | `"Omni 1.1 Flash"` (default) or `"Veo 3.1"` variants |
| `project.resolution` | Optional: `"1080p"` or `"720p"` — overrides CLI flag if set |
| `voice_profiles` | Map of character name → ElevenLabs slider calibration presets |
| `shots[].characters` | Array of character names to attach as `@Character` chips |
| `shots[].dialogue_tier` | `"A"` = bottom-center subtitle, `"B"` = top-center HUD subtitle |
| `shots[].prompt` | Full Google Flow prompt (follow `skills/omni-video-prompts.md`) |

---

## 5. VideoGen Unified Engine v2.0 & CLI Reference (`./videogen`)

| Command | Function | Description |
| :--- | :--- | :--- |
| `./videogen bridge [status]` | Bridge Health | Auto-starts Windows Chrome & CDP proxy; verifies tab connections. |
| `./videogen render <sb> [shots...] [--720p]` | Render Google Flow | Configures settings, attaches `@Character` chips, runs Jev pre-flight, renders, downloads 1080p (or `--720p`). |
| `./videogen voice <sb> [shots...]` | Voiceover ElevenLabs | Reads `voice_profiles`, auto-calibrates Radix UI sliders, downloads MP3s. |
| `./videogen subs <sb>` | Subtitle Generation | Generates cinema Dual-Zone ASS (Mode 2) or Bouncy Neon (Shorts). |
| `./videogen assemble <sb>` | Post-Production | Stitches clips, pads audio, mixes multi-track, burns hardsubs. |
| `./videogen verify <video> [ts...]` | Visual QA | Extracts keyframes at specified timestamps for quality inspection. |
| `./videogen thumb <sb> [prompt]` | Thumbnails | Generates 4 cinematic 16:9 thumbnails, upscales to 1080p. |
| `./videogen archive <sb>` | Archival | Migrates materials to `DEST_ORIGINAL`, master to `DEST_FINAL`, purges temp dirs. |
| `./videogen upload <sb>` | YouTube Upload | Uploads master video to YouTube Studio as Unlisted via CDP. |
| `./videogen facebook <sb> [video] [--draft]` | Facebook Reels Upload | Uploads 9:16 Shorts to Facebook Reels via Chrome CDP (Publish or Draft). |
| **`./videogen run <sb> [--720p]`** | **Full A→Z Pipeline** | **Executes the complete autonomous pipeline end-to-end.** |

---

## 6. End-to-End Production Checklist (v2.0)

1. **Prepare Storyboard (Director):** Author `storyboards/<project>.json` following the SSOT schema above.
2. **Select Resolution Mode:** Agent asks user for 1080p or 720p preference (see Section 3 above).
3. **Execute Automated Production (Worker):**
   - Single command (full pipeline):
     ```bash
     ./videogen run storyboards/<project>.json           # 1080p (default)
     ./videogen run storyboards/<project>.json --720p    # 720p draft mode
     ```
   - Or step-by-step for fine control:
     ```bash
     ./videogen bridge
     ./videogen render storyboards/<project>.json [--720p]
     ./videogen voice storyboards/<project>.json
     ./videogen subs storyboards/<project>.json
     ./videogen assemble storyboards/<project>.json
     ./videogen verify output/<project>/<master>.mp4
     ./videogen archive storyboards/<project>.json
     ./videogen upload storyboards/<project>.json
     ```

---

## 7. The 6-Dimensional Parameter Matrix (Universal Declarative Architecture)

VideoGen is a **zero-hardcoding, parameter-driven video production engine**. Rather than locking users into rigid formats, any video format—across any genre, aspect ratio, duration, or platform—is defined by declaring values across 6 orthogonal parameter dimensions in the storyboard JSON:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   UNIVERSAL PARAMETER MATRIX (6D)                      │
├────────────────────────────────────────────────────────────────────────┤
│ 1. GEOMETRY    : aspect_ratio ("9:16" | "16:9" | "1:1") · resolution  │
│ 2. TIMELINE    : shots_count (N) · duration_per_shot (4s, 6s, 8s, 10s) │
│ 3. VOICE       : provider (vieneu | elevenlabs) · wps density · temp   │
│ 4. VISUALS     : model (omni_flash | veo) · character chips · guards   │
│ 5. SUBTITLES   : hardsub (true | false) · style (clean | bouncy | dual)│
│ 6. AUDIO MIX   : 3-bus volume balance (voice, ambient sfx, bgm)        │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.1. Dimension 1: Geometry
- `aspect_ratio`: `"9:16"` (Shorts, Reels, TikTok) or `"16:9"` (Standard YouTube, cinema widescreen), `"1:1"` (square feeds).
- `resolution`: `"1080p"` (native upscale via Google Cloud Super-Resolution) or `"720p"` (direct CDN download).

### 7.2. Dimension 2: Timeline & Pacing
- `shots_count`: Number of distinct visual scenes (e.g. 3, 4, 6, 30).
- `duration_per_shot_sec`: Native duration in Google Flow (`4`, `6`, `8`, or `10` seconds).
- `total_duration_sec`: `shots_count × duration_per_shot_sec`. Control internal scene pacing using Timeline Prompting (2–3 micro-scenes per clip).

### 7.3. Dimension 3: Voice & Pacing Calibration
- `provider`: `"vieneu"` (local 48 kHz neural TTS, Vietnamese), `"f5-tts"` (local zero-shot studio clone, English), or `"elevenlabs"` (browser CDP).
- `target_density_wps`: Words-per-second speech density:
  - **Documentary Narrative Pacing:** ~3.8–4.0 wps. For a 10s shot, write exactly **36–39 words** (~8.5s–9.5s audio duration) to naturally fill the cut without dead air.
  - **Hand-Drawn Explainer Pacing (Ink Explainer):** ~2.6–3.0 wps. Rapid-fire narration with micro-pauses (0.12–0.18s) matching micro-shots of **1.5s – 2.5s**.
  - **Rapid Social Explainer Pacing:** ~2.75–3.0 wps. Approximately 80–85 words per 30 seconds.
- `settings`:
  - `temperature`: `0.4`–`0.5` (prevents slurring and consonant lisping in VieNeu).
  - `watermark`: `false` (eliminates high-frequency sibilant sizzle).
  - `voice_id` / `profile`: e.g. `"documentary"` (VieNeu Hải Đăng/Thiện Minh) or `"f5-tts-latest"` (F5-TTS Studio Clone at 0.90x speed).

### 7.4. Dimension 4: Visuals & Guardrails
- `model`: `"omni_flash"` (Omni 1.1 Flash, 15 credits / 10s clip) or `"veo"` (Veo 3.1).
- `characters`: Array of character chips (e.g. `["@CharacterName"]`).
  - **Zero Physical Descriptor Rule:** When chips are attached, prompt text must omit physical appearance and focus exclusively on action, camera, lighting, and sound.
- `negative_prompt_guard`: Prompts must terminate with:
  `AUDIO: SFX ONLY. STRICTLY NO VOICE. NO SPEECH. NO DIALOGUE. CLEAN FOOTAGE ONLY. STRICTLY NO ON-SCREEN TEXT. NO SUBTITLES. NO CAPTIONS.`

### 7.5. Dimension 5: Subtitles & Typography
- `enabled`: `false` for clean footage without burned-in text; `true` for hardsubbed output.
- `style`:
  - `"clean"`: No subtitles burned (`hardsub: false`).
  - `"bouncy_neon"`: Animated yellow-neon micro-chunks (2–3 words/chunk) for high-retention vertical Shorts.
  - `"dual_zone_cinema"`: Advanced 2-tier typography (Tier A bottom white dialogue 34px + Tier B top cyan tech HUD 28px).

### 7.6. Dimension 6: Audio Mixing Bus
Three-channel independent volume matrix:
- `voice_volume`: 0.0 – 1.0 (default `1.0`).
- `sfx_volume`: 0.0 – 1.0 (default `0.20`–`0.25`).
- `bgm_path`: Path to background music (e.g. `assets/bgm.mp3`).
- `bgm_volume`: 0.0 – 1.0 (default `0.12`–`0.15`, with automatic 2s fade-out at end).

---

## 8. Reference Presets, Production Recipes & Dual Channels

The repository maintains **only one universal declarative template** (`examples/storyboards/universal_template.json`) using format-agnostic `${...}` placeholders. The 4 canonical production recipes below are instantiated purely by filling those parameters:

### 8.1. Multi-Channel Coexistence Overview
VideoGen powers multiple independent production channels running in parallel:
1. **Vertical Shorts Channel:** World exploration, science mysteries, and natural wonders (Recipe 8.2 — 9:16 Shorts, Omni 1.1 video, VieNeu-TTS Vietnamese voice, BGM).
2. **Widescreen Explainer Channel:** History, human curiosity, and educational storytelling via hand-drawn stickman animations (Recipe 8.4 / 8.6 — 16:9 2D Motion Stills, Nano Banana Pro, F5-TTS English voice at 0.90x, Strictly NO BGM).

---

### 8.2. Recipe 1: Clean Documentary Shorts (40s Clean Master — Vertical 9:16)
- **Geometry:** `9:16` vertical, `1080p` Cloud Super-Resolution (or `720p` Direct CDN).
- **Timeline:** 4 shots × 10s = 40s (60 Google Flow credits).
- **Visuals:** Model `Omni 1.1 Flash` via Google Flow.
- **Voice:** Provider `vieneu`, profile `documentary`, 36–39 words/shot (~3.8 wps), temperature `0.4`, watermark `false`.
- **Subtitles:** `hardsub: false` (100% clean footage, zero on-screen text).
- **Audio Mix:** Voice 100%, Ambient SFX 25%, BGM 15%.
- **Publishing:** YouTube Studio (Vertical Channel) + Meta Business Suite (Facebook Reels).

### 8.3. Recipe 2: Kinetic Explainer Shorts (30s–60s)
- **Geometry:** `9:16` vertical.
- **Timeline:** 3–6 shots × 10s.
- **Visuals:** High-contrast AI video with action cues.
- **Voice:** Rapid pacing (~3.0 wps).
- **Subtitles:** `hardsub: true`, style `bouncy_neon` (animated yellow-neon micro-chunks).
- **Audio Mix:** Voice 100%, SFX 30%, BGM 12%.

### 8.4. Recipe 3: Minimalist Hand-Drawn Explainer (16:9 Static Micro-Shot Cuts)
- **Geometry:** `16:9` widescreen, 1920×1080 Full HD.
- **Timeline:** Dynamic micro-shots of **1.0s – 2.8s** (average ~2.5s per cut, clause-locked semantic timing, ~110–220 cuts for a 5-minute video) tightly synchronized with voiceover punchlines, lists, and dialogue beats.
- **Visuals:** Google Flow Image Mode with 🍌 **Nano Banana Pro in 16:9** (0 credits consumed, 100% free, unlimited batch capacity). In-browser Base64 fetch via Chrome CDP, MD5 deduplication guard against Flow duplicate image generation, and Tesseract OCR screening to ensure 0% watermark/channel text leaks. Authentic Ink Explainer aesthetic: pure white round cartoon head (`#ffffff`), bold clean black ink contours, expressive meme eyes, and contextual color palettes (dark olive/charcoal for night & danger, pale ice-blue for cold, clean cream parchment for everyday diagrams, warm indoors for modern scenes).
- **Motion:** Pure Static Hard Cuts (0 Ken Burns camera motion) for maximum visual punch and authentic comic-book pacing.
- **Voice & Rhythm Standardization (Snappy Explainer Pacing):** Provider `f5-tts` (or `f5`), voice `f5-tts-latest`, speed `1.0`.
  * **Mandatory Dead-Silence Trimming:** Engine strictly strips dead silence with 2-tier micro-pauses.
  * **2-Tier Micro-Pauses:** 
    - **Intra-sentence clause padding:** Exactly **0.08s (80ms)** between comma/semicolon/dash clauses.
    - **Sentence-end pause:** Exactly **0.22s (220ms)** for terminal punctuation (`.`, `?`, `!`, `...`).
    - **Boundary click suppression:** 5ms linear fade-in and 10ms linear fade-out applied to all voice slices.
  * **Pacing Result:** A ~930-word 5-act explainer compresses into an energetic ~4m30s–4m45s runtime with continuous narrative momentum.
  * **Batch synthesis:** Accelerated batch pipeline (`--batch-json`) synthesizes entire episodes in a single GPU pass.
- **Subtitles:** Optional / clean footage.
- **Audio Mix:** Voice 100%, Foley SFX (pops, whooshes, rock taps), **STRICTLY NO BGM** (`bgm_volume: 0`).
- **Assembly:** Rapid 1-pass FFmpeg Concat Demuxer (`ffconcat version 1.0`) in ~0.5s via `./videogen assemble`.
- **Publishing:** YouTube Studio (Widescreen Channel).

### 8.5. Recipe 4: Story-Driven Cinematic Series (16:9 Widescreen)
- **Geometry:** `16:9` widescreen.
- **Timeline:** Multi-shot timeline (e.g. 30 shots × 10s = 5 minutes).
- **Visuals:** Character asset consistency via `@Character` chips.
- **Voice:** Multi-voice casting via ElevenLabs or local profiles.
- **Subtitles:** `hardsub: true`, style `dual_zone_cinema` (Tier A bottom white dialogue 34px + Tier B top cyan tech HUD 28px).
- **Audio Mix:** Voice 100%, Ambient SFX 25%, BGM 15%.

---

### 8.6. Recipe 5: Minimalist Explainer Production Workflow (Authentic Ink Explainer / Before Civilization Style)
- **Geometry:** `16:9` widescreen (1920×1080).
- **Engine:** Google Flow 🍌 **Nano Banana Pro** (Image mode, 0 Flow credits, 100% free).
- **Pacing:** `static_cuts` (Strictly 0 Ken Burns motion, 1-pass FFmpeg demuxer assembly in ~0.5s).
- **Audio Mix:** Voice 100%, Strictly NO BGM (`bgm_volume: 0`).
- **Voice:** Local F5-TTS (English, `f5-tts-latest`, speed `0.90x`, micro-pauses ~0.15s).
- **Core Visual DNA (Learned directly from Before Civilization Reference & @Inkexplainer96 Benchmark):**
  1. **Minimalist Stick Figure Mascot:**
     - Round white head (`#ffffff`) with clean, bold black comic ink contours.
     - Solid white bean body or single ink line torso, stick limbs, 3–4 finger cartoon mitten hands.
     - Expressive meme facial features: black dot/oval cartoon eyes, worried curved eyebrows, comically wide gaping mouth, unblinking insomnia paralysis eyes with dilated pupils, blue sweat drops.
     - 100% flat 2D vector graphic novel art with authentic hand-drawn ink contours (strictly 0 3D, 0 photorealism, 0 gradient shading).
  2. **Contextual Watercolor Washes & Educational Environments:**
     - *Dark Vignette (Signature Ink Explainer):* Deep charcoal slate watercolor wash vignette framing a bright circular warm spotlight halo in the center on subtle cream paper texture.
     - *Clean Diagram (Infographic / Chalkboard / Anatomy):* Stark clean cream-white parchment paper (`#fbf9f5`) with subtle texture, generous negative space, dotted guide lines, and indicator arrows.
     - *Prehistoric Savanna:* Warm apricot and terracotta watercolor wash arch with minimalist dry cracked earth ground line and delicate acacia silhouettes.
     - *Ice Age / Cold Threat:* Pale slate-blue watercolor wash vignette (`#a0c0d0`), black-and-white snowflake doodles, flat jagged white ice ground line.
     - *Modern Interior (Office, Bedroom, Living Room):* Muted olive and tan flat walls, horizontal wooden plank floorboards, minimalist black-line furniture.
     - *Clean Card (Punchline / Title Card):* Stark clean cream-white parchment paper with soft warm spotlight, 80%+ negative breathing space.
  3. **"Voice Gì Thị Giác Đó" — Direct 1-to-1 Semantic Mapping:**
     - Never draw generic standing stick figures. Every scene literally and humorously illustrates the spoken science, anatomy, daily life, or metaphor.
     - Full visual grammar support for cutaway anatomical diagrams (kidneys with adrenal glands, lungs expanding, liver dumping glucose, heart tachometer at 200 BPM), chalkboards (`7 + 5 = ?`), pointer sticks, labeled props (e.g. `CLOSED` lock), comic impact starbursts, and matrix bullet dodging.
  4. **Negative Prompt:**
     ```text
     NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO WATERMARK, NO LOGO, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
     ```
  5. **Standardized Prompt Blueprint:**
     ```text
     An authentic Ink Explainer style 2D comic illustration. SCENE: [SCENE_DESCRIPTION]. CHARACTERS: Expressive minimalist white stickman mascot with round white head (#ffffff), solid white limbs, clean bold black comic ink contours, big expressive cartoon meme eyes, interacting directly with the scene. ENVIRONMENT: [SELECTED_PALETTE_BG]. STYLE: High-contrast educational graphic novel explainer, bold black ink line art, flat vibrant color accents on focal elements, clean paper texture, comic motion lines and indicator arrows. NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO WATERMARK, NO LOGO, NO BLURRY ARTIFACTS, NO STOCK PHOTO.
     ```
- **Clause-Locked Semantic Workflow (`./videogen explainer`):**
  1. **Segment Transcript:** Splits voiceover into semantic visual clauses (1.5s–2.5s / 4–8 words).
  2. **Classify Visual Strategy:** Assigns each clause one of 4 pure visual strategies (no text injection):
     - `LITERAL`: Direct physical depiction (alarm clock at night, sweating in bed, clutching churning stomach, trembling fingers).
     - `METAPHOR`: Meme / symbolic visual gag (stickman lifting giant cartoon minivan, floating in mid-air with sunglasses and golden halo, brain control room with panic button).
     - `SPLIT_SCREEN`: Visual contrast (baffled modern stickman vs rugged caveman ancestor).
     - `POSE_CHURN`: Rapid sequential emotion / posture changes against consistent watercolor backdrop.
  3. **Contextual Color Palettes:** Routes scenes to `ice_age` (`pale slate-blue wash #a0c0d0`), `prehistoric` (`warm apricot and terracotta gradient wash`), `interior_cozy` (`muted olive/tan flat walls`), or `clean_card` (`stark clean pure cream-white parchment paper wash`).
  4. **Execution Commands:**
     ```bash
     ./videogen explainer transcript.txt --title="Episode Title" --series="series_name" --ep="ep01"
     ./videogen render storyboards/series_name_ep01.json
     ./videogen voice storyboards/series_name_ep01.json
     ./videogen assemble storyboards/series_name_ep01.json
     ```
  5. **High-CTR Thumbnail SOP (Golden Hook & Visual Paradox — Standardized from EP01):**
     - **Aspect Ratio:** `16:9` widescreen (1920×1080 / 1376×768 native Flow).
     - **The Top Golden Hook Text:**
       * A single line of giant, massive comic hook text across the very top in bold bright golden-yellow typography with thick black outlines and slight dynamic tilt: `ADRENALINE?`, `WHY STUPID?`, `SUPERHUMAN?`, `BRAIN OFF?`.
       * Flow Prompt Syntax: `At the very top, one single line of giant, massive comic hook text in bold bright golden-yellow typography with thick black outlines reads exactly: "<HOOK_TEXT>?".`
     - **Extreme Visual Paradox (2-Way Conflict):**
       * **Feat (Superhuman):** Stickman casually lifting a heavy pickup truck overhead with one hand (`RUMBLE`), bending steel, or outrunning a missile.
       * **Failure (Utter Stupidity):** Stickman sweating cold bullets, wide derpy cartoon eyes, facing a kindergarten chalkboard (`7 + 5 = ?` with bright red `???`), utterly baffled and unable to solve simple logic.
     - **Environment & Palettes:**
       * Warm apricot and terracotta gradient watercolor wash vignette on cream parchment paper (`#fbf9f5`), comic screentone halftone dot textures, dynamic motion lines, educational indicator arrows.
     - **Negative Guards for Thumbnail:**
       * Strictly use: `STRICTLY NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM.`
       * Do NOT include `NO TITLE BANNER` or `NO TOP HEADER` in thumbnail prompts, as it suppresses the desired top golden hook line.
     - **Standardized Thumbnail Prompt Blueprint:**
       ```text
       A high-contrast 2D comic YouTube thumbnail. SCENE: At the very top, one single line of giant, massive comic hook text in bold bright golden-yellow typography with thick black outlines reads exactly: "[HOOK_TEXT]?". Below the text, on the left, an expressive white stickman mascot effortlessly lifting an entire heavy pickup truck overhead with ONE HAND like a superhero. On the right, floating next to his head is a simple kindergarten math chalkboard showing "7 + 5 = ?" with red question marks, and the stickman has wide derpy cartoon eyes and a sweat drop, completely incapable of simple math. ENVIRONMENT: Warm apricot and terracotta gradient watercolor wash vignette on subtle cream parchment paper, educational indicator arrows. STYLE: High-contrast educational graphic novel illustration, bold black ink line art, flat vibrant color accents, clean paper texture. STRICTLY NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM.
       ```

---

### 8.7. Vertical 9:16 Shorts Extraction from 16:9 Master
To extract and render viral vertical Shorts from a completed 16:9 master episode:
```bash
./videogen shorts storyboards/<project>.json output/<project>_Master_1080p.mp4
```
- **Option B — Cinematic Blur Overlay:** Canvas 1080×1920 with blurred master background (`boxblur=25:5`), centered 16:9 video at 1080×608 with drop shadow and gold separator accents (`#D4AF37`).
- **Kinetic Micro-Subtitles:** Subtitle phrases are split into **1.2s–1.8s chunks** with yellow keyword highlights (`&H0000FFFF`).
- **Outro Audio Fade:** Applied via `afade=t=out:st=<dur-0.25>:d=0.25` to cleanly cut trailing dialogue.

---

### 8.8. Authoring Custom Recipes via `universal_template.json`
To build any format, copy `examples/storyboards/universal_template.json` into your private `storyboards/` directory, replace the `${PLACEHOLDER}` values, and run:
```bash
./videogen run storyboards/my_custom_video.json
```

---

### 8.9. Universal Explainer Series (16:9 Minimalist 2D Ink Explainer)
An ultra-fast, zero-API-cost format for educational and narrative explainer videos (Casually Explained / Kurzgesagt style).
- **Configuration:** Authored via `examples/storyboards/universal_template.json` with `aspect_ratio: "16:9"`, `engine: "nano_banana_pro"`, `pacing: "static_cuts"`, `tts_provider: "f5-tts"`, and `bgm_volume: 0`.
- **Visual Engine:** Google Flow Nano Banana Pro in 16:9 (`1376x768` native upscaled to `1080p`).
- **Pacing & Editing:** 100% Static Cuts (hard cut per clause/sentence). No artificial Ken Burns motion. Assembled in single-pass via `ffconcat version 1.0` demuxer mapped to narrator audio duration.
- **Audio Hygiene (Strictly No BGM):** Set `bgm_volume: 0`. The entire audio spectrum remains pristine for local F5-TTS studio narration at `0.90x` speed with natural micro-pauses.
- **Scene Prompt Hygiene (Zero-Banner Rule):**
  * Do NOT include the words `"Ink Explainer"` or `"Minimalist Stick Figure"` in the positive prompt, as image generators mistake them for titles and render huge header banners.
  * Positive Prompt Formula: `2D comic illustration of [SCENE_DESCRIPTION]. CHARACTERS: Expressive minimalist white stickman mascot with round white head (#ffffff), solid white limbs, clean bold black comic ink contours, big expressive cartoon meme eyes, interacting directly with the scene. ENVIRONMENT: [SELECTED_PALETTE_BG]. STYLE: High-contrast educational graphic novel illustration, bold black ink line art, flat vibrant color accents, clean paper texture.`
  * Mandatory Negative Prompt: `STRICTLY NO TITLE BANNER, NO TOP HEADER, NO "INK EXPLAINER" TEXT, NO "MINIMALIST" TEXT, NO CHANNEL NAME, NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO BLURRY ARTIFACTS, NO STOCK PHOTO.`
- **High-CTR Thumbnail Formula (Top Golden Hook & Visual Paradox):**
  * **Top Golden Hook:** A single line of giant, massive comic hook text in bold bright golden-yellow typography with thick black outlines at the very top: `At the very top, one single line of giant, massive comic hook text in bold bright golden-yellow typography with thick black outlines reads exactly: "<HOOK_QUESTION>?".`
  * **Visual Paradox:** Superhuman/extreme feat on the left vs complete kindergarten logic failure on the right.
  * **Background:** Warm apricot and terracotta gradient watercolor wash vignette on cream parchment paper with educational indicator arrows.
  * **Negative Guard:** Include `STRICTLY NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM.` (Never include `NO TITLE BANNER` on thumbnails to avoid stripping the golden hook text).

---

## 9. Multi-Platform Publishing, CDP Hygiene & Continuous Batch Loop

### 9.1. Publishing Sequence & Posture
```bash
# Upload and schedule on YouTube Studio (Unlisted / Scheduled)
./videogen upload storyboards/<project>.json

# Upload and schedule on Meta Business Suite (Facebook Reels)
./videogen facebook storyboards/<project>.json

# Save as Facebook Draft for review
./videogen facebook storyboards/<project>.json --draft
```
- **Order:** Always schedule **YouTube Studio first**, then **Meta Business Suite**. Skip TikTok unless explicitly enabled.

### 9.2. CDP Navigation & Dialog Hygiene
- Upload pages maintain dirty form state. Automated navigation triggers native Chrome `beforeunload` dialogs ("Leave site?") or platform modals.
- The automation listens to `Page.javascriptDialogOpening` and immediately calls `Page.handleJavaScriptDialog({ accept: true })` or clicks the platform Confirm/Leave button.
- If a flow appears stalled, capture a screenshot via CDP (`Page.captureScreenshot`) for visual diagnosis rather than timing out.
- **YouTube Prechecks Warning Dialog Auto-Bypass:** When publishing videos rapidly, YouTube Studio's preliminary content checks may still be running when the Save/Publish button (`#done-button`) is clicked. This triggers the modal `ytcp-prechecks-warning-dialog` ("Chúng tôi vẫn đang kiểm tra nội dung của bạn" / "We are still checking your content"). The automation in `engine/youtube_uploader.js` automatically waits 3.5s after clicking `#done-button` and clicks `#secondary-action-button` ("Vẫn xuất bản" / "Publish anyway") to prevent the video from being stalled in Draft state.

### 9.3. Continuous Batch Production Loop (`./videogen loop`)
Run fully automated, continuous batch video production across multiple storyboards:
```bash
# Process specific storyboard files in sequence
./videogen loop storyboards/short_01.json storyboards/short_02.json

# Process all storyboards in storyboards/*.json
./videogen loop
```

---

### 9.4. Strict YouTube Channel Routing & Lock Guard
- **The Channel Drift Problem:** Navigating to `https://studio.youtube.com` without an explicit channel ID causes Google to automatically redirect to the Google Account's primary default/personal channel rather than the intended brand channel.
- **Strict Channel Lock Architecture:**
  1. `engine/config.js` always maps channel aliases to explicit studio URLs: `https://studio.youtube.com/channel/${channelId}`.
  2. `engine/youtube_uploader.js` verifies `curUrl.includes(targetCid)` before triggering the upload modal. If the browser is on a different channel, it actively navigates to the target channel URL.
  3. **Fail-Closed Assertion:** If the current URL fails to match `targetCid` after navigation, the uploader immediately throws a critical error and aborts the upload, preventing any video from leaking onto the wrong channel.
  4. In multi-channel environments, specify the target channel via `--channel <name_or_id>` or set `DEFAULT_CHANNEL_NAME` / `YOUTUBE_CHANNEL_ID` in `.env`.

# Draft mode / no-upload
./videogen loop --draft
./videogen loop --no-upload
```

### 9.4. Post-Production Archival & Storage Policy
Configure external archive destinations in `.env`:
```bash
DEST_ORIGINAL=/mnt/d/YourPath/File video original
DEST_FINAL=/mnt/d/YourPath/File video after edit
```
Then run:
```bash
./videogen archive storyboards/<project>.json
```
Migrates raw clips, voice files, and storyboard backups to external storage and purges temporary working directories (`renders/`, `audio/`, `output/`).

### 9.5. Mobile Dispatch Notification Bridge (Zalo Bot)
For instant notification upon video completion or schedule verification:
```bash
~/.local/bin/zalo-notify "🎬 [VideoGen] Video đã được xuất bản và lên lịch thành công: https://youtu.be/..."
```
Delivers notifications directly to the operator's mobile Zalo via the local OpenClaw gateway.




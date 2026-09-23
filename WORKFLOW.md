# VideoGen: Automated Video Production Workflow

Production-grade automated system for creating cinema-quality faceless YouTube Shorts, explainer videos, and story-driven animated series using **Google Flow** (Google Omni 1.1 / Veo 3.1) and **ElevenLabs** via browser automation (0 API token cost).

> **IP Protection Notice:** This workflow is a generic engine guide. All series-specific storyboards, character names, voice calibrations, and plotlines are stored privately in each user's `storyboards/` directory (gitignored) and are never part of this public repository.

---

## 1. System Components & Architecture

### 1.1. Visual & Sound Effects Engine (Google Flow)
- Operated via Chrome DevTools Protocol (CDP) through Windows Chrome profile `AutomationProfile`.
- Uses **Omni 1.1 Flash** (10-second clips, Cloud AI 1080p Full HD upscale & download).
- Generates natural ambient SFX embedded in the video stream.

### 1.2. Voiceover Engine (ElevenLabs)
- Operated via CDP directly on the active ElevenLabs Text-to-Speech tab.
- Generates natural voiceover using voices declared in the storyboard's `voice_profiles`.
- Auto-downloads MP3 files to `audio/<project_id>/`.

### 1.3. Post-Production & Mixing Engine (FFmpeg)
- Stitches all scenes sequentially into a master video (`engine/compositor.js`).
- Dynamically scales voiceover speed (`atempo`) to align with exact video duration.
- Balances audio levels: Voiceover at 100% volume, background ambient SFX at 25–30% volume.

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

## 7. Auto-Edit Mode 1: Faceless Shorts / Explainer Specifications

### 7.1. Dynamic Subtitle Specifications
- **Format:** Advanced SubStation Alpha (`.ass`) rendered via `libass`.
- **Timing & Alignment:** Aligned against ground-truth text in storyboard JSON.
- **Pacing:** Micro-chunks of 2–3 words each (~0.8s–1.5s display time) for high-retention pacing.
- **Visual Styling:**
  - Font: `Arial Black` / `Impact`, all-caps. Size: `50` (for 720×1280).
  - Base Color: Pure White (`&H00FFFFFF&`). Highlight: Neon Yellow (`&H0000FFFF&`).
  - Border: 4.5px solid black + 2.0px drop shadow.
  - Position: Lower-third center (`MarginV=280`).

### 7.2. Sound Effects (SFX) Layering
- **Opening Hook (00:00–00:01):** Deep cinematic sub-bass drop (`impact.mp3`, 50% volume).
- **Scene Transitions (~10s, ~20s):** Crisp swoosh (`whoosh.mp3`, 40% volume).
- **Emphasis Pop (~05.5s):** Subtle UI accent pop (`pop.mp3`, 35% volume).
- **Audio Balance:** Voiceover at 100%, video background ambient SFX at 20–30%.

---

## 8. Mode 2: Story-Driven Cinematic Series Production

### 8.1. Episode Architecture & Budgeting
- **Shot Formula:** Exactly **30 shots × 10 seconds** = 5-minute episode.
- **Credit Economics:** 15 credits per 10s clip (Omni 1.1 Flash) → **450 credits / episode**.
- **Aspect Ratio:** **16:9** for main episodes; **9:16** for auxiliary Shorts teasers.
- **Duration Setting:** Always **10s** in Flow settings — control pacing internally via Timeline Prompting.

### 8.2. Character Asset Binding System (Google Flow)
Maintain visual consistency via **Ingredient Chips** (`<flow-character-ingredient-chip>`):

- Save your characters in a named Google Flow project (e.g. `My Series`).
- Attach chips in storyboard via `characters: ["HeroName"]`.
- Engine auto-types `@HeroName` in Flow CDP to bind the visual reference.
- **Zero Physical Descriptor Rule:** When a character chip is attached, prompt text **MUST NOT** include any physical descriptions (hair color, armor details, face structure). The chip anchors 100% of visual identity. Focus prompt exclusively on: **Action, Expression, Camera Framing, Lighting/FX, Audio**.
- **Celebrity Filter Hygiene:** Avoid character names that match celebrity names in plain text — use role descriptors instead (e.g. `the duelist`, `she`, `the warrior`, `him`).

### 8.3. Dual-Tier Audio Architecture
1. **Tier 1 — Flow Native Dialogue & Lip-Sync:**
   - Omni 1.1 Flash natively synthesizes character voice + synchronized lip movement from prompt.
   - Use for close-up shots with on-screen spoken dialogue.
   - Prompt pattern: `[00:03 - 00:07] Close-up of <character> speaking: "Your line here", synced lip motion.`
   - Append: `AUDIO: Clear [language] voiceover speaking: "Your line", [voice description], synced lip motion, [ambient].`

2. **Tier 2 — ElevenLabs Voice Profiles (Narration & Inner Monologue):**
   - Configure each character's voice in `voice_profiles` (see storyboard schema above).
   - Engine auto-selects voice model and calibrates Radix UI sliders via CDP.

### 8.4. Dual-Zone Subtitle Architecture
- **Format:** Advanced SubStation Alpha (`.ass`) via `libass`, two distinct typographic layers.
- **Tier A — Character Dialogue & Inner Monologue:**
  - Position: Bottom Center (`Alignment 2`, `MarginV 35`).
  - Style: White (`&H00FFFFFF`), Arial 28pt, black outline 2.0px, shadow 1.0px.
- **Tier B — AI System / HUD / Narrator:**
  - Position: Top Center (`Alignment 8`, `MarginV 30`).
  - Style: Cyan Neon (`&H00FFFF00`), Consolas 24pt Bold, tech black outline 1.8px (`&H00112222`), Spacing 1.0.
  - Label format: `{\b1}[ SYSTEM NAME ]{\b0}\N< SYSTEM MESSAGE >`.
- **Audio Balance:** Dialogue/voiceover at 100%, background OST at 25–35%, diegetic SFX at 40%.
- **No Shorts-style SFX:** No whooshes, pops, or braams. Cinematic cuts only.

### 8.5. Timeline Prompting Formula (10s Clips)
Subdivide every 10s clip into **2–3 dynamic micro-scenes (2–4s each)**:

```text
[00:00 - 00:03] <Establishing wide/medium shot — character stance & environment (3s)>
[00:03 - 00:07] <Dynamic camera motion (push-in/pan/tilt) + motivated action beat (4s)>
[00:07 - 00:10] <Dramatic close-up — reaction / expression / climax (3s)>
<Lighting, rendering style, engine notes>.
AUDIO: SFX ONLY — <diegetic sounds>. NO MUSIC.
```

### 8.6. Policy & Safety Filter Hygiene (Zero-Flag Guarantee)
Google Flow rejects prompts containing violence/injury terms. Always substitute:

| Prohibited / High-Risk Term | Safe Cinematic Alternative |
| :--- | :--- |
| `blood`, `bleeding`, `blood dripping` | `purple/crimson cosmic particles`, `energy residue`, `shattered crystal sparks` |
| `severely injured`, `wounded`, `dying` | `exhausted battle stance`, `kneeling in fatigue`, `battle-worn posture` |
| `dagger stabbing`, `slash throat` | `shattered crystalline blade`, `energy saber`, `defensive stance` |
| `piercing chest`, `impaling` | `thrusting glowing rapier near chest`, `impact shockwave`, `energy burst` |
| `kill`, `murder`, `corpse` | `vanquish`, `fallen warrior`, `motionless silhouette in dark void` |
| `screaming in agony` | `gasp of shock`, `fierce determined glare`, `sharp intake of breath` |

### 8.7. Post-Production Archival & Storage Policy
Configure your external storage paths in `.env`:
```bash
DEST_ORIGINAL=/mnt/d/YourPath/File video original
DEST_FINAL=/mnt/d/YourPath/File video after edit
```
Then run:
```bash
./videogen archive storyboards/<project>.json
```
This migrates all raw clips, voiceover MP3s, and the storyboard backup to `DEST_ORIGINAL/<title>_materials_<timestamp>/`, copies the final master MP4 to `DEST_FINAL/`, and purges `renders/`, `audio/`, and `output/` in the repo.

### 8.8. Automated Unlisted YouTube Uploading
```bash
./videogen upload storyboards/<project>.json
```
- Operates on `studio.youtube.com` via CDP (zero YouTube Data API quota cost).
- TypeSafe Jev pre-screens title and description before submission.
- Sets visibility to **Unlisted** by default and returns the shareable `https://youtu.be/...` link.

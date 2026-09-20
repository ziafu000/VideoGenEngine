# VideoGenAgent

Autonomous, production-grade video generation pipeline (Director-Worker architecture) supporting two production modes:
1. **Mode 1: Faceless English Explainer & Shorts** (Rapid pacing, dynamic yellow animated captions, sound design).
2. **Mode 2: Original AI Anime Series ("Ashel: Mã Nguồn Tái Sinh / Protocol: Root")** (16-episode 3D CGI anime, 5-minute episodes = 30 clips x 10s in 16:9, character consistency via Google Flow Ingredient Chips, Japanese voiceover with Vietnamese subtitles).

Powered by:
- **Visuals & Ambient SFX:** Google Flow (Omni 1.1 Flash / Veo 3.1) via Chrome DevTools Protocol (CDP) on Google AI Pro with character asset binding.
- **Voiceover & Narration:** ElevenLabs Text-to-Speech via CDP browser automation (zero paid API keys).
- **Post-production & Audio Mixing:** FFmpeg for multi-track video stitching, tempo alignment, and audio ducking (voiceover + ambient SFX).

---

## Production Modes

### Mode 1: Faceless Explainer Shorts (English)
- **Ratio:** 9:16 vertical.
- **Pacing:** Rapid 2.75 words/second (~80–85 words per 30s Short).
- **Styling:** Dynamic word-by-word highlighted captions (Impact/Arial Black font, neon yellow highlight), hook impacts, and transition swooshes.

### Mode 2: Original AI Anime Series ("Ashel: Mã Nguồn Tái Sinh")
- **Ratio:** 16:9 widescreen cinematic (720p Omni 1.1 Flash).
- **Format:** 5 minutes per episode (30 shots @ 10s each = 450 credits/episode).
- **Character Consistency:** Pre-saved character assets (`Ashel`, `Valerie`, `Kiran`, `Selena`, `Master Eldrin`) attached programmatically or via `@` mention chips. Supports multi-character scenes.
- **Audio:** Japanese narrative voice acting + Vietnamese subtitles. Pure cinematic pacing without fast-paced Shorts SFX.

---

## Architecture Overview

```
[Topic / Prompt]
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Director (Scriptwriting & Prompt Engineering)            │
│    - Guidelines: skills/faceless-script-writer.md           │
│    - Omni Video Rules: skills/omni-video-prompts.md         │
│    - Storyboard Output: storyboards/scenes.json             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Video Worker (Google Flow Automation)                    │
│    - Bridge Check: scripts/start_bridge.sh                  │
│    - Flow Operator: scripts/flow_operator.sh                │
│      ├── Configure aspect ratio (9:16 / 16:9) & duration    │
│      ├── Input scene prompts & trigger generation           │
│      ├── Poll rendering progress until complete             │
│      └── Download native 720p clips to renders/scene_XX.mp4 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Audio & Auto-Edit Worker (Mode 1: Dynamic Captions + SFX)│
│    - ElevenLabs Operator: scripts/elevenlabs_operator.sh    │
│      ├── Uses active default voice (e.g. Alistair)          │
│      └── Generates & saves MP3 to audio/voiceover_en.mp3    │
│    - Subtitle Generator: scripts/generate_subtitles.js      │
│      └── Whisper transcription + ground-truth alignment     │
│    - Master Video Editor: scripts/edit_video.sh             │
│      ├── Burns dynamic ASS animated subtitles (libass)      │
│      ├── Layers opening impact, transition swishes & pops   │
│      └── Multi-track mixing: Voice (100%) + Ambient (20%)   │
│    - Final Master Output: output/final_with_voice_*.mp4     │
└─────────────────────────────────────────────────────────────┘
```

---

## Directory Layout
- `skills/`: Video prompt rules (`omni-video-prompts.md`) and faceless scriptwriting principles (`faceless-script-writer.md`).
- `storyboards/`: Current structured storyboard and script (`scenes.json`).
- `renders/`: Downloaded scene clips from Google Flow (`scene_01.mp4`, etc. - gitignored).
- `audio/`: Generated voiceover files (`voiceover_en.mp3` - gitignored).
- `output/`: Master rendered and mixed videos (gitignored).
- `assets/sfx/`: Bundled cinematic sound effects (impact, whoosh, pop).
- `scripts/`: Toolchain for CDP bridge, Flow control, ElevenLabs control, Subtitle generation, Auto-editing (`edit_video.sh`), and automated D: drive archival (`archive_and_cleanup.sh`).

## Storage & Archival Policy (Windows D: Drive)
To maintain an ultra-lightweight Git repository (<200KB) and prevent binary file bloat, all completed production runs automatically migrate assets to the editor's permanent drive:
- **Raw Materials:** `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\`
- **Finished Videos:** `D:\Billy\Work\Editing\File video after edit\<Video_Title>.mp4`
- **Cleanup:** `renders/`, `audio/`, and `output/` are kept clean with only `.gitkeep` tracked in Git.

# VideoGenAgent

Autonomous, production-grade faceless YouTube video generation pipeline (Director-Worker architecture) leveraging:
- **Visuals & Ambient SFX:** Google Flow (Omni 1.1 Flash / Veo 3.1) via Chrome DevTools Protocol (CDP) on Google AI Pro.
- **Voiceover & Narration:** ElevenLabs Text-to-Speech via CDP browser automation (zero paid API keys).
- **Post-production & Audio Mixing:** FFmpeg for multi-track video stitching, tempo alignment, and audio ducking (voiceover + ambient SFX).

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
│ 3. Audio Worker (ElevenLabs Voiceover & SFX Mixing)         │
│    - ElevenLabs Operator: scripts/elevenlabs_operator.sh    │
│      ├── Uses active default voice (e.g. Alistair)          │
│      └── Generates & saves MP3 to audio/voiceover_en.mp3    │
│    - Stitcher: scripts/stitch_video.sh                      │
│    - Audio Mixer: scripts/mix_audio.sh                      │
│      ├── Multi-track mixing: Voice (100%) + SFX (25%)       │
│      └── Automatic tempo alignment to match video length    │
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
- `scripts/`: Toolchain for CDP bridge, Flow control, ElevenLabs control, FFmpeg processing, and automated D: drive archival (`archive_and_cleanup.sh`).

## Storage & Archival Policy (Windows D: Drive)
To maintain an ultra-lightweight Git repository (<200KB) and prevent binary file bloat, all completed production runs automatically migrate assets to the editor's permanent drive:
- **Raw Materials:** `D:\Billy\Work\Editing\File video original\<Video_Title>_materials_<Timestamp>\`
- **Finished Videos:** `D:\Billy\Work\Editing\File video after edit\<Video_Title>.mp4`
- **Cleanup:** `renders/`, `audio/`, and `output/` are kept clean with only `.gitkeep` tracked in Git.

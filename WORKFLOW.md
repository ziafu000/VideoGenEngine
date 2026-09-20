# VideoGen: Automated Faceless YouTube Video Production Workflow

Production-grade automated system for creating cinema-quality faceless YouTube Shorts and explainer videos in English using **Google Flow** (Google Omni 1.1 / Veo 3.1) and **ElevenLabs** via browser automation (0 API token cost).

---

## 1. System Components & Architecture

### 1.1. Visual & Sound Effects Engine (Google Flow)
- Operated via Chrome DevTools Protocol (CDP) through Windows Chrome profile `AutomationProfile`.
- Uses **Omni 1.1 Flash** (10-second clips, 720p native download).
- Generates natural ambient SFX embedded in the video stream (truck rumble, glass pouring, fizzing carbonation).

### 1.2. Voiceover Engine (ElevenLabs)
- Operated via CDP directly on the active ElevenLabs Text-to-Speech tab.
- Generates natural native English voiceover using the user's active default voice (e.g. **Alistair** - Clear, Neutral, Informative).
- Auto-downloads MP3 files to `audio/`.

### 1.3. Post-Production & Mixing Engine (FFmpeg)
- Stitches all scenes sequentially into a master video (`scripts/stitch_video.sh`).
- Dynamically scales voiceover speed (`atempo`) to align with exact video duration (`scripts/mix_audio.sh`).
- Balances audio levels: Voiceover at 100% volume, background ambient SFX at 25% volume.

---

## 2. Environment Setup & Browser Bridge

To bypass Cloudflare / Google bot protections, the system attaches to the user's authentic Windows Chrome browser via remote debugging.

### 2.1. Port Architecture
- **Windows Chrome:** Launched with `--remote-debugging-port=9222` and profile at `C:\Users\ASUS\AppData\Local\Google\Chrome\AutomationProfile`.
- **CDP Proxy (`scripts/cdp_proxy.js`):** Node.js TCP bridge on Windows forwarding `0.0.0.0:9223` -> `127.0.0.1:9222`.
- **WSL Client:** Accesses CDP at `http://$WIN_HOST:9223` using `chrome-devtools-axi`.

### 2.2. Starting the Bridge
```bash
~/ai/project/VideoGen/scripts/start_bridge.sh
```
Runs automatically at session start or whenever a browser disconnect is detected.

---

## 3. Storyboard Specification (`storyboards/scenes.json`)

The storyboard serves as the contract between the scriptwriter (Director) and the video/audio automators (Workers):

```json
{
  "title": "Why Nobody Can Copy Coca-Cola's 138-Year Formula",
  "niche": "explainer",
  "language": "en",
  "aspect_ratio": "9:16",
  "model": "Omni 1.1 Flash",
  "voice": "Alistair",
  "target_duration_seconds": 30,
  "title_options": [
    "Why Nobody Can Copy Coca-Cola's 138-Year Formula",
    "The DEA Secret Inside Every Bottle of Coke"
  ],
  "thumbnail_line": "THE 138-YEAR LIE",
  "script_full": "Full voiceover script in English...",
  "scenes": [
    {
      "scene_id": "scene_01",
      "duration_seconds": 10,
      "timecode": "00:00 - 00:10",
      "voiceover": "First scene narration...",
      "prompt": "Vertical 9:16 eye-level medium shot... [Action]... [Lighting]... AUDIO: SFX ONLY — [sound details]. NO MUSIC."
    }
  ]
}
```

---

## 4. Automation Toolchain Reference

| Script | Function | Command / Usage |
| :--- | :--- | :--- |
| `scripts/start_bridge.sh` | Verifies and starts Chrome & CDP proxy on Windows | `./scripts/start_bridge.sh` |
| `scripts/flow_operator.sh` | Google Flow automation (status, configure, submit, wait, download) | `./scripts/flow_operator.sh status`<br>`./scripts/flow_operator.sh configure 9:16 10s`<br>`./scripts/flow_operator.sh submit "<prompt>"`<br>`./scripts/flow_operator.sh wait 180`<br>`./scripts/flow_operator.sh download renders/scene_01.mp4` |
| `scripts/elevenlabs_operator.sh` | ElevenLabs TTS automation (preserves active voice, generates speech, downloads MP3) | `./scripts/elevenlabs_operator.sh generate "<text>" [output_path]` |
| `scripts/stitch_video.sh` | Concatenates rendered MP4 scene clips via FFmpeg | `./scripts/stitch_video.sh` |
| `scripts/mix_audio.sh` | Syncs voiceover tempo with video duration & mixes with background SFX | `./scripts/mix_audio.sh [video_path] [voice_path]` |
| `scripts/render_pipeline.sh` | Master end-to-end runner (renders all scenes in `scenes.json` & stitches) | `./scripts/render_pipeline.sh` |

---

## 5. End-to-End Production Checklist

1. **Verify Bridge:** Ensure Windows Chrome is open with Google Flow and ElevenLabs tabs. Run `./scripts/start_bridge.sh`.
2. **Draft Storyboard:** Write the English script & visual prompts into `storyboards/scenes.json` following `skills/faceless-script-writer.md` and `skills/omni-video-prompts.md`.
3. **Render Scenes:** Execute `./scripts/render_pipeline.sh` to configure Flow, submit each scene prompt, wait for rendering, and download clips to `renders/`.
4. **Generate Voiceover:** Run `./scripts/elevenlabs_operator.sh generate "$SCRIPT_EN"` to generate voiceover via ElevenLabs and download to `audio/voiceover_en.mp3`.
5. **Mix & Master:** Run `./scripts/mix_audio.sh` to mix the stitched video with the voiceover and ambient SFX.
6. **Delivery:** The final master video is automatically copied to Windows Downloads (`C:\Users\ASUS\Downloads`) for instant review.

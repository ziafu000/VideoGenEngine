import argparse
import os
import sys
import subprocess
from pathlib import Path
import torch

CACHE_DIR = os.environ.get("KOKORO_CACHE_DIR", "/home/asus/ai/vieneu/cache/kokoro")
os.environ["HF_HOME"] = CACHE_DIR
os.environ["TORCH_HOME"] = os.path.join(CACHE_DIR, "torch")

_PIPELINE = None

def get_pipeline(lang_code="a"):
    global _PIPELINE
    if _PIPELINE is None:
        from kokoro import KPipeline
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _PIPELINE = KPipeline(lang_code=lang_code, device=device)
    return _PIPELINE

def resolve_voice_tensor(pipeline, voice_spec):
    """
    Resolve voice into a PyTorch tensor.
    Supports:
      - 'puck_open_throat' (80% Puck + 20% Adam, anti-nasal optimized)
      - 'puck_warm' (70% Puck + 30% Adam)
      - 'puck_michael' (80% Puck + 20% Michael)
      - Comma-separated (e.g. 'am_puck,am_adam')
      - Any single Kokoro voice (e.g. 'am_puck', 'am_adam', 'am_michael', 'bm_george')
    """
    spec = voice_spec.strip().lower()
    if spec in ["puck_expressive", "pure_puck", "puck"]:
        return pipeline.load_single_voice("am_puck")
    elif spec in ["puck_fenrir", "puck_fenrir_blend"]:
        v_puck = pipeline.load_single_voice("am_puck")
        v_fenrir = pipeline.load_single_voice("am_fenrir")
        return 0.65 * v_puck + 0.35 * v_fenrir
    elif spec in ["fenrir_punchy", "fenrir"]:
        return pipeline.load_single_voice("am_fenrir")
    elif spec in ["puck_open_throat", "puck_denasal", "puck_adam_explainer"]:
        v_puck = pipeline.load_single_voice("am_puck")
        v_adam = pipeline.load_single_voice("am_adam")
        return 0.80 * v_puck + 0.20 * v_adam
    elif spec == "puck_warm":
        v_puck = pipeline.load_single_voice("am_puck")
        v_adam = pipeline.load_single_voice("am_adam")
        return 0.70 * v_puck + 0.30 * v_adam
    elif spec == "puck_michael":
        v_puck = pipeline.load_single_voice("am_puck")
        v_mic = pipeline.load_single_voice("am_michael")
        return 0.80 * v_puck + 0.20 * v_mic
    elif "," in voice_spec:
        parts = [p.strip() for p in voice_spec.split(",") if p.strip()]
        packs = [pipeline.load_single_voice(v) for v in parts]
        return torch.mean(torch.stack(packs), dim=0)
    else:
        return pipeline.load_single_voice(voice_spec)

def to_win_path(p: Path) -> str:
    """Convert WSL / Linux Path to Windows path for Windows FFmpeg binary."""
    try:
        res = subprocess.run(["wslpath", "-w", str(p.resolve())], capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return str(p.resolve())

def main():
    parser = argparse.ArgumentParser(description="Kokoro-82M Local English TTS Engine for VideoGen")
    parser.add_argument("--text", default=None, help="Text to synthesize")
    parser.add_argument("--output", default=None, help="Output audio file (.wav or .mp3)")
    parser.add_argument("--batch-json", default=None, help="JSON file containing list of {text, output} items for high-speed batch processing")
    parser.add_argument("--voice", default="puck_open_throat", help="Voice ID or blend (default: puck_open_throat)")
    parser.add_argument("--speed", type=float, default=1.12, help="Speaking speed multiplier (default: 1.12 for continuous explainer)")
    parser.add_argument("--lang", default="a", help="Language code ('a' for American, 'b' for British)")
    parser.add_argument("--de-nasal-eq", action="store_true", default=True, help="Apply studio EQ to eliminate nasal frequencies")
    parser.add_argument("--no-de-nasal-eq", action="store_false", dest="de_nasal_eq")

    args = parser.parse_args()

    import json
    import soundfile as sf

    lang = args.lang.lower()
    if lang in ["en", "en-us", "us", "american", "a"]:
        lang_code = "a"
    elif lang in ["en-gb", "gb", "uk", "british", "b"]:
        lang_code = "b"
    else:
        lang_code = "a"

    pipeline = get_pipeline(lang_code=lang_code)
    voice_tensor = resolve_voice_tensor(pipeline, args.voice)

    items = []
    if args.batch_json:
        with open(args.batch_json, "r", encoding="utf-8") as f:
            items = json.load(f)
    elif args.text and args.output:
        items = [{"text": args.text, "output": args.output}]
    else:
        print("ERROR: Either --batch-json OR both --text and --output must be provided.", file=sys.stderr)
        sys.exit(1)

    sample_rate = 24000
    for idx, item in enumerate(items):
        t = item["text"]
        out_p = Path(item["output"])
        out_p.parent.mkdir(parents=True, exist_ok=True)

        if out_p.exists() and out_p.stat().st_size > 1000:
            print(f"[{idx+1}/{len(items)}] Skip existing: {out_p.name}")
            continue

        generator = pipeline(t, voice=voice_tensor, speed=args.speed)
        audio_chunks = []
        for gs, ps, audio in generator:
            audio_chunks.append(audio)

        if not audio_chunks:
            print(f"WARN: No audio for item {idx}: {t[:30]}", file=sys.stderr)
            continue

        full_audio = torch.cat(audio_chunks, dim=0).cpu().numpy()
        temp_wav = out_p.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), full_audio, sample_rate)

        win_temp_wav = to_win_path(temp_wav)
        win_out_path = to_win_path(out_p)

        if out_p.suffix.lower() == ".mp3":
            cmd = ["ffmpeg", "-y", "-i", win_temp_wav]
            if args.de_nasal_eq:
                eq_filter = (
                    "highpass=f=75,"
                    "equalizer=f=1350:width_type=h:width=500:g=-4.5,"
                    "equalizer=f=220:width_type=h:width=100:g=1.8,"
                    "equalizer=f=7000:width_type=h:width=2500:g=2.5"
                )
                cmd.extend(["-af", eq_filter])
            cmd.extend(["-b:a", "192k", win_out_path])
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if temp_wav.exists():
                temp_wav.unlink()
        else:
            if args.de_nasal_eq:
                eq_filter = (
                    "highpass=f=75,"
                    "equalizer=f=1350:width_type=h:width=500:g=-4.5,"
                    "equalizer=f=220:width_type=h:width=100:g=1.8,"
                    "equalizer=f=7000:width_type=h:width=2500:g=2.5"
                )
                subprocess.run(
                    ["ffmpeg", "-y", "-i", win_temp_wav, "-af", eq_filter, win_out_path],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                if temp_wav.exists():
                    temp_wav.unlink()
            else:
                temp_wav.replace(out_p)

        duration = len(full_audio) / float(sample_rate)
        print(f"[{idx+1}/{len(items)}] OK ({duration:.2f}s): {out_p.name}")

if __name__ == "__main__":
    main()

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
    if spec == "puck_open_throat" or spec == "puck_denasal":
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
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--output", required=True, help="Output audio file (.wav or .mp3)")
    parser.add_argument("--voice", default="puck_open_throat", help="Voice ID or blend (default: puck_open_throat)")
    parser.add_argument("--speed", type=float, default=1.12, help="Speaking speed multiplier (default: 1.12 for continuous explainer)")
    parser.add_argument("--lang", default="a", help="Language code ('a' for American, 'b' for British)")
    parser.add_argument("--de-nasal-eq", action="store_true", default=True, help="Apply studio EQ to eliminate nasal frequencies")
    parser.add_argument("--no-de-nasal-eq", action="store_false", dest="de_nasal_eq")

    args = parser.parse_args()

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

    generator = pipeline(args.text, voice=voice_tensor, speed=args.speed)
    audio_chunks = []
    for gs, ps, audio in generator:
        audio_chunks.append(audio)

    if not audio_chunks:
        print("ERROR: No audio generated", file=sys.stderr)
        sys.exit(1)

    full_audio = torch.cat(audio_chunks, dim=0).cpu().numpy()
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    sample_rate = 24000
    temp_wav = out_path.with_suffix(".tmp.wav")
    sf.write(str(temp_wav), full_audio, sample_rate)

    win_temp_wav = to_win_path(temp_wav)
    win_out_path = to_win_path(out_path)

    if out_path.suffix.lower() == ".mp3":
        cmd = ["ffmpeg", "-y", "-i", win_temp_wav]
        if args.de_nasal_eq:
            # Studio EQ chain:
            # 1. highpass 75Hz (removes low-end rumble)
            # 2. notch cut 1350Hz -4.5dB (eliminates nasal congestion)
            # 3. bell boost 220Hz +1.8dB (chest resonance warmth)
            # 4. bell boost 7000Hz +2.5dB (air brilliance and clarity)
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
            temp_wav.replace(out_path)

    duration = len(full_audio) / float(sample_rate)
    print(f"OK: generated {duration:.2f}s audio at {out_path} (voice: {args.voice}, speed: {args.speed})")

if __name__ == "__main__":
    main()

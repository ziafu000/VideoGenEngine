import argparse
import json
import os
import shutil
import sys
import subprocess
from pathlib import Path

# Configure isolated caches
CACHE_DIR = os.environ.get("VIENEU_CACHE_DIR", str(Path.home() / "ai" / "vieneu" / "cache"))
os.environ["HF_HOME"] = CACHE_DIR
os.environ["TORCH_HOME"] = os.path.join(CACHE_DIR, "torch")

import torch

def to_win_path(p: Path) -> str:
    """Convert WSL / Linux Path to Windows path for Windows FFmpeg binary, or return direct path on native OS."""
    resolved = str(p.resolve())
    if sys.platform == "win32" or sys.platform == "darwin" or not shutil.which("wslpath"):
        return os.path.normpath(resolved)
    try:
        res = subprocess.run(["wslpath", "-w", resolved], capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return resolved

def get_engine():
    from vieneu import Vieneu
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return Vieneu(mode="v3turbo", device=device)

def main():
    parser = argparse.ArgumentParser(description="VieNeu-TTS CLI runner for VideoGen")
    parser.add_argument("--text", default=None, help="Text to synthesize")
    parser.add_argument("--output", default=None, help="Output audio file path (.wav or .mp3)")
    parser.add_argument("--batch-json", default=None, help="JSON file containing list of {text, output} items for batch processing")
    parser.add_argument("--profile", default=None, help="Profile name from assets/voice_profiles.json")
    parser.add_argument("--voice", default="Hải Đăng", help="Preset voice name")
    parser.add_argument("--ref-audio", default=None, help="Reference audio for voice cloning")
    parser.add_argument("--temperature", type=float, default=None, help="Sampling temperature (default 0.4 for crisp diction)")
    parser.add_argument("--apply-watermark", action="store_true", default=None, help="Apply watermark (default False)")
    
    args = parser.parse_args()

    items = []
    if args.batch_json:
        with open(args.batch_json, "r", encoding="utf-8") as f:
            items = json.load(f)
    elif args.text and args.output:
        items = [{"text": args.text, "output": args.output}]
    else:
        print("ERROR: Either --batch-json OR both --text and --output must be provided.", file=sys.stderr)
        sys.exit(1)

    # Resolve voice profile if specified
    # Priority: assets/voice_profiles.json (private/gitignored) -> engine/voice_profiles.json -> engine/voice_profiles.example.json
    project_dir = Path(__file__).parent.parent
    candidate_paths = [
        project_dir / "assets" / "voice_profiles.json",
        Path(__file__).parent / "voice_profiles.json",
        Path(__file__).parent / "voice_profiles.example.json"
    ]

    profiles = {}
    for p_path in candidate_paths:
        if p_path.exists():
            try:
                with open(p_path, "r", encoding="utf-8") as f:
                    profiles = json.load(f)
                if profiles:
                    break
            except Exception:
                pass

    profile_name = args.profile or "default"
    temperature = args.temperature
    apply_watermark = args.apply_watermark

    if profile_name in profiles:
        resolved = profiles[profile_name]
        if resolved.get("mode") == "preset":
            args.voice = resolved.get("voice", args.voice)
            args.ref_audio = None
        elif resolved.get("mode") == "clone" and resolved.get("ref_audio"):
            args.ref_audio = resolved.get("ref_audio")
        if temperature is None and "temperature" in resolved:
            temperature = float(resolved["temperature"])
        if apply_watermark is None and "apply_watermark" in resolved:
            apply_watermark = bool(resolved["apply_watermark"])
    elif "default" in profiles and not args.profile:
        resolved = profiles["default"]
        if resolved.get("mode") == "preset":
            args.voice = resolved.get("voice", args.voice)
        if temperature is None and "temperature" in resolved:
            temperature = float(resolved["temperature"])
        if apply_watermark is None and "apply_watermark" in resolved:
            apply_watermark = bool(resolved["apply_watermark"])

    if temperature is None:
        temperature = 0.4
    if apply_watermark is None:
        apply_watermark = False

    engine = get_engine()

    for idx, item in enumerate(items):
        item_text = item["text"]
        out_path = Path(item["output"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        item_voice = item.get("voice") or args.voice
        item_temp = float(item["temperature"]) if "temperature" in item and item["temperature"] is not None else temperature

        infer_kwargs = {
            "text": item_text,
            "temperature": item_temp,
            "apply_watermark": apply_watermark
        }
        if args.ref_audio and os.path.exists(args.ref_audio):
            infer_kwargs["ref_audio"] = args.ref_audio
        else:
            infer_kwargs["voice"] = item_voice

        audio = engine.infer(**infer_kwargs)

        # Save audio (48kHz)
        if out_path.suffix.lower() == ".mp3":
            temp_wav = out_path.with_suffix(".tmp.wav")
            engine.save(audio, str(temp_wav))
            win_temp_wav = to_win_path(temp_wav)
            win_out_path = to_win_path(out_path)
            subprocess.run(
                ["ffmpeg", "-y", "-i", win_temp_wav, "-b:a", "192k", win_out_path],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            if temp_wav.exists():
                temp_wav.unlink()
        else:
            engine.save(audio, str(out_path))

        duration = len(audio) / 48000.0
        print(f"OK [{idx+1}/{len(items)}]: generated {duration:.2f}s audio at {out_path}")

if __name__ == "__main__":
    main()

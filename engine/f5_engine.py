import argparse
import os
import sys
import re
import warnings

# Suppress HuggingFace Hub unauthenticated warning
warnings.filterwarnings("ignore", message=".*unauthenticated requests to the HF Hub.*")
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

import subprocess
from pathlib import Path
import json
import torch
import numpy as np
import soundfile as sf

_MODEL = None

DEFAULT_SPEED = float(os.environ.get("F5_SPEED", "0.90"))

DEFAULT_REF_AUDIO = os.environ.get(
    "F5_REF_AUDIO",
    str(Path(__file__).resolve().parent.parent / "assets" / "voices" / "f5_tts_latest_ref.wav")
)
if not os.path.exists(DEFAULT_REF_AUDIO):
    example_ref = Path(__file__).resolve().parent.parent / "examples" / "voices" / "sample_ref.wav"
    if example_ref.exists():
        DEFAULT_REF_AUDIO = str(example_ref)

DEFAULT_REF_TEXT = os.environ.get(
    "F5_REF_TEXT",
    "Most of us never think twice about any of this, but the person wide awake at 3am may have been the most important person in the camp."
)

PRONUNCIATION_DICT_FILE = (
    Path(__file__).resolve().parent.parent / "assets" / "pronunciation_dict.json"
)

def normalize_pronunciation(text: str) -> str:
    """
    Applies phonetic respelling for tricky words/acronyms and strips awkward hyphens
    to ensure smooth, natural, continuous speech without stuttering.
    """
    if not text:
        return text
    normalized = text

    # 1. Custom pronunciation dictionary
    if PRONUNCIATION_DICT_FILE.exists():
        try:
            with open(PRONUNCIATION_DICT_FILE, "r", encoding="utf-8") as f:
                pdict = json.load(f)
            for k, v in pdict.items():
                pattern = r"\b" + re.escape(k) + r"\b"
                normalized = re.sub(pattern, v, normalized, flags=re.IGNORECASE)
        except Exception as e:
            print(f"[!] Warning reading pronunciation dict: {e}", file=sys.stderr)

    # 2. De-hyphenate compound words (e.g. ninety-nine -> ninety nine, Olympic-level -> Olympic level)
    # Hyphens in character-level models cause glottal stops / hesitations.
    normalized = re.sub(r'(\w+)-(\w+)', r'\1 \2', normalized)
    normalized = re.sub(r'(\w+)-(\w+)', r'\1 \2', normalized)
    normalized = normalized.replace('—', ', ').replace('–', ' ')

    return normalized

def get_f5_model(device=None):
    global _MODEL
    if _MODEL is None:
        from f5_tts.api import F5TTS
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        _MODEL = F5TTS(device=device)
    return _MODEL

def to_win_path(p: Path) -> str:
    """Convert WSL / Linux Path to Windows path for Windows FFmpeg binary."""
    try:
        res = subprocess.run(["wslpath", "-w", str(p.resolve())], capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except Exception:
        return str(p.resolve())

def trim_and_pad_audio(audio, sr, text, threshold_db=-40):
    """
    Trims dead silence from output and applies two-tier natural padding:
      - 80ms (0.08s) for intra-sentence clauses
      - 220ms (0.22s) for sentence-end clauses (. ? ! ...)
      - 20ms lead-in, 5ms fade-in, 10ms fade-out to prevent clicks
    """
    threshold_amp = 10 ** (threshold_db / 20)
    abs_audio = np.abs(audio)

    window_size = int(sr * 0.01) # 10ms
    start_idx = 0
    for i in range(0, len(audio) - window_size, max(1, window_size // 2)):
        if np.max(abs_audio[i : i + window_size]) > threshold_amp:
            start_idx = max(0, i - int(sr * 0.02)) # 20ms lead-in
            break

    end_idx = len(audio)
    for i in range(len(audio) - window_size, 0, -max(1, window_size // 2)):
        if np.max(abs_audio[i : i + window_size]) > threshold_amp:
            end_idx = min(len(audio), i + window_size)
            break

    if start_idx >= end_idx:
        trimmed = audio.copy()
    else:
        trimmed = audio[start_idx:end_idx].copy()

    fade_in_len = int(sr * 0.005) # 5ms
    fade_out_len = int(sr * 0.010) # 10ms
    if len(trimmed) > fade_in_len + fade_out_len:
        fade_in = np.linspace(0, 1, fade_in_len)
        fade_out = np.linspace(1, 0, fade_out_len)
        trimmed[:fade_in_len] *= fade_in
        trimmed[-fade_out_len:] *= fade_out

    clean_t = text.strip()
    is_sentence_end = clean_t.endswith(('.', '?', '!', '."', '?"', '!"', '...'))
    pad_sec = 0.22 if is_sentence_end else 0.08
    pad_len = int(sr * pad_sec)

    return np.pad(trimmed, (0, pad_len), mode='constant')

def main():
    parser = argparse.ArgumentParser(description="F5-TTS Local Zero-Shot Voice Cloning Engine for VideoGen")
    parser.add_argument("--text", default=None, help="Text to synthesize")
    parser.add_argument("--output", default=None, help="Output audio file (.wav or .mp3)")
    parser.add_argument("--batch-json", default=None, help="JSON file containing list of {text, output} items for batch processing")
    parser.add_argument("--ref-audio", default=DEFAULT_REF_AUDIO, help="Reference audio file for voice cloning")
    parser.add_argument("--ref-text", default=DEFAULT_REF_TEXT, help="Transcript of reference audio")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED, help=f"Speaking speed multiplier (default: {DEFAULT_SPEED})")
    parser.add_argument("--target-rms", type=float, default=0.1, help="Target RMS loudness (default: 0.1)")
    parser.add_argument("--nfe-step", type=int, default=32, help="Denoising steps (default: 32)")
    parser.add_argument("--studio-eq", action="store_true", default=True, help="Apply broadcast studio EQ")
    parser.add_argument("--no-studio-eq", action="store_false", dest="studio_eq")

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

    ref_p = Path(args.ref_audio)
    if not ref_p.is_absolute() and not ref_p.exists():
        proj_root = Path(__file__).resolve().parent.parent
        alt_p = proj_root / args.ref_audio
        if alt_p.exists():
            ref_p = alt_p
    ref_audio = str(ref_p.resolve())
    if not os.path.exists(ref_audio):
        print(f"ERROR: Reference audio not found at: {ref_audio}", file=sys.stderr)
        sys.exit(1)

    print(f"[F5-TTS] Initializing engine on CUDA with ref_audio: {Path(ref_audio).name}")
    engine = get_f5_model()

    for idx, item in enumerate(items):
        t = item["text"]
        norm_t = normalize_pronunciation(t)
        if norm_t != t:
            print(f"[{idx+1}/{len(items)}] [Phonetic Fix] '{t}' -> '{norm_t}'")

        out_p = Path(item["output"])
        out_p.parent.mkdir(parents=True, exist_ok=True)

        if out_p.exists() and out_p.stat().st_size > 1000:
            print(f"[{idx+1}/{len(items)}] Skip existing: {out_p.name}")
            continue

        raw_wav, sr, _ = engine.infer(
            ref_file=ref_audio,
            ref_text=args.ref_text,
            gen_text=norm_t,
            speed=args.speed,
            target_rms=args.target_rms,
            nfe_step=args.nfe_step,
            show_info=lambda *a, **k: None # quiet logging
        )

        processed_audio = trim_and_pad_audio(raw_wav, sr, t)
        temp_wav = out_p.with_suffix(".tmp.wav")
        sf.write(str(temp_wav), processed_audio, sr)

        win_temp_wav = to_win_path(temp_wav)
        win_out_path = to_win_path(out_p)

        if out_p.suffix.lower() == ".mp3":
            cmd = ["ffmpeg", "-y", "-i", win_temp_wav]
            if args.studio_eq:
                eq_filter = (
                    "highpass=f=70,"
                    "equalizer=f=250:width_type=h:width=120:g=1.2,"
                    "equalizer=f=3500:width_type=h:width=1500:g=1.5,"
                    "equalizer=f=10000:width_type=h:width=3000:g=2.0"
                )
                cmd.extend(["-af", eq_filter])
            cmd.extend(["-b:a", "192k", win_out_path])
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if temp_wav.exists():
                temp_wav.unlink()
        else:
            if args.studio_eq:
                eq_filter = (
                    "highpass=f=70,"
                    "equalizer=f=250:width_type=h:width=120:g=1.2,"
                    "equalizer=f=3500:width_type=h:width=1500:g=1.5,"
                    "equalizer=f=10000:width_type=h:width=3000:g=2.0"
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

        duration = len(processed_audio) / float(sr)
        print(f"[{idx+1}/{len(items)}] OK ({duration:.2f}s): {out_p.name}")

if __name__ == "__main__":
    main()

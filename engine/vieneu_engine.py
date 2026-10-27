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

import numpy as np
import torch

def build_regional_clone_voice(engine, ref_audio_path: str, region: str = None, gender: str = "female"):
    """Enroll reference audio and optionally project speaker embedding + hybrid acoustic prompt into target regional dialect subspace."""
    emb_raw, codes_raw = engine._enroll_reference(ref_audio_path, denoise=True, use_ref_codes=True)
    if not region:
        return {"speaker_emb": emb_raw.tolist(), "codes": codes_raw.tolist() if codes_raw is not None else None}

    import vieneu
    presets_path = Path(vieneu.__file__).parent / "assets" / "voices_v3_turbo.json"
    if not presets_path.exists():
        return {"speaker_emb": emb_raw.tolist(), "codes": codes_raw.tolist() if codes_raw is not None else None}

    with open(presets_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)
    presets = raw_data.get("presets", raw_data) if isinstance(raw_data, dict) else {}

    norm_gender = (gender or "female").lower()
    if region.lower() in ("nam", "miền nam", "southern", "south"):
        nam_g_list = [np.array(v["speaker_emb"], dtype=np.float32) for v in presets.values() if isinstance(v, dict) and v.get("region") == "Nam" and v.get("gender") == norm_gender]
        bac_g_list = [np.array(v["speaker_emb"], dtype=np.float32) for v in presets.values() if isinstance(v, dict) and v.get("region") == "Bắc" and v.get("gender") == norm_gender]

        if nam_g_list and bac_g_list:
            nam_g = np.mean(nam_g_list, axis=0)
            bac_g = np.mean(bac_g_list, axis=0)
            u1 = nam_g - bac_g
            u1 = u1 / (np.linalg.norm(u1) + 1e-8)

            emb_raw_f = np.asarray(emb_raw, dtype=np.float32)
            emb_id = emb_raw_f - np.dot(emb_raw_f, u1) * u1
            emb_reg = emb_id + 4.2 * u1
            emb_reg = emb_reg * (np.linalg.norm(emb_raw_f) / (np.linalg.norm(emb_reg) + 1e-8))

            if codes_raw is not None and len(codes_raw) >= 90:
                own_codes = codes_raw[15:90]
            elif codes_raw is not None and len(codes_raw) > 20:
                own_codes = codes_raw[15:]
            else:
                own_codes = codes_raw

            return {
                "speaker_emb": emb_reg.tolist(),
                "codes": own_codes.tolist() if own_codes is not None else None
            }

    return {"speaker_emb": emb_raw.tolist(), "codes": codes_raw.tolist() if codes_raw is not None else None}

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
    parser.add_argument("--region", default=None, help="Target dialect region for voice cloning (Nam/Bắc/Trung)")
    parser.add_argument("--gender", default=None, help="Speaker gender for dialect subspace projection (female/male)")
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
    region = args.region
    gender = args.gender

    if profile_name in profiles:
        resolved = profiles[profile_name]
        if resolved.get("mode") == "preset":
            args.voice = resolved.get("voice", args.voice)
            args.ref_audio = None
        elif resolved.get("mode") == "clone" and resolved.get("ref_audio"):
            args.ref_audio = resolved.get("ref_audio")
        if region is None and "region" in resolved:
            region = resolved["region"]
        if gender is None and "gender" in resolved:
            gender = resolved["gender"]
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

    if args.ref_audio and not os.path.exists(args.ref_audio):
        candidate_ref = project_dir / args.ref_audio
        if candidate_ref.exists():
            args.ref_audio = str(candidate_ref.resolve())

    engine = get_engine()
    cloned_voice_payload = None
    if args.ref_audio and os.path.exists(args.ref_audio) and region:
        cloned_voice_payload = build_regional_clone_voice(engine, args.ref_audio, region=region, gender=gender or "female")

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
        if cloned_voice_payload is not None:
            infer_kwargs["voice"] = cloned_voice_payload
            infer_kwargs["use_ref_codes"] = True
        elif args.ref_audio and os.path.exists(args.ref_audio):
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

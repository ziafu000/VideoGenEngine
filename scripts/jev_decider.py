#!/usr/bin/env python3
"""
scripts/jev_decider.py: TypeSafe Jev (System One AI) Decider for VideoGen browser automation.

Provides programmable semantic judgments:
- screen-prompt: Pre-flight safety screening of video prompts before submission to Google Flow.
- classify-tile: Classify Google Flow render tile state (ready, generating, policy_refusal, error).
- verify-elevenlabs: Verify ElevenLabs audio generation readiness before download.
"""

import sys
import os
import json
import urllib.request
import urllib.error

API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"


def get_api_key():
    """Retrieve TYPESAFE_API_KEY from env or fallback to /home/asus/ai/firstmate/.env."""
    key = os.environ.get("TYPESAFE_API_KEY")
    if key and key.strip():
        return key.strip()

    candidate_files = [
        "/home/asus/ai/firstmate/.env",
        os.path.expanduser("~/.env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
    ]

    for env_file in candidate_files:
        if os.path.exists(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("TYPESAFE_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip('"\'')
                            if val:
                                return val
            except Exception:
                pass
    return None


def call_jev(state, questions, model=DEFAULT_MODEL, timeout=15):
    """Execute a TypeSafe System One API call using standard library urllib."""
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("TYPESAFE_API_KEY not found in environment or /home/asus/ai/firstmate/.env")

    payload = {
        "state": state,
        "model": model,
        "questions": questions
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "VideoGen-JevDecider/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TypeSafe API HTTP {e.code}: {err_body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"TypeSafe API connection error: {e.reason}") from e


def cmd_screen_prompt(prompt_text):
    """
    Screen prompt using primitive `noul` to assess safety violation risk for Google Flow.
    Returns JSON: { "safe": boolean, "risk_score": float, "reason": str }
    """
    if not prompt_text or not prompt_text.strip():
        return {
            "safe": True,
            "risk_score": 0.0,
            "reason": "Empty prompt"
        }

    questions = {
        "risk": {
            "type": "noul",
            "instructions": (
                "Does this video generation prompt contain content policy violations, extreme violence, gore, "
                "weapons manufacturing, illegal drugs, explicit sexual content, hate speech, or terms highly likely "
                "to trigger AI video safety filters?"
            ),
            "criteria": {
                "true": "High risk of triggering AI video safety filters or violates content policy (violence, gore, weapons, drugs, explicit content).",
                "false": "Safe, standard cinematic storytelling, historical/technical depiction, or non-violating creative action."
            }
        },
        "concern_category": {
            "type": "choice",
            "instructions": "What is the primary policy category or nature of this prompt?",
            "criteria": {
                "safe": "Prompt is safe and compliant with AI video safety policies",
                "violence_or_weapons": "Weapons, explosives, extreme violence, blood, or physical harm",
                "explicit_sexual": "Sexual content, nudity, or adult explicit material",
                "hate_harassment": "Hate speech, defamation, or targeted harassment",
                "illicit_substances": "Illegal drugs, contraband, or illicit chemical production",
                "other_policy_risk": "Other sensitive topics or potential safety filter triggers"
            }
        }
    }

    resp = call_jev(prompt_text, questions)
    answers = resp.get("answers", {})

    risk_prob = float(answers.get("risk", {}).get("noul", 0.0))
    risk_score = round(risk_prob, 3)
    is_safe = risk_score < 0.40

    cat = answers.get("concern_category", {}).get("choice", "safe")
    cat_reasons = {
        "safe": "Prompt complies with AI video safety guidelines",
        "violence_or_weapons": "High risk of violence, weapons, or physical harm violation",
        "explicit_sexual": "High risk of adult or sexually explicit content violation",
        "hate_harassment": "High risk of hate speech or harassment violation",
        "illicit_substances": "High risk of illicit drugs or contraband policy violation",
        "other_policy_risk": "Potential AI content filter violation detected"
    }

    if is_safe:
        reason = "Prompt appears safe and complies with AI video safety guidelines"
    else:
        reason = cat_reasons.get(cat, "High risk of triggering AI video safety filters")

    return {
        "safe": is_safe,
        "risk_score": risk_score,
        "reason": reason
    }


def cmd_classify_tile(tile_text):
    """
    Classify Google Flow render tile state using primitive `choice`.
    Criteria: ready, generating, policy_refusal, error.
    """
    cleaned_text = (tile_text or "").strip()
    if not cleaned_text:
        return {
            "choice": "generating",
            "status": "generating",
            "confidence": 0.5,
            "probabilities": {"generating": 0.5, "error": 0.5, "ready": 0.0, "policy_refusal": 0.0}
        }

    # Fast heuristic check for obvious Google Flow refusal strings
    lower = cleaned_text.lower()
    if "không thành công" in lower or "vi phạm" in lower or "policy refusal" in lower or "violated" in lower:
        return {
            "choice": "policy_refusal",
            "status": "policy_refusal",
            "confidence": 1.0,
            "probabilities": {"policy_refusal": 1.0, "generating": 0.0, "ready": 0.0, "error": 0.0}
        }

    questions = {
        "tile_status": {
            "type": "choice",
            "instructions": "Classify the current operational state of this Google Flow video generation tile based on the UI text.",
            "criteria": {
                "ready": "Video generation is finished; video player is available, download option exists, or preview duration is ready.",
                "generating": "Video is currently generating, processing, or rendering (e.g. progress percentage like 10%, 45%, spinner, 'Đang tạo').",
                "policy_refusal": "Generation was refused, rejected, or blocked due to content policy, safety guidelines, moderation, or error messages like 'Không thành công', 'Vi phạm chính sách'.",
                "error": "Technical crash, network disconnection, server error, or unexpected UI failure not related to content policy refusal."
            }
        }
    }

    resp = call_jev(cleaned_text, questions)
    answers = resp.get("answers", {})
    choice_ans = answers.get("tile_status", {})
    choice = choice_ans.get("choice", "error")
    confidence = float(choice_ans.get("confidence", 0.0))
    probs = choice_ans.get("probabilities", {})

    return {
        "choice": choice,
        "status": choice,
        "confidence": confidence,
        "probabilities": probs
    }


def cmd_verify_elevenlabs(page_text):
    """
    Verify ElevenLabs TTS audio generation readiness using primitive `noul`.
    Returns JSON: { "ready": boolean, "score": float, "confidence": float }
    """
    cleaned_text = (page_text or "").strip()
    if not cleaned_text:
        return {
            "ready": False,
            "score": 0.0,
            "confidence": 0.0
        }

    questions = {
        "audio_ready": {
            "type": "noul",
            "instructions": (
                "Is the ElevenLabs text-to-speech audio generation completed and ready for playback or download?"
            ),
            "criteria": {
                "true": "Audio has finished generating; player is visible, duration is displayed, or download button is active; not loading or spinning.",
                "false": "Audio is still generating, spinning, loading, queued, or has failed."
            }
        }
    }

    resp = call_jev(cleaned_text, questions)
    answers = resp.get("answers", {})
    score = float(answers.get("audio_ready", {}).get("noul", 0.0))
    ready = score >= 0.60

    return {
        "ready": ready,
        "score": round(score, 3),
        "confidence": round(abs(score - 0.5) * 2, 3)
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: jev_decider.py {screen-prompt <prompt> | classify-tile <tile_text> | verify-elevenlabs <page_text>}", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    # Support passing text as argument or reading from stdin if argument is '-'
    if len(sys.argv) >= 3:
        if sys.argv[2] == "-":
            text_input = sys.stdin.read()
        else:
            text_input = sys.argv[2]
    else:
        text_input = sys.stdin.read() if not sys.stdin.isatty() else ""

    try:
        if cmd == "screen-prompt":
            res = cmd_screen_prompt(text_input)
            print(json.dumps(res, ensure_ascii=False, indent=2))
        elif cmd == "classify-tile":
            res = cmd_classify_tile(text_input)
            print(json.dumps(res, ensure_ascii=False, indent=2))
        elif cmd == "verify-elevenlabs":
            res = cmd_verify_elevenlabs(text_input)
            print(json.dumps(res, ensure_ascii=False, indent=2))
        else:
            print(f"Unknown command: {cmd}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        err_res = {
            "error": str(e),
            "safe": False,
            "status": "error",
            "ready": False
        }
        print(json.dumps(err_res, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

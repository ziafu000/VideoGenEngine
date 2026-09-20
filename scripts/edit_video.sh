#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# edit_video.sh - Chế độ 1: Tự động Edit Video hoàn chỉnh (Dynamic Subs + SFX Layering)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SFX_DIR="$PROJECT_DIR/assets/sfx"
STORYBOARD="$PROJECT_DIR/storyboards/scenes.json"

VIDEO_INPUT="${1:-$(ls -t "$PROJECT_DIR"/output/final_video_*.mp4 2>/dev/null | head -n 1 || true)}"
VOICE_INPUT="${2:-$PROJECT_DIR/audio/voiceover_en.mp3}"

if [ ! -f "$VIDEO_INPUT" ] || [ ! -f "$VOICE_INPUT" ]; then
    echo "[!] Lỗi: Không tìm thấy video gốc ($VIDEO_INPUT) hoặc file voice ($VOICE_INPUT)."
    exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FINAL="$PROJECT_DIR/output/final_with_voice_${TIMESTAMP}.mp4"
SUBTITLES_ASS="$PROJECT_DIR/renders/subtitles.ass"
MODELS_DIR="/mnt/d/Billy/Work/Editing/models"

echo "============================================================"
echo "          VIDEOGEN: AUTO-EDIT MODE 1 (SUBS + SFX)           "
echo "============================================================"
echo "[-] Video đầu vào: $VIDEO_INPUT"
echo "[-] Voiceover đầu vào: $VOICE_INPUT"

to_win_path() {
    local p="$1"
    if [[ "$p" =~ ^/mnt/([a-z])/(.*) ]]; then
        local drive="${BASH_REMATCH[1]}"
        local rest="${BASH_REMATCH[2]}"
        echo "${drive^^}:/$rest"
    else
        echo "$p"
    fi
}

VIDEO_WIN=$(to_win_path "$VIDEO_INPUT")
VOICE_WIN=$(to_win_path "$VOICE_INPUT")

VIDEO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_WIN" | tr -d '\r')
AUDIO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VOICE_WIN" | tr -d '\r')

echo "[-] Thời lượng video: ${VIDEO_DUR}s | Thời lượng audio: ${AUDIO_DUR}s"

# 1. Tính toán hệ số tempo audio để khớp hoàn hảo với video
RATIO=$(python3 -c "print(round($AUDIO_DUR / $VIDEO_DUR, 4))")
echo "[-] Hệ số căn chỉnh tốc độ audio (tempo): ${RATIO}x"

ATEMPO_FILTER=$(python3 -c "
r = $RATIO
if r < 0.5:
    print(f'atempo=0.5,atempo={round(r/0.5, 4)}')
elif r > 2.0:
    print(f'atempo=2.0,atempo={round(r/2.0, 4)}')
else:
    print(f'atempo={r}')
")

# 2. Tự động sinh phụ đề động chuẩn Shorts (Dynamic ASS Subtitles)
echo "[-] Đang tạo phụ đề động chuẩn Shorts (Whisper + Script Alignment)..."
node "$SCRIPT_DIR/generate_subtitles.js" "$VOICE_INPUT" "$SUBTITLES_ASS" "$VIDEO_DUR"

# Đảm bảo file phụ đề và SFX có sẵn trên ổ D: để ffmpeg Windows đọc mượt mà
mkdir -p "$MODELS_DIR/sfx"
cp -f "$SUBTITLES_ASS" "$MODELS_DIR/subtitles.ass"
cp -f "$SFX_DIR"/*.mp3 "$MODELS_DIR/sfx/"

# 3. Tính toán các điểm cắt cảnh (Scene transition timestamps)
# Mặc định: scene 1 kết thúc ở ~10s, scene 2 ở ~20s
CUT1_MS=9800
CUT2_MS=19800

# 4. Chạy FFmpeg render 1-pass: Burn ASS Subtitles + Layer SFX + Ducking
echo "[-] Đang tiến hành Render Video: Ép phụ đề động + Hòa âm đa tầng SFX..."
TEMP_RENDER_WIN="D:/Billy/Work/Editing/models/temp_rendered_edit.mp4"
LOCAL_TEMP_RENDER="/mnt/d/Billy/Work/Editing/models/temp_rendered_edit.mp4"

(cd "$MODELS_DIR" && ffmpeg -y \
  -i "$VIDEO_WIN" \
  -i "$VOICE_WIN" \
  -i "sfx/impact.mp3" \
  -i "sfx/whoosh.mp3" \
  -i "sfx/pop.mp3" \
  -filter_complex "\
    [1:a]${ATEMPO_FILTER},volume=1.0[voice]; \
    [0:a]volume=0.20[ambient]; \
    [2:a]volume=0.50[sfx_impact]; \
    [3:a]adelay=${CUT1_MS}|${CUT1_MS},volume=0.40[sfx_whoosh1]; \
    [3:a]adelay=${CUT2_MS}|${CUT2_MS},volume=0.40[sfx_whoosh2]; \
    [4:a]adelay=5500|5500,volume=0.35[sfx_pop]; \
    [voice][ambient][sfx_impact][sfx_whoosh1][sfx_whoosh2][sfx_pop]amix=inputs=6:duration=first:dropout_transition=0[aout]; \
    [0:v]ass='D\:/Billy/Work/Editing/models/subtitles.ass'[vout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  "$TEMP_RENDER_WIN")

mkdir -p "$PROJECT_DIR/output"
cp -f "$LOCAL_TEMP_RENDER" "$OUTPUT_FINAL"
rm -f "$LOCAL_TEMP_RENDER"

echo "✓ ĐÃ RENDER XONG VIDEO CHẾ ĐỘ 1:"
echo "  -> $OUTPUT_FINAL"

# Sao chép vào Windows Downloads để captain xem ngay
PREVIEW_NAME="Shorts_Edited_Mode1_$(basename "$OUTPUT_FINAL")"
cp -f "$OUTPUT_FINAL" "/mnt/c/Users/ASUS/Downloads/$PREVIEW_NAME"
echo "✓ Đã copy sang Windows Downloads để review: C:\\Users\\ASUS\\Downloads\\$PREVIEW_NAME"
echo "============================================================"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VIDEO_INPUT="${1:-$(ls -t "$PROJECT_DIR"/output/final_video_*.mp4 | head -n 1)}"
VOICE_INPUT="${2:-$PROJECT_DIR/audio/voiceover.mp3}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FINAL="$PROJECT_DIR/output/final_with_voice_${TIMESTAMP}.mp4"

if [ ! -f "$VIDEO_INPUT" ] || [ ! -f "$VOICE_INPUT" ]; then
    echo "Lỗi: Không tìm thấy file video hoặc file voice."
    exit 1
fi

echo "[-] Video gốc: $VIDEO_INPUT"
echo "[-] Voiceover: $VOICE_INPUT"

VIDEO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO_INPUT" | tr -d '\r')
AUDIO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VOICE_INPUT" | tr -d '\r')

echo "[-] Thời lượng video: ${VIDEO_DUR}s | Thời lượng audio: ${AUDIO_DUR}s"

# Tính toán tỷ lệ tốc độ để voice khớp với video
RATIO=$(python3 -c "print(round($AUDIO_DUR / $VIDEO_DUR, 4))")
echo "[-] Hệ số căn chỉnh tốc độ audio (tempo): ${RATIO}x"

# Xây dựng bộ lọc atempo an toàn (giới hạn 0.5 đến 2.0 của ffmpeg)
ATEMPO_FILTER=$(python3 -c "
r = $RATIO
if r < 0.5:
    print(f'atempo=0.5,atempo={round(r/0.5, 4)}')
elif r > 2.0:
    print(f'atempo=2.0,atempo={round(r/2.0, 4)}')
else:
    print(f'atempo={r}')
")

# Trộn voiceover (volume 1.0) và âm thanh SFX gốc của video (volume 0.25)
ffmpeg -y -i "$VIDEO_INPUT" -i "$VOICE_INPUT" -filter_complex \
    "[1:a]${ATEMPO_FILTER},volume=1.0[voice]; \
     [0:a]volume=0.25[sfx]; \
     [voice][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]" \
    -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k "$OUTPUT_FINAL"

echo "✓ Đã xuất video hoàn chỉnh kèm giọng đọc: $OUTPUT_FINAL"
cp -f "$OUTPUT_FINAL" /mnt/c/Users/ASUS/Downloads/Bí_Mật_Coca_Cola_Hoàn_Chỉnh_Voice.mp4
echo "✓ Đã copy sang Windows Downloads: C:\\Users\\ASUS\\Downloads\\Bí_Mật_Coca_Cola_Hoàn_Chỉnh_Voice.mp4"

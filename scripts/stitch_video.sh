#!/usr/bin/env bash
# stitch_video.sh: Ghép nối các phân cảnh trong renders/ thành video hoàn chỉnh tại output/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RENDERS_DIR="$PROJECT_DIR/renders"
OUTPUT_DIR="$PROJECT_DIR/output"
STORYBOARD="$PROJECT_DIR/storyboards/scenes.json"

mkdir -p "$OUTPUT_DIR"

CONCAT_LIST="$RENDERS_DIR/concat_list.txt"
rm -f "$CONCAT_LIST"

if [ -f "$STORYBOARD" ]; then
    echo "[-] Đọc danh sách phân cảnh theo thứ tự từ $STORYBOARD..."
    TOTAL_SCENES=$(jq '.scenes | length' "$STORYBOARD")
    for i in $(seq 0 $((TOTAL_SCENES - 1))); do
        SCENE_ID=$(jq -r ".scenes[$i].scene_id" "$STORYBOARD")
        CLIP="$RENDERS_DIR/${SCENE_ID}.mp4"
        if [ -f "$CLIP" ]; then
            echo "file '$CLIP'" >> "$CONCAT_LIST"
        else
            echo "[!] Cảnh báo: Thiếu file phân cảnh: $CLIP"
        fi
    done
else
    echo "[-] Không tìm thấy storyboards/scenes.json, tự động quét toàn bộ renders/*.mp4..."
    for f in "$RENDERS_DIR"/*.mp4; do
        [ -f "$f" ] || continue
        echo "file '$f'" >> "$CONCAT_LIST"
    done
fi

if [ ! -s "$CONCAT_LIST" ]; then
    echo "[!] Lỗi: Không có clip nào trong danh sách ghép nối."
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FINAL_OUTPUT="$OUTPUT_DIR/final_video_${TIMESTAMP}.mp4"

echo "[-] Bắt đầu ghép nối qua ffmpeg..."
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" -c copy "$FINAL_OUTPUT"

echo "✓ Video hoàn thành: $FINAL_OUTPUT"
ls -lh "$FINAL_OUTPUT"

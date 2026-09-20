#!/usr/bin/env bash
# render_pipeline.sh: Pipeline tự động chạy toàn bộ kịch bản scenes.json -> tải clips -> ghép video
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STORYBOARD="$PROJECT_DIR/storyboards/scenes.json"
RENDERS_DIR="$PROJECT_DIR/renders"
OUTPUT_DIR="$PROJECT_DIR/output"
LOG_FILE="$RENDERS_DIR/pipeline.log"

mkdir -p "$RENDERS_DIR" "$OUTPUT_DIR"

echo "============================================================"
echo "          VIDEOGEN AUTO PIPELINE: SCENES -> FINAL VIDEO     "
echo "============================================================"

if [ ! -f "$STORYBOARD" ]; then
    echo "[!] Lỗi: Không tìm thấy tệp kịch bản tại $STORYBOARD"
    echo "    Firstmate cần tạo storyboards/scenes.json trước khi kích hoạt pipeline."
    exit 1
fi

# 1. Đảm bảo cầu nối Chrome & Google Flow sẵn sàng
echo "[-] Khởi động & kiểm tra cầu nối trình duyệt..."
"$SCRIPT_DIR/start_bridge.sh"

ASPECT_RATIO=$(jq -r '.aspect_ratio // "16:9"' "$STORYBOARD")
echo "[-] Cấu hình thông số trên Google Flow: Tỷ lệ $ASPECT_RATIO, Thời lượng 10s, Model Omni 1.1 Flash..."
"$SCRIPT_DIR/flow_operator.sh" configure "$ASPECT_RATIO" 10

TOTAL_SCENES=$(jq '.scenes | length' "$STORYBOARD")
echo "[-] Tổng số phân cảnh cần xử lý: $TOTAL_SCENES"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bắt đầu quy trình render $TOTAL_SCENES phân cảnh..." >> "$LOG_FILE"

# 2. Vòng lặp xử lý từng cảnh
for i in $(seq 0 $((TOTAL_SCENES - 1))); do
    SCENE_ID=$(jq -r ".scenes[$i].scene_id" "$STORYBOARD")
    PROMPT=$(jq -r ".scenes[$i].prompt" "$STORYBOARD")
    DURATION=$(jq -r ".scenes[$i].duration_seconds // 6" "$STORYBOARD")
    OUTPUT_CLIP="$RENDERS_DIR/${SCENE_ID}.mp4"

    echo ""
    echo ">>> [Cảnh $((i + 1))/$TOTAL_SCENES] Xử lý: $SCENE_ID (${DURATION}s)..."

    if [ -f "$OUTPUT_CLIP" ] && [ -s "$OUTPUT_CLIP" ]; then
        echo "  ✓ $SCENE_ID đã tồn tại, tự động bỏ qua."
        continue
    fi

    echo "  1. Gửi prompt vào Google Flow..."
    "$SCRIPT_DIR/flow_operator.sh" submit "$PROMPT"

    echo "  2. Chờ Google Flow render video..."
    if "$SCRIPT_DIR/flow_operator.sh" wait 240; then
        echo "  3. Tải video về thư mục renders/..."
        if "$SCRIPT_DIR/flow_operator.sh" download "$OUTPUT_CLIP"; then
            echo "  ✓ Đã lưu thành công: $OUTPUT_CLIP"
        else
            echo "[!] Lỗi tải video cho $SCENE_ID."
            exit 1
        fi
    else
        echo "[!] Quá thời gian render tại cảnh $SCENE_ID."
        exit 1
    fi
done

# 3. Ghép nối thành phẩm
echo ""
echo "[-] Đang tiến hành ghép nối toàn bộ các phân cảnh bằng FFmpeg..."
"$SCRIPT_DIR/stitch_video.sh"

echo ""
echo "============================================================"
echo "          HOÀN THÀNH TOÀN BỘ QUY TRÌNH TỪ A ĐẾN Z!          "
echo "============================================================"

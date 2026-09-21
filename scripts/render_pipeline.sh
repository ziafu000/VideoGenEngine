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

    # Tự động đồng bộ nhân vật theo phân cảnh (Mode 2: Anime Series hoặc Storyboards có characters)
    CHAR_COUNT=$(jq -r ".scenes[$i].characters | if . and type == \"array\" then length else 0 end" "$STORYBOARD" 2>/dev/null || echo 0)
    if [ "$CHAR_COUNT" -gt 0 ]; then
        echo "  [-] Phát hiện $CHAR_COUNT nhân vật cho $SCENE_ID. Đang thiết lập thẻ nhân vật Google Flow..."
        "$SCRIPT_DIR/flow_operator.sh" clear-characters
        while IFS= read -r char_name; do
            if [ -n "$char_name" ] && [ "$char_name" != "null" ]; then
                echo "      + Gắn nhân vật: $char_name"
                "$SCRIPT_DIR/flow_operator.sh" add-character "$char_name"
            fi
        done < <(jq -r ".scenes[$i].characters[]" "$STORYBOARD")
    fi

    echo "  1. Gửi prompt vào Google Flow..."
    if ! "$SCRIPT_DIR/flow_operator.sh" submit "$PROMPT"; then
        echo ""
        echo "[!] Pipeline dừng tại cảnh $SCENE_ID: Gửi prompt không thành công (kiểm tra an toàn TypeSafe Jev hoặc kết nối DOM)."
        exit 1
    fi

    echo "  2. Chờ Google Flow render video..."
    set +e
    "$SCRIPT_DIR/flow_operator.sh" wait 240
    WAIT_CODE=$?
    set -e

    if [ $WAIT_CODE -eq 2 ]; then
        echo ""
        echo "=========================================================================="
        echo "[!] PIPELINE BỊ TỪ CHỐI BỞI CHÍNH SÁCH GOOGLE FLOW TẠI PHÂN CẢNH $SCENE_ID"
        echo "[!] TypeSafe Jev đã phát hiện và ngắt tiến trình sớm để tiết kiệm thời gian."
        echo "[!] Hướng dẫn khắc phục:"
        echo "    1. Mở file '$STORYBOARD'"
        echo "    2. Điều chỉnh lại mô tả 'prompt' của '$SCENE_ID' (tránh bạo lực/vũ khí/từ nhạy cảm)"
        echo "    3. Chạy lại: ./scripts/render_pipeline.sh"
        echo "=========================================================================="
        exit 2
    elif [ $WAIT_CODE -ne 0 ]; then
        echo ""
        echo "[!] Pipeline thất bại tại cảnh $SCENE_ID (mã lỗi $WAIT_CODE): Quá thời gian render hoặc lỗi kỹ thuật."
        exit 1
    fi

    echo "  3. Tải video về thư mục renders/..."
    if ! "$SCRIPT_DIR/flow_operator.sh" download "$OUTPUT_CLIP"; then
        echo "[!] Lỗi tải video cho cảnh $SCENE_ID."
        exit 1
    fi
    echo "  ✓ Đã lưu thành công: $OUTPUT_CLIP"
done

# 3. Ghép nối thành phẩm
echo ""
echo "[-] Đang tiến hành ghép nối toàn bộ các phân cảnh bằng FFmpeg..."
"$SCRIPT_DIR/stitch_video.sh"

# 4. Tự động Edit video hoàn chỉnh Chế độ 1 (Phụ đề động + Hòa âm SFX)
VOICE_EN="$PROJECT_DIR/audio/voiceover_en.mp3"
if [ -f "$VOICE_EN" ]; then
    echo ""
    echo "[-] Phát hiện file voiceover tiếng Anh: $VOICE_EN"
    echo "[-] Đang kích hoạt Chế độ 1: Tự động tạo phụ đề động & hòa âm SFX..."
    "$SCRIPT_DIR/edit_video.sh" "$(ls -t "$OUTPUT_DIR"/final_video_*.mp4 | head -n 1)" "$VOICE_EN"
fi

# 5. Tự động lưu trữ materials sang D: drive và dọn dẹp repo
echo ""
echo "[-] Kích hoạt lưu trữ materials & dọn dẹp repo..."
"$SCRIPT_DIR/archive_and_cleanup.sh"

echo ""
echo "============================================================"
echo "          HOÀN THÀNH TOÀN BỘ QUY TRÌNH TỪ A ĐẾN Z!          "
echo "============================================================"

#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# archive_and_cleanup.sh - Di chuyển materials và thành phẩm sang D: drive,
#                         sau đó dọn dẹp sạch repo VideoGen.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STORYBOARD="$PROJECT_DIR/storyboards/scenes.json"

DEST_ORIGINAL="/mnt/d/Billy/Work/Editing/File video original"
DEST_FINAL="/mnt/d/Billy/Work/Editing/File video after edit"

echo "============================================================"
echo "          VIDEOGEN: ARCHIVE MATERIALS & REPO CLEANUP        "
echo "============================================================"

# 1. Kiểm tra thư mục đích trên Windows D: drive
if [ ! -d "$DEST_ORIGINAL" ] || [ ! -d "$DEST_FINAL" ]; then
    echo "[!] Lỗi: Không tìm thấy thư mục lưu trữ trên ổ D:."
    echo "    Đảm bảo đường dẫn tồn tại:"
    echo "    - $DEST_ORIGINAL"
    echo "    - $DEST_FINAL"
    exit 1
fi

# 2. Xác định tên video và mốc thời gian
TITLE=$(jq -r '.title // "video_project"' "$STORYBOARD" 2>/dev/null || echo "video_project")
SAFE_NAME=$(echo "$TITLE" | tr ' ' '_' | tr -cd 'A-Za-z0-9_-')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "[-] Tiêu đề dự án: $TITLE ($SAFE_NAME)"

# 3. Tạo thư mục lưu trữ materials tương ứng cho dự án này
ARCHIVE_MAT_DIR="$DEST_ORIGINAL/${SAFE_NAME}_materials_${TIMESTAMP}"
mkdir -p "$ARCHIVE_MAT_DIR"

echo "[-] Di chuyển toàn bộ file materials sang: $ARCHIVE_MAT_DIR"

# Di chuyển clips thô từ renders/
if compgen -G "$PROJECT_DIR/renders/*.mp4" > /dev/null; then
    mv -f "$PROJECT_DIR/renders/"*.mp4 "$ARCHIVE_MAT_DIR/"
    echo "  ✓ Đã di chuyển các phân cảnh raw từ renders/"
fi

# Di chuyển voiceover từ audio/
if compgen -G "$PROJECT_DIR/audio/*.mp3" > /dev/null; then
    mv -f "$PROJECT_DIR/audio/"*.mp3 "$ARCHIVE_MAT_DIR/"
    echo "  ✓ Đã di chuyển file voiceover từ audio/"
fi

# Lưu kèm 1 bản sao storyboard kịch bản & prompt vào folder materials
if [ -f "$STORYBOARD" ]; then
    cp -f "$STORYBOARD" "$ARCHIVE_MAT_DIR/storyboard_backup.json"
    echo "  ✓ Đã lưu kèm kịch bản chi tiết vào thư mục materials"
fi

# 4. Di chuyển file thành phẩm cuối cùng sang "File video after edit"
LATEST_MASTER=$(ls -t "$PROJECT_DIR"/output/final_with_voice_*.mp4 2>/dev/null | head -n 1 || true)
if [ -z "$LATEST_MASTER" ]; then
    # Nếu không có final_with_voice thì lấy final_video mới nhất
    LATEST_MASTER=$(ls -t "$PROJECT_DIR"/output/final_video_*.mp4 2>/dev/null | head -n 1 || true)
fi

if [ -n "$LATEST_MASTER" ] && [ -f "$LATEST_MASTER" ]; then
    TARGET_MASTER_FILE="$DEST_FINAL/${SAFE_NAME}.mp4"
    if [ -f "$TARGET_MASTER_FILE" ]; then
        TARGET_MASTER_FILE="$DEST_FINAL/${SAFE_NAME}_${TIMESTAMP}.mp4"
    fi
    cp -f "$LATEST_MASTER" "$TARGET_MASTER_FILE"
    echo "✓ ĐÃ MIGRATE THÀNH PHẨM CUỐI CÙNG SANG:"
    echo "  -> $TARGET_MASTER_FILE"
else
    echo "[!] Cảnh báo: Không tìm thấy file video thành phẩm trong output/"
fi

# Di chuyển các video render trung gian cũ trong output sang materials archive
if compgen -G "$PROJECT_DIR/output/*.mp4" > /dev/null; then
    mv -f "$PROJECT_DIR/output/"*.mp4 "$ARCHIVE_MAT_DIR/" 2>/dev/null || true
    echo "  ✓ Đã lưu trữ các video nháp/trung gian vào thư mục materials"
fi

# 5. Dọn dẹp sạch sẽ bên trong repo VideoGen (chỉ giữ lại .gitkeep)
echo "[-] Dọn dẹp sạch các thư mục tạm trong repo VideoGen..."
find "$PROJECT_DIR/renders" -type f ! -name '.gitkeep' -delete
find "$PROJECT_DIR/audio" -type f ! -name '.gitkeep' -delete
find "$PROJECT_DIR/output" -type f ! -name '.gitkeep' -delete

echo "✓ Đã dọn dẹp xong: renders/, audio/, output/ hoàn toàn sạch sẽ!"
echo "✓ Repo VideoGen hiện tại chỉ chứa code, tools và docs — không bị phình dung lượng!"
echo "============================================================"

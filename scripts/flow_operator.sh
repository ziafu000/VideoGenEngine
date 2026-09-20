#!/usr/bin/env bash
# flow_operator.sh: CLI điều khiển Google Flow qua CDP cho Pi Worker & Firstmate
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WIN_HOST=$(ip route | awk '/default/ {print $3}')
PROXY_URL="http://$WIN_HOST:9223"
DOWNLOADS_DIR="/mnt/c/Users/ASUS/Downloads"

export CHROME_DEVTOOLS_AXI_BROWSER_URL="$PROXY_URL"

ensure_connection() {
    if ! curl -s --connect-timeout 2 "$PROXY_URL/json/version" >/dev/null 2>&1; then
        echo "[!] CDP bridge chưa chạy. Đang tự động kích hoạt qua start_bridge.sh..."
        "$SCRIPT_DIR/start_bridge.sh" >/dev/null
    fi
}

cmd_configure() {
    local aspect="${1:-16:9}"
    local duration="${2:-10}"
    ensure_connection
    echo "[-] Cấu hình Google Flow: Tỷ lệ $aspect, Thời lượng ${duration}s, Model Omni 1.1 Flash..."
    chrome-devtools-axi eval "() => {
      let overlay = document.querySelector('.cdk-overlay-container');
      const hasToggles = overlay && overlay.querySelectorAll('button.mat-button-toggle-button').length > 0;
      if (!hasToggles) {
        const settingsBtn = document.querySelector('button.settings-trigger-button, button[aria-label=\"Điều kiện kích hoạt cài đặt\"], button[aria-label=\"Settings trigger\"]');
        if (settingsBtn) settingsBtn.click();
      }
      return 'OPENED';
    }"
    sleep 1
    chrome-devtools-axi eval "() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      if (!overlay) return 'NO_OVERLAY';

      // 1. Chuyển sang Video nếu đang ở Image
      const videoBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes('Video'));
      if (videoBtn && !videoBtn.parentElement.classList.contains('mat-button-toggle-checked')) {
        videoBtn.click();
      }

      // 2. Chọn tỷ lệ: 9:16 (dọc) hoặc 16:9 (ngang)
      const targetAspect = '$aspect' === '9:16' ? '9:16' : '16:9';
      const aspectBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes(targetAspect));
      if (aspectBtn) aspectBtn.click();

      // 3. Chọn thời lượng: 10 giây
      const durText = '$duration' === '10' || '$duration' === '10s' ? '10 giây' : '$duration' + ' giây';
      const durBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes(durText));
      if (durBtn) durBtn.click();

      return 'CONFIGURED';
    }"
    sleep 1
    chrome-devtools-axi press Escape >/dev/null 2>&1 || true
}

cmd_status() {
    ensure_connection
    echo "=== GOOGLE FLOW STATUS ==="
    chrome-devtools-axi pages
    chrome-devtools-axi eval '() => {
      const pm = document.querySelector(".ProseMirror");
      const genBtn = document.querySelector("button.generate-icon-button, button[aria-label=\"Start generation\"], button[aria-label=\"Bắt đầu tạo\"]");
      const videoTiles = document.querySelectorAll("flow-video-tile");
      const loading = document.querySelectorAll("mat-progress-spinner, mat-progress-bar, .loading, .spinner");
      return {
        promptValue: pm ? pm.innerText.trim() : "(không tìm thấy input)",
        generateBtnReady: genBtn ? !genBtn.disabled : false,
        totalVideoTiles: videoTiles.length,
        isGenerating: loading.length > 0
      };
    }'
}

cmd_submit_prompt() {
    local prompt_text="${1:-}"
    if [ -z "$prompt_text" ]; then
        echo "Lỗi: Vui lòng cung cấp nội dung prompt."
        exit 1
    fi
    ensure_connection

    echo "[-] Đang điền prompt vào Google Flow..."
    # Escape single and double quotes for safe JS injection
    local escaped_prompt
    escaped_prompt=$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$prompt_text")

    chrome-devtools-axi eval "() => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return 'LỖI: Không tìm thấy ô nhập prompt .ProseMirror';
      pm.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, $escaped_prompt);
      
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label=\"Start generation\"], button[aria-label=\"Bắt đầu tạo\"]');
      return {
        textEntered: pm.innerText.trim().slice(0, 50) + '...',
        generateBtnDisabled: genBtn ? genBtn.disabled : true
      };
    }"

    sleep 1

    echo "[-] Kiểm tra và kích hoạt nút Bắt đầu tạo (Start generation)..."
    local ready
    ready=$(chrome-devtools-axi eval '() => {
      const genBtn = document.querySelector("button.generate-icon-button, button[aria-label=\"Start generation\"], button[aria-label=\"Bắt đầu tạo\"]");
      if (genBtn && !genBtn.disabled) {
        genBtn.click();
        return "CLICKED";
      }
      return "DISABLED";
    }')

    if [[ "$ready" == *"CLICKED"* ]]; then
        echo "✓ Đã bấm Start generation thành công!"
    else
        echo "[!] Cảnh báo: Nút Start generation đang bị khóa hoặc chưa sẵn sàng: $ready"
        exit 1
    fi
}

cmd_wait_render() {
    local timeout_secs="${1:-180}"
    ensure_connection
    echo "[-] Chờ Google Flow render xong video (tối đa ${timeout_secs}s)..."
    local elapsed=0
    while [ "$elapsed" -lt "$timeout_secs" ]; do
        sleep 5
        elapsed=$((elapsed + 5))
        local state
        state=$(chrome-devtools-axi eval '() => {
          const tile = document.querySelector("flow-video-tile");
          if (!tile) return "WAITING_TILE";
          const pending = tile.querySelector("flow-pending-tile");
          const match = tile.innerText.match(/(\d+)%/);
          if (pending || match) {
            return "GENERATING: " + (match ? match[1] + "%" : "...");
          }
          if (tile.querySelector("video") || tile.querySelector(".mat-mdc-menu-trigger")) {
            return "READY";
          }
          return "WAITING";
        }')
        if [[ "$state" == *"READY"* ]]; then
            echo ""
            echo "✓ Video đã render xong (hoàn tất sau ${elapsed}s)!"
            return 0
        fi
        local percent
        percent=$(echo "$state" | grep -o '[0-9]*%' || echo "...")
        echo -ne "\r  Render tiến trình: $percent (${elapsed}s)... "
    done
    echo ""
    echo "[!] Quá thời gian chờ render (${timeout_secs}s)."
    return 1
}

cmd_download_latest() {
    local target_file="${1:-$PROJECT_DIR/renders/latest_scene.mp4}"
    ensure_connection
    mkdir -p "$(dirname "$target_file")"

    echo "[-] Đang kích hoạt tải về video (720p gốc)..."
    touch /tmp/flow_dl_marker
    sleep 0.5

    chrome-devtools-axi eval '() => {
      const tile = document.querySelector("flow-video-tile");
      if (!tile) return "LỖI: Không tìm thấy video tile nào";
      const moreBtn = tile.querySelector("button[aria-label=\"Tuỳ chọn khác\"], button[aria-label=\"More options\"], .mat-mdc-menu-trigger");
      if (moreBtn) moreBtn.click();
      return "CLICKED_MORE";
    }'
    sleep 1

    chrome-devtools-axi eval '() => {
      const items = Array.from(document.querySelectorAll("[role=\"menuitem\"], .mat-mdc-menu-item"));
      const dl = items.find(m => m.innerText.includes("Tải xuống") || m.innerText.includes("Download"));
      if (dl) dl.click();
      return "CLICKED_DOWNLOAD";
    }'
    sleep 1

    chrome-devtools-axi eval '() => {
      const subItems = Array.from(document.querySelectorAll("[role=\"menuitem\"], .mat-mdc-menu-item"));
      const p720 = subItems.find(m => m.innerText.includes("720p"));
      if (p720) p720.click();
      return "CLICKED_720P";
    }'

    echo "[-] Chờ tệp hoàn tất tải về tại $DOWNLOADS_DIR..."
    local downloaded_file=""
    for i in {1..60}; do
        # Đợi các file tạm .crdownload tải xong
        if ls "$DOWNLOADS_DIR"/*.crdownload >/dev/null 2>&1; then
            sleep 1
            continue
        fi

        # Tìm file mp4 mới được tạo sau mốc touch /tmp/flow_dl_marker
        local newest
        newest=$(find "$DOWNLOADS_DIR" -maxdepth 1 -name "*.mp4" -newer /tmp/flow_dl_marker 2>/dev/null | head -n 1 || true)
        if [ -n "$newest" ] && [ -f "$newest" ]; then
            local sz
            sz=$(stat -c %s "$newest" 2>/dev/null || echo 0)
            if [ "$sz" -gt 100000 ]; then
                downloaded_file="$newest"
                break
            fi
        fi
        sleep 1
    done

    if [ -n "$downloaded_file" ] && [ -f "$downloaded_file" ]; then
        echo "✓ Đã tải về: $downloaded_file"
        cp -f "$downloaded_file" "$target_file"
        echo "✓ Đã chuyển thành công vào: $target_file"
    else
        echo "[!] Không tìm thấy file video mới tải về trong $DOWNLOADS_DIR sau 60s."
        exit 1
    fi
}

case "${1:-status}" in
    status)
        cmd_status
        ;;
    configure)
        cmd_configure "${2:-16:9}" "${3:-10}"
        ;;
    submit)
        cmd_submit_prompt "${2:-}"
        ;;
    wait)
        cmd_wait_render "${2:-180}"
        ;;
    download)
        cmd_download_latest "${2:-}"
        ;;
    *)
        echo "Cách dùng: $0 {status | submit <prompt> | download <output_path>}"
        exit 1
        ;;
esac

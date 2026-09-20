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
      // Mở cài đặt nếu chưa mở
      const trigger = Array.from(document.querySelectorAll('button')).find(b => 
        (b.innerText && b.innerText.includes('Điều kiện kích hoạt cài đặt')) || 
        (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('cài đặt')) ||
        b.classList.contains('settings-trigger-button')
      );
      if (trigger) trigger.click();
      return 'TRIGGERED';
    }"
    sleep 1
    chrome-devtools-axi eval "() => {
      // Hỗ trợ cả giao diện mới (role=radio) và giao diện cũ (mat-button-toggle)
      const radios = Array.from(document.querySelectorAll('[role=\"radio\"]'));
      if (radios.length > 0) {
        // 1. Chuyển sang Video nếu đang ở Image
        const videoRadio = radios.find(r => r.innerText.includes('Video') || r.innerText.includes('videocam'));
        if (videoRadio && videoRadio.getAttribute('aria-checked') !== 'true') {
          videoRadio.click();
        }

        // 2. Chọn tỷ lệ: 16:9 hoặc 9:16
        const targetAspect = '$aspect' === '9:16' ? '9:16' : '16:9';
        const aspectRadio = radios.find(r => r.innerText.includes(targetAspect));
        if (aspectRadio && aspectRadio.getAttribute('aria-checked') !== 'true') {
          aspectRadio.click();
        }

        // 3. Chọn thời lượng: 10 giây
        const durText = '$duration' === '10' || '$duration' === '10s' ? '10 giây' : '$duration' + ' giây';
        const durRadio = radios.find(r => r.innerText.includes(durText));
        if (durRadio && durRadio.getAttribute('aria-checked') !== 'true') {
          durRadio.click();
        }
        return 'CONFIGURED_RADIO';
      }

      // Fallback: Giao diện cũ cdk-overlay
      const overlay = document.querySelector('.cdk-overlay-container');
      if (!overlay) return 'NO_SETTINGS_PANEL';

      const videoBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes('Video'));
      if (videoBtn && !videoBtn.parentElement.classList.contains('mat-button-toggle-checked')) {
        videoBtn.click();
      }

      const targetAspect = '$aspect' === '9:16' ? '9:16' : '16:9';
      const aspectBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes(targetAspect));
      if (aspectBtn) aspectBtn.click();

      const durText = '$duration' === '10' || '$duration' === '10s' ? '10 giây' : '$duration' + ' giây';
      const durBtn = Array.from(overlay.querySelectorAll('button.mat-button-toggle-button')).find(b => b.innerText.includes(durText));
      if (durBtn) durBtn.click();

      return 'CONFIGURED_TOGGLE';
    }"
    sleep 1
    chrome-devtools-axi press Escape >/dev/null 2>&1 || true
}

cmd_add_character() {
    local char_name="${1:-}"
    if [ -z "$char_name" ]; then
        echo "Lỗi: Vui lòng cung cấp tên nhân vật (ví dụ: Ashel, Selena, Kiran, Valerie, Master Eldrin)."
        exit 1
    fi
    ensure_connection
    echo "[-] Đang gắn thẻ nhân vật: $char_name vào ô prompt Google Flow..."

    local escaped_name
    escaped_name=$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$char_name")

    chrome-devtools-axi eval "() => {
      const addBtn = document.querySelector('button[aria-label*=\"Thêm thành phần\"], flow-add-menu button');
      if (!addBtn) return { error: 'Không tìm thấy nút Thêm thành phần' };
      addBtn.click();
      
      setTimeout(() => {
        const tabs = Array.from(document.querySelectorAll('[role=\"tab\"]'));
        const charTab = tabs.find(t => t.innerText.includes('Nhân vật'));
        if (charTab) charTab.click();
        
        setTimeout(() => {
          const options = Array.from(document.querySelectorAll('[role=\"option\"]'));
          const opt = options.find(o => o.innerText.toLowerCase().includes($escaped_name.toLowerCase()) || 
                                       (o.getAttribute('value')||'').toLowerCase().includes($escaped_name.toLowerCase()));
          if (!opt) return;
          opt.click();
          
          setTimeout(() => {
            const insertBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Thêm vào câu lệnh'));
            if (insertBtn) insertBtn.click();
          }, 150);
        }, 150);
      }, 150);
      return { ok: true, character: $escaped_name };
    }"
    sleep 1
    echo "✓ Đã gắn nhân vật: $char_name"
}

cmd_clear_characters() {
    ensure_connection
    echo "[-] Đang dọn dẹp các thẻ nhân vật / thành phần trong ô prompt..."
    chrome-devtools-axi eval "() => {
      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Xoá câu lệnh'));
      if (clearBtn) {
        clearBtn.click();
        return 'CLEARED_VIA_BUTTON';
      }
      const chips = Array.from(document.querySelectorAll('flow-character-ingredient-chip'));
      chips.forEach(chip => {
        const btn = chip.querySelector('button, mat-icon');
        if (btn) btn.click();
      });
      return 'CLEARED_CHIPS';
    }"
    sleep 0.5
    echo "✓ Đã dọn dẹp xong thẻ nhân vật."
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
      const charChips = Array.from(document.querySelectorAll("flow-character-ingredient-chip"));
      return {
        promptValue: pm ? pm.innerText.trim() : "(không tìm thấy input)",
        attachedCharactersCount: charChips.length,
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
    add-character|character|add-char)
        shift
        for char in "$@"; do
            cmd_add_character "$char"
        done
        ;;
    clear-characters|clear-chars)
        cmd_clear_characters
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
        echo "Cách dùng: $0 {status | configure [aspect] [dur] | add-character <name...> | clear-characters | submit <prompt> | wait [timeout] | download <output_path>}"
        exit 1
        ;;
esac

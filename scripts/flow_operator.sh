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

    # TypeSafe Jev Pre-flight Prompt Screening
    local jev_decider="$SCRIPT_DIR/jev_decider.py"
    if [ -f "$jev_decider" ]; then
        echo "[-] TypeSafe Jev: Đang đánh giá an toàn nội dung prompt..."
        local screen_out
        if screen_out=$(python3 "$jev_decider" screen-prompt "$prompt_text" 2>/dev/null); then
            local is_safe
            local risk_score
            local reason
            is_safe=$(echo "$screen_out" | jq -r '.safe // true')
            risk_score=$(echo "$screen_out" | jq -r '.risk_score // 0')
            reason=$(echo "$screen_out" | jq -r '.reason // ""')

            if [ "$is_safe" = "false" ]; then
                echo "================================================================="
                echo "[!] CẢNH BÁO NGUY CƠ CHÍNH SÁCH CAO TỪ TYPESAFE JEV!"
                echo "[!] Mức độ rủi ro: $risk_score (Nguyên nhân: $reason)"
                echo "[!] Prompt có nguy cơ cao kích hoạt bộ lọc kiểm duyệt của Google Flow."
                echo "================================================================="
                if [ "${ALLOW_RISKY_PROMPT:-0}" != "1" ] && awk "BEGIN {exit !($risk_score > 0.70)}"; then
                    echo "[!] DỪNG GỬI PROMPT: Điểm rủi ro ($risk_score > 0.70) vượt ngưỡng cho phép."
                    echo "    Để tiếp tục thử nghiệm, chạy lại với: ALLOW_RISKY_PROMPT=1"
                    return 1
                fi
            else
                echo "✓ TypeSafe Jev: Prompt an toàn (Điểm rủi ro: $risk_score)."
            fi
        fi
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
      pm.dispatchEvent(new Event('input', { bubbles: true }));
      pm.dispatchEvent(new Event('change', { bubbles: true }));
      pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      
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
    local jev_decider="$SCRIPT_DIR/jev_decider.py"

    while [ "$elapsed" -lt "$timeout_secs" ]; do
        sleep 5
        elapsed=$((elapsed + 5))

        # Trích xuất trạng thái DOM và nội dung văn bản của tile
        local raw_state
        raw_state=$(chrome-devtools-axi eval '() => {
          const tile = document.querySelector("flow-video-tile");
          if (!tile) return "NO_TILE||||";
          const text = (tile.innerText || "").replace(/[\r\n]+/g, " ").trim();
          const hasVideo = !!tile.querySelector("video");
          const hasMenu = !!tile.querySelector(".mat-mdc-menu-trigger, button[aria-label*=\"Tuỳ chọn\"], button[aria-label*=\"More\"]");
          const pending = !!tile.querySelector("flow-pending-tile");
          const match = text.match(/(\d+)%/);
          const percent = match ? match[1] : "";
          
          let domStatus = "WAITING";
          if (hasVideo || hasMenu) {
            domStatus = "READY";
          } else if (pending || percent) {
            domStatus = "GENERATING";
          }
          return domStatus + "|||" + percent + "|||" + text;
        }' 2>/dev/null || echo "ERROR||||")

        # Parse output từ chrome-devtools-axi eval
        # Format: result: "DOM_STATUS|||PERCENT|||TEXT"
        local cleaned_raw
        cleaned_raw=$(echo "$raw_state" | sed -E 's/^result: "//; s/"$//')
        local dom_status
        local percent
        local tile_text
        dom_status=$(echo "$cleaned_raw" | awk -F'\\|\\|\\|' '{print $1}')
        percent=$(echo "$cleaned_raw" | awk -F'\\|\\|\\|' '{print $2}')
        tile_text=$(echo "$cleaned_raw" | awk -F'\\|\\|\\|' '{print $3}')

        # 1. Phát hiện sớm lỗi từ chối chính sách (policy_refusal) bằng TypeSafe Jev & Heuristics
        local tile_lower
        tile_lower=$(echo "$tile_text" | tr '[:upper:]' '[:lower:]')
        local is_policy_refusal=false

        if [[ "$tile_lower" == *"không thành công"* ]] || [[ "$tile_lower" == *"vi phạm"* ]] || [[ "$tile_lower" == *"policy refusal"* ]] || [[ "$tile_lower" == *"guideline"* ]]; then
            is_policy_refusal=true
        elif [ -n "$tile_text" ] && [ "$dom_status" != "READY" ] && [ -f "$jev_decider" ]; then
            local classify_res
            classify_res=$(python3 "$jev_decider" classify-tile "$tile_text" 2>/dev/null || true)
            local status_choice
            status_choice=$(echo "$classify_res" | jq -r '.choice // .status // ""' 2>/dev/null || true)
            if [ "$status_choice" = "policy_refusal" ]; then
                is_policy_refusal=true
            fi
        fi

        if [ "$is_policy_refusal" = "true" ]; then
            echo ""
            echo "================================================================="
            echo "[!] PHÁT HIỆN SỚM: GOOGLE FLOW TỪ CHỐI TẠO VIDEO (policy_refusal)!"
            echo "[!] Thông báo trên tile: $tile_text"
            echo "[!] Thoát ngay sau ${elapsed}s để tiết kiệm thời gian (thay vì chờ ${timeout_secs}s)."
            echo "================================================================="
            return 2
        fi

        # 2. Kiểm tra video đã hoàn thành
        if [ "$dom_status" = "READY" ]; then
            echo ""
            echo "✓ Video đã render xong (hoàn tất sau ${elapsed}s)!"
            return 0
        fi

        # 3. Tiến trình đang tạo
        local pct_display="${percent:+$percent%}"
        pct_display="${pct_display:-...}"
        echo -ne "\r  Render tiến trình: $pct_display (${elapsed}s)... "
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

    local dl_menu_triggered=false
    local max_retries=3

    for attempt in $(seq 1 $max_retries); do
        echo "  [*] Thử mở menu tải về (Lần $attempt/$max_retries)..."

        # Bước 1: Tìm tile và bấm nút "Tuỳ chọn khác" / "More options"
        local click_more_res
        click_more_res=$(chrome-devtools-axi eval '() => {
          const tile = document.querySelector("flow-video-tile");
          if (!tile) return "ERR_NO_TILE";
          const moreBtn = tile.querySelector("button[aria-label*=\"Tuỳ chọn\"], button[aria-label*=\"More\"], .mat-mdc-menu-trigger");
          if (!moreBtn) return "ERR_NO_MORE_BTN";
          moreBtn.scrollIntoView({ block: "center" });
          moreBtn.click();
          return "OK_MORE_CLICKED";
        }' 2>/dev/null || true)

        if [[ "$click_more_res" != *"OK_MORE_CLICKED"* ]]; then
            echo "    [!] Chưa tìm thấy nút Tuỳ chọn khác ($click_more_res), đợi 1s..."
            sleep 1
            continue
        fi

        sleep 0.8

        # Bước 2: Kiểm tra panel menu đã mở và bấm "Tải xuống" / "Download"
        local click_dl_res
        click_dl_res=$(chrome-devtools-axi eval '() => {
          const menus = Array.from(document.querySelectorAll(".mat-mdc-menu-panel, [role=\"menu\"]"));
          if (menus.length === 0) return "ERR_NO_MENU_PANEL";
          const items = Array.from(document.querySelectorAll("[role=\"menuitem\"], .mat-mdc-menu-item"));
          const dlItem = items.find(m => {
            const txt = (m.innerText || "").toLowerCase();
            return txt.includes("tải xuống") || txt.includes("download");
          });
          if (!dlItem) return "ERR_NO_DL_ITEM";
          dlItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          dlItem.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
          dlItem.click();
          return "OK_DL_CLICKED";
        }' 2>/dev/null || true)

        if [[ "$click_dl_res" != *"OK_DL_CLICKED"* ]]; then
            echo "    [!] Chưa mở được menu Tải xuống ($click_dl_res), đợi 1s..."
            sleep 1
            continue
        fi

        sleep 0.8

        # Bước 3: Tìm và bấm tuỳ chọn "720p" (Kích thước gốc)
        local click_720_res
        click_720_res=$(chrome-devtools-axi eval '() => {
          const items = Array.from(document.querySelectorAll("[role=\"menuitem\"], .mat-mdc-menu-item, button"));
          const p720 = items.find(m => {
            const txt = (m.innerText || "").toLowerCase();
            return txt.includes("720p") || txt.includes("kích thước gốc") || txt.includes("original size");
          });
          if (!p720) return "ERR_NO_720P";
          p720.click();
          return "OK_720P_CLICKED";
        }' 2>/dev/null || true)

        if [[ "$click_720_res" == *"OK_720P_CLICKED"* ]]; then
            echo "  ✓ Đã kích hoạt lệnh tải xuống 720p thành công!"
            dl_menu_triggered=true
            break
        else
            echo "    [!] Chưa tìm thấy mục 720p ($click_720_res), thử lại..."
            chrome-devtools-axi press Escape >/dev/null 2>&1 || true
            sleep 1
        fi
    done

    if [ "$dl_menu_triggered" = "false" ]; then
        echo "[!] Cảnh báo: Không thể kích hoạt menu tải xuống 720p sau $max_retries lần thử."
        echo "    Đang tiếp tục kiểm tra thư mục tải về phòng trường hợp trình duyệt đã kích hoạt tải ngầm..."
    fi

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

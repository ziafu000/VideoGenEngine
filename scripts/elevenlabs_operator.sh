#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# elevenlabs_operator.sh - Điều khiển ElevenLabs qua Chrome DevTools Protocol
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WIN_HOST=$(ip route | awk '/default/ {print $3}' 2>/dev/null || echo "127.0.0.1")
CDP_URL="http://${WIN_HOST}:9223"
DOWNLOADS_DIR="/mnt/c/Users/ASUS/Downloads"
export CHROME_DEVTOOLS_AXI_BROWSER_URL="$CDP_URL"

ensure_elevenlabs_tab() {
    local tab_id
    tab_id=$(chrome-devtools-axi pages | grep -i 'elevenlabs.io' | head -n 1 | awk '{print $1}' | tr -d ',-' || true)
    if [ -n "$tab_id" ]; then
        chrome-devtools-axi selectpage "$tab_id" >/dev/null 2>&1 || true
    else
        echo "[!] Không tìm thấy tab ElevenLabs. Đang mở tab mới..."
        chrome-devtools-axi newpage "https://elevenlabs.io/app/speech-synthesis/text-to-speech" >/dev/null 2>&1
        sleep 4
    fi
}

cmd_generate() {
    local text="${1:-}"
    local output_file="${2:-$PROJECT_DIR/audio/voiceover.mp3}"
    if [ -z "$text" ]; then
        echo "Lỗi: Vui lòng nhập nội dung cần đọc."
        exit 1
    fi
    mkdir -p "$(dirname "$output_file")"
    ensure_elevenlabs_tab

    local current_voice
    current_voice=$(chrome-devtools-axi eval '() => {
      const btn = document.querySelector("button[aria-label=\"Select voice\"]") ||
        Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Select voice") || b.getAttribute("aria-label")?.includes("voice"));
      return btn ? btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, "").trim().replace(/\s+/g, " ") : "Default";
    }' | grep -o 'result: "[^"]*"' | sed 's/result: "//; s/"$//' || echo "Active Voice")
    echo "[-] Giọng đọc đang kích hoạt trên ElevenLabs: $current_voice"

    echo "[-] Đang điền văn bản vào ElevenLabs..."
    local escaped_text
    escaped_text=$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$text")

    chrome-devtools-axi eval "() => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'LỖI: Không tìm thấy textarea';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, $escaped_text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return 'TEXT_INSERTED';
    }" >/dev/null 2>&1

    sleep 1
    echo "[-] Kích hoạt sinh giọng đọc (Generate speech)..."
    chrome-devtools-axi eval "() => {
      const genBtn = document.querySelector('button[aria-label=\"Generate speech Ctrl+Enter\"]') ||
        document.querySelector('button[aria-label=\"Regenerate speech Ctrl+Enter\"]') ||
        Array.from(document.querySelectorAll('button')).find(b => 
          b.innerText.includes('Generate speech') || 
          b.innerText.includes('Regenerate speech') ||
          (b.getAttribute('aria-label') && (b.getAttribute('aria-label').includes('Generate') || b.getAttribute('aria-label').includes('Regenerate')))
        );
      if (genBtn && !genBtn.disabled) {
        genBtn.click();
        return 'CLICKED';
      }
      return 'DISABLED';
    }" >/dev/null 2>&1

    echo "[-] Chờ ElevenLabs tạo file âm thanh..."
    local jev_decider="$PROJECT_DIR/scripts/jev_decider.py"
    for i in {1..30}; do
        sleep 2
        local is_ready
        is_ready=$(chrome-devtools-axi eval '() => {
          const loading = document.querySelectorAll("[data-loading=\"true\"], .animate-spin, svg.animate-spin");
          const audio = document.querySelector("audio");
          return (loading.length === 0 && audio && audio.duration > 0) ? "READY" : "WAITING";
        }' | grep -o 'READY' || true)
        if [ "$is_ready" = "READY" ]; then
            echo "✓ Giọng đọc đã tạo xong!"
            break
        fi

        # Xác thực bổ trợ qua TypeSafe Jev nếu cấu trúc DOM biến động
        if [ "$i" -ge 3 ] && [ -f "$jev_decider" ]; then
            local page_text
            page_text=$(chrome-devtools-axi eval '() => {
              const main = document.querySelector("main") || document.body;
              return (main.innerText || "").replace(/[\r\n]+/g, " ").slice(0, 400);
            }' | sed -E 's/^result: "//; s/"$//' || true)

            if [ -n "$page_text" ]; then
                local verify_res
                verify_res=$(python3 "$jev_decider" verify-elevenlabs "$page_text" 2>/dev/null || true)
                local j_ready
                j_ready=$(echo "$verify_res" | jq -r '.ready // false' 2>/dev/null || echo "false")
                if [ "$j_ready" = "true" ]; then
                    echo "✓ TypeSafe Jev: Xác nhận tệp âm thanh đã hoàn tất và sẵn sàng tải về!"
                    break
                fi
            fi
        fi

        echo -n "."
    done
    echo ""

    echo "[-] Kích hoạt tải về file MP3..."
    chrome-devtools-axi eval '() => {
      const btn = document.querySelector("button[aria-label=\"Download Audio\"]") ||
        document.querySelector("button[aria-label=\"Download latest\"]");
      if (btn) {
        btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        btn.click();
        return "CLICKED_DOWNLOAD";
      }
      return "NOT_FOUND";
    }' >/dev/null 2>&1

    sleep 3
    local newest
    newest=$(ls -t "$DOWNLOADS_DIR"/ElevenLabs*.mp3 2>/dev/null | head -n 1 || true)
    if [ -n "$newest" ] && [ -f "$newest" ]; then
        cp -f "$newest" "$output_file"
        echo "✓ Đã lưu file audio tại: $output_file"
    else
        echo "[!] Không tìm thấy file audio vừa tải trong $DOWNLOADS_DIR."
        exit 1
    fi
}

case "${1:-}" in
    generate)
        cmd_generate "${2:-}" "${3:-$PROJECT_DIR/audio/voiceover.mp3}"
        ;;
    *)
        echo "Cách dùng: $0 generate \"<văn bản>\" [đường_dẫn_lưu_mp3]"
        exit 1
        ;;
esac

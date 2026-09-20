#!/usr/bin/env bash
set -euo pipefail

# Start Windows Chrome with remote debugging and the CDP proxy if not running

WIN_HOST=$(ip route | awk '/default/ {print $3}')
PROXY_URL="http://$WIN_HOST:9223"
FLOW_URL="https://flow.google.com"

echo "[1/4] Kiểm tra kết nối tới CDP bridge ($PROXY_URL)..."
if curl -s --connect-timeout 2 "$PROXY_URL/json/version" >/dev/null 2>&1; then
    echo "✓ CDP bridge đã hoạt động tại $PROXY_URL"
else
    echo "Khởi động Chrome và CDP proxy trên Windows..."
    cp -f /home/asus/ai/project/VideoGen/scripts/cdp_proxy.js /mnt/c/Users/ASUS/AppData/Local/Google/Chrome/cdp_proxy.js

    (cd /mnt/c && powershell.exe -NoProfile -Command '
        $chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Application\chrome.exe" }
        $listening = Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue
        if (-not $listening) {
            Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222 --user-data-dir=C:\Users\ASUS\AppData\Local\Google\Chrome\AutomationProfile https://flow.google.com"
            Start-Sleep -Seconds 3
        }
        $proxyListening = Get-NetTCPConnection -LocalPort 9223 -ErrorAction SilentlyContinue
        if (-not $proxyListening) {
            Start-Process node -ArgumentList "C:\Users\ASUS\AppData\Local\Google\Chrome\cdp_proxy.js" -WindowStyle Hidden
        }
    ')
    
    echo "Chờ bridge sẵn sàng..."
    for i in {1..15}; do
        if curl -s --connect-timeout 1 "$PROXY_URL/json/version" >/dev/null 2>&1; then
            echo "✓ Kết nối thành công tới CDP bridge ($PROXY_URL)!"
            break
        fi
        sleep 1
    done
fi

echo "[2/4] Kiểm tra tab Google Flow..."
HAS_FLOW=$(curl -s "$PROXY_URL/json/list" | jq -r '.[] | select(.type=="page" and (.url | test("flow\\.google\\.com"))) | .id' | head -n 1 || true)

if [ -z "$HAS_FLOW" ]; then
    echo "[-] Chưa có tab Google Flow, đang tự động mở $FLOW_URL..."
    curl -s -X PUT "$PROXY_URL/json/new?$FLOW_URL" >/dev/null || true
    sleep 3
fi

echo "[3/4] Danh sách các tab đang mở trong Chrome:"
curl -s "$PROXY_URL/json/list" | jq -r '.[] | select(.type=="page") | "  - [\(.id)] \(.title) (\(.url))"'

echo "[4/4] Sẵn sàng điều khiển Google Flow!"

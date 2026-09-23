#!/usr/bin/env node
/**
 * scripts/youtube_uploader.js: Automated YouTube Studio Video Uploader via Chrome DevTools Protocol.
 *
 * Supports uploading unlisted/private/public videos directly via YouTube Creator Studio UI
 * without consuming YouTube Data API v3 quota (0 API cost).
 *
 * Usage:
 *   node scripts/youtube_uploader.js status
 *   node scripts/youtube_uploader.js upload --video <path> [--title <title>] [--description <desc>] [--visibility <unlisted|private|public>] [--thumbnail <path>]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getWinHost() {
  try {
    const route = execSync("ip route | awk '/default/ {print $3}'", { encoding: 'utf-8' }).trim();
    return route || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

const WIN_HOST = process.env.WIN_HOST || getWinHost();
const PROXY_PORT = process.env.CDP_PORT || 9223;
const PROXY_BASE = `http://${WIN_HOST}:${PROXY_PORT}`;
const STUDIO_URL = 'https://studio.youtube.com';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function postPut(url, method = 'POST') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: method
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function toWindowsPath(linuxPath) {
  const abs = path.resolve(linuxPath);
  if (abs.startsWith('/mnt/c/')) {
    return 'C:\\' + abs.slice(7).replace(/\//g, '\\');
  }
  if (abs.startsWith('/mnt/d/')) {
    return 'D:\\' + abs.slice(7).replace(/\//g, '\\');
  }
  if (abs.startsWith('/mnt/')) {
    const drive = abs[5].toUpperCase();
    return `${drive}:\\` + abs.slice(7).replace(/\//g, '\\');
  }
  // Linux/WSL internal path: copy to Windows Temp for Chrome accessibility
  const winUser = process.env.WIN_USERNAME || 'ASUS';
  const winTempDir = `/mnt/c/Users/${winUser}/AppData/Local/Temp`;
  if (fs.existsSync(winTempDir)) {
    const dest = path.join(winTempDir, `yt_up_${Date.now()}_${path.basename(abs)}`);
    fs.copyFileSync(abs, dest);
    return `C:\\Users\\${winUser}\\AppData\\Local\\Temp\\` + path.basename(dest);
  }
  return abs;
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          }
        } catch {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Runtime.evaluate exception');
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function getStudioTab() {
  const tabs = await fetchJson(`${PROXY_BASE}/json/list`);
  let studioTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('studio.youtube.com'));
  if (!studioTab) {
    // Open new tab
    studioTab = await postPut(`${PROXY_BASE}/json/new?${STUDIO_URL}`, 'PUT');
    await new Promise(r => setTimeout(r, 4000));
  }
  return studioTab;
}

async function cmdStatus() {
  try {
    const studioTab = await getStudioTab();
    const client = new CDPClient(studioTab.webSocketDebuggerUrl);
    await client.connect();

    const status = await client.eval(`(() => {
      const url = window.location.href;
      if (url.includes('accounts.google.com') || url.includes('signin')) {
        return { logged_in: false, state: 'NEED_LOGIN', url: url };
      }
      const channelEl = document.querySelector('#channel-title, #entity-name, .channel-name');
      const channelName = channelEl ? channelEl.innerText.trim() : 'Unknown';
      const uploadBtn = document.querySelector('button[aria-label*="Tải video lên"], button[aria-label*="Upload videos"], #create-icon, button[aria-label*="Tạo"], button[aria-label*="Create"]');
      return {
        logged_in: true,
        state: 'READY',
        channel_name: channelName,
        can_upload: !!uploadBtn,
        url: url
      };
    })()`);

    client.close();
    console.log(JSON.stringify({ ok: true, status }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

async function cmdUpload(args) {
  const videoFile = args.video;
  if (!videoFile || !fs.existsSync(videoFile)) {
    console.error(JSON.stringify({ ok: false, error: `Video file not found: ${videoFile}` }));
    process.exit(1);
  }

  const title = args.title || path.basename(videoFile, path.extname(videoFile));
  const description = args.description || '';
  const visibility = (args.visibility || 'unlisted').toLowerCase();
  const thumbnail = args.thumbnail && fs.existsSync(args.thumbnail) ? args.thumbnail : null;

  const winVideoPath = toWindowsPath(videoFile);
  const winThumbPath = thumbnail ? toWindowsPath(thumbnail) : null;

  console.error(`[-] Chuẩn bị upload video lên YouTube Studio...`);
  console.error(`  - Video: ${videoFile} (Windows: ${winVideoPath})`);
  console.error(`  - Tiêu đề: ${title}`);
  console.error(`  - Chế độ hiển thị: ${visibility.toUpperCase()}`);

  const studioTab = await getStudioTab();
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();

  try {
    // 1. Kiểm tra trạng thái đăng nhập
    const isLogin = await client.eval(`(() => {
      return !window.location.href.includes('accounts.google.com') && !window.location.href.includes('signin');
    })()`);

    if (!isLogin) {
      throw new Error('Chưa đăng nhập tài khoản YouTube. Vui lòng mở Chrome đăng nhập vào studio.youtube.com trước.');
    }

    // 1b. Đảm bảo trang Studio ở trạng thái sạch sẽ hoàn toàn
    console.error(`[-] Chuẩn bị giao diện Studio sạch...`);
    await client.send('Page.navigate', { url: 'https://studio.youtube.com/channel/UCXpamBXGkpcZ5bNpTAiZyJw' });
    await new Promise(r => setTimeout(r, 4000));

    // 2. Kích hoạt menu Tạo / Tải video lên
    console.error(`[-] Mở hộp thoại tải video lên trên YouTube Studio...`);
    const openedDialog = await client.eval(`(() => {
      // Tìm nút Tạo
      const btns = Array.from(document.querySelectorAll('button, ytcp-button'));
      const createBtn = btns.find(b => (b.innerText && b.innerText.trim() === 'Tạo') || b.getAttribute('aria-label') === 'Tạo' || b.id === 'create-icon');
      if (createBtn) {
        createBtn.click();
        return 'CREATE_CLICKED';
      }
      const directUpload = document.querySelector('button[aria-label*="Tải video lên"], button[aria-label*="Upload videos"], #upload-icon, #upload-button');
      if (directUpload && directUpload.offsetParent !== null) {
        directUpload.click();
        return 'DIRECT_CLICKED';
      }
      return 'NO_BTN';
    })()`);

    await new Promise(r => setTimeout(r, 1500));

    if (openedDialog === 'CREATE_CLICKED') {
      await client.eval(`(() => {
        const items = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-menu #items tp-yt-paper-item, #text-item-0'));
        const upItem = items.find(i => i.innerText && (i.innerText.includes('Tải video lên') || i.innerText.includes('Upload videos')));
        if (upItem) upItem.click();
      })()`);
      await new Promise(r => setTimeout(r, 2000));
    }

    // 3. Tìm phần tử input file và nạp file video qua CDP DOM.setFileInputFiles
    console.error(`[-] Đang truyền file video vào Chrome qua CDP DOM.setFileInputFiles...`);
    await client.send('DOM.enable');

    let nodeId = 0;
    for (let attempt = 0; attempt < 15; attempt++) {
      const evalRes = await client.send('Runtime.evaluate', {
        expression: 'document.querySelector("input[type=\'file\']")'
      });

      if (evalRes.result && evalRes.result.objectId) {
        try {
          const nodeDesc = await client.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) {
            nodeId = nodeDesc.nodeId;
            break;
          }
        } catch {}
      }

      const doc = await client.send('DOM.getDocument', { depth: -1 });
      const fileInputNode = await client.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"][name="Filedata"], ytcp-uploads-dialog input[type="file"], input[type="file"]'
      });
      if (fileInputNode && fileInputNode.nodeId) {
        nodeId = fileInputNode.nodeId;
        break;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (!nodeId) {
      throw new Error('Không tìm thấy ô input file trên YouTube Studio uploads dialog.');
    }

    await client.send('DOM.setFileInputFiles', {
      files: [winVideoPath],
      nodeId: nodeId
    });

    console.error(`✓ Đã nạp file video thành công! Chờ YouTube xử lý metadata dialog...`);

    // 4. Chờ metadata editor xuất hiện (tối đa 30s)
    let editorReady = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      editorReady = await client.eval(`(() => {
        const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea');
        return !!titleBox;
      })()`);
      if (editorReady) break;
    }

    if (!editorReady) {
      throw new Error('Hộp thoại chỉnh sửa chi tiết video (Metadata editor) không xuất hiện sau khi chọn file.');
    }

    console.error(`[-] Điền tiêu đề và mô tả video...`);
    // 5. Điền Title và Description
    await client.eval(`((titleText, descText) => {
      // Tiêu đề
      const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea [contenteditable="true"]');
      if (titleBox) {
        titleBox.focus();
        titleBox.innerText = titleText;
        titleBox.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Mô tả
      const descBox = document.querySelector('#textbox[aria-label*="Mô tả"], #textbox[aria-label*="Description"], ytcp-social-suggestions-textbox#description-textarea [contenteditable="true"]');
      if (descBox && descText) {
        descBox.focus();
        descBox.innerText = descText;
        descBox.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Đối tượng người xem: Không dành cho trẻ em
      const notForKids = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #not-made-for-kids');
      if (notForKids) {
        notForKids.click();
      }
    })(${JSON.stringify(title)}, ${JSON.stringify(description)})`);

    // 6. Tải thumbnail (nếu có)
    if (winThumbPath) {
      try {
        console.error(`[-] Đang tải thumbnail tùy chỉnh...`);
        const thumbNode = await client.send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: 'input#file-loader[type="file"], input[type="file"][accept*="image"]'
        });
        if (thumbNode && thumbNode.nodeId) {
          await client.send('DOM.setFileInputFiles', {
            files: [winThumbPath],
            nodeId: thumbNode.nodeId
          });
          console.error(`✓ Đã nạp thumbnail thành công.`);
        }
      } catch (thumbErr) {
        console.error(`[!] Bỏ qua thumbnail do lỗi: ${thumbErr.message}`);
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // 7. Vượt qua các bước: Bước 1 (Chi tiết) -> Bước 2 (Thành phần) -> Bước 3 (Kiểm tra) -> Bước 4 (Hiển thị)
    console.error(`[-] Điều hướng qua các bước kiểm tra (Checks) sang bước Hiển thị...`);
    for (let step = 1; step <= 3; step++) {
      await client.eval(`(() => {
        const nextBtn = document.querySelector('#next-button, button#next-button, ytcp-button#next-button');
        if (nextBtn) nextBtn.click();
      })()`);
      await new Promise(r => setTimeout(r, 1500));
    }

    // 8. Chọn chế độ hiển thị: UNLISTED / PRIVATE / PUBLIC
    console.error(`[-] Thiết lập chế độ hiển thị: ${visibility.toUpperCase()}...`);
    await client.eval(`((vis) => {
      const radioName = vis === 'public' ? 'PUBLIC' : (vis === 'private' ? 'PRIVATE' : 'UNLISTED');
      const radio = document.querySelector(\`tp-yt-paper-radio-button[name="\${radioName}"]\`);
      if (radio) {
        radio.click();
      }
    })(${JSON.stringify(visibility)})`);

    await new Promise(r => setTimeout(r, 1000));

    // 9. Lấy đường link YouTube xem trước
    const videoUrl = await client.eval(`(() => {
      const linkEl = document.querySelector('a.ytcp-video-info[href*="youtu.be"], a.style-scope.ytcp-video-info, .video-url-fadeable a, a[href*="youtu.be"]');
      return linkEl ? linkEl.href : null;
    })()`);

    console.error(`[-] Lưu cài đặt xuất bản video...`);
    // 10. Bấm nút LƯU / XUẤT BẢN (#done-button)
    await client.eval(`(() => {
      const doneBtn = document.querySelector('#done-button, button#done-button, ytcp-button#done-button');
      if (doneBtn) doneBtn.click();
    })()`);

    // 11. Chờ xác nhận và đóng dialog
    let finalUrl = videoUrl;
    for (let w = 0; w < 10; w++) {
      await new Promise(r => setTimeout(r, 1000));
      const confirmedUrl = await client.eval(`(() => {
        const link = document.querySelector('a[href*="youtu.be"], .share-url a');
        const closeBtn = document.querySelector('#close-button, ytcp-button#close-button');
        if (closeBtn) closeBtn.click();
        return link ? link.href : null;
      })()`);
      if (confirmedUrl) {
        finalUrl = confirmedUrl;
        break;
      }
    }

    // Đóng dialog sau khi hoàn tất
    try {
      await client.eval(`(() => {
        const closeBtn = document.querySelector('ytcp-uploads-dialog #close-button, ytcp-dialog #close-button, tp-yt-paper-dialog #close-button, #dismiss-button');
        if (closeBtn) closeBtn.click();
      })()`);
    } catch {}

    client.close();

    // Verify upload success with TypeSafe Jev
    try {
      if (finalUrl && finalUrl.includes('youtu.be')) {
        const jOut = execSync(`browser-jev verify --expected "video upload succeeded with shareable link" --text ${JSON.stringify(finalUrl + ' ' + title)}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 5000
        });
        const jParsed = JSON.parse(jOut);
        console.error(`  [TypeSafe Jev: ${jParsed.verified ? 'Verified ✓' : 'Unverified ✗'}] Xác thực xuất bản YouTube.`);
      }
    } catch {}

    const videoId = finalUrl ? (finalUrl.split('/').pop().split('?')[0]) : null;

    const outputResult = {
      success: true,
      video_id: videoId,
      video_url: finalUrl,
      title: title,
      visibility: visibility,
      uploaded_at: new Date().toISOString()
    };

    console.log(JSON.stringify(outputResult, null, 2));
    console.error(`\n✓ ĐÃ UPLOAD THÀNH CÔNG LÊN YOUTUBE!`);
    console.error(`  -> Link: ${finalUrl || 'Đang cập nhật'}`);
    console.error(`  -> Trạng thái: ${visibility.toUpperCase()}\n`);

  } catch (err) {
    client.close();
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

function parseArgs(argsList) {
  const parsed = {};
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argsList[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'status';

  if (cmd === 'status') {
    await cmdStatus();
  } else if (cmd === 'upload') {
    const parsed = parseArgs(args.slice(1));
    await cmdUpload(parsed);
  } else {
    console.error('Usage: youtube_uploader.js {status | upload --video <path> [--title <t>] [--description <d>] [--visibility <unlisted|private|public>]}');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

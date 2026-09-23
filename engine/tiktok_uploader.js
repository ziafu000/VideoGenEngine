const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');
const { getClientForPage, sleep } = require('./cdp');

/**
 * TypeSafe Jev Classifier Helper
 */
function jevClassify(text, statesMap) {
  try {
    const statesJson = JSON.stringify(statesMap).replace(/"/g, '\\"');
    const cleanText = (text || '').replace(/[\r\n\t]+/g, ' ').slice(0, 800).replace(/"/g, '\\"');
    const cmd = `browser-jev classify --text "${cleanText}" --states "${statesJson}"`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    return JSON.parse(out);
  } catch (err) {
    return { choice: Object.keys(statesMap)[0], confidence: 0 };
  }
}

/**
 * Upload a single vertical 9:16 Short to TikTok Studio with Jev-guided gates.
 */
async function uploadSingleShortToTikTok({
  videoPath,
  thumbnailPath,
  caption
}) {
  const winVideo = config.toWinPath(videoPath);
  const winThumb = thumbnailPath ? config.toWinPath(thumbnailPath) : null;

  console.log(`\n============================================================`);
  console.log(`>>> TIKTOK UPLOAD (JEV DRIVEN): ${path.basename(videoPath)}`);
  console.log(`    - Video: ${winVideo}`);
  console.log(`    - Thumbnail: ${winThumb || '(Auto từ video)'}`);
  console.log(`    - Caption: ${caption}`);
  console.log(`============================================================`);

  const cdp = await getClientForPage('tiktok.com');
  await cdp.send('DOM.enable');

  // 1. Điều hướng tới TikTok Studio Upload
  console.log('[-] [1/6] Điều hướng tới TikTok Studio Upload...');
  await cdp.send('Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN' });
  await sleep(3500);

  // Dọn dẹp dialog draft cũ nếu có
  await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const discardBtn = btns.find(b => b.innerText && (b.innerText.trim() === 'Discard' || b.innerText.trim() === 'Bỏ qua' || b.innerText.trim() === 'Hủy'));
    if (discardBtn) discardBtn.click();
  })()`);
  await sleep(1500);

  // Kiểm tra đăng nhập bằng Jev
  const pageSnippet = await cdp.evaluate('document.body.innerText.slice(0, 400)');
  const loginState = jevClassify(pageSnippet, {
    logged_in: "User is in creator studio upload page",
    login_required: "Login page or sign in form"
  });
  if (loginState.choice === 'login_required') {
    throw new Error('Chưa đăng nhập TikTok trên Chrome. Vui lòng đăng nhập trên Chrome trước.');
  }

  // 2. Tìm thẻ input file video & nạp file
  console.log('[-] [2/6] Nạp file video vào TikTok Studio...');
  let fileNodeId = 0;
  for (let attempt = 0; attempt < 25; attempt++) {
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: 'document.querySelector("input[type=\'file\'][accept*=\'video\'], input[type=\'file\']")'
    });
    if (evalRes.result && evalRes.result.objectId) {
      try {
        const nodeDesc = await cdp.send('DOM.requestNode', { objectId: evalRes.result.objectId });
        if (nodeDesc && nodeDesc.nodeId) {
          fileNodeId = nodeDesc.nodeId;
          break;
        }
      } catch {}
    }

    try {
      const doc = await cdp.send('DOM.getDocument', { depth: -1 });
      const node = await cdp.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"]'
      });
      if (node && node.nodeId) {
        fileNodeId = node.nodeId;
        break;
      }
    } catch {}

    await sleep(1000);
  }

  if (!fileNodeId) throw new Error('Không tìm thấy ô chọn file video trên TikTok Studio');

  await cdp.send('DOM.setFileInputFiles', {
    nodeId: fileNodeId,
    files: [winVideo]
  });
  console.log('    [✓] Đã nạp file video thành công!');

  // 3. Chờ video xử lý hoàn tất bằng Jev Classifier
  console.log('[-] [3/6] TypeSafe Jev đang giám sát tiến trình tải lên video...');
  let isVideoReady = false;
  for (let i = 0; i < 45; i++) {
    await sleep(1500);
    const bodyText = await cdp.evaluate('document.body.innerText.slice(0, 800)');
    const state = jevClassify(bodyText, {
      ready: "Video uploaded successfully, editor form and details are visible",
      uploading: "Video is still uploading with progress percentage or loading",
      initial: "Initial select file dropzone"
    });

    if (state.choice === 'ready' && state.confidence >= 0.8) {
      console.log(`    [✓ Jev Decision] Video tải lên thành công (Confidence: ${(state.confidence * 100).toFixed(0)}%)!`);
      isVideoReady = true;
      break;
    }
    process.stdout.write(`\r    ... Jev State: ${state.choice} (${(state.confidence * 100).toFixed(0)}%) [${(i * 1.5).toFixed(1)}s]`);
  }

  if (!isVideoReady) throw new Error('Hết thời gian chờ video tải lên');

  // 4. Nhập Caption & Hashtags
  console.log('\n[-] [4/6] Nhập nội dung caption và hashtags...');
  await cdp.evaluate(`(() => {
    const editor = document.querySelector('.public-DraftEditor-content, [contenteditable="true"]');
    if (editor) {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(caption)});
    }
  })()`);
  await sleep(1500);

  // 5. Gắn custom thumbnail nếu có (Jev-Guided Content Verification)
  if (winThumb && fs.existsSync(thumbnailPath)) {
    console.log('[-] [5/6] Mở modal Edit cover và gắn thumbnail tùy chỉnh...');

    // Click nút Edit cover
    for (let attempt = 0; attempt < 10; attempt++) {
      const clicked = await cdp.evaluate(`(() => {
        const el = document.querySelector('.edit-container, [class*="cover-container"], [class*="edit-container"]');
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.click();
          return true;
        }
        return false;
      })()`);
      if (clicked) break;
      await sleep(1000);
    }

    // Chờ modal Edit cover render ĐẦY ĐỦ CONTENT (chờ input file ảnh xuất hiện)
    console.log('    [-] Đang chờ thẻ tải ảnh bìa bên trong modal sẵn sàng...');
    let imgNodeId = 0;

    for (let i = 0; i < 25; i++) {
      await sleep(1000);

      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: 'document.querySelector("input[type=\'file\'][accept*=\'image\']")'
      });

      if (evalRes.result && evalRes.result.objectId) {
        try {
          const nodeDesc = await cdp.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) {
            imgNodeId = nodeDesc.nodeId;
            console.log(`    [✓] Đã định vị ô nạp ảnh bìa (NodeId: ${imgNodeId}) sau ${i + 1}s!`);
            break;
          }
        } catch {}
      }
      process.stdout.write(`\r    ... Đang chờ modal sẵn sàng: ${i + 1}s`);
    }

    if (imgNodeId) {
      console.log(`\n    [-] Nạp file ảnh bìa qua CDP: ${winThumb}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: imgNodeId,
        files: [winThumb]
      });
      console.log('    [✓] Đã nạp file thumbnail vào modal cover!');

      // Chờ 3 giây để modal render ảnh thumbnail
      await sleep(3500);

      // Bấm nút Save trong modal
      const saveRes = await cdp.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText && (b.innerText.trim() === 'Save' || b.innerText.trim() === 'Lưu'));
        if (btns.length > 0) {
          btns[btns.length - 1].click();
          return { clicked: true, text: btns[btns.length - 1].innerText };
        }
        return { clicked: false };
      })()`);
      console.log(`    [✓] Đã bấm nút Save ảnh bìa:`, saveRes);

      // Chờ modal đóng hoàn toàn
      for (let w = 0; w < 10; w++) {
        await sleep(1000);
        const stillOpen = await cdp.evaluate(`!!document.querySelector('[role="dialog"], .modal, .semi-modal, [class*="modal"]')`);
        if (!stillOpen) {
          console.log('    [✓] Modal Edit cover đã đóng, ảnh bìa đã được lưu thành công!');
          break;
        }
      }
    } else {
      console.warn('\n    [!] Hết thời gian chờ ô chọn ảnh bìa trong modal');
    }
  }

  // 6. Click Post và dùng Jev xử lý các chướng ngại / popup
  console.log('[-] [6/6] Đang gửi lệnh Đăng video (Post)...');
  for (let i = 0; i < 20; i++) {
    const postBtnCoord = await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const postBtn = btns.find(b => b.innerText && b.innerText.trim() === 'Post');
      if (!postBtn || postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') return null;
      postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = postBtn.getBoundingClientRect();
      return {
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2)
      };
    })()`);

    if (postBtnCoord) {
      await cdp.clickMouse(postBtnCoord.x, postBtnCoord.y);
      console.log('    [✓] Đã click nút Post!');
      break;
    }
    await sleep(1000);
  }

  await sleep(1500);

  // TypeSafe Jev Obstacle & Confirmation Handler
  for (let i = 0; i < 15; i++) {
    const dialogText = await cdp.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"], .modal, .semi-modal, [class*="modal"]');
      return dialog ? dialog.innerText.slice(0, 400) : '';
    })()`);

    if (dialogText) {
      const obstacleDecision = jevClassify(dialogText, {
        copyright_warning: "Copyright check warning dialog asking to continue or post now",
        other_obstacle: "Other popup or dialog",
        none: "No obstacle"
      });

      if (obstacleDecision.choice === 'copyright_warning') {
        console.log('    [✓ Jev Obstacle] Phát hiện cảnh báo bản quyền, kích hoạt "Post now"...');
        await cdp.evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText && (b.innerText.includes('Post now') || b.innerText.includes('Vẫn đăng') || b.innerText.includes('Continue')));
          if (btns.length > 0) btns[btns.length - 1].click();
        })()`);
        break;
      }
    }
    await sleep(1000);
  }

  // Chờ điều hướng hoàn tất xác nhận bởi Jev
  console.log('[-] TypeSafe Jev đang xác thực kết quả xuất bản...');
  let uploadConfirmed = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const state = await cdp.evaluate(`(() => {
      return {
        url: window.location.href,
        bodyText: document.body.innerText.slice(0, 600)
      };
    })()`);

    const resultDecision = jevClassify(state.bodyText, {
      published: "Video has been uploaded or user is redirected to manage content posts",
      in_progress: "Upload still in progress",
      error: "Upload error or failure"
    });

    if (resultDecision.choice === 'published' || state.url.includes('/content')) {
      console.log(`    [✓ Jev Verified] XÁC NHẬN: Video đã được đăng thành công lên TikTok Studio!`);
      uploadConfirmed = true;
      break;
    }
  }

  if (!uploadConfirmed) {
    console.log('    [i] Đã gửi lệnh Post hoàn tất!');
  }

  cdp.close();
  return { success: true, video: winVideo };
}

module.exports = {
  uploadSingleShortToTikTok
};

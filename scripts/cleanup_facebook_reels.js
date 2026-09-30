#!/usr/bin/env node
/**
 * scripts/cleanup_facebook_reels.js
 *
 * Cleans up published Reels for Shorts 05-16 on Meta Business Suite.
 * Strictly preserves Shorts 01-04.
 */

const { getClientForPage, sleep } = require('../engine/cdp');

const TARGET_SHORTS = [
  { num: 5, keyword: 'Cửa Địa Ngục', label: 'Shorts 05 - Cửa Địa Ngục Darvaza' },
  { num: 5, keyword: 'Darvaza', label: 'Shorts 05 - Darvaza fallback' },
  { num: 6, keyword: 'Sơn Đoòng', label: 'Shorts 06 - Hang Sơn Đoòng' },
  { num: 7, keyword: 'Đảo Rắn', label: 'Shorts 07 - Đảo Rắn Tử Thần' },
  { num: 8, keyword: 'Rừng Uốn Cong', label: 'Shorts 08 - Rừng Uốn Cong' },
  { num: 9, keyword: 'Salar de Uyuni', label: 'Shorts 09 - Cánh Đồng Muối Uyuni' },
  { num: 10, keyword: 'Thác Máu', label: 'Shorts 10 - Thác Máu Nam Cực' },
  { num: 11, keyword: 'Hố Xanh', label: 'Shorts 11 - Hố Xanh Vĩ Đại Belize' },
  { num: 12, keyword: 'Dòng Sông Sôi', label: 'Shorts 12 - Dòng Sông Sôi Amazon' },
  { num: 13, keyword: 'Đảo Búp Bê', label: 'Shorts 13 - Đảo Búp Bê Ma Quái' },
  { num: 14, keyword: 'Roraima', label: 'Shorts 14 - Núi Bàn Roraima' },
  { num: 15, keyword: 'Fly Geyser', label: 'Shorts 15 - Mạch Nước Phun Fly Geyser' },
  { num: 16, keyword: 'Naica', label: 'Shorts 16 - Hang Tinh Thể Naica' }
];

const PRESERVE_PATTERNS = [
  /mariana/i,
  /sahara/i,
  /natron/i,
  /thủy\s*tinh/i,
  /hd\s*189733b/i
];

async function setSearchQuery(cdp, query) {
  await cdp.evaluate(`((kw) => {
    const input = document.querySelector('input[placeholder*="Tìm theo ID"], input[aria-label*="Tìm theo ID"]') ||
      Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('Tìm') || (i.getAttribute('aria-label') || '').includes('Tìm'));
    if (input) {
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, kw);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  })(${JSON.stringify(query)})`);
}

async function deleteMatchingPost(cdp, item) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`[-] Tìm kiếm để dọn dẹp: ${item.label} (keyword: "${item.keyword}")`);

  await setSearchQuery(cdp, item.keyword);
  await sleep(2500);

  // Check matching row
  const rowData = await cdp.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const text = r.innerText || '';
      if (text.includes('#Shorts') || text.includes('#shorts') || text.includes('Thước phim')) {
        const btns = Array.from(r.querySelectorAll('div[role="button"], button'));
        const menuBtn = btns.find(b => (b.innerText || '').includes('Mở menu'));
        return {
          rowIdx: i,
          title: text.split('\\n').filter(Boolean)[1] || text.split('\\n')[0],
          fullText: text.slice(0, 200),
          hasMenuBtn: !!menuBtn
        };
      }
    }
    return null;
  })()`);

  if (!rowData) {
    console.log(`    [i] Không tìm thấy bài đăng nào cho "${item.keyword}". Bỏ qua.`);
    return false;
  }

  console.log(`    [!] Tìm thấy bài đăng: "${rowData.title}"`);

  // HARD SAFETY GATE: Verify this is NOT Shorts 01-04
  for (const pat of PRESERVE_PATTERNS) {
    if (pat.test(rowData.fullText) || pat.test(rowData.title)) {
      console.error(`    [CRITICAL SAFETY GATE] Tiêu đề trùng khớp với Shorts 01-04 cần bảo vệ! TUYỆT ĐỐI KHÔNG XÓA!`);
      return false;
    }
  }

  // Step 1: Open row dropdown menu
  console.log(`    [-] Mở menu tùy chọn của hàng...`);
  const menuOpened = await cdp.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    if (rows.length < 2) return false;
    const r = rows[1];
    const btns = Array.from(r.querySelectorAll('div[role="button"], button'));
    const menuBtn = btns.find(b => (b.innerText || '').includes('Mở menu'));
    if (!menuBtn) return false;

    const kProps = Object.keys(menuBtn).find(k => k.startsWith('__reactProps'));
    if (kProps && menuBtn[kProps]?.onClick) {
      menuBtn[kProps].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
      return true;
    }
    menuBtn.click();
    return true;
  })()`);

  if (!menuOpened) {
    console.error(`    [!] Không thể mở menu thả xuống của hàng.`);
    return false;
  }

  await sleep(1200);

  // Step 2: Hover/click "Quản lý bài viết" to expand submenu
  console.log(`    [-] Kích hoạt menu "Quản lý bài viết"...`);
  const manageOpened = await cdp.evaluate(`(() => {
    const manageEl = Array.from(document.querySelectorAll('*')).find(el => {
      return el.children.length === 0 && el.innerText?.trim() === 'Quản lý bài viết';
    });
    if (!manageEl) return false;
    const target = manageEl.closest('[role="menuitem"], [role="button"]') || manageEl;
    const kProps = Object.keys(target).find(k => k.startsWith('__reactProps'));
    if (kProps && target[kProps]?.onClick) {
      target[kProps].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    } else if (kProps && target[kProps]?.onMouseEnter) {
      target[kProps].onMouseEnter({});
    } else {
      target.click();
    }
    return true;
  })()`);

  if (!manageOpened) {
    console.error(`    [!] Không tìm thấy mục "Quản lý bài viết" trong menu.`);
    await cdp.evaluate(`document.body.click()`);
    return false;
  }

  await sleep(1200);

  // Step 3: Click "Xóa bài viết"
  console.log(`    [-] Nhấn "Xóa bài viết"...`);
  const deleteClicked = await cdp.evaluate(`(() => {
    const xoaEl = Array.from(document.querySelectorAll('*')).find(el => {
      return el.children.length === 0 && el.innerText?.trim() === 'Xóa bài viết';
    });
    if (!xoaEl) return false;
    const target = xoaEl.closest('[role="menuitem"], [role="button"]') || xoaEl;
    const kProps = Object.keys(target).find(k => k.startsWith('__reactProps'));
    if (kProps && target[kProps]?.onClick) {
      target[kProps].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    } else {
      target.click();
    }
    return true;
  })()`);

  if (!deleteClicked) {
    console.error(`    [!] Không tìm thấy mục "Xóa bài viết" trong submenu.`);
    await cdp.evaluate(`document.body.click()`);
    return false;
  }

  await sleep(1500);

  // Step 4: Confirm deletion in dialog ("Chuyển vào thùng rác")
  console.log(`    [-] Xác nhận chuyển vào thùng rác trong hộp thoại...`);
  const confirmed = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { ok: false, error: 'No dialog' };
    const btns = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
    const confirmBtn = btns.find(b => {
      const t = (b.innerText || '').trim();
      return t === 'Chuyển vào thùng rác' || t === 'Xóa' || t === 'Delete' || t === 'Move to trash';
    });
    if (!confirmBtn) return { ok: false, error: 'No confirm button found' };

    const kProps = Object.keys(confirmBtn).find(k => k.startsWith('__reactProps'));
    if (kProps && confirmBtn[kProps]?.onClick) {
      confirmBtn[kProps].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    } else {
      confirmBtn.click();
    }
    return { ok: true, text: confirmBtn.innerText?.trim() };
  })()`);

  if (!confirmed.ok) {
    console.error(`    [!] Lỗi xác nhận xóa: ${confirmed.error}`);
    return false;
  }

  console.log(`    [✓] Đã nhấn nút xác nhận "${confirmed.text}"! Đang đợi xóa...`);
  await sleep(4000);

  // Close any remaining dialog
  await cdp.evaluate(`(() => {
    const closeBtn = document.querySelector('[role="dialog"] [aria-label="Đóng"]');
    if (closeBtn) closeBtn.click();
  })()`);

  return true;
}

async function verifyPreservedShorts(cdp) {
  console.log(`\n============================================================`);
  console.log(`>>> KIỂM TRA BẢO TOÀN SHORTS 01 ĐẾN 04 TRÊN FANPAGE`);
  console.log(`============================================================`);

  const preserved = [
    { num: 1, keyword: 'Mariana', name: 'Shorts 01 - Rãnh Mariana' },
    { num: 2, keyword: 'Sahara', name: 'Shorts 02 - Con Mắt Sahara' },
    { num: 3, keyword: 'Natron', name: 'Shorts 03 - Hồ Natron' },
    { num: 4, keyword: 'Thủy Tinh', name: 'Shorts 04 - Hành Tinh Mưa Thủy Tinh' }
  ];

  let allFound = true;
  for (const item of preserved) {
    await setSearchQuery(cdp, item.keyword);
    await sleep(2000);
    const hasRow = await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('[role="row"]'));
      return rows.length > 1;
    })()`);
    if (hasRow) {
      console.log(`[✓] ${item.name}: VẪN TỒN TẠI NGUYÊN VẸN`);
    } else {
      console.error(`[!] ${item.name}: KHÔNG TÌM THẤY!`);
      allFound = false;
    }
  }

  // Clear search
  await setSearchQuery(cdp, '');
  await sleep(1500);

  return allFound;
}

async function main() {
  console.log(`============================================================`);
  console.log(`>>> BẮT ĐẦU DỌN DẸP CÁC BÀI ĐĂNG CÔNG KHAI SHORTS 05-16 TRÊN FACEBOOK`);
  console.log(`============================================================\n`);

  const cdp = await getClientForPage('business.facebook.com');

  // Verify Shorts 01-04 before starting
  await verifyPreservedShorts(cdp);

  const deleteResults = [];
  for (const item of TARGET_SHORTS) {
    const res = await deleteMatchingPost(cdp, item);
    deleteResults.push({ label: item.label, deleted: res });
    await sleep(2000);
  }

  // Clear search filter
  await setSearchQuery(cdp, '');
  await sleep(3000);

  console.log(`\n================ BẢNG KẾT QUẢ DỌN DẸP ================`);
  for (const r of deleteResults) {
    console.log(`${r.label}: ${r.deleted ? 'ĐÃ XÓA THÀNH CÔNG' : 'KHÔNG TỒN TẠI / BỎ QUA'}`);
  }

  // Verify Shorts 01-04 after finishing
  const ok = await verifyPreservedShorts(cdp);
  if (ok) {
    console.log(`\n[✓] HOÀN TẤT DỌN DẸP: Shorts 01-04 được giữ nguyên 100%!`);
  } else {
    console.error(`\n[!] CẢNH BÁO: Kiểm tra lại Shorts 01-04!`);
  }

  cdp.close();
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});

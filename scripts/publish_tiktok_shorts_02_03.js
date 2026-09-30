#!/usr/bin/env node
/**
 * scripts/publish_tiktok_shorts_02_03.js
 *
 * Publishes Shorts 02 and Shorts 03 immediately to TikTok Studio.
 */

const path = require('path');
const { uploadSingleShortToTikTok } = require('../engine/tiktok_uploader');
const { getClientForPage, sleep } = require('../engine/cdp');

const ITEMS = [
  {
    num: 2,
    videoPath: path.resolve(__dirname, '../output/shorts_02_eye_of_sahara_master_1080p.mp4'),
    caption: 'Bí Ẩn Con Mắt Sahara: Tàn Tích Thành Phố Atlantis Đã Mất?! #shorts #ZFStudio #AmazingWorld #EyeOfSahara',
    scheduleTime: null
  },
  {
    num: 3,
    videoPath: path.resolve(__dirname, '../output/shorts_03_lake_natron_master_1080p.mp4'),
    caption: 'Hồ Nước Đỏ Kỳ Bí Hóa Đá Mọi Sinh Vật Rơi Xuống?! #shorts #ZFStudio #AmazingWorld #LakeNatron',
    scheduleTime: null
  }
];

async function verifyOnTikTok(titles) {
  const cdp = await getClientForPage('tiktokstudio');
  await cdp.send('Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/content' });
  await sleep(4000);

  const found = await cdp.evaluate(`((expected) => {
    const text = document.body.innerText;
    return expected.map(title => {
      const shortTitle = title.split('#')[0].trim();
      return {
        title: shortTitle,
        present: text.includes(shortTitle)
      };
    });
  })(${JSON.stringify(titles)})`);

  cdp.close();
  return found;
}

async function main() {
  console.log(`============================================================`);
  console.log(`>>> BẮT ĐẦU ĐĂNG SHORTS 02 VÀ SHORTS 03 LÊN TIKTOK STUDIO`);
  console.log(`============================================================\n`);

  for (const item of ITEMS) {
    console.log(`\n>>> Đang đăng Shorts ${item.num.toString().padStart(2, '0')}...`);
    const res = await uploadSingleShortToTikTok({
      videoPath: item.videoPath,
      caption: item.caption,
      scheduleTime: null
    });
    console.log(`[✓] Đã xử lý xong Shorts ${item.num.toString().padStart(2, '0')}:`, res);
    await sleep(5000);
  }

  console.log(`\n[-] Xác minh trạng thái bài đăng trên TikTok Studio content page...`);
  const check = await verifyOnTikTok(ITEMS.map(i => i.caption));
  console.log('Kết quả kiểm tra:', JSON.stringify(check, null, 2));

  const allPassed = check.every(c => c.present);
  if (allPassed) {
    console.log(`\n[✓] HOÀN TẤT: Cả Shorts 02 và Shorts 03 đã xuất bản thành công trên TikTok Studio!`);
  } else {
    console.error(`\n[!] CẢNH BÁO: Một số video chưa thấy xuất hiện trên TikTok Studio!`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});

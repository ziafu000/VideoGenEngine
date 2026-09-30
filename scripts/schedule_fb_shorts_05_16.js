#!/usr/bin/env node
/**
 * scripts/schedule_fb_shorts_05_16.js
 *
 * Sequentially uploads and schedules Shorts 06 through Shorts 16 on Facebook Reels.
 * (Shorts 05 is already scheduled for 01/10/2026 08:00).
 */

const fs = require('fs');
const { uploadReel } = require('../engine/facebook_uploader');
const { getClientForPage, sleep } = require('../engine/cdp');

const REMAINING_SHORTS = [
  {
    num: 14,
    storyboard: 'storyboards/shorts_14_mount_roraima.json',
    video: 'output/shorts_14_mount_roraima_master_1080p.mp4',
    schedule: '05/10/2026 13:00'
  },
  {
    num: 15,
    storyboard: 'storyboards/shorts_15_fly_geyser.json',
    video: 'output/shorts_15_fly_geyser_master_1080p.mp4',
    schedule: '06/10/2026 08:00'
  },
  {
    num: 16,
    storyboard: 'storyboards/shorts_16_naica_crystal_cave.json',
    video: 'output/shorts_16_naica_crystal_cave_master_1080p.mp4',
    schedule: '06/10/2026 13:00'
  }
];

async function main() {
  console.log(`============================================================`);
  console.log(`>>> BẮT ĐẦU QUÁ TRÌNH LÊN LỊCH SHORTS 06 ĐẾN 16 TRÊN FACEBOOK REELS`);
  console.log(`    Tổng số video: ${REMAINING_SHORTS.length}`);
  console.log(`============================================================\n`);

  const results = [];

  for (let i = 0; i < REMAINING_SHORTS.length; i++) {
    const item = REMAINING_SHORTS[i];
    console.log(`\n============================================================`);
    console.log(`>>> [${i + 1}/${REMAINING_SHORTS.length}] TIẾN HÀNH LÊN LỊCH: Shorts ${String(item.num).padStart(2, '0')}`);
    console.log(`    - File: ${item.video}`);
    console.log(`    - Lịch đăng: ${item.schedule}`);
    console.log(`============================================================`);

    const sb = JSON.parse(fs.readFileSync(item.storyboard, 'utf8'));

    try {
      const res = await uploadReel({
        videoPath: item.video,
        storyboard: sb,
        schedule: item.schedule
      });
      results.push({ num: item.num, schedule: item.schedule, success: true, res });
      console.log(`[✓] Đã lên lịch thành công cho Shorts ${item.num}!`);
    } catch (err) {
      console.error(`[!] Thất bại khi lên lịch Shorts ${item.num}:`, err.message);
      results.push({ num: item.num, schedule: item.schedule, success: false, error: err.message });
      throw err; // Dừng lại ngay để xử lý nếu có lỗi
    }

    if (i < REMAINING_SHORTS.length - 1) {
      console.log(`[-] Nghỉ 4s trước khi sang video tiếp theo...`);
      await sleep(4000);
    }
  }

  console.log(`\n================ TỔNG KẾT QUÁ TRÌNH LÊN LỊCH ================`);
  console.log(`Shorts 05: 01/10/2026 08:00 - THÀNH CÔNG (Đã lên lịch trước đó)`);
  for (const r of results) {
    console.log(`Shorts ${String(r.num).padStart(2, '0')}: ${r.schedule} - ${r.success ? 'THÀNH CÔNG' : 'THẤT BẠI: ' + r.error}`);
  }
}

main().catch(err => {
  console.error('Fatal error during scheduling batch:', err);
  process.exit(1);
});

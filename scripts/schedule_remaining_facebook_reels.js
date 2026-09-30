#!/usr/bin/env node
/**
 * scripts/schedule_remaining_facebook_reels.js
 *
 * Sequentially uploads and schedules remaining Amazing World Shorts (06 to 16)
 * to Facebook Reels via Meta Business Suite.
 */

const fs = require('fs');
const path = require('path');
const fb = require('../engine/facebook_uploader');

const REMAINING_FB_SHORTS = [
  {
    num: 6,
    file: "output/shorts_06_son_doong_master_1080p.mp4",
    caption: "Hang Sơn Đoòng: Kỳ Quan Lớn Tới Mức Tự Tạo Mây & Khí Hậu Riêng?! 🧗‍♂️☁️ #Shorts #ZFStudio",
    schedule: "01/10/2026 13:00"
  },
  {
    num: 7,
    file: "output/shorts_07_snake_island_master_1080p.mp4",
    caption: "Đảo Rắn Tử Thần: Nơi 1 Mét Vuông Có 5 Con Rắn Độc Cấm Tuyệt Đối Con Người! 🐍🏝️ #Shorts #ZFStudio",
    schedule: "02/10/2026 08:00"
  },
  {
    num: 8,
    file: "output/shorts_09_salar_de_uyuni_master_1080p.mp4",
    caption: "Cánh Đồng Muối Salar de Uyuni: Chiếc Gương Khổng Lồ Phản Chiếu Cả Vũ Trụ! 🪞✨ #Shorts #ZFStudio",
    schedule: "02/10/2026 13:00"
  },
  {
    num: 9,
    file: "output/shorts_10_blood_falls_master_1080p.mp4",
    caption: "Thác Máu Nam Cực: Kỳ Quan Đỏ Thẫm Tuôn Trào Sau 2 Triệu Năm Bị Giam Cầm! 🩸❄️ #Shorts #ZFStudio",
    schedule: "03/10/2026 08:00"
  },
  {
    num: 10,
    file: "output/shorts_11_great_blue_hole_master_1080p.mp4",
    caption: "Hố Xanh Vĩ Đại Belize: Cổng Vào Kỷ Băng Hà Nhìn Rõ Từ Ngoài Vũ Trụ! 🌊🕳️ #Shorts #ZFStudio",
    schedule: "03/10/2026 13:00"
  },
  {
    num: 11,
    file: "output/shorts_12_boiling_river_master_1080p.mp4",
    caption: "Dòng Sông Sôi Amazon: Nước Nóng 100°C Làm Chín Mọi Sinh Vật Giữa Rừng Già! 🌊♨️ #Shorts #ZFStudio",
    schedule: "04/10/2026 08:00"
  },
  {
    num: 12,
    file: "output/shorts_08_crooked_forest_master_1080p.mp4",
    caption: "Rừng Uốn Cong Ba Lan: Bí Ẩn 400 Cây Thông Bị Bẻ Cong 90 Độ Suốt 1 Thế Kỷ! 🌲❓ #Shorts #ZFStudio",
    schedule: "04/10/2026 13:00"
  },
  {
    num: 13,
    file: "output/shorts_13_isla_de_las_munecas_master_1080p.mp4",
    caption: "Đảo Búp Bê Ma Quái Mexico: Hàng Nghìn Con Búp Bê Tự Cử Động Giữa Đầm Lầy?! 🎎🏝️ #Shorts #ZFStudio",
    schedule: "05/10/2026 08:00"
  },
  {
    num: 14,
    file: "output/shorts_14_mount_roraima_master_1080p.mp4",
    caption: "Núi Bàn Roraima: Vùng Đất Thất Lạc Cổ Đại 2 Tỷ Năm Giữa Biển Mây! ⛰️☁️ #Shorts #ZFStudio",
    schedule: "05/10/2026 13:00"
  },
  {
    num: 15,
    file: "output/shorts_15_fly_geyser_master_1080p.mp4",
    caption: "Mạch Nước Phun Fly Geyser Tắc Kè Hoa: Kỳ Quan Cầu Vồng Ngoài Hành Tinh! 🌈🌋 #Shorts #ZFStudio",
    schedule: "06/10/2026 08:00"
  },
  {
    num: 16,
    file: "output/shorts_16_naica_crystal_cave_master_1080p.mp4",
    caption: "Hang Tinh Thể Naica: Pháo Đài Pha Lê Khổng Lồ 50 Tấn Nóng 58°C Dưới Lòng Đất! 💎⛏️ #Shorts #ZFStudio",
    schedule: "06/10/2026 13:00"
  }
];

async function main() {
  console.log(`============================================================`);
  console.log(`>>> BẮT ĐẦU ĐĂNG VÀ LÊN LỊCH ${REMAINING_FB_SHORTS.length} VIDEO LÊN FACEBOOK REELS`);
  console.log(`============================================================\n`);

  const results = [];

  for (const item of REMAINING_FB_SHORTS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`[+] Đang xử lý Shorts ${item.num.toString().padStart(2, '0')}: ${item.caption.slice(0, 40)}...`);
    console.log(`    Lịch đăng: ${item.schedule}`);
    console.log(`------------------------------------------------------------`);

    try {
      const res = await fb.uploadReel({
        videoPath: item.file,
        caption: item.caption,
        schedule: item.schedule
      });
      console.log(`[✓] THÀNH CÔNG Shorts ${item.num.toString().padStart(2, '0')}: ${item.schedule}`);
      results.push({ num: item.num, status: 'success', res });
    } catch (err) {
      console.error(`[!] THẤT BẠI Shorts ${item.num.toString().padStart(2, '0')}:`, err.message);
      results.push({ num: item.num, status: 'error', error: err.message });
      // Wait a bit before next attempt
    }

    // Short sleep between uploads
    await new Promise(r => setTimeout(r, 4000));
  }

  console.log(`\n================ BẢNG TỔNG KẾT FACEBOOK REELS ================`);
  for (const r of results) {
    console.log(`Shorts ${r.num.toString().padStart(2, '0')}: ${r.status.toUpperCase()}`);
  }
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});

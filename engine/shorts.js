const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');

/**
 * Generate ASS subtitle overlay for 9:16 Shorts with Option B (Cinematic Blur Overlay)
 * Uses high-impact bold typography standard for mobile screens.
 */
function generateShortsOverlayASS({
  badge = 'ORIGINAL SERIES',
  hookMain = 'MUST WATCH MOMENT',
  hookAccent = 'EPIC SCENE ⚡',
  ctaButton = '🔥 WATCH FULL EPISODE HERE',
  ctaSub = '👇 LINK IN PINNED COMMENT 👇',
  outAssPath
}) {
  const assContent = `[Script Info]
Title: VideoGen Shorts Overlay
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Badge,Segoe UI,32,&H00FFFF00,&H000000FF,&H00112222,&H80000000,-1,0,0,0,100,100,1.5,0,3,10,0,8,10,10,180,1
Style: HookMain,Segoe UI,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5.0,3.0,8,10,10,290,1
Style: HookAccent,Segoe UI,64,&H0000E5FF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0.5,0,1,6.0,4.0,8,10,10,380,1
Style: CtaButton,Segoe UI,48,&H00FFFFFF,&H000000FF,&H000000CC,&H00000000,-1,0,0,0,100,100,0.5,0,1,4.5,3.0,2,10,10,450,1
Style: CtaSub,Segoe UI,40,&H00FFFF00,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1.0,0,1,3.5,2.0,2,10,10,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:05:00.00,Badge,,0,0,180,,{\\b1}${badge}{\\b0}
Dialogue: 0,0:00:00.00,0:05:00.00,HookMain,,0,0,290,,{\\b1}${hookMain}{\\b0}
Dialogue: 0,0:00:00.00,0:05:00.00,HookAccent,,0,0,380,,{\\b1}${hookAccent}{\\b0}
Dialogue: 0,0:00:00.00,0:05:00.00,CtaButton,,0,0,450,,{\\b1}${ctaButton}{\\b0}
Dialogue: 0,0:00:00.00,0:05:00.00,CtaSub,,0,0,350,,{\\b1}${ctaSub}{\\b0}
`;

  const dir = path.dirname(outAssPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outAssPath, assContent, 'utf8');
  return outAssPath;
}

/**
 * Render a single vertical 9:16 Short using Option B (Cinematic Blur Overlay)
 */
async function renderShort({
  masterVideoPath,
  startTime = '00:00:00',
  duration = 35,
  badge,
  hookMain,
  hookAccent,
  ctaButton,
  ctaSub,
  outputVideoPath
}) {
  const tempDir = path.join(config.RENDERS_DIR, 'temp_shorts');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const shortId = path.basename(outputVideoPath, '.mp4');
  const tempCut = path.join(tempDir, `raw_${shortId}.mp4`);
  const tempAss = path.join(tempDir, `overlay_${shortId}.ass`);

  console.log(`\n>>> Đang xử lý Short: ${shortId}`);
  console.log(`    - Cắt từ: ${startTime} (Thời lượng: ${duration}s)`);

  // 1. Cut segment from master video
  execSync(`ffmpeg -y -ss ${startTime} -i ${JSON.stringify(masterVideoPath)} -t ${duration} -c:v libx264 -c:a aac ${JSON.stringify(tempCut)} 2>/dev/null`);

  // 2. Generate ASS overlay
  generateShortsOverlayASS({
    badge,
    hookMain,
    hookAccent,
    ctaButton,
    ctaSub,
    outAssPath: tempAss
  });

  // 3. Render 9:16 layout with FFmpeg filter_complex
  const filterComplex = (
    `[0:v]split=2[bg_in][fg_in];` +
    `[bg_in]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=luma_radius=35:luma_power=3,eq=brightness=-0.18:contrast=1.15[bg];` +
    `[fg_in]scale=1080:608:flags=lanczos[fg];` +
    `[bg][fg]overlay=0:656[comp];` +
    `[comp]drawbox=y=654:color=0x00FFFF@0.7:width=1080:height=2:t=fill,` +
    `drawbox=y=1264:color=0x00FFFF@0.7:width=1080:height=2:t=fill,` +
    `subtitles='${tempAss}'[v]`
  );

  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`    - Đang tổng hợp 9:16 Cinematic Blur Overlay...`);
  execSync(`ffmpeg -y -i ${JSON.stringify(tempCut)} -filter_complex "${filterComplex}" -map "[v]" -map 0:a -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k ${JSON.stringify(outputVideoPath)} 2>/dev/null`);

  const stat = fs.statSync(outputVideoPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`    [✓] Hoàn thành: ${outputVideoPath} (${sizeMB} MB)`);

  return {
    outputVideoPath,
    sizeMB
  };
}

/**
 * Generate all shorts defined in storyboard (or default set) from master video
 */
async function generateAllShorts({
  storyboard,
  masterVideoPath,
  outputDir = path.join(config.OUTPUT_DIR, 'shorts')
}) {
  if (!fs.existsSync(masterVideoPath)) {
    throw new Error(`Không tìm thấy file master video tại: ${masterVideoPath}`);
  }

  const shortsList = storyboard.shorts || [];
  if (shortsList.length === 0) {
    console.log(`[!] Storyboard chưa định nghĩa mảng 'shorts'. Tạo short mẫu mặc định từ 30s đầu...`);
    shortsList.push({
      id: 'short_01_highlight',
      title: 'Highlight',
      start_time: '00:00:00',
      duration: 35,
      badge: (storyboard.project && storyboard.project.title) || 'ORIGINAL AI SERIES',
      hook_main: 'MUST WATCH HIGHLIGHT',
      hook_accent: 'EPIC ACTION MOMENT ⚡',
      cta_button: '🔥 XEM TRỌN BỘ TẬP 1 TẠI ĐÂY',
      cta_sub: '👇 LINK GHIM DƯỚI BÌNH LUẬN 👇'
    });
  }

  console.log(`\n============================================================`);
  console.log(`       VIDEOGEN: BẮT ĐẦU TỰ ĐỘNG CẮT VÀ RENDER SHORTS 9:16    `);
  console.log(`       Tổng số clip Shorts: ${shortsList.length}             `);
  console.log(`============================================================`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  const defaultBadge = (storyboard.project && storyboard.project.title) || 'ORIGINAL SERIES';

  for (let i = 0; i < shortsList.length; i++) {
    const item = shortsList[i];
    const shortId = item.id || `short_${String(i + 1).padStart(2, '0')}`;
    const outPath = path.join(outputDir, `${shortId}_9x16.mp4`);

    const res = await renderShort({
      masterVideoPath,
      startTime: item.start_time || '00:00:00',
      duration: item.duration || 35,
      badge: item.badge || defaultBadge,
      hookMain: item.hook_main || item.title || 'EPIC MOMENT',
      hookAccent: item.hook_accent || 'BẤM XEM NGAY ⚡',
      ctaButton: item.cta_button || '🔥 XEM TRỌN BỘ TẬP 1 TẠI ĐÂY',
      ctaSub: item.cta_sub || '👇 LINK GHIM DƯỚI BÌNH LUẬN 👇',
      outputVideoPath: outPath
    });

    results.push(res);

    // Sync to Windows destinations if available
    if (config.DEST_FINAL) {
      const shortsDest = path.join(config.DEST_FINAL, 'Shorts');
      if (!fs.existsSync(shortsDest)) fs.mkdirSync(shortsDest, { recursive: true });
      const winTarget = path.join(shortsDest, path.basename(outPath));
      fs.copyFileSync(outPath, winTarget);
      console.log(`    [→] Đã đồng bộ sang: ${winTarget}`);
    }

    if (config.WIN_DOWNLOADS_DIR && fs.existsSync(config.WIN_DOWNLOADS_DIR)) {
      const winDlTarget = path.join(config.WIN_DOWNLOADS_DIR, path.basename(outPath));
      fs.copyFileSync(outPath, winDlTarget);
    }
  }

  console.log(`\n============================================================`);
  console.log(`✓ ĐÃ RENDER VÀ ĐỒNG BỘ ${results.length} SHORTS 9:16 THÀNH CÔNG!`);
  console.log(`============================================================\n`);

  return results;
}

module.exports = {
  generateShortsOverlayASS,
  renderShort,
  generateAllShorts
};

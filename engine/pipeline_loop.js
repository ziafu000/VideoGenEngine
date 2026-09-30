/**
 * engine/pipeline_loop.js: Automated Continuous Video Production Pipeline Loop.
 *
 * Provides batch and continuous production workflows:
 *   - Google Flow video rendering (1080p super-resolution or direct CDN 720p)
 *   - ElevenLabs voiceover synthesis
 *   - FFmpeg multi-layer audio mixing & master assembly
 *   - Optional synchronization to Windows Downloads
 *   - Video distribution / upload (YouTube Studio and/or Facebook Reels)
 *
 * Respects existing renders/assets so completed steps are not redundantly re-executed.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const bridge = require('./bridge');
const flow = require('./flow');
const tts = require('./tts');
const subtitles = require('./subtitles');
const compositor = require('./compositor');
const youtube = require('./youtube');
const facebook = require('./facebook');
const tiktok = require('./tiktok_uploader');

/**
 * Resolve storyboard path and parse content.
 * Accepts full path, relative path, or filename under storyboards/ or examples/storyboards/.
 */
function resolveStoryboard(storyboardPath) {
  if (typeof storyboardPath === 'object' && storyboardPath !== null && !storyboardPath.trim) {
    // Already parsed storyboard object
    return { path: storyboardPath._filePath || 'inline_storyboard.json', data: storyboardPath };
  }

  const rawPath = String(storyboardPath || '').trim();
  const candidates = [
    path.resolve(rawPath),
    path.join(config.PROJECT_DIR, rawPath),
    path.join(config.STORYBOARDS_DIR, rawPath),
    path.join(config.STORYBOARDS_DIR, path.basename(rawPath)),
    path.join(config.PROJECT_DIR, 'examples', 'storyboards', path.basename(rawPath)),
    path.join(config.PROJECT_DIR, 'examples', 'storyboards', rawPath)
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) {
      return { path: c, data: JSON.parse(fs.readFileSync(c, 'utf8')) };
    }
    if (fs.existsSync(c + '.json') && !fs.statSync(c + '.json').isDirectory()) {
      return { path: c + '.json', data: JSON.parse(fs.readFileSync(c + '.json', 'utf8')) };
    }
  }

  throw new Error(`Không tìm thấy file kịch bản storyboard tại: ${storyboardPath}`);
}

/**
 * Discover storyboard JSON files in storyboards/ (or examples/storyboards/ fallback).
 */
function discoverStoryboards(customDir = null) {
  const targetDir = customDir ? path.resolve(customDir) : config.STORYBOARDS_DIR;
  let files = [];

  if (fs.existsSync(targetDir)) {
    files = fs.readdirSync(targetDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('.'))
      .sort()
      .map(f => path.join(targetDir, f));
  }

  // If no storyboards found in private storyboards/, check examples/storyboards/
  if (files.length === 0 && !customDir) {
    const examplesDir = path.join(config.PROJECT_DIR, 'examples', 'storyboards');
    if (fs.existsSync(examplesDir)) {
      files = fs.readdirSync(examplesDir)
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .sort()
        .map(f => path.join(examplesDir, f));
    }
  }

  return files;
}

/**
 * Execute full production pipeline for a single storyboard.
 *
 * @param {string|object} sbPath - Path to storyboard JSON file or parsed object
 * @param {object} options
 * @param {boolean} [options.draft=false] - When uploading to Facebook/YouTube, use draft/private visibility
 * @param {boolean} [options.noUpload=false] - Skip upload step completely
 * @param {string} [options.resolution='1080p'] - Video render resolution ('1080p' or '720p')
 * @param {string} [options.targetPlatform='youtube'] - 'youtube', 'facebook', or 'both'
 * @param {boolean} [options.skipBridge=false] - Skip bridge readiness check
 * @param {boolean} [options.skipRender=false] - Skip Google Flow render step
 * @param {boolean} [options.skipVoice=false] - Skip ElevenLabs voice step
 * @returns {Promise<object>} Pipeline execution report
 */
async function runPipelineForStoryboard(sbPath, options = {}) {
  const {
    draft = false,
    noUpload = false,
    resolution = '1080p',
    targetPlatform = 'youtube',
    skipBridge = false,
    skipRender = false,
    skipVoice = false
  } = options;

  const { path: resolvedPath, data: sb } = resolveStoryboard(sbPath);
  const baseName = path.basename(resolvedPath, '.json');
  const episodeName = sb.series_id ||
    (sb.project && sb.project.id ? sb.project.id : '') ||
    sb.project_name ||
    baseName;

  const epRenderDir = path.join(config.RENDERS_DIR, episodeName);
  const epAudioDir = path.join(config.AUDIO_DIR, episodeName);

  if (!fs.existsSync(epRenderDir)) fs.mkdirSync(epRenderDir, { recursive: true });
  if (!fs.existsSync(epAudioDir)) fs.mkdirSync(epAudioDir, { recursive: true });

  const episodeTitle = sb.episode_title || (sb.project && sb.project.title) || sb.title || episodeName;
  console.log(`\n============================================================`);
  console.log(`🎬 BẮT ĐẦU SẢN XUẤT TẬP: ${episodeTitle}`);
  console.log(`   Storyboard: ${resolvedPath}`);
  console.log(`   Độ phân giải: ${resolution.toUpperCase()} | Upload: ${noUpload ? 'BỎ QUA' : (draft ? 'DRAFT / PRIVATE' : 'CÔNG KHAI / CHUẨN')}`);
  console.log(`============================================================`);

  // Ensure bridge connection if browser actions are needed
  if (!skipBridge && (!skipRender || !skipVoice || !noUpload)) {
    try {
      await bridge.ensureBridge();
    } catch (err) {
      console.warn(`[!] Cảnh báo kiểm tra bridge: ${err.message}`);
    }
  }

  // 1. RENDER GOOGLE FLOW (Bỏ qua các shot đã có file render hợp lệ)
  const shots = sb.shots || [];
  const renderResults = [];

  if (!skipRender && shots.length > 0) {
    console.log(`\n[-] [1/4] Kiểm tra & render video cảnh quay trên Google Flow [${resolution.toUpperCase()}]...`);
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      const outFile = path.join(epRenderDir, `${shotId}.mp4`);
      const rootOutFile = path.join(config.RENDERS_DIR, `${shotId}.mp4`);

      // Kiểm tra file có sẵn
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
        const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
        console.log(`    [✓] [${i + 1}/${shots.length}] ${shotId}: Đã có sẵn (${sizeMb} MB), bỏ qua render.`);
        if (!fs.existsSync(rootOutFile)) {
          try { fs.copyFileSync(outFile, rootOutFile); } catch {}
        }
        renderResults.push({ shotId, status: 'cached', file: outFile });
        continue;
      }

      if (fs.existsSync(rootOutFile) && fs.statSync(rootOutFile).size > 1000) {
        const sizeMb = (fs.statSync(rootOutFile).size / 1024 / 1024).toFixed(2);
        console.log(`    [✓] [${i + 1}/${shots.length}] ${shotId}: Đã có sẵn tại root renders/ (${sizeMb} MB), đồng bộ.`);
        try { fs.copyFileSync(rootOutFile, outFile); } catch {}
        renderResults.push({ shotId, status: 'cached', file: outFile });
        continue;
      }

      const prompt = s.flow_prompt || s.prompt;
      if (!prompt) {
        console.warn(`    [!] [${i + 1}/${shots.length}] ${shotId}: Không có prompt, bỏ qua.`);
        renderResults.push({ shotId, status: 'skipped_no_prompt' });
        continue;
      }

      console.log(`    >>> [${i + 1}/${shots.length}] Gửi render ${shotId}...`);
      await flow.clearCharacters();
      for (const charName of (s.characters || [])) {
        console.log(`        [-] Gắn chip nhân vật: @${charName}`);
        await flow.addCharacter(charName);
      }
      await flow.submitPrompt(prompt);
      await flow.waitForRender(240);
      await flow.downloadLatest(outFile, { resolution });

      try {
        fs.copyFileSync(outFile, rootOutFile);
      } catch {}

      renderResults.push({ shotId, status: 'rendered', file: outFile });
    }
  } else {
    console.log(`\n[-] [1/4] Bỏ qua bước Google Flow render.`);
  }

  // 2. TẠO LỜI THOẠI ELEVENLABS (Bỏ qua các shot đã có file audio)
  let voiceDir = epAudioDir;
  if (!skipVoice) {
    console.log(`\n[-] [2/4] Tạo giọng đọc thuyết minh qua ElevenLabs...`);
    try {
      voiceDir = await tts.generateAllVoices(sb, [], resolvedPath);
    } catch (err) {
      console.warn(`    [!] Cảnh báo tạo voice ElevenLabs: ${err.message}. Tiếp tục với audio hiện có.`);
    }
  } else {
    console.log(`\n[-] [2/4] Bỏ qua bước ElevenLabs voice synthesis.`);
  }

  // 3. HẬU KỲ & HÒA ÂM MASTER VIDEO
  console.log(`\n[-] [3/4] Hòa âm đa tầng & ghép nối master video...`);
  const videoFiles = [];
  const audioFiles = [];
  const timelines = [];
  const delays = [];

  let countVoices = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
    let vFile = path.join(epRenderDir, `${shotId}.mp4`);
    if (!fs.existsSync(vFile)) {
      vFile = path.join(config.RENDERS_DIR, `${shotId}.mp4`);
    }

    let aFile = path.join(voiceDir, `voice_${shotId}.mp3`);
    if (!fs.existsSync(aFile)) {
      aFile = path.join(epAudioDir, `voice_${shotId}.mp3`);
    }
    if (!fs.existsSync(aFile)) {
      aFile = path.join(config.AUDIO_DIR, baseName, `voice_${shotId}.mp3`);
    }

    if (fs.existsSync(vFile)) {
      videoFiles.push(vFile);

      const hasSubOrVo = !!(s.vietnamese_subtitles || s.japanese_voiceover || s.voice || (s.audio && (s.audio.voiceover || s.audio.japanese_voiceover)));
      const hasAudioFile = hasSubOrVo && fs.existsSync(aFile);

      if (hasAudioFile) {
        countVoices++;
        audioFiles.push(aFile);
      } else {
        audioFiles.push(null);
      }

      const delaySec = (s.voice && typeof s.voice.voice_delay_sec === 'number')
        ? s.voice.voice_delay_sec
        : ((s.audio && typeof s.audio.voice_delay_sec === 'number') ? s.audio.voice_delay_sec : 0.3);
      delays.push(delaySec);

      timelines.push({
        shotId,
        duration: compositor.getDuration(vFile),
        audioDuration: hasAudioFile ? compositor.getDuration(aFile) : 0
      });
    }
  }

  if (videoFiles.length === 0) {
    throw new Error(`Không tìm thấy video clips nào trong ${epRenderDir} hoặc renders/ để ghép nối!`);
  }

  // Phụ đề ASS
  const assPath = path.join(epRenderDir, 'master_subtitles.ass');
  subtitles.generateSubtitles(sb, timelines, assPath);
  try {
    fs.copyFileSync(assPath, path.join(config.RENDERS_DIR, 'master_subtitles.ass'));
  } catch {}

  const isShorts = (sb.aspect_ratio === '9:16') ||
                   (sb.format === 'shorts_40s') ||
                   (sb.project && (sb.project.mode === 'shorts' || sb.project.aspect_ratio === '9:16'));
  const noHardsub = sb.hardsub === false || (sb.project && sb.project.hardsub === false);

  const masterOutput = path.join(config.OUTPUT_DIR, `${episodeName}_master_${resolution}.mp4`);
  const compositeRes = await compositor.compositeVideo({
    videoFiles,
    audioFiles,
    assSubtitlePath: noHardsub ? null : assPath,
    outputVideoPath: masterOutput,
    ambientVolume: 0.25,
    voiceVolume: 1.0,
    delays,
    aspectRatio: isShorts ? '9:16' : '16:9',
    burnSubtitles: !noHardsub
  });

  console.log(`[✓] Master video hoàn tất: ${masterOutput} (${compositeRes.duration.toFixed(2)}s)`);

  // Đồng bộ sang Windows Downloads nếu có
  try {
    const winDownloads = config.WIN_DOWNLOADS_DIR;
    if (winDownloads && fs.existsSync(winDownloads)) {
      const destPath = path.join(winDownloads, path.basename(masterOutput));
      fs.copyFileSync(masterOutput, destPath);
      console.log(`    [✓] Đã copy sang Windows Downloads: ${destPath}`);
    }
  } catch (err) {
    console.warn(`    [!] Không thể copy sang Windows Downloads: ${err.message}`);
  }

  // 4. UPLOAD (YouTube Studio / Facebook Reels)
  const uploadResults = {};

  if (!noUpload) {
    console.log(`\n[-] [4/4] Tự động tải video lên nền tảng phân phối...`);
    const ytMeta = sb.youtube || {};
    const ytVisibility = draft ? 'private' : (ytMeta.visibility || 'private');
    const ytTitle = ytMeta.title || episodeTitle;
    const ytDescription = ytMeta.description || (sb.project && sb.project.series) || '';

    // Upload to YouTube
    if (targetPlatform === 'youtube' || targetPlatform === 'both' || targetPlatform === 'all') {
      try {
        const ytSchedule = (!draft && (ytMeta.schedule || sb.schedule)) || null;
        console.log(`    [-] Đang tải lên YouTube Studio (Chế độ: ${ytSchedule ? `SCHEDULED (${ytSchedule})` : ytVisibility.toUpperCase()})...`);
        const ytRes = await youtube.uploadVideo({
          videoPath: masterOutput,
          title: ytTitle,
          description: ytDescription,
          visibility: ytVisibility,
          schedule: ytSchedule
        });
        uploadResults.youtube = { success: true, result: ytRes, visibility: ytVisibility, schedule: ytSchedule };
        console.log(`    [✓] YouTube Studio upload thành công.`);
      } catch (err) {
        console.error(`    [!] Lỗi khi upload lên YouTube Studio: ${err.message}`);
        uploadResults.youtube = { success: false, error: err.message };
      }
    }

    // Upload to TikTok
    if (targetPlatform === 'tiktok' || targetPlatform === 'all') {
      try {
        const ttMeta = sb.tiktok || {};
        const ttCaption = ttMeta.caption || (sb.series_title ? `${sb.series_title} - ${sb.episode_title}` : sb.title);
        const ttSchedule = (!draft && (ttMeta.schedule || sb.schedule)) || null;
        console.log(`    [-] Đang tải lên TikTok Studio (Schedule: ${ttSchedule || 'Now'})...`);
        const ttRes = await tiktok.uploadSingleShortToTikTok({
          videoPath: masterOutput,
          caption: ttCaption,
          scheduleTime: ttSchedule
        });
        uploadResults.tiktok = { success: true, result: ttRes, schedule: ttSchedule };
        console.log(`    [✓] TikTok Studio upload thành công.`);
      } catch (err) {
        console.error(`    [!] Lỗi khi upload lên TikTok Studio: ${err.message}`);
        uploadResults.tiktok = { success: false, error: err.message };
      }
    }

    // Upload to Facebook Reels
    if (targetPlatform === 'facebook' || targetPlatform === 'both' || targetPlatform === 'all') {
      try {
        console.log(`    [-] Đang tải lên Facebook Reels (Draft: ${draft ? 'BẬT' : 'TẮT'})...`);
        const fbRes = await facebook.uploadReel({
          videoPath: masterOutput,
          draft: Boolean(draft),
          storyboard: sb
        });
        uploadResults.facebook = { success: true, result: fbRes };
        console.log(`    [✓] Facebook Reels upload thành công.`);
      } catch (err) {
        console.error(`    [!] Lỗi khi upload lên Facebook Reels: ${err.message}`);
        uploadResults.facebook = { success: false, error: err.message };
      }
    }
  } else {
    console.log(`\n[-] [4/4] Cờ --no-upload được bật: Bỏ qua bước tải video lên mạng.`);
  }

  const report = {
    storyboard: resolvedPath,
    episode: episodeName,
    title: episodeTitle,
    masterVideo: masterOutput,
    duration: compositeRes.duration,
    renders: renderResults,
    uploads: uploadResults,
    completedAt: new Date().toISOString()
  };

  console.log(`\n🎉 HOÀN THÀNH TẬP: ${episodeTitle}`);
  return report;
}

/**
 * Run continuous production loop over a list of storyboards.
 *
 * @param {string[]} [storyboardPaths=[]] - Array of storyboard paths or empty to discover all
 * @param {object} [options={}]
 * @param {boolean} [options.draft=false] - Draft/private visibility
 * @param {boolean} [options.noUpload=false] - Skip uploads
 * @param {string} [options.resolution='1080p'] - '1080p' or '720p'
 * @param {number} [options.delayMs=5000] - Delay between episodes in milliseconds
 * @param {boolean} [options.stopOnQuota=true] - Stop loop if quota exhausted
 * @returns {Promise<object>} Summary report of the batch run
 */
async function runLoop(storyboardPaths = [], options = {}) {
  const {
    draft = false,
    noUpload = false,
    resolution = '1080p',
    delayMs = 5000,
    stopOnQuota = true
  } = options;

  let queue = Array.isArray(storyboardPaths) ? [...storyboardPaths] : [];

  if (queue.length === 0) {
    queue = discoverStoryboards();
  }

  if (queue.length === 0) {
    console.log('[!] Không tìm thấy storyboard nào trong hàng đợi.');
    return { success: false, total: 0, completed: [], failed: [] };
  }

  console.log(`\n============================================================`);
  console.log(`🔄 VIDEOGEN PRODUCTION LOOP: BẮT ĐẦU VÒNG LẶP SẢN XUẤT`);
  console.log(`   Tổng số tập trong hàng đợi: ${queue.length}`);
  console.log(`   Độ phân giải: ${resolution.toUpperCase()} | Draft: ${draft} | No-Upload: ${noUpload}`);
  console.log(`============================================================`);

  const completed = [];
  const failed = [];

  for (let idx = 0; idx < queue.length; idx++) {
    const sbItem = queue[idx];
    console.log(`\n------------------------------------------------------------`);
    console.log(`[${idx + 1}/${queue.length}] Tiến trình sản xuất: ${sbItem}`);
    console.log(`------------------------------------------------------------`);

    try {
      const res = await runPipelineForStoryboard(sbItem, {
        draft,
        noUpload,
        resolution
      });
      completed.push(res);

      if (idx < queue.length - 1 && delayMs > 0) {
        console.log(`\n⏳ Tạm nghỉ ${(delayMs / 1000).toFixed(1)}s trước khi xử lý tập tiếp theo...\n`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (err) {
      console.error(`\n❌ LỖI TRONG QUY TRÌNH TẠI ${sbItem}: ${err.message}`);
      failed.push({ storyboard: sbItem, error: err.message });

      const isQuotaError = stopOnQuota && (
        err.message.includes('credit') ||
        err.message.includes('quota') ||
        err.message.includes('hạn ngạch') ||
        err.message.includes('rate limit')
      );

      if (isQuotaError) {
        console.error(`🛑 PHÁT HIỆN HẾT HẠN NGẠCH! Dừng vòng lặp tự động để bảo vệ tài khoản.`);
        break;
      }
      console.error(`Bỏ qua tập này và tiếp tục tập kế tiếp trong hàng đợi...`);
    }
  }

  console.log(`\n============================================================`);
  console.log(`🏁 KẾT THÚC VÒNG LẶP SẢN XUẤT VIDEOGEN LOOP`);
  console.log(`   Thành công: ${completed.length}/${queue.length}`);
  console.log(`   Thất bại: ${failed.length}/${queue.length}`);
  console.log(`============================================================\n`);

  return {
    success: failed.length === 0,
    total: queue.length,
    completed,
    failed
  };
}

module.exports = {
  resolveStoryboard,
  discoverStoryboards,
  runPipelineForStoryboard,
  runLoop
};

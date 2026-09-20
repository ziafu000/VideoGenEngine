#!/usr/bin/env node

/**
 * generate_subtitles.js - Tự động tạo phụ đề động chuẩn Shorts (Dynamic ASS Subtitles)
 * từ file voiceover và kịch bản gốc trong storyboards/scenes.json.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const STORYBOARD_PATH = path.join(PROJECT_DIR, 'storyboards', 'scenes.json');
const MODEL_WIN = 'D:/Billy/Work/Editing/models/ggml-tiny.en.bin';

const audioFile = process.argv[2] || path.join(PROJECT_DIR, 'audio', 'voiceover_en.mp3');
const outputAss = process.argv[3] || path.join(PROJECT_DIR, 'renders', 'subtitles.ass');
const videoDuration = parseFloat(process.argv[4] || '30.0');

if (!fs.existsSync(audioFile)) {
  console.error(`[!] Không tìm thấy file audio: ${audioFile}`);
  process.exit(1);
}

// 1. Đọc kịch bản gốc từ scenes.json
let fullScript = '';
if (fs.existsSync(STORYBOARD_PATH)) {
  const sb = JSON.parse(fs.readFileSync(STORYBOARD_PATH, 'utf8'));
  fullScript = sb.script_full || '';
}

// 2. Chạy Whisper qua ffmpeg để trích xuất SRT thô
const tmpSrtWin = 'D\\:/Billy/Work/Editing/models/raw_whisper.srt';
const tmpModelWin = 'D\\:/Billy/Work/Editing/models/ggml-tiny.en.bin';
const localAudioWin = '/mnt/d/Billy/Work/Editing/models/temp_voice.mp3';
const localSrtWin = '/mnt/d/Billy/Work/Editing/models/raw_whisper.srt';

console.log('[-] Đang chạy Whisper nhận diện timestamp giọng đọc...');
try {
  // Xóa SRT cũ nếu có
  if (fs.existsSync(localSrtWin)) fs.unlinkSync(localSrtWin);
  fs.copyFileSync(audioFile, localAudioWin);
  const cmd = `ffmpeg -y -i "D:/Billy/Work/Editing/models/temp_voice.mp3" -af "whisper=model='${tmpModelWin}':language=en:format=srt:destination='${tmpSrtWin}'" -f null -`;
  execSync(cmd, { stdio: 'pipe' });
} catch (e) {
  console.warn('[!] Cảnh báo khi chạy ffmpeg whisper:', e.message);
}

// Kiểm tra file SRT sinh ra
let srtContent = '';
if (fs.existsSync(localSrtWin)) {
  srtContent = fs.readFileSync(localSrtWin, 'utf8');
}

// 3. Phân tích SRT thành các segment và căn chỉnh với kịch bản gốc
function parseTime(tStr) {
  const [h, m, rest] = tStr.split(':');
  const [s, ms] = rest.split(',');
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
}

function formatAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const srtBlocks = srtContent.trim().split(/\n\s*\n/);
let segments = [];

for (const block of srtBlocks) {
  const lines = block.trim().split('\n');
  if (lines.length >= 3) {
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (timeMatch) {
      const start = parseTime(timeMatch[1]);
      const end = parseTime(timeMatch[2]);
      const text = lines.slice(2).join(' ').replace(/\r/g, '').trim();
      if (text) {
        segments.push({ start, end, text });
      }
    }
  }
}

// Nếu có kịch bản chuẩn, căn chỉnh thay thế từ chuẩn xác
if (fullScript && segments.length > 0) {
  const scriptWords = fullScript.split(/\s+/).filter(w => w.length > 0);
  let scriptWordIdx = 0;
  for (let seg of segments) {
    const segWordCount = seg.text.split(/\s+/).filter(w => w.length > 0).length;
    if (scriptWordIdx < scriptWords.length) {
      const replacedWords = scriptWords.slice(scriptWordIdx, scriptWordIdx + segWordCount);
      if (replacedWords.length > 0) {
        seg.text = replacedWords.join(' ');
        scriptWordIdx += segWordCount;
      }
    }
  }
}

// Nếu whisper không sinh được SRT, fallback chia đều kịch bản
if (segments.length === 0 && fullScript) {
  console.log('[-] Sử dụng fallback chia đều nhịp kịch bản theo thời lượng video...');
  const words = fullScript.split(/\s+/);
  const wordsPerChunk = 3;
  const numChunks = Math.ceil(words.length / wordsPerChunk);
  const chunkDuration = videoDuration / numChunks;
  for (let i = 0; i < numChunks; i++) {
    const chunkWords = words.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
    segments.push({
      start: i * chunkDuration,
      end: Math.min((i + 1) * chunkDuration, videoDuration),
      text: chunkWords.join(' ')
    });
  }
}

// 4. Chia nhỏ thành các micro-chunks 2-3 từ (Shorts style)
let microChunks = [];
for (const seg of segments) {
  const words = seg.text.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 4) {
    microChunks.push({
      start: seg.start,
      end: seg.end,
      words: words
    });
  } else {
    // Tách thành các cụm 2-3 từ
    const chunkSize = 3;
    const numSub = Math.ceil(words.length / chunkSize);
    const segDuration = seg.end - seg.start;
    const subDuration = segDuration / numSub;
    for (let i = 0; i < numSub; i++) {
      microChunks.push({
        start: seg.start + i * subDuration,
        end: seg.start + (i + 1) * subDuration,
        words: words.slice(i * chunkSize, (i + 1) * chunkSize)
      });
    }
  }
}

// 5. Tạo file ASS với style chuẩn TikTok / Shorts
const assHeader = `[Script Info]
Title: Dynamic Shorts Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ShortsDefault,Arial Black,50,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,4.5,2.0,2,30,30,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

let dialogueLines = [];
for (const chunk of microChunks) {
  const startStr = formatAssTime(chunk.start);
  const endStr = formatAssTime(chunk.end);
  const wordsUpper = chunk.words.map(w => w.toUpperCase());

  // Hiệu ứng: Từ cuối cùng hoặc từ quan trọng được highlight màu vàng neon
  let styledText = '';
  if (wordsUpper.length === 1) {
    styledText = `{\\c&H0000FFFF&}${wordsUpper[0]}`;
  } else {
    // Từ trước màu trắng, từ cuối màu vàng neon
    const leadWords = wordsUpper.slice(0, -1).join(' ');
    const lastWord = wordsUpper[wordsUpper.length - 1];
    styledText = `{\\c&H00FFFFFF&}${leadWords} {\\c&H0000FFFF&}${lastWord}`;
  }

  dialogueLines.push(`Dialogue: 0,${startStr},${endStr},ShortsDefault,,0,0,0,,${styledText}`);
}

const finalAssContent = assHeader + dialogueLines.join('\n') + '\n';
fs.writeFileSync(outputAss, finalAssContent, 'utf8');
console.log(`✓ Đã tạo file phụ đề động ASS chuẩn Shorts: ${outputAss} (${dialogueLines.length} nhịp phụ đề)!`);

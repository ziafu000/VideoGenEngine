#!/usr/bin/env node

/**
 * generate_subtitles.js - Tự động tạo phụ đề động chuẩn Shorts (Dynamic ASS Subtitles)
 * Phiên bản Chế độ 1 Nâng cao: 1 đến 2 từ mỗi nhịp, bám sát voiceover, gom cụm danh từ.
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

// 3. Phân tích SRT thành các segment
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

// Căn chỉnh thay thế từ chuẩn xác từ kịch bản gốc
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

// Fallback chia đều nếu không có SRT
if (segments.length === 0 && fullScript) {
  console.log('[-] Sử dụng fallback chia nhịp kịch bản theo thời lượng video...');
  const words = fullScript.split(/\s+/);
  const numChunks = Math.ceil(words.length / 2);
  const chunkDuration = videoDuration / numChunks;
  for (let i = 0; i < numChunks; i++) {
    const chunkWords = words.slice(i * 2, (i + 1) * 2);
    segments.push({
      start: i * chunkDuration,
      end: Math.min((i + 1) * chunkDuration, videoDuration),
      text: chunkWords.join(' ')
    });
  }
}

// 4. Thuật toán gom cụm danh từ (Noun Phrases & Collocations) và chia 1-2 từ
function isNounPair(w1, w2) {
  const c1 = w1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const c2 = w2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const knownPairs = new Set([
    'new_jersey', 'coca_cola', 'coca_colas', 'coca_leaves', 'raw_coca',
    'atlanta_vault', 'secret_formula', 'federal_license', 'federal_monopoly',
    'chemical_plant', 'stepan_chemical', 'dea_supervision', 'spent_flavor',
    'flavor_extract', '138_years', 'one_company', 'the_truth', 'the_law',
    'the_secret', 'the_chemistry', 'the_cocaine', 'in_america', 'the_stepan',
    'french_fries', 'george_crum', 'potato_chips', 'head_chef'
  ]);
  if (knownPairs.has(`${c1}_${c2}`)) return true;

  // Số + Danh từ (138 years, 1 company)
  if (/^\d+$/.test(c1)) return true;

  // Tính từ tận cùng -al, -ic, -ous, -ed đi liền danh từ
  if ((c1.endsWith('al') || c1.endsWith('ic') || c1.endsWith('ous') || c1.endsWith('ed')) && c2.length > 2) {
    return true;
  }

  // Giới từ ngắn đi liền mạo từ/đại từ (in an, was locked, to import)
  const shortGrammar = new Set(['in_an', 'was_locked', 'to_import', 'it_is', 'is_in', 'is_far']);
  if (shortGrammar.has(`${c1}_${c2}`)) return true;

  return false;
}

function groupWords(words) {
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const w1 = words[i];
    const w2 = words[i + 1];

    if (!w2) {
      chunks.push([w1]);
      i += 1;
      continue;
    }

    // 0. Lookahead: Nếu từ kế tiếp (w2) và từ sau nữa (w3) tạo thành 1 Cụm danh từ gắn kết,
    // thì w1 tuyệt đối không được nuốt w2! w1 đứng riêng để nhường w2 và w3 đi cùng nhau!
    if (i + 2 < words.length && isNounPair(words[i + 1], words[i + 2])) {
      chunks.push([w1]);
      i += 1;
      continue;
    }

    // 1. Kiểm tra cặp danh từ / collocation gắn kết
    if (isNounPair(w1, w2)) {
      chunks.push([w1, w2]);
      i += 2;
      continue;
    }

    // 2. Các từ đơn nhấn mạnh (punch words) đứng riêng 1 từ
    const c1 = w1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const punchWords = new Set([
      'locked', 'stranger', 'exclusively', 'monopoly', 'competitors',
      'law', 'vault', 'cocaine', 'pharmaceuticals', 'only'
    ]);
    if (punchWords.has(c1)) {
      chunks.push([w1]);
      i += 1;
      continue;
    }

    // 3. Nếu còn lại đúng 3 từ
    if (words.length - i === 3) {
      if (isNounPair(w2, words[i + 2])) {
        chunks.push([w1]);
        i += 1;
      } else {
        chunks.push([w1, w2]);
        i += 2;
      }
      continue;
    }

    // 4. Mặc định: Gom 2 từ nếu từ thứ nhất ngắn, hoặc 1 từ nếu từ thứ nhất dài
    if (c1.length >= 8) {
      chunks.push([w1]);
      i += 1;
    } else {
      chunks.push([w1, w2]);
      i += 2;
    }
  }
  return chunks;
}

// 5. Tính trọng số âm tiết & độ dài ký tự để căn chỉnh thời lượng (Syllable Weighting)
function getChunkWeight(chunk) {
  let wScore = 0;
  for (const w of chunk) {
    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    const vowels = (clean.match(/[aeiouy]/g) || []).length;
    wScore += Math.max(1, vowels) * 1.0 + clean.length * 0.2;
  }
  return wScore;
}

let microChunks = [];
for (const seg of segments) {
  const words = seg.text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) continue;

  const grouped = groupWords(words);
  const weights = grouped.map(g => getChunkWeight(g));
  const totalWeight = weights.reduce((acc, v) => acc + v, 0);
  const segDuration = seg.end - seg.start;

  let currentStart = seg.start;
  for (let i = 0; i < grouped.length; i++) {
    const chunkDur = (weights[i] / totalWeight) * segDuration;
    const chunkEnd = (i === grouped.length - 1) ? seg.end : (currentStart + chunkDur);
    microChunks.push({
      start: currentStart,
      end: chunkEnd,
      words: grouped[i]
    });
    currentStart = chunkEnd;
  }
}

// 6. Tạo file ASS với style chuẩn TikTok / Shorts (Cỡ chữ 58px, Highlight Vàng Neon)
const assHeader = `[Script Info]
Title: Dynamic Shorts Captions (1-2 Words Mode)
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ShortsDefault,Arial Black,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,5.0,2.5,2,30,30,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

let dialogueLines = [];
for (const chunk of microChunks) {
  const startStr = formatAssTime(chunk.start);
  const endStr = formatAssTime(chunk.end);
  const wordsUpper = chunk.words.map(w => w.toUpperCase());

  let styledText = '';
  if (wordsUpper.length === 1) {
    // 1 từ: Toàn bộ chữ là Vàng Neon rực rỡ
    styledText = `{\\c&H0000FFFF&}${wordsUpper[0]}`;
  } else {
    // 2 từ: Từ 1 màu trắng, Từ 2 Highlight Vàng Neon
    styledText = `{\\c&H00FFFFFF&}${wordsUpper[0]} {\\c&H0000FFFF&}${wordsUpper[1]}`;
  }

  dialogueLines.push(`Dialogue: 0,${startStr},${endStr},ShortsDefault,,0,0,0,,${styledText}`);
}

const finalAssContent = assHeader + dialogueLines.join('\n') + '\n';
fs.writeFileSync(outputAss, finalAssContent, 'utf8');
console.log(`✓ Đã tạo file phụ đề động ASS chuẩn Shorts: ${outputAss} (${dialogueLines.length} nhịp phụ đề 1-2 từ)!`);

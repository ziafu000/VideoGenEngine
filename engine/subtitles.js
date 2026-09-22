const fs = require('fs');
const path = require('path');
const config = require('./config');

function secToAss(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

const DUAL_ZONE_HEADER = `[Script Info]
Title: VideoGen Dual-Zone Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: AnimeDialogue,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2.0,1.0,2,30,30,35,1
Style: SystemProtocol,Consolas,24,&H00FFFF00,&H000000FF,&H00112222,&H80000000,1,0,0,0,100,100,1.0,0,1,1.8,0.0,8,30,30,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const SHORTS_HEADER = `[Script Info]
Title: VideoGen Shorts Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ShortsYellow,Arial Black,50,&H0000FFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4.5,2.0,2,30,30,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

/**
 * Generate ASS subtitles from storyboard and clip durations
 * @param {Object} storyboardData 
 * @param {Array<{shotId: string, duration: number, audioDuration?: number}>} clipTimelines 
 * @param {string} outputPath 
 */
function generateSubtitles(storyboardData, clipTimelines, outputPath) {
  const isShorts = storyboardData.project && storyboardData.project.mode === 'shorts';
  let assContent = isShorts ? SHORTS_HEADER : DUAL_ZONE_HEADER;

  let currentTime = 0.0;

  for (let i = 0; i < clipTimelines.length; i++) {
    const item = clipTimelines[i];
    const shot = (storyboardData.shots || []).find(s => s.id === item.shotId) || (storyboardData.shots || [])[i];
    const dur = item.duration;
    const aDur = item.audioDuration || (dur - 1.0);

    const subStart = currentTime + 0.3;
    const subEnd = Math.min(currentTime + dur - 0.1, subStart + aDur + 0.4);

    const startStr = secToAss(subStart);
    const endStr = secToAss(subEnd);

    if (shot) {
      const audioConf = shot.audio || {};
      const layer = audioConf.sub_layer || shot.subtitle_layer || 'bottom';
      const text = audioConf.sub_text || shot.vietnamese_subtitles || shot.subtitles || '';
      const sysText = audioConf.sys_sub || shot.system_vietnamese || '';

      if (layer === 'dual') {
        const cleanSys = sysText.replace(/\\N/g, '\\N');
        assContent += `Dialogue: 0,${startStr},${endStr},SystemProtocol,,0,0,0,,${cleanSys}\n`;
        if (text) {
          assContent += `Dialogue: 0,${startStr},${endStr},AnimeDialogue,,0,0,0,,${text}\n`;
        }
      } else if (layer === 'top') {
        const cleanSys = (sysText || text).replace(/\\N/g, '\\N');
        assContent += `Dialogue: 0,${startStr},${endStr},SystemProtocol,,0,0,0,,${cleanSys}\n`;
      } else if (text) {
        const styleName = isShorts ? 'ShortsYellow' : 'AnimeDialogue';
        assContent += `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,${text}\n`;
      }
    }

    currentTime += dur;
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(outputPath, assContent, 'utf8');
  console.log(`[✓] Đã tạo file phụ đề ASS: ${outputPath}`);
  return outputPath;
}

module.exports = {
  generateSubtitles,
  secToAss
};

/**
 * engine/explainer.js: Master Minimalist Explainer Animation Engine (Ink Explainer / Stickman 2.0).
 *
 * Implements the authentic Ink Explainer visual grammar ("Voice gì thì cái đó hiện ra"):
 * Direct 1-to-1 visual correspondence between voiceover and on-screen educational illustrations,
 * featuring the iconic minimalist white stickman mascot (#ffffff), bold black ink contours,
 * anatomical cutaways, scientific diagrams, and witty comic storytelling.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');

// Helper to optionally load bespoke episode scenes from storyboards/ or custom path
function loadCustomScenes(scenesPath, seriesId, episodeId) {
  if (scenesPath && fs.existsSync(scenesPath)) {
    try {
      const mod = require(path.resolve(scenesPath));
      return mod.SCENES || mod.EP01_SCENES || mod;
    } catch (e) {
      console.warn(`[!] Không thể nạp custom scenes từ ${scenesPath}:`, e.message);
    }
  }

  // Auto-discover in storyboards/ directory if present (keeping engine 100% generic)
  const candidates = [
    path.join(config.STORYBOARDS_DIR, `${seriesId}_${episodeId}_scenes.js`),
    path.join(config.STORYBOARDS_DIR, `${episodeId}_scenes.js`),
    path.join(config.STORYBOARDS_DIR, `${seriesId}_${episodeId}_scenes.json`),
    path.join(config.STORYBOARDS_DIR, `${episodeId}_scenes.json`)
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const mod = require(c);
        return mod.SCENES || mod.EP01_SCENES || mod;
      } catch (e) {}
    }
  }
  return null;
}

// 1. Contextual Color Palettes (Calibrated to Ink Explainer & Reference frames)
const PALETTES = {
  dark_vignette: {
    name: 'Dark Ink Vignette / Spotlight (Signature Ink Explainer)',
    bg: 'deep charcoal slate watercolor wash vignette framing a bright circular warm spotlight halo in the center on subtle cream paper texture'
  },
  clean_diagram: {
    name: 'Educational Infographic / Diagram Parchment',
    bg: 'stark clean cream-white parchment paper (#fbf9f5) with delicate subtle paper texture, generous negative space, dotted guide lines and educational indicator arrows'
  },
  prehistoric: {
    name: 'Prehistoric Savanna',
    bg: 'warm apricot and terracotta watercolor wash arch with minimalist dry cracked earth ground line and delicate acacia silhouettes'
  },
  ice_age: {
    name: 'Ice Age / Permafrost',
    bg: 'pale slate-blue watercolor wash vignette (#a0c0d0) with delicate paper texture, floating black-and-white snowflake doodles, flat jagged white ice ground line'
  },
  modern_interior: {
    name: 'Modern Interior (Office, Bedroom & Living Room)',
    bg: 'muted olive and tan flat walls, horizontal wooden plank floorboards, minimalist black-line furniture'
  },
  clean_card: {
    name: 'Punchline Minimal Card',
    bg: 'stark clean pure cream-white parchment paper (#fbf9f5) with a soft warm spotlight circle, 80% negative breathing space'
  }
};

// 2. Negative safety prompt footer - guards 2D vector graphic novel integrity
const NEGATIVE_PROMPT = 'STRICTLY NO TITLE BANNER, NO TOP HEADER, NO "INK EXPLAINER" TEXT, NO "MINIMALIST" TEXT, NO CHANNEL NAME, NO WATERMARK, NO LOGO, NO 3D, NO CGI, NO PHOTOREALISM, NO REALISTIC TEXTURES, NO GRADIENT MESH, NO BLURRY ARTIFACTS, NO STOCK PHOTO.';

// 3. Segment transcript text into semantic visual clauses (1.5s–2.5s / 4–8 words)
function segmentTranscript(text) {
  if (!text || typeof text !== 'string') return [];

  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.?!;:])\s+/);
  const clauses = [];

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    const parts = sentence.split(/(?<=[,;:\-—])\s+/);
    let currentChunk = '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const words = trimmed.split(/\s+/);
      const curWords = currentChunk ? currentChunk.split(/\s+/).length : 0;

      if (currentChunk && (curWords + words.length <= 10 || words.length < 3)) {
        currentChunk = currentChunk + ' ' + trimmed;
      } else {
        if (currentChunk) clauses.push(currentChunk);
        currentChunk = trimmed;
      }
    }
    if (currentChunk) clauses.push(currentChunk);
  }

  return clauses.filter(c => c.length > 0);
}

// 4. Classify visual strategy based on keywords and cognitive semantics
function classifyStrategy(clause, index, prevStrategy) {
  const lower = clause.toLowerCase();

  if (lower.startsWith('maybe you\'re') || lower.endsWith('?') || lower.includes('did you know') || (lower.split(' ').length <= 3 && /[?!]$/.test(lower))) {
    return 'TITLE_CARD';
  }
  if ((lower.includes('vs') || lower.includes('compared to') || lower.includes('split') || lower.includes('left side')) && lower.includes('right')) {
    return 'SPLIT_SCREEN';
  }
  if (
    lower.includes('gland') || lower.includes('kidney') || lower.includes('brain') || lower.includes('circuit') ||
    lower.includes('diagram') || lower.includes('gauge') || lower.includes('heart') || lower.includes('lung') ||
    lower.includes('nerve') || lower.includes('artery') || lower.includes('stomach') || lower.includes('chalkboard')
  ) {
    return 'DIAGRAM';
  }
  if (prevStrategy === 'LITERAL_BEDROOM' || lower.includes('stress') || lower.includes('fall back asleep')) {
    return 'POSE_CHURN';
  }
  return 'LITERAL';
}

// 4.5. Dynamic semantic action resolver (Generalized fallback for non-indexed topics)
function resolveSemanticAction(clause, strategy, index, customScenes = null) {
  // If bespoke scene mapping is loaded for this episode, use it directly for 100% precision
  if (customScenes && customScenes[index] && customScenes[index].scene) {
    return customScenes[index].scene;
  }

  const lower = clause.toLowerCase();

  // Anatomy & Biology
  if (lower.includes('adrenal') || lower.includes('kidney')) {
    return "A cartoon anatomical diagram showing kidneys with glowing yellow adrenal glands on top, stickman pointing with a pointer stick";
  }
  if (lower.includes('heart') || lower.includes('pulse') || lower.includes('beats')) {
    return "A cartoon heart with a glowing mechanical turbocharger spinning wildly, emitting comic flame bursts";
  }
  if (lower.includes('lung') || lower.includes('breath') || lower.includes('airway')) {
    return "A cutaway diagram of human lungs expanding wide like storm drains vacuuming up swirling blue oxygen air";
  }
  if (lower.includes('liver') || lower.includes('glucose')) {
    return "A cartoon liver opening a floodgate dam releasing a rushing torrent of sparkling sugar fuel cubes into blood vessels";
  }
  if (lower.includes('brain') || lower.includes('amygdala') || lower.includes('cortex')) {
    return "A cross-section diagram of the human brain with the amygdala flashing bright red like an emergency alarm button";
  }
  if (lower.includes('nerve') || lower.includes('pain') || lower.includes('endorphin')) {
    return "Sensory nerve cables hitting a heavy metal blast door, red pain lightning bolts bouncing harmlessly backward";
  }
  if (lower.includes('stomach') || lower.includes('digest')) {
    return "An anatomical cartoon diagram of stomach and intestines wrapped in chains with a padlock marked 'CLOSED'";
  }

  // Action & Superhuman Feats
  if (lower.includes('strength') || lower.includes('lift') || lower.includes('car') || lower.includes('suv')) {
    return "The white stickman mascot effortlessly flipping a giant two-ton cartoon car upside down with one arm, rocket thrusters firing";
  }
  if (lower.includes('bear') || lower.includes('punch') || lower.includes('snout')) {
    return "The stickman delivering a powerful, heroic cartoon punch right to the nose of a surprised cartoon bear, comic starburst impact";
  }
  if (lower.includes('matrix') || lower.includes('bullet') || lower.includes('slow motion')) {
    return "The stickman in black sunglasses leaning backward in the iconic Matrix limbo bullet-dodge pose with floating glass shards";
  }
  if (lower.includes('tiger') || lower.includes('saber') || lower.includes('predator')) {
    return "A prehistoric caveman stickman frantically sprinting across the savanna pursued by a snarling saber-toothed tiger";
  }
  if (lower.includes('rollercoaster') || lower.includes('skydiving')) {
    return "The stickman strapped into a rollercoaster cart rocketing down a steep 90-degree loop with hilarious wide thrill eyes";
  }
  if (lower.includes('crash') || lower.includes('toothpaste') || lower.includes('deflated')) {
    return "The stickman lying completely flat and deflated like a puddle on the living room rug next to an empty coffee mug";
  }
  if (lower.includes('7 + 5') || lower.includes('math') || lower.includes('cortex')) {
    return "A school chalkboard reading '7 + 5 = ?', stickman scratching his head sweating with question marks orbiting his head";
  }
  if (lower.includes('shake') || lower.includes('tremble') || lower.includes('finger') || lower.includes('key')) {
    return "Extreme close-up of both stickman hands vibrating violently in comic motion blur, dropping a small key";
  }

  // General clean stickman action fallback
  return "The expressive minimalist white stickman mascot with round white head and clean black comic ink contours, gesturing with funny dynamic body language";
}

// 5. Build standardized Nano Banana Pro prompt
function buildPrompt({ clause, strategy, index = 0, customScenes = null }) {
  // If bespoke scene mapping has a dedicated palette, use it
  let paletteKey = 'dark_vignette';
  if (customScenes && customScenes[index] && customScenes[index].palette) {
    paletteKey = customScenes[index].palette;
  } else {
    // Dynamic palette resolution
    const lower = clause.toLowerCase();
    if (/\b(ice|snow|cold|winter|freeze|frost|shiver)\b/i.test(clause)) {
      paletteKey = 'ice_age';
    } else if (/\b(ancient|savanna|cave|caveman|prehistoric|tiger|predator|acacia|100,000)\b/i.test(clause)) {
      paletteKey = 'prehistoric';
    } else if (strategy === 'TITLE_CARD' || strategy === 'CLEAN_CARD') {
      paletteKey = 'clean_card';
    } else if (strategy === 'DIAGRAM' || /\b(diagram|anatomical|brain|kidney|gland|nerve|chalkboard|equation|blood)\b/i.test(clause)) {
      paletteKey = 'clean_diagram';
    } else if (/\b(office|desk|chair|boardroom|meeting|zoom|laptop|bedroom)\b/i.test(clause)) {
      paletteKey = 'modern_interior';
    } else {
      paletteKey = 'dark_vignette';
    }
  }

  const sceneDesc = resolveSemanticAction(clause, strategy, index, customScenes);
  const selectedPalette = PALETTES[paletteKey] || PALETTES.dark_vignette;

  const prompt = `2D comic illustration of ${sceneDesc}. CHARACTERS: Expressive minimalist white stickman mascot with round white head (#ffffff), solid white limbs, clean bold black comic ink contours, big expressive cartoon meme eyes, interacting directly with the scene. ENVIRONMENT: ${selectedPalette.bg}. STYLE: High-contrast educational graphic novel illustration, bold clean black ink line art, flat vibrant color accents on focal elements, clean paper texture, comic motion lines and indicator arrows. ${NEGATIVE_PROMPT}`;

  return {
    prompt,
    strategy,
    palette: paletteKey
  };
}

/**
 * Helper to measure exact audio duration using ffprobe
 */
function getAudioDuration(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const val = parseFloat(out);
      if (!isNaN(val) && val > 0) return Math.round(val * 100) / 100;
    }
  } catch (e) {
    // Ignore and fallback
  }
  return null;
}

/**
 * Generate a complete production-ready storyboard JSON from a transcript text or file.
 */
function createExplainerStoryboard({
  title = 'Explainer Animation',
  seriesId = 'explainer_series',
  episodeId = 'ep01',
  transcriptText = '',
  aspectRatio = '16:9',
  outputStoryboardPath = null,
  scenesPath = null
}) {
  const clauses = segmentTranscript(transcriptText);
  if (clauses.length === 0) {
    throw new Error('createExplainerStoryboard: Transcript rỗng hoặc không có mệnh đề hợp lệ!');
  }

  const projectId = `${seriesId}_${episodeId}`;
  const audioDir = config.AUDIO_DIR ? path.join(config.AUDIO_DIR, projectId) : path.join(__dirname, '..', 'audio', projectId);
  const customScenes = loadCustomScenes(scenesPath, seriesId, episodeId);

  let prevStrategy = 'LITERAL';
  const shots = clauses.map((clause, idx) => {
    const shotNum = idx + 1;
    const shotId = `shot_${String(shotNum).padStart(3, '0')}`;
    const strategy = classifyStrategy(clause, idx, prevStrategy);
    const { prompt, palette } = buildPrompt({ clause, strategy, index: idx, customScenes });
    prevStrategy = strategy;

    // Check for exact audio file duration
    const audioFileName = `voice_shot_${String(shotNum).padStart(3, '0')}.mp3`;
    const audioFilePath = path.join(audioDir, audioFileName);
    const measuredDuration = getAudioDuration(audioFilePath);
    const duration = measuredDuration || 2.2;

    return {
      id: shotId,
      clause: clause,
      duration: duration,
      strategy: strategy,
      palette: palette,
      image_prompt: prompt,
      audio: {
        voiceover: clause,
        file: fs.existsSync(audioFilePath) ? audioFilePath : null
      }
    };
  });

  const storyboard = {
    project: {
      id: projectId,
      title: title,
      mode: aspectRatio === '9:16' ? 'shorts' : 'video',
      aspect_ratio: aspectRatio,
      resolution: '1080p',
      format: 'minimalist_explainer'
    },
    format: 'minimalist_explainer',
    pacing: 'static_cuts',
    motion: 'none',
    engine: 'nano_banana_pro',
    tts_provider: 'f5-tts',
    voice: {
      provider: 'f5-tts',
      profile: 'f5-tts-latest',
      ref_audio: 'assets/voices/f5_tts_latest_ref.wav',
      ref_text: "Most of us never think twice about any of this, but the person wide awake at 3am may have been the most important person in the camp.",
      speed: 0.90
    },
    voice_profile: 'f5-tts-latest',
    bgm_volume: 0,
    hardsub: false,
    shots: shots
  };

  if (outputStoryboardPath) {
    const dir = path.dirname(outputStoryboardPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputStoryboardPath, JSON.stringify(storyboard, null, 2), 'utf8');
    console.log(`[✓] Storyboard explainer đã được lưu tại: ${outputStoryboardPath}`);
  }

  return storyboard;
}

module.exports = {
  PALETTES,
  NEGATIVE_PROMPT,
  segmentTranscript,
  classifyStrategy,
  buildPrompt,
  createExplainerStoryboard
};

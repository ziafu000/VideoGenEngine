/**
 * engine/explainer.js: Master Minimalist Explainer Animation Engine (Ink Explainer / Stickman 2.0).
 *
 * Implements the semantic clause segmenter, visual strategy classification,
 * contextual color palette routing, and prompt generation for Nano Banana Pro.
 * Matches visual clauses (1.5s–2.5s) directly to voiceover cadence.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// 1. Contextual Color Palettes
const PALETTES = {
  ice_age: {
    name: 'Ice Age / Permafrost',
    bg: 'pale slate-blue wash (#a0c0d0) with subtle watercolor paper texture, faint frost vignette, white ice cracks on ground',
    character: 'expressive stick figure with shaggy wild brown hair and rugged prehistoric tunic, shivering'
  },
  prehistoric: {
    name: 'Prehistoric Savanna',
    bg: 'warm ochre and terracotta gradient wash (#f5d5b0) with watercolor edge vignette, flat minimalist acacia trees and dry ground',
    character: 'wild caveman stick figure with shaggy brown hair and ragged prehistoric cloth'
  },
  interior_cozy: {
    name: 'Modern Cozy Interior',
    bg: 'warm muted olive and tan walls, wooden plank floor, clean minimalist furniture with black ink outlines',
    character: 'modern stick figure with round white face, expressive meme eyes and mouth'
  },
  clean_card: {
    name: 'Punchline Title Card',
    bg: 'stark clean pure white background with zero clutter',
    character: 'hand-drawn comic title in bold black marker with cute cartoon doodle icons'
  },
  metaphor_dark: {
    name: 'Metaphorical Void',
    bg: 'deep charcoal and dark navy atmospheric paper wash with a soft spotlight circle',
    character: 'expressive white stick figure interacting with glowing or contrasting symbolic props'
  }
};

// 2. Negative safety prompt footer
const NEGATIVE_PROMPT = 'STRICTLY NO 3D, NO PHOTOREALISM, NO GRADIENT SHADING, NO CLUTTER, NO WATERMARK, NO LOGO, NO CHANNEL NAME, NO TEXT BANNER.';

// 3. Segment transcript text into semantic visual clauses (1.5s–2.5s / 4–8 words)
function segmentTranscript(text) {
  if (!text || typeof text !== 'string') return [];

  // Clean and normalize text
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.?!;:])\s+/);
  const clauses = [];

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    // Split sentence by natural punctuation pause delimiters: commas, semicolons, colons, dashes
    const parts = sentence.split(/(?<=[,;:\-—])\s+/);
    let currentChunk = '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const words = trimmed.split(/\s+/);
      const curWords = currentChunk ? currentChunk.split(/\s+/).length : 0;

      // Merge tiny clauses or preserve natural breath groups (up to 10 words)
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

  // A. GAG_CARD / TITLE_CARD: Short questions, single punch words, definitions
  if (lower.startsWith('maybe you\'re') || lower.endsWith('?') || lower.includes('did you know') || (lower.split(' ').length <= 3 && /[?!]$/.test(lower))) {
    return 'TITLE_CARD';
  }

  // B. SPLIT_SCREEN: Contrasts between modern and ancient, past and present
  if ((lower.includes('vs') || lower.includes('compared to') || lower.includes('terrifying truth') || lower.includes('ancient humans')) && lower.includes('survived')) {
    return 'SPLIT_SCREEN';
  }

  // C. METAPHOR: Abstract concepts, biology/morality/caloric burn/machines of nature
  if (
    lower.includes('calorie') || lower.includes('burn') ||
    lower.includes('morality') || lower.includes('moral') ||
    lower.includes('death machine') || lower.includes('machine') ||
    lower.includes('eat another human') || lower.includes('evil') ||
    lower.includes('brain') || lower.includes('energy') || lower.includes('economy')
  ) {
    return 'METAPHOR';
  }

  // D. POSE_CHURN: Sequential expressions in the same setting (e.g. night bedroom, waking up, stress)
  if (prevStrategy === 'LITERAL_BEDROOM' || lower.includes('stress') || lower.includes('fall back asleep') || lower.includes('blame your phone') || lower.includes('tired all evening')) {
    return 'POSE_CHURN';
  }

  // E. LITERAL: Concrete actions, items, settings
  return 'LITERAL';
}

// 5. Build standardized Nano Banana Pro prompt
function buildPrompt({ clause, strategy, topic = 'history', index = 0 }) {
  const lower = clause.toLowerCase();
  let sceneDesc = '';
  let paletteKey = 'interior_cozy';

  // Determine context palette
  if (lower.includes('ice') || lower.includes('cold') || lower.includes('winter') || lower.includes('freeze') || lower.includes('frost')) {
    paletteKey = 'ice_age';
  } else if (lower.includes('ancient') || lower.includes('savanna') || lower.includes('cave') || lower.includes('prehistoric') || lower.includes('fire')) {
    paletteKey = 'prehistoric';
  } else if (strategy === 'TITLE_CARD') {
    paletteKey = 'clean_card';
  } else if (strategy === 'METAPHOR') {
    paletteKey = 'metaphor_dark';
  }

  // Generate scene description according to strategy
  switch (strategy) {
    case 'TITLE_CARD': {
      const cardTitle = clause.replace(/[.,]/g, '').toUpperCase();
      sceneDesc = `A clean white title card with bold hand-drawn comic lettering "${cardTitle}" in black ink, accompanied by cute minimalist cartoon doodles and star symbols`;
      break;
    }

    case 'SPLIT_SCREEN': {
      sceneDesc = `A clean split-screen comparison: on the left side, a confused pampered modern stickman scratching his head in a clean modern kitchen; on the right side, a tough rugged prehistoric caveman with shaggy hair in ragged cloth standing in the dry African savanna`;
      paletteKey = 'prehistoric';
      break;
    }

    case 'METAPHOR': {
      if (lower.includes('calorie') || lower.includes('energy') || lower.includes('burn')) {
        sceneDesc = `An exhausted stickman with outstretched tired arms, hovering beside a glowing red low-battery phone icon with yellow energy spark particles floating away into the air`;
      } else if (lower.includes('morality') || lower.includes('moral')) {
        sceneDesc = `A stickman with a deadpan flat emotionless poker face (- _ -), with a tilted broken golden scale of justice floating above his head`;
      } else if (lower.includes('death machine') || lower.includes('machine')) {
        sceneDesc = `Massive heavy purple mechanical gears grinding together, crushing and snapping a brittle dry tree branch caught between the gear teeth`;
      } else if (lower.includes('eat') || lower.includes('evil')) {
        sceneDesc = `An empty wooden food bowl sitting on a table, with a glowing red question mark hovering above it with comic radiating lines`;
      } else {
        sceneDesc = `A minimalist symbolic representation of ${clause}, using bold iconic comic metaphors and high contrast symbols`;
      }
      break;
    }

    case 'POSE_CHURN': {
      if (lower.includes('stress')) {
        sceneDesc = `A stickman sitting up in bed at night clutching his head in agony and stress, bedside clock showing 3:25 AM, next to a huge messy stack of work paperwork and a laptop`;
      } else if (lower.includes('phone')) {
        sceneDesc = `A stickman lying awake in bed at night holding a glowing smartphone up, the blue screen light illuminating his tired droopy eyes`;
      } else if (lower.includes('coffee')) {
        sceneDesc = `A stickman in the kitchen happily sipping a steaming orange coffee mug, with a coffee maker on the counter and wall clock showing 11:00 PM with moon outside`;
      } else if (lower.includes('tired')) {
        sceneDesc = `A stickman slouched completely knocked out asleep on the living room couch under a yellow blanket, mouth open snoring, clock showing 8:00 PM`;
      } else {
        sceneDesc = `A stickman with a sharp determined expression, raising one index finger upwards as if having a sudden breakthrough idea (Aha moment)`;
      }
      paletteKey = 'interior_cozy';
      break;
    }

    case 'LITERAL':
    default: {
      if (lower.includes('finger') || lower.includes('hand')) {
        sceneDesc = `Extreme close-up of a stiff, claw-like trembling hand with vibration lines, struggling and unable to turn a modern door handle`;
      } else if (lower.includes('skin') || lower.includes('crack') || lower.includes('foot')) {
        sceneDesc = `Side profile of a bare human cartoon foot stepping onto cold cracked permafrost earth, showing dark jagged crack lines in the dry heel skin`;
      } else if (lower.includes('3:00') || lower.includes('wake up') || lower.includes('asleep')) {
        sceneDesc = `A wide shot of a bedroom at night, a stickman lying wide awake in bed with huge round cartoon eyes staring up at the ceiling, alarm clock showing 3:00 on the nightstand and stars outside window`;
      } else if (lower.includes('ice age') || lower.includes('cold')) {
        sceneDesc = `A shivering stickman with a sweat drop hugging himself, surrounded by floating snowflake doodles, standing on a jagged ice horizon`;
        paletteKey = 'ice_age';
      } else {
        sceneDesc = `A minimalist 2D comic scene depicting ${clause}, with an expressive white stick figure in a clean clear setting`;
      }
      break;
    }
  }

  const selectedPalette = PALETTES[paletteKey] || PALETTES.interior_cozy;
  const prompt = `A minimalist 2D vector ink explainer illustration. SCENE: ${sceneDesc}. ENVIRONMENT: ${selectedPalette.bg}. STYLE: Bold clean black comic ink contours, simple expressive white stick figure, cartoon meme eyes, flat color fills, subtle warm watercolor paper wash background, high contrast graphic novel aesthetic. ${NEGATIVE_PROMPT}`;

  return {
    prompt,
    strategy,
    palette: paletteKey
  };
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
  outputStoryboardPath = null
}) {
  const clauses = segmentTranscript(transcriptText);
  if (clauses.length === 0) {
    throw new Error('createExplainerStoryboard: Transcript rỗng hoặc không có mệnh đề hợp lệ!');
  }

  let prevStrategy = 'LITERAL';
  const shots = clauses.map((clause, idx) => {
    const shotId = `shot_${String(idx + 1).padStart(3, '0')}`;
    const strategy = classifyStrategy(clause, idx, prevStrategy);
    const { prompt, palette } = buildPrompt({ clause, strategy, index: idx });
    prevStrategy = strategy;

    return {
      id: shotId,
      clause: clause,
      duration: 2.2, // Default estimated pacing per clause
      strategy: strategy,
      palette: palette,
      image_prompt: prompt,
      audio: {
        voiceover: clause
      }
    };
  });

  const storyboard = {
    project: {
      id: `${seriesId}_${episodeId}`,
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
      speed: 1.0
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
  segmentTranscript,
  classifyStrategy,
  buildPrompt,
  createExplainerStoryboard
};

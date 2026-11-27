const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../engine/config');
const flow = require('../engine/flow');
const compositor = require('../engine/compositor');
const pipelineLoop = require('../engine/pipeline_loop');

console.log('=== RUNNING INGREDIENTS, CHARACTER CREATOR & SILENT-CINEMA TEST SUITE ===\n');

(async () => {

// 1. Exact ingredient name matching (including prefix-collision cases)
console.log('Test 1: flow.matchExactIngredientOption prevents prefix/substring collisions...');
const sampleOptions = [
  { role: 'option', text: 'Character Alpha 1980s Nhân vật' },
  { role: 'option', text: 'Character Alpha Nhân vật' },
  { role: 'option', text: 'Character Beta Character' },
  { role: 'option', text: 'Scene Clip Video' },
  { role: 'option', text: 'Character Gamma' }
];

const hitAlpha = flow.matchExactIngredientOption(sampleOptions, 'Character Alpha');
assert.ok(hitAlpha, 'Must find exact match for Character Alpha');
assert.strictEqual(hitAlpha.text, 'Character Alpha Nhân vật', 'Must NOT match "Character Alpha 1980s Nhân vật"');

const hitAlpha1980s = flow.matchExactIngredientOption(sampleOptions, 'Character Alpha 1980s');
assert.ok(hitAlpha1980s, 'Must find exact match for Character Alpha 1980s');
assert.strictEqual(hitAlpha1980s.text, 'Character Alpha 1980s Nhân vật');

const hitBeta = flow.matchExactIngredientOption(sampleOptions, '@Character Beta');
assert.ok(hitBeta, 'Must strip leading @ and match English Character suffix');
assert.strictEqual(hitBeta.text, 'Character Beta Character');

const hitGamma = flow.matchExactIngredientOption(sampleOptions, 'Character Gamma');
assert.ok(hitGamma, 'Must match exact bare option name');
assert.strictEqual(hitGamma.text, 'Character Gamma');

// Prefix collision when ONLY the longer variant exists -> must return null!
const onlyVariant = [
  { role: 'option', text: 'Hero Variant 2 Nhân vật' },
  { role: 'option', text: 'Hero Variant Extra Nhân vật' }
];
assert.strictEqual(flow.matchExactIngredientOption(onlyVariant, 'Hero Variant'), null, 'Prefix must NEVER match longer variant');
assert.strictEqual(flow.matchExactIngredientOption(sampleOptions, 'Character'), null, 'Partial prefix must NEVER match');
assert.strictEqual(flow.matchExactIngredientOption(sampleOptions, 'Scene Clip'), null, 'Video option must NOT match character name unless exact');
console.log('  [PASS] Exact ingredient matching & prefix-collision guard verified.\n');

// 2. Flow video config & /character route derivation
console.log('Test 2: flow.resolveFlowVideoConfig & buildCharacterRouteUrl...');
const cfg = flow.resolveFlowVideoConfig({
  flow_project_url: 'https://flow.google.com/project/00000000-0000-0000-0000-000000000000',
  flow_mode: 'ingredients',
  ratio: '16:9',
  resolution: '720p',
  clip_duration: 10,
  model: 'Omni 1.1 Flash'
});
assert.strictEqual(cfg.flowMode, 'ingredients');
assert.strictEqual(cfg.ratio, '16:9');
assert.strictEqual(cfg.resolution, '720p');
assert.strictEqual(cfg.clipDuration, 10);
assert.strictEqual(cfg.durationLabel, '10 giây');
assert.strictEqual(cfg.model, 'Omni 1.1 Flash');
assert.strictEqual(
  flow.buildCharacterRouteUrl('https://flow.google.com/project/00000000-0000-0000-0000-000000000000/'),
  'https://flow.google.com/project/00000000-0000-0000-0000-000000000000/character'
);
assert.strictEqual(flow.buildCharacterRouteUrl('https://example.invalid/other'), null);
console.log('  [PASS] Flow video config & character route derivation verified.\n');

// 3. Download directory resolution & ffprobe validation helper
console.log('Test 3: config.resolveDownloadDirs & flow.verifyVideoFileWithFfprobe...');
const wslDirs = config.resolveDownloadDirs({
  envDir: '',
  platform: 'linux',
  winUser: 'TestUser',
  existsFn: (p) => p === '/mnt/c/Users' || p === '/mnt/d/Downloads' || p === '/mnt/c/Users/TestUser/Downloads'
});
assert.deepStrictEqual(wslDirs, ['/mnt/d/Downloads', '/mnt/c/Users/TestUser/Downloads']);

const envOverrideDirs = config.resolveDownloadDirs({
  envDir: '/mnt/e/CustomDownloads/',
  platform: 'linux',
  winUser: 'TestUser',
  existsFn: (p) => p === '/mnt/c/Users' || p === '/mnt/e/CustomDownloads' || p === '/mnt/d/Downloads'
});
assert.deepStrictEqual(envOverrideDirs, ['/mnt/e/CustomDownloads', '/mnt/d/Downloads']);

const nativeDirs = config.resolveDownloadDirs({
  envDir: '',
  platform: 'darwin',
  homedir: '/Users/alice',
  existsFn: (p) => p === '/Users/alice/Downloads'
});
assert.deepStrictEqual(nativeDirs, ['/Users/alice/Downloads']);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-ing-cinema-test-'));
try {
  // Fake HTML login redirect saved as .mp4 must be rejected
  const htmlFake = path.join(tmpDir, 'fake_login.mp4');
  fs.writeFileSync(htmlFake, '<!DOCTYPE html><html><body>Sign in</body></html>'.repeat(400), 'utf8');
  const htmlProbe = flow.verifyVideoFileWithFfprobe(htmlFake);
  assert.strictEqual(htmlProbe.valid, false, 'HTML redirect saved as .mp4 must fail validation');
  assert.strictEqual(htmlProbe.reason, 'html_redirect_or_text_response');

  // Truncated/tiny file must be rejected
  const tinyFile = path.join(tmpDir, 'tiny.mp4');
  fs.writeFileSync(tinyFile, Buffer.alloc(500));
  const tinyProbe = flow.verifyVideoFileWithFfprobe(tinyFile);
  assert.strictEqual(tinyProbe.valid, false);
  assert.strictEqual(tinyProbe.reason, 'file_too_small');

  // Real synthetic mp4 must pass real ffprobe validation
  const realMp4 = path.join(tmpDir, 'valid_clip.mp4');
  execFileSync('ffmpeg', [
    '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1.2:size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    realMp4
  ], { stdio: 'ignore' });
  const realProbe = flow.verifyVideoFileWithFfprobe(realMp4);
  assert.strictEqual(realProbe.valid, true, `Valid MP4 must pass ffprobe: ${realProbe.reason}`);
  assert.strictEqual(realProbe.width, 640);
  assert.strictEqual(realProbe.height, 360);
  assert.ok(realProbe.duration >= 1.0);
  console.log('  [PASS] Download directory resolution & ffprobe validation verified.\n');

  // 4. Silent-cinema storyboard detection
  console.log('Test 4: compositor.isSilentCinemaStoryboard detection...');
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ mode: 'cinema_silent' }), true);
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ tts: false }), true);
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ project: { mode: 'cinema_silent' } }), true);
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ project: { tts: false } }), true);
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ format: 'minimalist_explainer' }), false);
  assert.strictEqual(compositor.isSilentCinemaStoryboard({ tts: true }), false);
  assert.strictEqual(compositor.isSilentCinemaStoryboard(null), false);
  console.log('  [PASS] Silent-cinema detection verified.\n');

  // 5. Silent-cinema FFmpeg filter graph construction (xfade, concat fallback, BGM/SFX mix, title & closing cards)
  console.log('Test 5: compositor.buildSilentCinemaFilterGraph (xfade + concat fallback + BGM/SFX + cards)...');
  const titleTxt = path.join(tmpDir, 'title.txt');
  const subTxt = path.join(tmpDir, 'sub.txt');
  const closeTxt = path.join(tmpDir, 'close.txt');
  fs.writeFileSync(titleTxt, 'SAMPLE TITLE', 'utf8');
  fs.writeFileSync(subTxt, 'Sample Author', 'utf8');
  fs.writeFileSync(closeTxt, 'Sample Unicode Quote — Tiếng Việt có dấu.', 'utf8');

  const gXfade = compositor.buildSilentCinemaFilterGraph({
    clips: [
      { duration: 10.0, hasAudio: true },
      { duration: 10.0, hasAudio: true },
      { duration: 10.0, hasAudio: false }
    ],
    width: 1920,
    height: 1080,
    fps: 30,
    xfadeDuration: 0.35,
    sfxVolume: 0.35,
    hasBgm: true,
    bgmVolume: 0.85,
    titleCard: { titleTextFile: titleTxt, subtitleTextFile: subTxt, start: 1, end: 5 },
    closingCard: { textFile: closeTxt, start: 23, end: 29 }
  });
  assert.strictEqual(gXfade.xfadeOffsets.length, 2);
  assert.strictEqual(gXfade.xfadeOffsets[0], 9.65);
  assert.strictEqual(gXfade.xfadeOffsets[1], 19.3);
  assert.strictEqual(gXfade.totalDuration, 29.3);
  assert.ok(gXfade.filterComplex.includes('xfade=transition=fade:duration=0.350:offset=9.650'));
  assert.ok(gXfade.filterComplex.includes('acrossfade=d=0.350'));
  assert.ok(gXfade.filterComplex.includes('anullsrc=r=48000:cl=stereo'));
  assert.ok(gXfade.filterComplex.includes('volume=0.35[a_sfx]'));
  assert.ok(gXfade.filterComplex.includes('volume=0.85,afade=t=in'));
  assert.ok(gXfade.filterComplex.includes('drawtext='));
  assert.ok(gXfade.filterComplex.includes('amix=inputs=2'));

  const gConcat = compositor.buildSilentCinemaFilterGraph({
    clips: [
      { duration: 5.0, hasAudio: true },
      { duration: 5.0, hasAudio: true }
    ],
    xfadeDuration: 0,
    hasBgm: false,
    sfxVolume: 0.5
  });
  assert.strictEqual(gConcat.effectiveXfade, 0);
  assert.strictEqual(gConcat.totalDuration, 10);
  assert.ok(gConcat.filterComplex.includes('concat=n=2:v=1:a=1[v_joined][a_sfx_raw]'));
  assert.ok(!gConcat.filterComplex.includes('xfade='));
  console.log('  [PASS] Silent-cinema filter graph construction verified.\n');

  // 6. End-to-end synthetic silent-cinema assembly via compositor + pipeline_loop
  console.log('Test 6: End-to-end silent-cinema assembly with Unicode Vietnamese cards & BGM...');
  const clip1 = path.join(tmpDir, 'shot_01.mp4');
  const clip2 = path.join(tmpDir, 'shot_02.mp4');
  const bgmFile = path.join(tmpDir, 'bgm.mp3');
  const outMaster = path.join(tmpDir, 'silent_master.mp4');

  execFileSync('ffmpeg', [
    '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=#1e3a2f:s=1280x720:r=24:d=2.0',
    '-f', 'lavfi', '-i', 'sine=f=330:d=2.0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip1
  ], { stdio: 'ignore' });
  execFileSync('ffmpeg', [
    '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=#3a2e1e:s=1280x720:r=24:d=2.0',
    '-f', 'lavfi', '-i', 'sine=f=520:d=2.0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip2
  ], { stdio: 'ignore' });
  execFileSync('ffmpeg', [
    '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=f=220:d=6.0',
    '-c:a', 'libmp3lame', bgmFile
  ], { stdio: 'ignore' });

  const assembled = await compositor.compositeSilentCinema({
    videoFiles: [clip1, clip2],
    outputVideoPath: outMaster,
    width: 1280,
    height: 720,
    fps: 30,
    xfadeDuration: 0.35,
    sfxVolume: 0.35,
    bgmPath: bgmFile,
    bgmVolume: 0.85,
    titleCard: { title: 'TIÊU ĐỀ MẪU', subtitle: 'Tác giả mẫu', start: 0.2, end: 1.4, fade: 0.3 },
    closingCard: { text: '“Câu trích mẫu có đầy đủ dấu tiếng Việt: ă â đ ê ô ơ ư.”', start: 2.0, end: 3.4, fade: 0.3 }
  });
  assert.ok(fs.existsSync(outMaster), 'Silent cinema master must be written');
  assert.strictEqual(assembled.width, 1280);
  assert.strictEqual(assembled.height, 720);
  assert.ok(assembled.duration >= 3.4 && assembled.duration <= 3.9, `Expected ~3.65s duration with 0.35s xfade, got ${assembled.duration}`);

  // Verify CLI exposes character command
  const cliSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'videogen'), 'utf8');
  assert.ok(cliSrc.includes("case 'character':"), 'CLI must expose ./videogen character');
  assert.strictEqual(typeof flow.createCharacterAssets, 'function');
  assert.strictEqual(typeof pipelineLoop.runPipelineForStoryboard, 'function');
  console.log('  [PASS] End-to-end synthetic silent-cinema assembly verified.\n');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('=== ALL INGREDIENTS, CHARACTER CREATOR & SILENT-CINEMA TESTS PASSED ===');
})().catch((err) => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});

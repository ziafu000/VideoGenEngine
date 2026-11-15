const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../engine/config');
const flow = require('../engine/flow');
const clipper = require('../engine/podcast_clipper');
const { COMPONENT_TYPES, normalizeScenes, buildScenesHtml, renderScene } = require('../engine/podcast_hyperframes/components');

console.log('=== RUNNING 9:16 CLIP MOTION OVERLAY & FLOW/CONFIG HELPER TEST SUITE ===\n');

const silent = { warn: null };

// 1. normalizeScenes is empty by default (no opinionated fallback scenes)
console.log('Test 1: normalizeScenes returns [] when spec.scenes is omitted or empty...');
assert.deepStrictEqual(normalizeScenes({}), []);
assert.deepStrictEqual(normalizeScenes({ scenes: [] }), []);
assert.deepStrictEqual(normalizeScenes({ project_id: 'any_project', title: 'Any Title' }), []);
assert.deepStrictEqual(normalizeScenes(undefined), []);
assert.strictEqual(buildScenesHtml({ title: 'Any Title' }), '');
const warnings = [];
const filtered = normalizeScenes({ scenes: [{ type: 'not_a_component' }, null, { type: 'gauge', value: 40, start: '2', end: '1' }] }, { warn: m => warnings.push(m) });
assert.strictEqual(filtered.length, 1, 'Unknown / invalid scenes must be dropped');
assert.strictEqual(warnings.length, 1, 'Unknown scene type must warn once');
assert.strictEqual(filtered[0].start, 2);
assert.ok(filtered[0].end >= 2.8, 'end must be coerced to at least start + 0.8s');
assert.deepStrictEqual(normalizeScenes({ scenes: filtered }, silent), filtered, 'normalizeScenes must be idempotent');
console.log('  [PASS] Empty-by-default scene normalization verified.\n');

// 2. Every component renders strictly from spec.scenes content
console.log('Test 2: Generic components render custom spec.scenes content...');
const customScenes = [
  { type: 'comparison_bars', start: 0.5, end: 4, title: 'Alpha Title', items: [{ label: 'Left Thing', value: '12 units', pct: 80, color: '#123456' }, { label: 'Right Thing', value: '3 units', pct: 20 }] },
  { type: 'comparison_bars', start: 4, end: 8, orientation: 'vertical', items: [{ label: 'Col A', value: 'A1', pct: 30 }, { label: 'Col B', value: 'B1', pct: 90 }] },
  { type: 'metric_counter', start: 8, end: 12, label: 'Counter Label', from: 5, to: 1234.5, decimals: 1, prefix: '~', suffix: ' pts', locale: 'en-US', caption: 'Counter Caption' },
  { type: 'trend_line', start: 12, end: 16, points: [3, 9, 4, 12], start_label: 'Begin Mark', end_label: 'Finish Mark', x_labels: ['Q1', 'Q2', 'Q3', 'Q4'] },
  { type: 'pillar_cards', start: 16, end: 20, items: [{ code: 'A', label: 'Pillar One' }, { label: 'Pillar Two' }] },
  { type: 'balance_scale', start: 20, end: 24, tilt: 0.5, left: { label: 'Side West', value: 'w1' }, right: { label: 'Side East', value: 'e1' } },
  { type: 'funnel', start: 24, end: 28, top_label: 'Many Inputs', bottom_label: 'Few Outputs', input_count: 9, output_count: 3 },
  { type: 'gauge', start: 28, end: 32, value: 72, value_label: '72 of 100', label: 'Gauge Label', min_label: 'Low End', max_label: 'High End' },
  { type: 'spectrum_slider', start: 32, end: 36, min_label: 'Min Side', max_label: 'Max Side', markers: [{ pct: 50, label: 'Middle Marker' }], pointer: { from_pct: 50, to_pct: 20, label: 'Pointer Label' } },
  { type: 'text_callout', start: 36, end: 40, lines: ['Plain Line', { text: 'Struck Line', style: 'strike' }, { text: 'Bold Line', style: 'emphasis', color: '#ABCDEF' }] },
  { type: 'step_flow', start: 40, end: 44, items: [{ title: 'Step Before', subtitle: 'sub before' }, { title: 'Step After', subtitle: 'sub after' }] }
];
const renderedTypes = new Set(customScenes.map(s => s.type));
assert.deepStrictEqual([...renderedTypes].sort(), [...COMPONENT_TYPES].sort(), 'Test must cover every component type');
const html = buildScenesHtml({ scenes: customScenes });
const expectedText = [
  'Alpha Title', 'Left Thing', '12 units', 'Right Thing', 'Col A', 'B1', 'Counter Label', '1,234.5', 'Counter Caption',
  'Begin Mark', 'Finish Mark', 'Q3', 'Pillar One', 'Pillar Two', '02', 'Side West', 'Side East', 'Many Inputs', 'Few Outputs',
  '72 of 100', 'Gauge Label', 'Low End', 'High End', 'Min Side', 'Max Side', 'Middle Marker', 'Pointer Label',
  'Plain Line', 'Struck Line', 'Bold Line', 'Step Before', 'sub after'
];
for (const t of expectedText) assert.ok(html.includes(t), `Rendered HTML must include "${t}"`);
customScenes.forEach((_, i) => assert.ok(html.includes(`id="scene-${i}"`), `scene-${i} must be rendered`));
assert.ok(html.includes('#123456') && html.includes('#ABCDEF'), 'Custom colors must be applied');
assert.ok(html.includes('data-from="5"') && html.includes('data-to="1234.5"') && html.includes('data-suffix=" pts"'), 'Counter data attributes must come from spec');
assert.ok(html.includes('tc-strike') && html.includes('tc-emphasis'), 'Text callout styles must be applied');
assert.ok(html.includes('anim-pointer'), 'Spectrum pointer must animate');
console.log('  [PASS] All generic components render custom content.\n');

// 3. Escaping & sanitization
console.log('Test 3: Scene text is escaped and colors are sanitized...');
const evil = renderScene({ type: 'text_callout', lines: [{ text: '<script>alert(1)</script>', color: 'red;background:url(x)' }] }, 0);
assert.ok(!evil.includes('<script>'), 'Scene text must be HTML-escaped');
assert.ok(evil.includes('&lt;script&gt;'), 'Escaped text must be preserved');
assert.ok(!evil.includes('url(x)'), 'Unsafe color values must be rejected');
assert.strictEqual(renderScene({ type: 'comparison_bars', items: [] }, 0), '', 'Components without data render nothing');
assert.strictEqual(renderScene({ type: 'metric_counter' }, 0), '', 'metric_counter without "to" renders nothing');
assert.strictEqual(renderScene({ type: 'trend_line', points: [1] }, 0), '', 'trend_line needs at least 2 points');
console.log('  [PASS] Escaping and sanitization verified.\n');

// 4. HyperFrames page assembly
console.log('Test 4: buildHyperFramesHtml embeds scenes, captions and script-safe spec...');
const emptyPage = clipper.buildHyperFramesHtml({ duration: 12 });
assert.ok(/<!--BEGIN_WIDGETS--><!--END_WIDGETS-->/.test(emptyPage), 'No scenes must produce an empty widget block');
assert.ok(emptyPage.includes('data-duration="12"'), 'Duration must be injected');
const page = clipper.buildHyperFramesHtml({
  duration: 20,
  language: 'fr',
  subtitle_style: { y: 1500, font_size: 60, highlight_color: '#00FF00' },
  scenes: [{ type: 'gauge', value: 10, start: 1, end: 3, label: '</script><b>x</b>' }],
  subtitles: [{ start: 0, end: 2, lines: ['First caption line', 'Second line'], highlights: [{ word: 'caption' }] }]
});
assert.ok(page.includes('id="scene-0"'));
assert.ok(page.includes('<html lang="fr">'));
assert.ok(page.includes('First caption line'.replace('caption', '<span class="hl">caption</span>')), 'Highlights must wrap words');
assert.ok(page.includes('top: 1390px'), 'Subtitle zone must follow subtitle_style.y');
assert.ok(page.includes('color: #00FF00'), 'Highlight color must follow subtitle_style.highlight_color');
const specBlock = page.slice(page.indexOf('const SPEC ='), page.indexOf('(function buildTimeline'));
assert.ok(!specBlock.includes('</script>'), 'Embedded spec JSON must not be able to close the script tag');
console.log('  [PASS] HyperFrames page assembly verified.\n');

// 5. Portrait framing, style/voice resolution, subtitles and snapshots
console.log('Test 5: Framing filter, option resolution, ASS subtitles and snapshot times...');
const centered = clipper.buildPortraitFilter();
assert.ok(centered.includes("crop=w='trunc(ih*9/16/2)*2':h=ih") && centered.includes('scale=1080:1920'), 'Default framing must be a neutral centered 9:16 crop');
assert.ok(clipper.buildPortraitFilter({ crop: { w: 600, h: 1066, x: 10, y: 0 } }).includes('crop=600:1066:10:0'));
const multi = clipper.buildPortraitFilter({ segments: [{ start: 0, end: 5, crop: { w: 100, h: 178, x: 0, y: 0 } }, { start: 5, end: 9, crop: { w: 200, h: 356, x: 4, y: 2 } }] });
assert.ok(multi.includes('split=2') && multi.includes("between(t,5.00,9.00)"), 'Segments must switch crops over time');
assert.throws(() => clipper.buildPortraitFilter({ crop: { w: 'a', h: 1, x: 0, y: 0 } }), /crop/);
assert.strictEqual(clipper.resolveStyle(undefined), 'both');
assert.strictEqual(clipper.resolveStyle('hyperframes'), 'motion');
assert.throws(() => clipper.resolveStyle('demo9'));
assert.strictEqual(clipper.resolveVoiceMode(undefined), 'original', 'Default voice mode must be the original audio');
assert.throws(() => clipper.resolveVoiceMode('robot'));
assert.deepStrictEqual(clipper.subtitleLines({ text: 'a\nb' }), ['a', 'b']);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-clip-test-'));
const assPath = clipper.generateSubtitleAss({ subtitles: [{ start: 1, end: 2.5, lines: ['Hello {brace} world'], highlights: [{ word: 'world', color: '#FF0000' }] }] }, path.join(tmpDir, 's.ass'));
const ass = fs.readFileSync(assPath, 'utf8');
assert.ok(ass.includes('0:00:01.00,0:00:02.50'), 'ASS timing must match');
assert.ok(ass.includes('{\\c&H000000FF&\\b1}world'), 'ASS highlight must use BGR color');
assert.ok(!ass.includes('{brace}'), 'ASS override braces from user text must be stripped');
fs.rmSync(tmpDir, { recursive: true, force: true });
assert.deepStrictEqual(clipper.defaultSnapshotTimes({ duration: 20 }), [5, 10, 15]);
assert.deepStrictEqual(clipper.defaultSnapshotTimes({ scenes: [{ type: 'gauge', value: 1, start: 2, end: 4 }] }), [3]);
console.log('  [PASS] Framing, options, subtitles and snapshots verified.\n');

// 6. Neutral, placeholder-only template and zero domain steering in the feature sources
console.log('Test 6: Template is a neutral placeholder schema and sources carry no domain steering...');
const templatePath = path.join(config.PROJECT_DIR, 'examples', 'storyboards', 'podcast_short_template.json');
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
assert.strictEqual(template.project_id, 'YOUR_PROJECT_ID');
assert.strictEqual(template.title, 'YOUR_TITLE');
for (const sc of template.scenes) assert.ok(COMPONENT_TYPES.includes(sc.type), `Template scene type ${sc.type} must be supported`);
assert.strictEqual(normalizeScenes(template, silent).length, template.scenes.length);
// Every text value in the template (outside of structural keys) must be a YOUR_* placeholder.
const structuralKeys = new Set(['_comment', 'type', 'style', 'voice_mode', 'orientation', 'source_video', 'master_dub_audio', 'highlight_color', 'clean_output_filename', 'motion_output_filename']);
const walk = (node, key) => {
  if (typeof node === 'string') {
    if (!structuralKeys.has(key)) assert.ok(node === '' || /^YOUR_[A-Z0-9_]+$/.test(node), `Template value for "${key}" must be a YOUR_* placeholder, got "${node}"`);
    return;
  }
  if (Array.isArray(node)) return node.forEach(v => walk(v, key));
  if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => walk(v, k));
};
walk(template, null);
assert.ok(!fs.existsSync(path.join(config.PROJECT_DIR, 'engine', 'podcast_hyperframes', 'archetypes')), 'Legacy archetypes directory must not exist');
const componentsSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'engine', 'podcast_hyperframes', 'components', 'index.js'), 'utf8');
assert.ok(!/project_id|spec\.title|key\.includes/.test(componentsSrc), 'Scene selection must never be inferred from project id or title');
const cliSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'videogen'), 'utf8');
assert.ok(cliSrc.includes("case 'podcast-short':"), 'CLI must expose podcast-short');
console.log('  [PASS] Neutral template and sources verified.\n');

// 7. Config helpers: WSL drive mapping & upload staging honors WIN_DOWNLOADS_DIR
console.log('Test 7: config.mntToWinDrivePath / resolveUploadStaging / toWinUploadPath...');
assert.strictEqual(config.mntToWinDrivePath('/mnt/d/Media/clip.mp4'), 'D:\\Media\\clip.mp4');
assert.strictEqual(config.mntToWinDrivePath('/mnt/c'), 'C:\\');
assert.strictEqual(config.mntToWinDrivePath('/home/user/clip.mp4'), null);
const staged = config.resolveUploadStaging('/home/user/out/clip.mp4', '/mnt/e/Custom Downloads/');
assert.deepStrictEqual(staged, { copyTo: '/mnt/e/Custom Downloads/clip.mp4', winPath: 'E:\\Custom Downloads\\clip.mp4' }, 'Staging must follow the custom downloads dir, not a hardcoded C:\\Users path');
assert.strictEqual(config.resolveUploadStaging('/home/user/clip.mp4', '/home/user/Downloads'), null, 'Non-drive downloads dir cannot be used for Windows staging');
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  assert.strictEqual(config.toWinUploadPath('/mnt/f/videos/a.mp4'), 'F:\\videos\\a.mp4');
  const nativeFile = path.join(os.tmpdir(), 'vg-upload-test.mp4');
  assert.strictEqual(config.toWinUploadPath(nativeFile, { isWsl: false }), config.toWinPath(nativeFile), 'Non-WSL Linux must not stage files');
}
console.log('  [PASS] Config upload path helpers verified.\n');

// 8. Flow helpers: insufficient credits preflight & error classification
console.log('Test 8: flow.detectInsufficientCredits / classifyFlowShotError...');
assert.strictEqual(flow.detectInsufficientCredits({ warnLabel: 'Bạn không đủ tín dụng' }).outOfCredits, true);
assert.strictEqual(flow.detectInsufficientCredits({ warnLabel: 'Not enough credits to generate' }).outOfCredits, true);
const banner = flow.detectInsufficientCredits({ bannerText: 'You are out of credits\nUpgrade' });
assert.strictEqual(banner.outOfCredits, true);
assert.strictEqual(banner.msg, 'You are out of credits Upgrade');
assert.strictEqual(flow.detectInsufficientCredits({ warnLabel: 'Prompt too long', bannerText: '' }).outOfCredits, false);
assert.strictEqual(flow.detectInsufficientCredits(undefined).outOfCredits, false);
assert.strictEqual(flow.classifyFlowShotError('[Google Flow] Insufficient credits: x'), 'insufficient_credits');
assert.strictEqual(flow.classifyFlowShotError('Phát hiện hoạt động bất thường'), 'unusual_activity');
assert.strictEqual(flow.classifyFlowShotError('We noticed unusual activity'), 'unusual_activity');
assert.strictEqual(flow.classifyFlowShotError('Timeout 35s: Google Flow chưa kích hoạt render'), 'timeout');
assert.strictEqual(flow.classifyFlowShotError('policy refusal'), 'other');
assert.strictEqual(flow.classifyFlowShotError(undefined), 'other');
const ytSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'engine', 'youtube_uploader.js'), 'utf8');
assert.ok(ytSrc.includes('youtube.com/shorts/'), 'YouTube uploader must detect youtube.com/shorts URLs');
console.log('  [PASS] Flow helpers verified.\n');

console.log('=== ALL CLIP MOTION OVERLAY & FLOW/CONFIG HELPER TESTS PASSED ===');

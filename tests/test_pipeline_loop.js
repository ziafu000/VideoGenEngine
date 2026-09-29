const assert = require('assert');
const path = require('path');
const fs = require('fs');
const config = require('../engine/config');
const pipelineLoop = require('../engine/pipeline_loop');

console.log('=== RUNNING PIPELINE LOOP TEST SUITE ===\n');

// 1. Module Exports Verification
console.log('Test 1: Module exports verification...');
assert.strictEqual(typeof pipelineLoop.runPipelineForStoryboard, 'function', 'runPipelineForStoryboard must be a function');
assert.strictEqual(typeof pipelineLoop.runLoop, 'function', 'runLoop must be a function');
assert.strictEqual(typeof pipelineLoop.resolveStoryboard, 'function', 'resolveStoryboard must be a function');
assert.strictEqual(typeof pipelineLoop.discoverStoryboards, 'function', 'discoverStoryboards must be a function');
console.log('  [PASS] All exports present and correctly typed.\n');

// 2. resolveStoryboard() Unit Tests
console.log('Test 2: resolveStoryboard() unit tests...');

// Case A: Resolving an example storyboard by relative path
const examplePath = 'examples/storyboards/example_anime_series.json';
const res1 = pipelineLoop.resolveStoryboard(examplePath);
assert.ok(res1.data, 'Should load storyboard data');
assert.strictEqual(res1.data.project.id, 'anime_ep01_demo', 'Should correctly match project id');
assert.ok(res1.path.endsWith('example_anime_series.json'), 'Should resolve full path');

// Case B: Resolving by base name without .json
const res2 = pipelineLoop.resolveStoryboard('example_anime_series');
assert.strictEqual(res2.data.project.id, 'anime_ep01_demo', 'Should resolve storyboard without .json extension');

// Case C: Passing raw storyboard object
const rawSb = { project_name: 'test_obj', shots: [] };
const res3 = pipelineLoop.resolveStoryboard(rawSb);
assert.strictEqual(res3.data.project_name, 'test_obj', 'Should accept raw storyboard object');

// Case D: Non-existent storyboard throws descriptive error
assert.throws(() => {
  pipelineLoop.resolveStoryboard('non_existent_storyboard_12345.json');
}, /Không tìm thấy file kịch bản storyboard/);

console.log('  [PASS] resolveStoryboard handles paths, extensions, and errors correctly.\n');

// 3. discoverStoryboards() Unit Tests
console.log('Test 3: discoverStoryboards() unit tests...');

// Case A: Discovers files in examples/storyboards when directed
const examplesDir = path.join(config.PROJECT_DIR, 'examples', 'storyboards');
const discovered = pipelineLoop.discoverStoryboards(examplesDir);
assert.ok(Array.isArray(discovered), 'Must return an array');
assert.ok(discovered.length >= 2, `Should discover at least 2 storyboards in examples, found ${discovered.length}`);
assert.ok(discovered.some(f => f.endsWith('example_anime_series.json')), 'Should include example_anime_series.json');
assert.ok(discovered.some(f => f.endsWith('scenes.json')), 'Should include scenes.json');

// Case B: Default discovery (checks storyboards/ and falls back to examples/ if empty)
const defaultDiscovered = pipelineLoop.discoverStoryboards();
assert.ok(Array.isArray(defaultDiscovered), 'Default discovery must return an array');
assert.ok(defaultDiscovered.length > 0, 'Should find at least 1 storyboard');

console.log(`  [PASS] discoverStoryboards discovered ${defaultDiscovered.length} files successfully.\n`);

// 4. Mocked runPipelineForStoryboard() Integration Test
console.log('Test 4: runPipelineForStoryboard execution with skip options...');

async function testPipelineExecution() {
  const testSb = {
    project: {
      id: 'test_pipeline_unit_shot',
      title: 'Unit Test Pipeline'
    },
    shots: [
      {
        id: 'shot_01',
        prompt: 'A calm mountain landscape at sunrise.',
        audio: { voiceover: 'Sunrise over the peaks.' }
      }
    ]
  };

  // Create temporary mock shot video and voiceover so compositor can stitch
  const epRenderDir = path.join(config.RENDERS_DIR, 'test_pipeline_unit_shot');
  const epAudioDir = path.join(config.AUDIO_DIR, 'test_pipeline_unit_shot');
  fs.mkdirSync(epRenderDir, { recursive: true });
  fs.mkdirSync(epAudioDir, { recursive: true });

  const dummyMp4 = path.join(epRenderDir, 'shot_01.mp4');
  const dummyMp3 = path.join(epAudioDir, 'voice_shot_01.mp3');

  // Generate 1-second synthetic video & audio using ffmpeg if available
  const { execSync } = require('child_process');
  try {
    execSync(`ffmpeg -y -f lavfi -i color=c=blue:s=1280x720:d=1 -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -c:v libx264 -c:a aac ${JSON.stringify(dummyMp4)} 2>/dev/null`);
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -c:a libmp3lame ${JSON.stringify(dummyMp3)} 2>/dev/null`);
  } catch (err) {
    console.warn('  [SKIP] FFmpeg not available or failed to create test fixture, skipping assembly run:', err.message);
    return;
  }

  // Run pipeline with skipRender, skipVoice, and noUpload to test wiring & composition
  const report = await pipelineLoop.runPipelineForStoryboard(testSb, {
    skipBridge: true,
    skipRender: true,
    skipVoice: true,
    noUpload: true,
    resolution: '720p'
  });

  assert.strictEqual(report.episode, 'test_pipeline_unit_shot');
  assert.ok(fs.existsSync(report.masterVideo), `Master video should exist at ${report.masterVideo}`);
  assert.ok(report.duration > 0, 'Report duration must be > 0');
  console.log(`  [PASS] Pipeline assembled master video: ${report.masterVideo} (${report.duration.toFixed(2)}s)\n`);

  // Cleanup test fixtures
  try {
    if (fs.existsSync(dummyMp4)) fs.unlinkSync(dummyMp4);
    if (fs.existsSync(dummyMp3)) fs.unlinkSync(dummyMp3);
    if (fs.existsSync(report.masterVideo)) fs.unlinkSync(report.masterVideo);
    if (fs.existsSync(epRenderDir)) fs.rmdirSync(epRenderDir, { recursive: true });
    if (fs.existsSync(epAudioDir)) fs.rmdirSync(epAudioDir, { recursive: true });
    const winCopied = path.join(config.WIN_DOWNLOADS_DIR, path.basename(report.masterVideo));
    if (fs.existsSync(winCopied)) fs.unlinkSync(winCopied);
  } catch {}
}

// 5. runLoop() Batch Behavior Test
console.log('Test 5: runLoop() batch handling and options test...');
async function testRunLoop() {
  const emptyRes = await pipelineLoop.runLoop(['non_existent_fake_storyboard.json'], {
    noUpload: true
  });
  assert.strictEqual(emptyRes.success, false, 'Should report non-success on failed storyboard');
  assert.strictEqual(emptyRes.failed.length, 1, 'Should have 1 failed entry');
  console.log('  [PASS] runLoop handled error queue correctly.\n');
}

(async () => {
  await testPipelineExecution();
  await testRunLoop();
  console.log('=== ALL PIPELINE LOOP TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
})().catch(err => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../engine/config');
const cdp = require('../engine/cdp');
const cdpProxy = require('../engine/cdp_proxy');
const doctor = require('../engine/doctor');
const explainer = require('../engine/explainer');
const tts = require('../engine/tts');
const compositor = require('../engine/compositor');

console.log('=== RUNNING SECURITY (SEC-01..04) & PERFORMANCE (PERF-01..03) TEST SUITE ===\n');

// 1. SEC-01: CDP Proxy IP Filtering & Bind Hardening
console.log('Test 1 (SEC-01): CDP Proxy client IP allowlist & interface binding...');
assert.strictEqual(cdpProxy.isAllowedClientIp('127.0.0.1'), true, 'Loopback IPv4 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::1'), true, 'Loopback IPv6 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.16.0.1'), true, 'WSL subnet start 172.16.0.1 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.24.112.1'), true, 'WSL subnet mid 172.24.112.1 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::ffff:172.31.255.254'), true, 'WSL subnet end 172.31.255.254 must be allowed');

assert.strictEqual(cdpProxy.isAllowedClientIp('172.15.255.255'), false, '172.15.x.x outside /12 must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.32.0.1'), false, '172.32.0.1 outside /12 must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp('192.168.1.100'), false, 'LAN 192.168.x.x must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp('10.0.0.15'), false, 'LAN 10.x.x.x must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp('8.8.8.8'), false, 'Public IP must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp(''), false, 'Empty IP must be rejected');

const bindAddrs = cdpProxy.getBindAddresses();
assert.ok(Array.isArray(bindAddrs) && bindAddrs.includes('127.0.0.1'), 'Bind addresses must include 127.0.0.1');
assert.ok(!bindAddrs.includes('0.0.0.0'), 'Bind addresses must not include wildcard 0.0.0.0');
for (const addr of bindAddrs) {
  assert.strictEqual(cdpProxy.isAllowedClientIp(addr), true, `Bind address ${addr} must pass allowlist`);
}

const bridgeSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'engine', 'bridge.js'), 'utf8');
assert.ok(bridgeSrc.includes('--remote-debugging-address=127.0.0.1'), 'bridge.js must enforce --remote-debugging-address=127.0.0.1');
console.log('  [PASS] SEC-01 CDP Proxy and Bridge network hardening verified.\n');

// 2. SEC-02 & SEC-03: Zero-Leak Blocklist & Pre-Commit Hook Hardening
console.log('Test 2 (SEC-02 & SEC-03): Zero-Leak blocklist & pre-commit hook hardening...');
const preCommitPath = path.join(config.PROJECT_DIR, '.githooks', 'pre-commit');
const doctorPath = path.join(config.PROJECT_DIR, 'engine', 'doctor.js');
const preCommitSrc = fs.readFileSync(preCommitPath, 'utf8');
const doctorSrc = fs.readFileSync(doctorPath, 'utf8');

// Verify no hardcoded Base64 secret strings or legacy private blocklists remain in tracked code (A06)
assert.ok(!preCommitSrc.includes('base64'), '.githooks/pre-commit must not contain hardcoded Base64 blocklist');
assert.ok(!doctorSrc.includes('base64'), 'engine/doctor.js must not contain hardcoded Base64 blocklist');

// Verify POSIX printf, case-insensitive grep -iE, null-terminated git diff -z, and no blind skip of .env.example
assert.ok(preCommitSrc.includes("printf '%s"), '.githooks/pre-commit must use POSIX printf');
assert.ok(preCommitSrc.includes('grep -iE'), '.githooks/pre-commit must use case-insensitive grep -iE');
assert.ok(preCommitSrc.includes('git diff --cached --name-only -z'), '.githooks/pre-commit must use null-terminated file iteration');
assert.ok(!preCommitSrc.includes('[ "$file" = ".env.example" ]'), '.githooks/pre-commit must not blind-skip .env.example');

// Verify structural pattern & dynamic .env blocklist support in doctor.js
process.env.ZERO_LEAK_BLOCKLIST = 'secret_test_channel_xyz|private_owner_token';
const patterns = doctor.buildLeakPatterns(config.PROJECT_DIR);
delete process.env.ZERO_LEAK_BLOCKLIST;

const sampleUpperChannelId = 'channel/' + 'UC' + '1234567890123456789012';
const sampleLowerChannelId = 'channel/' + 'uc' + '1234567890123456789012';
assert.ok(patterns.some(p => p.regex.test(sampleUpperChannelId)), 'Must detect uppercase YouTube Channel ID');
assert.ok(patterns.some(p => p.regex.test(sampleLowerChannelId)), 'Must detect lowercase YouTube Channel ID case-insensitively');
assert.ok(patterns.some(p => p.regex.test(' Owned by SECRET_TEST_CHANNEL_XYZ ')), 'Must detect custom .env blocklist token case-insensitively');
console.log('  [PASS] SEC-02 & SEC-03 Zero-Leak patterns and POSIX pre-commit guard verified.\n');

// 3. SEC-04: Command Injection Hygiene Across Engine Modules
console.log('Test 3 (SEC-04): Command injection hygiene (execFileSync argument arrays across engine/)...');
const engineDir = path.join(config.PROJECT_DIR, 'engine');
const engineFiles = fs.readdirSync(engineDir).filter(f => f.endsWith('.js'));
for (const file of engineFiles) {
  const src = fs.readFileSync(path.join(engineDir, file), 'utf8');
  assert.ok(!/\bexecSync\s*\(/.test(src), `engine/${file} must not use shell-interpolated execSync()`);
}
for (const requiredTarget of ['flow.js', 'compositor.js', 'bridge.js', 'explainer.js']) {
  const src = fs.readFileSync(path.join(engineDir, requiredTarget), 'utf8');
  assert.ok(/\bexecFileSync\s*\(/.test(src), `engine/${requiredTarget} must use execFileSync()`);
}

// Verify shell metacharacters in file paths cannot execute arbitrary commands
const injectionMarker = path.join(config.OUTPUT_DIR, 'sec04_injected_marker.txt');
if (fs.existsSync(injectionMarker)) fs.unlinkSync(injectionMarker);
const maliciousPath = path.join(config.OUTPUT_DIR, `bad"; touch "${injectionMarker}"; echo "`);
const durResult = compositor.getDuration(maliciousPath);
const expDurResult = explainer.getAudioDuration(maliciousPath);
assert.strictEqual(durResult, 0, 'compositor.getDuration on nonexistent metacharacter path must safely return 0');
assert.strictEqual(expDurResult, null, 'explainer.getAudioDuration on nonexistent metacharacter path must safely return null');
assert.strictEqual(fs.existsSync(injectionMarker), false, 'Shell metacharacters in path must never execute injected commands');
console.log('  [PASS] SEC-04 Command injection immunity verified across all engine modules.\n');

// 4. PERF-01 & PERF-02: Explainer Multi-Image Pacing + Single-Pass FFmpeg & Deterministic Scratch Cleanup
console.log('Test 4 (PERF-01 & PERF-02): Explainer pacing, single-pass FFmpeg composite, and scratch cleanup...');

async function testExplainerPacingAndAssembly() {
  const testSeries = 'test_perf01';
  const testEp = 'ep01';
  const projectId = `${testSeries}_${testEp}`;
  const epRenderDir = path.join(config.RENDERS_DIR, projectId);
  const epAudioDir = path.join(config.AUDIO_DIR, projectId);

  try {
    const sampleTranscript = [
      'Most of us never think twice about why our heart races in the dark when we hear a sudden noise outside the window.',
      'Your brain immediately slams the emergency alarm button in the amygdala, flooding your bloodstream with pure adrenaline.',
      'Within seconds, your lungs expand wide and your liver dumps a rushing torrent of glucose fuel into your muscles.'
    ].join(' ');

    const sb = explainer.createExplainerStoryboard({
      title: 'Test PERF-01 Explainer',
      seriesId: testSeries,
      episodeId: testEp,
      transcriptText: sampleTranscript,
      aspectRatio: '16:9'
    });

    assert.ok(sb.clauses_count >= 3, `Expected at least 3 clauses, got ${sb.clauses_count}`);
    assert.ok(sb.shots.length > sb.clauses_count, `Expected multi-image sub-cuts (${sb.shots.length}) > clauses (${sb.clauses_count})`);

    // Count how many shots actually request TTS synthesis
    const synthesisTargets = sb.shots.filter((s, idx) => !tts.isContinuationSubCut(s, idx, sb.shots));
    const continuationCuts = sb.shots.filter((s, idx) => tts.isContinuationSubCut(s, idx, sb.shots));

    assert.strictEqual(
      synthesisTargets.length,
      sb.clauses_count,
      `Voice synthesis count (${synthesisTargets.length}) must equal unique clause count (${sb.clauses_count}), not total visual cuts (${sb.shots.length})`
    );
    assert.ok(continuationCuts.length > 0, 'Must have continuation visual sub-cuts');
    for (const cCut of continuationCuts) {
      assert.strictEqual(cCut.is_clause_start, false, 'Continuation sub-cut must have is_clause_start: false');
      assert.strictEqual(cCut.audio.voiceover, null, 'Continuation sub-cut must have null audio.voiceover');
    }

    // Create synthetic clause audio files (only for clause primary shots) and distinct test PNGs for all visual sub-cuts
    fs.mkdirSync(epRenderDir, { recursive: true });
    fs.mkdirSync(epAudioDir, { recursive: true });

    for (let i = 0; i < synthesisTargets.length; i++) {
      const targetShot = synthesisTargets[i];
      const freq = 300 + i * 80;
      const mp3Path = path.join(epAudioDir, `voice_${targetShot.id}.mp3`);
      execFileSync('ffmpeg', [
        '-nostdin', '-y', '-f', 'lavfi', '-i', `sine=f=${freq}:d=0.6`,
        '-c:a', 'libmp3lame', config.toWinPath(mp3Path)
      ], { stdio: 'ignore' });
    }

    // Create valid distinct PNG files for each visual sub-cut using pure Node zlib + CRC32
    const zlib = require('zlib');
    function makeSolidPng(r, g, b) {
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
      const crc32 = (buf) => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
      };
      const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(typeAndData), 0);
        return Buffer.concat([len, typeAndData, crc]);
      };
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(1, 0);
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8; // bit depth
      ihdr[9] = 2; // color type RGB
      const idat = zlib.deflateSync(Buffer.from([0, r & 0xff, g & 0xff, b & 0xff]));
      return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
    }
    for (let i = 0; i < sb.shots.length; i++) {
      const s = sb.shots[i];
      const pngPath = path.join(epRenderDir, `${s.id}.png`);
      fs.writeFileSync(pngPath, makeSolidPng((i * 37) % 255, (i * 73) % 255, (i * 113) % 255));
    }

    // Build master clause audio and verify master_voice_clauses.wav & master_voice_tight.wav exist
    const masterWav = tts.buildMasterClauseAudio(sb, epAudioDir);
    assert.ok(masterWav && fs.existsSync(masterWav), 'master_voice_clauses.wav must be generated');
    assert.ok(fs.existsSync(path.join(epAudioDir, 'master_voice_tight.wav')), 'master_voice_tight.wav must be generated');

    // Run compositor.assembleStoryboard for static cuts and verify output MP4
    const masterVideoPath = await compositor.assembleStoryboard(sb);
    assert.ok(fs.existsSync(masterVideoPath), `Assembled static-cut master video must exist at ${masterVideoPath}`);
    assert.ok(fs.statSync(masterVideoPath).size > 5000, 'Assembled master video must be non-empty');

    // PERF-02: Verify concat_plan.txt was deterministically cleaned up by assembleStaticCuts finally block
    const concatPlan = path.join(config.OUTPUT_DIR, 'concat_plan.txt');
    assert.strictEqual(fs.existsSync(concatPlan), false, 'concat_plan.txt must be deterministically removed after assembleStaticCuts');

    if (fs.existsSync(masterVideoPath)) fs.unlinkSync(masterVideoPath);
    console.log(`  [PASS] PERF-01 & static-cut cleanup verified: ${sb.clauses_count} clauses -> ${sb.shots.length} visual cuts.\n`);
  } finally {
    try {
      if (fs.existsSync(epRenderDir)) fs.rmSync(epRenderDir, { recursive: true, force: true });
      if (fs.existsSync(epAudioDir)) fs.rmSync(epAudioDir, { recursive: true, force: true });
    } catch {}
  }
}

async function testSinglePassCompositeVideo() {
  const compositorSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'engine', 'compositor.js'), 'utf8');
  assert.ok(!compositorSrc.includes('raw_master.mp4'), 'compositor.js must not write redundant intermediate raw_master.mp4');
  assert.ok(compositorSrc.includes('concat=n=${videoFiles.length}:v=1:a=1'), 'compositor.js must use single-pass concat filtergraph');

  const testSeries = 'test_perf02';
  const testEp = 'ep01';
  const projectId = `${testSeries}_${testEp}`;
  const epRenderDir = path.join(config.RENDERS_DIR, projectId);
  const epAudioDir = path.join(config.AUDIO_DIR, projectId);
  const tempAssembleDir = path.join(config.RENDERS_DIR, 'temp_assemble');

  try {
    fs.mkdirSync(epRenderDir, { recursive: true });
    fs.mkdirSync(epAudioDir, { recursive: true });

    const sb = {
      project: projectId,
      series_id: projectId,
      episode_id: testEp,
      aspect_ratio: '9:16',
      hardsub: false,
      bgm_volume: 0,
      shots: [
        { id: 'shot_01', duration: 1, prompt: 'Test shot 1', audio: { voiceover: 'First test clip.' } },
        { id: 'shot_02', duration: 1, prompt: 'Test shot 2', audio: { voiceover: 'Second test clip.' } }
      ]
    };

    for (let i = 0; i < sb.shots.length; i++) {
      const s = sb.shots[i];
      const clipPath = path.join(epRenderDir, `${s.id}.mp4`);
      const voicePath = path.join(epAudioDir, `voice_${s.id}.mp3`);
      execFileSync('ffmpeg', [
        '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=${i === 0 ? 'red' : 'blue'}:s=360x640:r=24:d=1`,
        '-f', 'lavfi', '-i', `sine=f=${220 + i * 110}:d=1`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest',
        config.toWinPath(clipPath)
      ], { stdio: 'ignore' });
      execFileSync('ffmpeg', [
        '-nostdin', '-y',
        '-f', 'lavfi', '-i', `sine=f=${440 + i * 150}:d=0.8`,
        '-c:a', 'libmp3lame',
        config.toWinPath(voicePath)
      ], { stdio: 'ignore' });
    }

    const outRes = await compositor.assembleStoryboard(sb);
    const outPath = typeof outRes === 'string' ? outRes : outRes.outputVideoPath;
    assert.ok(outPath && fs.existsSync(outPath), `Single-pass compositeVideo output must exist at ${outPath}`);
    assert.ok(fs.statSync(outPath).size > 2000, 'Single-pass compositeVideo output must be non-empty');
    assert.strictEqual(fs.existsSync(tempAssembleDir), false, 'renders/temp_assemble must be deterministically cleaned up in finally block');

    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    console.log('  [PASS] PERF-02 verified: Single-pass H.264 filtergraph assembly & deterministic temp_assemble cleanup.\n');
  } finally {
    try {
      if (fs.existsSync(epRenderDir)) fs.rmSync(epRenderDir, { recursive: true, force: true });
      if (fs.existsSync(epAudioDir)) fs.rmSync(epAudioDir, { recursive: true, force: true });
      if (fs.existsSync(tempAssembleDir)) fs.rmSync(tempAssembleDir, { recursive: true, force: true });
    } catch {}
  }
}

// 5. PERF-03: CDP Connection Pooling & Memory Hygiene
console.log('Test 5 (PERF-03): CDP connection reuse, lease reference counting & Base64/DOM hygiene...');
function testCdpPoolingAndFlowMemory() {
  const client = new cdp.CDPClient('ws://127.0.0.1:9999/devtools/page/mock', { pooled: true, idleTtlMs: 50 });
  assert.strictEqual(client._refCount, 0, 'Initial refCount must be 0');
  client.retain();
  client.retain();
  assert.strictEqual(client._refCount, 2, 'Two retain() calls must increment refCount to 2');
  client.release();
  assert.strictEqual(client._refCount, 1, 'One release() call must decrement refCount to 1');
  client.release();
  assert.strictEqual(client._refCount, 0, 'Second release() call must decrement refCount to 0');
  client.forceClose();

  const stats = cdp.getPoolStats();
  assert.strictEqual(typeof stats.keys, 'number', 'cdp.getPoolStats() must report pool keys count');
  assert.strictEqual(typeof stats.activeClients, 'number', 'cdp.getPoolStats() must report activeClients count');
  cdp.closeAllClients();

  const flowSrc = fs.readFileSync(path.join(config.PROJECT_DIR, 'engine', 'flow.js'), 'utf8');
  assert.ok(!flowSrc.includes(".split(',')[1]"), 'flow.js must not duplicate Base64 strings with .split(",")');
  assert.ok(flowSrc.includes("res.indexOf(',')"), 'flow.js must slice Base64 strings using indexOf(",")');
  assert.ok(flowSrc.includes('pruneFlowDomMemory'), 'flow.js must prune offscreen DOM/Blob resources during batch runs');
  assert.ok(flowSrc.includes('cdp.releaseMemory'), 'flow.js must invoke cdp.releaseMemory() after heavy transfers');
  console.log('  [PASS] PERF-03 CDP connection reuse and memory hygiene verified.\n');
}

(async () => {
  const secOk = await doctor.runSecurityChecks(config.PROJECT_DIR);
  assert.strictEqual(secOk, true, 'doctor.runSecurityChecks must pass on repository');
  await testExplainerPacingAndAssembly();
  await testSinglePassCompositeVideo();
  testCdpPoolingAndFlowMemory();
  console.log('=== ALL SECURITY & PERFORMANCE TESTS PASSED ===');
})().catch(err => {
  console.error('\n[FAIL] Test failed:', err);
  process.exit(1);
});

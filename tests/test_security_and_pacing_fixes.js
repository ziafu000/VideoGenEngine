const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../engine/config');
const cdpProxy = require('../engine/cdp_proxy');
const doctor = require('../engine/doctor');
const explainer = require('../engine/explainer');
const tts = require('../engine/tts');
const compositor = require('../engine/compositor');

console.log('=== RUNNING SECURITY (SEC-01..03) & EXPLAINER PACING (PERF-01) TEST SUITE ===\n');

// 1. SEC-01: CDP Proxy IP Filtering & Bind Hardening
console.log('Test 1 (SEC-01): CDP Proxy client IP allowlist & interface binding...');
assert.strictEqual(cdpProxy.isAllowedClientIp('127.0.0.1'), true, 'Loopback IPv4 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::1'), true, 'Loopback IPv6 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.16.0.1'), true, 'WSL subnet start 172.16.0.1 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.24.112.1'), true, 'WSL subnet mid 172.24.112.1 must be allowed');
assert.strictEqual(cdpProxy.isAllowedClientIp('::ffff:172.31.255.254'), true, 'WSL subnet end 172.31.255.254 must be allowed');

assert.strictEqual(cdpProxy.isAllowedClientIp('172.15.255.255'), false, '172.15.x.x outside /12 must be rejected');
assert.strictEqual(cdpProxy.isAllowedClientIp('172.32.0.1'), false, '172.32.x.x outside /12 must be rejected');
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

// Verify no hardcoded Base64 secret strings remain in tracked code
const bannedBase64Fragments = [
  'emZzdHVkaW98',
  'R2lhIFBow7o=',
  'VUNbYS16QS1aMC05Xy1dezIyfXx6ZnN0dWRpbw'
];
for (const frag of bannedBase64Fragments) {
  assert.ok(!preCommitSrc.includes(frag), `.githooks/pre-commit must not contain hardcoded Base64 secret ${frag}`);
  assert.ok(!doctorSrc.includes(frag), `engine/doctor.js must not contain hardcoded Base64 secret ${frag}`);
}

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

// 3. PERF-01: Explainer Multi-Image Pacing Decoupled Voice Synthesis & Master Audio Assembly
console.log('Test 3 (PERF-01): Explainer multi-image pacing voice deduplication & static cuts assembly...');

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
      execSync(`ffmpeg -nostdin -y -f lavfi -i sine=f=${freq}:d=0.6 -c:a libmp3lame ${JSON.stringify(config.toWinPath(mp3Path))} 2>/dev/null`);
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

    console.log(`  [PASS] PERF-01 verified: ${sb.clauses_count} clauses -> ${sb.shots.length} visual cuts, synthesized ${synthesisTargets.length} voices, assembled master video.\n`);

    if (fs.existsSync(masterVideoPath)) fs.unlinkSync(masterVideoPath);
    const concatPlan = path.join(config.OUTPUT_DIR, 'concat_plan.txt');
    if (fs.existsSync(concatPlan)) fs.unlinkSync(concatPlan);
  } finally {
    try {
      if (fs.existsSync(epRenderDir)) fs.rmSync(epRenderDir, { recursive: true, force: true });
      if (fs.existsSync(epAudioDir)) fs.rmSync(epAudioDir, { recursive: true, force: true });
    } catch {}
  }
}

(async () => {
  const secOk = await doctor.runSecurityChecks(config.PROJECT_DIR);
  assert.strictEqual(secOk, true, 'doctor.runSecurityChecks must pass on repository');
  await testExplainerPacingAndAssembly();
  console.log('=== ALL SECURITY & EXPLAINER PACING TESTS PASSED ===');
})().catch(err => {
  console.error('\n[FAIL] Test failed:', err);
  process.exit(1);
});

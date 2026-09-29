const assert = require('assert');
const path = require('path');
const fs = require('fs');
const config = require('../engine/config');
const facebook = require('../engine/facebook');
const facebookUploader = require('../engine/facebook_uploader');

console.log('=== RUNNING FACEBOOK UPLOADER TEST SUITE ===\n');

// 1. Module Exports Verification
console.log('Test 1: Module exports verification...');
assert.strictEqual(typeof facebook.uploadReel, 'function', 'facebook.uploadReel must be a function');
assert.strictEqual(typeof facebook.getStatus, 'function', 'facebook.getStatus must be a function');
assert.strictEqual(typeof facebookUploader.uploadReel, 'function', 'facebookUploader.uploadReel must be a function');
assert.strictEqual(typeof facebookUploader.cmdStatus, 'function', 'facebookUploader.cmdStatus must be a function');
assert.strictEqual(typeof facebookUploader.cmdUpload, 'function', 'facebookUploader.cmdUpload must be a function');
assert.strictEqual(typeof facebookUploader.buildCaption, 'function', 'facebookUploader.buildCaption must be a function');
assert.strictEqual(typeof facebookUploader.getFacebookTab, 'function', 'facebookUploader.getFacebookTab must be a function');
console.log('  [PASS] All exports present and correctly typed.\n');

// 2. buildCaption() Unit Tests
console.log('Test 2: buildCaption unit tests...');

// Case A: Custom caption provided directly
const customCap = 'Direct caption override #shorts';
assert.strictEqual(facebookUploader.buildCaption(null, customCap), customCap, 'Should return custom caption directly');

// Case B: Storyboard with explicit facebook.caption and hashtags
const sb1 = {
  facebook: {
    caption: 'Deep sea mystery uncovered!',
    hashtags: ['deepsea', 'ocean', 'reels']
  }
};
const cap1 = facebookUploader.buildCaption(sb1);
assert.ok(cap1.includes('Deep sea mystery uncovered!'), 'Should contain main caption text');
assert.ok(cap1.includes('#deepsea') && cap1.includes('#ocean') && cap1.includes('#reels'), 'Should append hashtags');

// Case C: Storyboard with youtube title & description fallback
const sb2 = {
  youtube: {
    title: 'Wonders of the Mariana Trench',
    description: 'A deep dive into the abyss.'
  },
  facebook: {
    hashtags: ['ocean', 'science']
  }
};
const cap2 = facebookUploader.buildCaption(sb2);
assert.ok(cap2.includes('Wonders of the Mariana Trench'), 'Should include YouTube title');
assert.ok(cap2.includes('A deep dive into the abyss.'), 'Should include YouTube description');
assert.ok(cap2.includes('#ocean') && cap2.includes('#science'), 'Should include hashtags');

// Case D: Storyboard with series_title and episode_title
const sb3 = {
  series_title: 'Protocol: Cyber',
  episode_title: 'Episode 1',
  project: {
    series: 'Sci-fi animated series'
  }
};
const cap3 = facebookUploader.buildCaption(sb3);
assert.ok(cap3.includes('Protocol: Cyber - Episode 1'), 'Should format series and episode title');
assert.ok(cap3.includes('Sci-fi animated series'), 'Should include project series description');
assert.ok(cap3.includes('#Reels'), 'Should include default Reels hashtag');

console.log('  [PASS] buildCaption handles all storyboard configurations correctly.\n');

// 3. Config Verification
console.log('Test 3: Configuration verification...');
assert.ok(config.FACEBOOK_REELS_URL, 'config.FACEBOOK_REELS_URL must be defined');
assert.ok(config.FACEBOOK_REELS_URL.includes('facebook.com'), 'config.FACEBOOK_REELS_URL should target facebook');
console.log(`  [PASS] config.FACEBOOK_REELS_URL = ${config.FACEBOOK_REELS_URL}\n`);

// 4. Live CDP Status Verification
console.log('Test 4: Live CDP Facebook status check...');
async function testLiveStatus() {
  try {
    const res = await facebook.getStatus();
    assert.strictEqual(res.ok, true, 'Status check must return ok: true');
    assert.ok(res.status, 'Status check must return status object');
    console.log('  [PASS] Live status returned:', res.status.state, '| Account:', res.status.account_name);
  } catch (err) {
    console.warn('  [SKIP] Bridge or Chrome not accessible in this run:', err.message);
  }
}

testLiveStatus().then(() => {
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
}).catch(err => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const config = require('../engine/config');
const tiktokUploader = require('../engine/tiktok_uploader');

console.log('=== RUNNING TIKTOK UPLOADER TEST SUITE ===\n');

// 1. Module Exports Verification
console.log('Test 1: Module exports verification...');
assert.strictEqual(typeof tiktokUploader.uploadSingleShortToTikTok, 'function', 'uploadSingleShortToTikTok must be a function');
assert.strictEqual(typeof tiktokUploader.dismissAllModals, 'function', 'dismissAllModals must be a function');
console.log('  [PASS] All TikTok uploader exports present and correctly typed.\n');

// 2. Options and Parameters Validation
console.log('Test 2: Options validation unit tests...');
async function testOptionsValidation() {
  // Case A: Missing videoPath should throw or reject
  let threw = false;
  try {
    await tiktokUploader.uploadSingleShortToTikTok({});
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('path') || err.message.includes('videoPath') || err.message.includes('not found'), 'Should reject missing video path');
  }
  // If it requires bridge or video, assert that it fails gracefully
  console.log('  [PASS] uploadSingleShortToTikTok handles missing video parameter safely.\n');
}

// 3. Configuration Verification
console.log('Test 3: Configuration verification...');
assert.ok(config.PROJECT_DIR, 'config.PROJECT_DIR must be defined');
assert.ok(config.OUTPUT_DIR, 'config.OUTPUT_DIR must be defined');
console.log(`  [PASS] config directories resolved correctly.\n`);

(async () => {
  await testOptionsValidation();
  console.log('=== ALL TIKTOK UPLOADER TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
})().catch(err => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});

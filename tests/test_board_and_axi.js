const fs = require('fs');
const path = require('path');
const assert = require('assert');
const board = require('../engine/board');
const cdp = require('../engine/cdp');
const tts = require('../engine/tts');

console.log('=== RUNNING BOARD & AXI UPGRADES TEST SUITE ===\n');

// Test 1: Board Generation
console.log('Test 1: Director\'s Board generation...');
const templatePath = path.join(__dirname, '..', 'examples', 'storyboards', 'universal_template.json');
assert.ok(fs.existsSync(templatePath), 'Universal template storyboard must exist');

const templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const outHtml = board.generateBoard(templateData, { storyboardPath: templatePath });

assert.ok(fs.existsSync(outHtml), 'Generated board HTML must exist');
const htmlContent = fs.readFileSync(outHtml, 'utf8');

assert.ok(htmlContent.includes('daisyui'), 'Board must load DaisyUI');
assert.ok(htmlContent.includes('@tailwindcss/browser'), 'Board must load Tailwind browser runtime');
assert.ok(htmlContent.includes('data-theme="luxury"'), 'Board must default to luxury theme');
assert.ok(htmlContent.includes('Director\'s Board'), 'Board must include title header');
assert.ok(htmlContent.includes('shot-card'), 'Board must render shot cards');
console.log('  [PASS] Board generates responsive DaisyUI/Tailwind HTML with shot grid.');

// Test 2: Helper Functions in board.js
console.log('\nTest 2: Board timing & badge helper functions...');
assert.strictEqual(board.formatTime(0), '00:00');
assert.strictEqual(board.formatTime(65), '01:05');
assert.strictEqual(board.formatTime(125), '02:05');

assert.strictEqual(board.getStrategyBadgeClass('LITERAL'), 'badge-info');
assert.strictEqual(board.getStrategyBadgeClass('METAPHOR'), 'badge-secondary');
assert.strictEqual(board.getStrategyBadgeClass('TITLE_CARD'), 'badge-warning');
assert.strictEqual(board.getStrategyBadgeClass('SPLIT_SCREEN'), 'badge-accent');
assert.strictEqual(board.getStrategyBadgeClass('POSE_CHURN'), 'badge-primary');
console.log('  [PASS] Timing formatting and strategy badge mappings are correct.');

// Test 3: CDP captureDiagnosticScreenshot export
console.log('\nTest 3: CDP diagnostic screenshot function...');
assert.strictEqual(typeof cdp.captureDiagnosticScreenshot, 'function', 'captureDiagnosticScreenshot must be exported');
console.log('  [PASS] cdp.captureDiagnosticScreenshot is exported.');

// Test 4: TTS preflightElevenLabsQuota export and behavior
console.log('\nTest 4: TTS preflightElevenLabsQuota...');
assert.strictEqual(typeof tts.preflightElevenLabsQuota, 'function', 'preflightElevenLabsQuota must be exported');

const quotaResult = tts.preflightElevenLabsQuota([
  { shotId: 'shot_01', text: 'First shot voiceover' },
  { shotId: 'shot_02', text: 'Second shot voiceover' }
]);
assert.ok(quotaResult, 'Quota preflight must return result object');
assert.strictEqual(quotaResult.ok, true, 'Quota preflight must return ok');
assert.strictEqual(quotaResult.totalChars, 'First shot voiceover'.length + 'Second shot voiceover'.length);
console.log('  [PASS] preflightElevenLabsQuota calculates character count and handles quota audit gracefully.');

console.log('\n=== ALL BOARD & AXI TESTS PASSED ===\n');

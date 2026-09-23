const { execSync } = require('child_process');

/**
 * TypeSafe Jev (System One AI) Centralized Helper for VideoGen Engine
 * Flagship model: jev-latest (jev-1.13.0) via browser-jev CLI
 * Non-generative, fast semantic decisions (~60-70ms), 100% free output tokens.
 */

class JevHelper {
  /**
   * Screen prompt for safety, policy refusal risks, and sensitive keywords before submission.
   */
  static screenPrompt(promptText) {
    if (!promptText || typeof promptText !== 'string') return { safe: true, risk_score: 0 };
    try {
      const cleanPrompt = promptText.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
      const out = execSync(`browser-jev screen-prompt ${JSON.stringify(cleanPrompt)}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return JSON.parse(out.trim());
    } catch (err) {
      return { safe: true, risk_score: 0, error: err.message };
    }
  }

  /**
   * Classify page text / component text into one of several predefined typed states.
   * @param {string} text - Clean text from page or DOM component
   * @param {Record<string, string>} statesMap - Map of state_id -> semantic description
   * @returns {{ choice: string, confidence: number, probabilities: Record<string, number> }}
   */
  static classify(text, statesMap) {
    const keys = Object.keys(statesMap);
    if (!keys.length) return { choice: '', confidence: 0 };
    if (!text || typeof text !== 'string') return { choice: keys[0], confidence: 0 };

    try {
      const cleanText = text.replace(/[\r\n\t]+/g, ' ').slice(0, 800);
      const statesJson = JSON.stringify(statesMap);
      const out = execSync(`browser-jev classify --text ${JSON.stringify(cleanText)} --states ${JSON.stringify(statesJson)}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return JSON.parse(out.trim());
    } catch (err) {
      return { choice: keys[0], confidence: 0, error: err.message };
    }
  }

  /**
   * Detect obstacles, modals, popups, captchas, rate limits, or confirmation warnings.
   * @param {string} text - Modal or page text
   * @returns {{ has_obstacle: boolean, obstacle_type: string, action: string, confidence: number }}
   */
  static obstacle(text) {
    if (!text || typeof text !== 'string') return { has_obstacle: false };
    try {
      const cleanText = text.replace(/[\r\n\t]+/g, ' ').slice(0, 800);
      const out = execSync(`browser-jev obstacle --text ${JSON.stringify(cleanText)}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return JSON.parse(out.trim());
    } catch (err) {
      return { has_obstacle: false, error: err.message };
    }
  }

  /**
   * Verify if an expected condition is satisfied by the current text.
   * @param {string} text - Page text
   * @param {string} expected - Expected outcome description
   * @returns {{ verified: boolean, confidence: number, has_error: boolean }}
   */
  static verify(text, expected) {
    if (!text) return { verified: false, confidence: 0 };
    try {
      const cleanText = text.replace(/[\r\n\t]+/g, ' ').slice(0, 800);
      const out = execSync(`browser-jev verify --text ${JSON.stringify(cleanText)} --expected ${JSON.stringify(expected)}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return JSON.parse(out.trim());
    } catch (err) {
      return { verified: false, confidence: 0, error: err.message };
    }
  }

  /**
   * Select best matching UI element by intent.
   * @param {Array<{ id?: string, text?: string, tag?: string, role?: string }>} elements
   * @param {string} intent - Desired target action or element
   */
  static select(elements, intent) {
    if (!elements || !elements.length) return null;
    try {
      const elJson = JSON.stringify(elements.slice(0, 20));
      const out = execSync(`browser-jev select --elements ${JSON.stringify(elJson)} --intent ${JSON.stringify(intent)}`, {
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return JSON.parse(out.trim());
    } catch (err) {
      return null;
    }
  }
}

module.exports = JevHelper;

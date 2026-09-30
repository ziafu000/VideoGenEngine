# Contributing to VideoGen Engine

Thank you for your interest in contributing to **VideoGen Engine**! We welcome bug reports, feature suggestions, documentation improvements, and pull requests from the community.

---

## 🛡️ Intellectual Property & Storyboard Protection

Please keep the following principles in mind when contributing:

1. **Keep Engine Logic Generic:**
   - VideoGen is an open-source engine framework. Engine code (`engine/`, `videogen`) must **never contain hardcoded series titles, character names, or private plotlines**.
   - All private storyboards reside under `storyboards/` (which is gitignored). Only generic community templates belong in `examples/storyboards/`.
2. **Never Commit Private Assets:**
   - Raw character assets, voice recordings, and private video outputs must never be committed. The `.gitignore` is pre-configured to protect these directories.

---

## 🛠️ Development Setup

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/ziafu000/VideoGenEngine.git
   cd VideoGenEngine
   chmod +x ./videogen
   ```

2. **Zero Dependencies:**
   - The engine is designed to run entirely on **native Node.js v20+** standard libraries without requiring `npm install` or third-party packages.
   - You can optionally link the CLI globally during development:
     ```bash
     npm link
     ```

3. **Verify Health:**
   ```bash
   ./videogen bridge status
   ```

---

## 📋 Pull Request Guidelines

1. **Focus on Modularity:**
   - Keep module boundaries clean (`engine/flow.js`, `engine/tts.js`, `engine/compositor.js`, etc.).
   - Follow the established CDP error-handling and fallback conventions.
2. **TypeSafe Jev Compatibility:**
   - Whenever adding browser interaction steps, ensure they are resilient to UI variations and consider adding semantic classification via `browser-jev` with safe heuristic fallbacks.
3. **Shell & Node.js Standards:**
   - Ensure all code passes syntax checks (`node -c <file>`).
   - Keep scripts ShellCheck-clean if contributing bash utilities.

---

## 🐛 Reporting Bugs & Issues

Please open an issue on GitHub with:
- Operating system and environment (WSL2 Ubuntu, native Linux, etc.).
- Node.js version (`node -v`) and FFmpeg version (`ffmpeg -version`).
- The command executed and relevant error logs.
- Redact any sensitive prompts, channel IDs, or API keys before submitting!

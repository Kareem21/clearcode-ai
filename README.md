# ClearCode AI (`clearcode-ai`)

> **Eliminating AI "black-box" coding and comprehension debt by streaming AI-generated Playwright code line-by-line while simultaneously populating real-time documentation citations, highlighted excerpts, and micro-decision rationales.**

---

## ⚡ Key Features

1. **Synchronized Single-Call Streaming**:
   * Causal decision-first architecture: The AI commits to the architectural decision and documentation rule *before* emitting the code line.
   * Eliminates "post-hoc confabulation" (rationalizing after the fact).
2. **Interactive Right Panel (Exact `sa.jpeg` Design)**:
   * **Live Status & Cancel Button**: Displays `Generating... [■■■]` with animated pulse and instant cancellation (`AbortController`).
   * **Accordion Micro-Decision Cards**: Displays ordered decision steps with blue highlight for the active streaming step.
   * **Expandable Highlighted Excerpts**: In-panel `<mark>` preview showing the exact official rule or documentation quote without leaving the editor.
   * **1-Click "Open in Browser ↗"**: External launch straight to the official Playwright documentation anchor or discussion thread.
   * **Clear Citations**: Clean reset for new generation sessions.
3. **TypeScript & Playwright Guardrail**:
   * Strictly tuned for TypeScript + Playwright test engineering. Out-of-scope requests are intercepted and rejected cleanly.
4. **Zero-Config Instant Demo Mode**:
   * Ready to run out of the box without requiring an API key.
   * Also supports live LLM API keys (OpenAI / Anthropic / Gemini).

---

## 🚀 How to Run the Extension

1. Open this workspace in VS Code:
   ```bash
   code /Users/kareemyoussef/Desktop/clearcode
   ```
2. Press **`F5`** (or go to **Run and Debug** in the sidebar and click **Run ClearCode Extension**).
3. A new window titled **`[Extension Development Host]`** will open.
4. In that host window:
   * Open [tests/sample-login.spec.ts](file:///Users/kareemyoussef/Desktop/clearcode/tests/sample-login.spec.ts) (or create any `.ts` file).
   * Place your cursor inside the test function.
   * Click the **ClearCode AI** icon in the sidebar (or press `Cmd+Shift+P` and run `ClearCode: Generate Playwright Test with Live Citations`).
   * Click **`▶ Start Playwright Test Demo`** (or enter a scenario).
5. Watch the code stream line-by-line into the active editor while the right panel populates with live micro-decision cards, highlighted Playwright documentation citations, and linkouts!

---

## 🛠 Configuration
Under VS Code Settings (`settings.json`):
* `clearcode.provider`: `"demo"` (default) | `"openai"` | `"anthropic"` | `"gemini"`
* `clearcode.apiKey`: Your API Key (or set via `Cmd+Shift+P` -> `ClearCode: Set LLM API Key`)
* `clearcode.model`: `"gpt-4o"` (default)

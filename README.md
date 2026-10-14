# ClearCode AI

ClearCode AI is a VS Code extension that streams generated code line-by-line into the active editor while concurrently populating a right-hand Webview panel with documentation citations, highlighted excerpts, and micro-decision rationales for that generation session.

The extension is currently scoped to TypeScript and Playwright test suites.

## Problem Statement

Standard AI code generation inserts blocks of code without conveying the underlying API choices, version constraints, or official documentation rationale. Developers often accept code without understanding subtle anti-patterns (such as hardcoded sleep intervals instead of auto-retrying locator assertions) or spend time manually cross-referencing documentation.

ClearCode AI uses a decision-first streaming protocol:
1. For each step, the model identifies the architectural decision and documentation citation first.
2. The code line is emitted conditional on that decision.
3. The editor receives the code chunk and updates line ranges while the side panel renders the corresponding rationale card and source links.

## Architecture

```
[Prompt Layer] -> [Single-Call LLM Stream (Gemini / OpenAI / Demo)]
                         |
                 (NDJSON Payloads)
                         |
         +---------------+---------------+
         |                               |
         v                               v
[Editor Writer]                 [Webview Provider]
Inserts code line-by-line        Renders collapsible cards:
into active vscode.TextEditor    - Micro-decision rationale
Tracks 1-indexed line numbers    - Highlighted quote excerpt
                                 - Direct documentation linkout
```

### Components

- `src/providers/clearCodeViewProvider.ts`: WebviewViewProvider for the auxiliary sidebar panel. Manages the session lifecycle, accordion cards, highlighted excerpt views, and browser linkouts.
- `src/engine/streamEngine.ts`: Central coordinator. Handles line tracking, AbortController cancellation, editor insertion, and status bar state.
- `src/engine/llmClient.ts`: Single-stream client supporting Gemini (`gemini-3.8-flash`), OpenAI, or an offline reference manifest. Enforces scope validation.
- `src/manifest/playwrightManifest.ts`: Index of Playwright best-practice citations (navigation lifecycle, user-visible locators, auto-retrying assertions, actionability checks).

## Setup & Running Locally

### Prerequisites

- Node.js 18+
- VS Code 1.90.0+

### Installation

1. Clone repository and install dependencies:
   ```bash
   git clone https://github.com/Kareem21/clearcode-ai.git
   cd clearcode-ai
   npm install
   ```

2. Configure environment:
   Copy `.env.example` to `.env` and set your API key:
   ```bash
   cp .env.example .env
   ```
   Add your Gemini or OpenAI API key:
   ```env
   GEMINI_API_KEY=your_key_here
   CLEARCODE_PROVIDER=gemini
   CLEARCODE_MODEL=gemini-3.8-flash
   ```

3. Build:
   ```bash
   npm run compile
   ```

### Debugging

1. Open the project folder in VS Code.
2. Press `F5` to start the Extension Development Host.
3. In the development host window:
   - Open `tests/sample-login.spec.ts` (or any TypeScript file).
   - Click the ClearCode AI icon in the sidebar (or run `ClearCode: Generate Playwright Test with Live Citations` from the Command Palette).
   - Enter your prompt or click the demo trigger.
   - Code streams into the editor and cards populate the right panel.

## Configuration Options

Settings can be customized in VS Code `settings.json`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `clearcode.provider` | string | `"gemini"` | Provider: `"gemini"`, `"openai"`, or `"demo"` |
| `clearcode.model` | string | `"gemini-3.8-flash"` | Model identifier |
| `clearcode.apiKey` | string | `""` | API key (can also be provided via `.env` or Command Palette) |

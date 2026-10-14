# ClearCode AI

ClearCode AI is an open-source Visual Studio Code extension designed to eliminate AI comprehension debt and black-box code generation. While standard AI coding assistants stream code directly into the editor as opaque text blocks, ClearCode AI uses a decision-first causal streaming protocol. For each step of code generated, the system produces the architectural rationale and documentation citations before the code is inserted, synchronizing line-by-line editor insertion with real-time micro-decision cards in a dedicated sidebar and an in-depth inspection view in the main editor.

The extension is currently optimized for TypeScript and Playwright end-to-end test engineering, with architectural extensibility to general software engineering workflows.

---

## Table of Contents

1. Problem Statement and Philosophy
2. System Architecture
3. Codebase Structure and Module Directory
4. Core Subsystems
   - Causal Decision-First Streaming Engine
   - Dual-Track Source Verification Subsystem
   - Editor Writer and Line-Range Synchronizer
   - Webview Provider (Sidebar Interface)
   - Inspection Panel (Middle Editor Full-Width Modal)
   - Large Language Model Client and Stream Parser
5. Data Flow and Inter-Process Communication (IPC)
6. Security and Configuration
7. Local Development and Build Instructions
8. Troubleshooting and Operational Notes

---

## 1. Problem Statement and Philosophy

### The AI Comprehension Debt Problem

Modern large language models generate syntactically plausible code at high velocity. However, this creates a compounding comprehension deficit for software engineers:
- Opaque Code Emission: Code blocks are inserted without explaining the underlying architectural trade-offs, configuration assumptions, or specific API design patterns chosen.
- Post-Hoc Confabulation: When asked to explain previously generated code, models confabulate rationales after the fact, inventing plausible-sounding explanations that do not reflect why specific constructs were selected.
- Unverified Paraphrasing and Outdated Sources: Models frequently paraphrase documentation or cite forum threads that have evolved or become obsolete, leading developers to trust invalid patterns (for example, using arbitrary sleep timeouts instead of auto-retrying web-first locator assertions).

### ClearCode AI Design Principles

1. Decision-First Causal Streaming: The model must output the decision title, rationale, and cited source before emitting the code block. This forces the model to condition code generation on verified architectural rules rather than rationalizing code after outputting it.
2. Radical Source Transparency: ClearCode AI draws a strict distinction between verified canonical documentation (guaranteed verbatim quotes from official specifications) and internal model memory patterns. When a pattern cannot be verified against canonical docs, the UI explicitly flags it as unverified model knowledge rather than confabulating a false citation.
3. Dual-View Inspection: High-level overview cards remain non-intrusive in the auxiliary sidebar, while an in-depth inspection modal can be opened in the main editor pane to inspect code snippets, highlighted quotes, and direct browser links.
4. Per-Generation Lifecycle: Every generation session starts fresh. When a user submits a new prompt or clears citations, previous session data is reset to ensure citations strictly reflect active editor modifications.

---

## 2. System Architecture

The following diagram illustrates the unidirectional data flow from prompt input to editor and webview synchronization:

```
+-----------------------------------------------------------------------+
|                             User Prompt                               |
|        (Sidebar Webview Input or VS Code Command Palette)             |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                          StreamEngine                                 |
|   - Initializes generation session and AbortController                |
|   - Reads active editor context (file name, existing code)            |
|   - Dispatches session lifecycle messages to UI                       |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                           LLMClient                                   |
|   - Evaluates scope validation                                        |
|   - Issues streaming SSE request (Gemini Flash / OpenAI / Demo)       |
|   - Parses brace-balanced JSON objects incrementally                  |
+-----------------------------------------------------------------------+
                                    |
               StreamStepPayload (Title, Rationale, Citations, Code)
                                    |
            +-----------------------+-----------------------+
            |                                               |
            v                                               v
+-----------------------+                       +-----------------------+
|     EditorWriter      |                       |    SourceVerifier     |
| - Inserts code chunk  |                       | - Validates citation  |
|   into active editor  |                       |   against canonical   |
| - Computes exact      |                       |   documentation index |
|   1-indexed line range|                       | - Assigns 'verified'  |
|   [StartLine, EndLine]|                       |   or 'unverified'     |
+-----------------------+                       +-----------------------+
            \                                               /
             \                                             /
              v                                           v
+-----------------------------------------------------------------------+
|                     MicroDecisionCard Constructed                     |
|    { id, stepNumber, title, lineRange, rationale, code, citations }   |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                     ClearCodeViewProvider (Sidebar)                   |
|   - Dispatches 'addCard' to Webview HTML/JS runtime                   |
|   - Renders collapsed-by-default card with status badges              |
|   - Listens for 'openInspectionPanel' messages                        |
+-----------------------------------------------------------------------+
                                    |
                     (On Click 'Inspect' Button)
                                    |
                                    v
+-----------------------------------------------------------------------+
|                     InspectionPanel (Middle Editor)                   |
|   - Opens webview in ViewColumn.One                                   |
|   - Renders full rationale, formatted code block,                     |
|     highlighted excerpt marks, and external browser linkouts          |
+-----------------------------------------------------------------------+
```

---

## 3. Codebase Structure and Module Directory

```
clearcode/
├── package.json                   # Extension manifest, contributes views, commands, and configs
├── tsconfig.json                  # TypeScript compiler configuration (ES2022, CommonJS, strict)
├── .env.example                   # Template for local environment variables
├── .gitignore                     # Git exclusions (node_modules, dist, .env, credentials)
├── README.md                      # Comprehensive technical architecture documentation
├── src/
│   ├── extension.ts               # Extension activation, command registration, and dependency wiring
│   ├── types.ts                   # Core TypeScript types, interfaces, and IPC message schemas
│   ├── engine/
│   │   ├── streamEngine.ts        # Central generation orchestrator and lifecycle manager
│   │   ├── editorWriter.ts        # Editor text insertion and 1-indexed line range calculator
│   │   └── llmClient.ts           # SSE streaming client, JSON parser, and env credential loader
│   ├── verification/
│   │   └── sourceVerifier.ts      # Canonical ground-truth index and source verification engine
│   ├── providers/
│   │   ├── clearCodeViewProvider.ts # Sidebar WebviewViewProvider and prompt input bridge
│   │   └── inspectionPanel.ts     # Middle editor full-width WebviewPanel for deep inspection
│   └── manifest/
│       └── playwrightManifest.ts  # Canonical Playwright offline reference suite
└── dist/                          # Compiled JavaScript artifacts (generated via npm run compile)
```

---

## 4. Core Subsystems

### 4.1 Causal Decision-First Streaming Engine (`src/engine/streamEngine.ts`)

The `StreamEngine` class is the central orchestrator that coordinates between the user, the active text editor, the language model stream, and the user interface providers.

Key Responsibilities:
- Active File Context: Inspects `vscode.window.activeTextEditor` to capture the target file name and existing code context, providing contextual grounding to the LLM prompt.
- Session Lifecycle Management: Enforces one active generation at a time. If a user triggers a new generation, any ongoing generation is cleanly aborted via `AbortController`.
- Editor and UI Synchronization: For each step yielded by the LLM stream, the engine:
  1. Writes the code chunk into the active editor via `EditorWriter` and receives the precise 1-indexed line numbers (`[startLine, endLine]`).
  2. Runs the step citations through `SourceVerifier` to assign formal verification status.
  3. Constructs a `MicroDecisionCard` and dispatches it immediately to `ClearCodeViewProvider`.
- Status Bar Integration: Controls a VS Code status bar item displaying real-time states: Ready, Streaming, Verified, Cancelled, or Error.

### 4.2 Dual-Track Source Verification Subsystem (`src/verification/sourceVerifier.ts`)

LLMs cannot reliably output verbatim quotes from memory; they frequently hallucinate or paraphrase passages. Furthermore, scraping live community threads at runtime is brittle due to Cloudflare anti-bot interstitials and mutable page contents.

To solve this, `SourceVerifier` implements a dual-track verification model:

1. Canonical Playwright Index (`CANONICAL_PLAYWRIGHT_DOCS`):
   - Contains curated, word-for-word extracts from official Microsoft Playwright documentation.
   - Covers critical Playwright APIs: `page.goto`, `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`, `page.locator`, `toBeVisible`, `toHaveURL`, `toHaveText`, `toHaveTitle`, `toBeChecked`, `toBeEnabled`, actionability checks (`fill`, `click`), authentication state storage (`storageState`), network interception (`page.route`), and test lifecycle hooks (`test.describe`, `beforeEach`).
   - If a step code or citation matches an indexed entry, `SourceVerifier` replaces any loose paraphrases with the exact verbatim excerpt and anchor URL, setting `verificationStatus = 'verified'`.

2. Honest Model Knowledge Fallback (`verificationStatus = 'unverified_model'`):
   - When a micro-decision relies on community patterns or internal LLM memory that cannot be verified against canonical specifications, the engine does not disguise it.
   - It assigns an explicit notice: "This micro-decision was generated from the AI model internal pre-training weights and could not be verified against official documentation specifications. Review this pattern according to your team code standards."
   - It provides a direct search link to GitHub issues and discussions so the user can review community findings safely.

### 4.3 Editor Writer and Line-Range Synchronizer (`src/engine/editorWriter.ts`)

The `EditorWriter` handles the precise physical insertion of code text into the active `vscode.TextEditor`.

Key Mechanisms:
- Cursor Anchoring: Detects whether the editor currently has a selection or cursor position. If at line 0 or empty, it appends cleanly to the end of the document.
- Line Calculations: Measures the exact start line and end line before and after insertion using `editor.edit(...)`, converting 0-indexed VS Code line structures into developer-friendly 1-indexed line numbers (e.g., `Lines 14-22`).
- Clean Formatting: Strips redundant wrapping artifacts and ensures proper newline spacing between streaming steps.

### 4.4 Webview Provider (Sidebar Interface) (`src/providers/clearCodeViewProvider.ts`)

Implements `vscode.WebviewViewProvider` to render the primary ClearCode sidebar panel in the VS Code Activity Bar.

UI Features:
- Session Header: Displays the active topic, a spinning animation during generation, and a Cancel button.
- Prompt Input Box: Located directly below the session controls, featuring an active file context pill (e.g., `Context: sample-login.spec.ts`), a multi-line auto-expanding textarea, keyboard shortcut hints (Ctrl+Enter / Cmd+Enter to generate), and a Generate button.
- Micro-Decision Cards: Rendered in an accordion layout (collapsed by default to prevent visual clutter). Each card displays the step number, title, line range pill, and verification badges (`[Verified Docs]` in green or `[Model Knowledge]` in amber).
- Action Triggers: Includes an `Inspect` button on each card that sends an IPC message to open the full-width middle editor panel.
- Clear Current Citations: Resets the sidebar state to idle and clears all active cards.

### 4.5 Inspection Panel (`src/providers/inspectionPanel.ts`)

Because standard sidebar iframes cannot float over the middle editor, ClearCode AI uses `vscode.window.createWebviewPanel` to display a full-width inspection modal directly in `vscode.ViewColumn.One`.

Panel Contents:
- Header: Displays step number, title, line range, and a Close button.
- Architectural Rationale: Formatted description of why this specific code pattern was selected.
- Code Block: Highlighted code snippet corresponding to the active step.
- Verified vs Unverified Visual Treatment:
  - For Verified Citations: Displays a green badge `[Verified Official Docs]`, an official specification note, and the verbatim excerpt with `<mark>` highlight on key phrases, alongside an "Open Official Documentation" browser link.
  - For Unverified Model Knowledge: Displays an amber badge `[AI Model Knowledge]`, an honest verification notice explaining that the pattern originates from pre-training weights, and a "Search Discussions & Issues" linkout to GitHub.

### 4.6 Large Language Model Client and Stream Parser (`src/engine/llmClient.ts`)

The `LLMClient` coordinates communication with external AI providers:

- Multi-Provider Support: Supports Google Gemini (`gemini-3.8-flash`) via native Server-Sent Events (SSE) streaming, OpenAI chat completions, or an offline reference manifest.
- Single-Call Causal Prompting: Formats system and user prompts to require structured JSON outputs where decision attributes precede code emission.
- Resilient Brace-Balanced JSON Parser: Because LLM streaming chunks cut through arbitrary boundaries, `LLMClient` accumulates chunks and uses a character-by-character bracket-balancing parser to extract complete JSON step objects as soon as their closing brace `}` is received.
- Robust Environment Loading: Loads API keys from multiple tiers:
  1. VS Code settings (`clearcode.apiKey`)
  2. Local workspace `.env`
  3. User home directory `.clearcode_env` (`~/.clearcode_env`)
  4. System environment variables (`process.env.GEMINI_API_KEY`)

---

## 5. Data Flow and Inter-Process Communication (IPC)

The extension utilizes bidirectional message passing between the Node.js extension host and the Webview contexts.

### Webview to Extension Host (`WebviewToExtensionMessage`)

| Command | Payload | Description |
|---|---|---|
| `submitUserPrompt` | `{ prompt: string }` | Dispatched when the user submits a prompt from the sidebar input box. |
| `openInspectionPanel` | `{ card: MicroDecisionCard }` | Requests opening the middle editor inspection modal for the specified card. |
| `cancelGeneration` | None | Signals the extension host to abort the current `AbortController`. |
| `clearCitations` | None | Clears all current citations and resets session state. |
| `openExternal` | `{ url: string }` | Requests the host to open a URL in the user's default browser via `vscode.env.openExternal`. |
| `webviewReady` | None | Signals that the sidebar webview DOM has initialized and is ready to receive state. |

### Extension Host to Webview (`ExtensionToWebviewMessage`)

| Command | Payload | Description |
|---|---|---|
| `sessionStart` | `{ topic: string }` | Initializes a new generation session in the webview. |
| `addCard` | `{ card: MicroDecisionCard }` | Streams a newly verified micro-decision card into the sidebar container. |
| `updateActiveContext` | `{ fileName?: string }` | Updates the active file pill when the user switches active editor tabs. |
| `sessionComplete` | None | Informs the webview that generation finished successfully. |
| `sessionCancelled` | None | Informs the webview that generation was terminated by the user. |
| `sessionError` | `{ error: string }` | Displays an error notice if generation failed. |
| `clearView` | None | Resets the cards container back to the empty state. |

---

## 6. Security and Configuration

### API Key Protection

To protect API credentials from accidental leaks:
- The repository `.gitignore` explicitly ignores `.env`, `*.env`, and `out/`.
- Never commit hardcoded API keys to source files. The codebase reads keys exclusively via environment variables or VS Code settings.
- Developers can store credentials globally in `~/.clearcode_env` to avoid managing `.env` files across distinct workspaces:
  ```bash
  echo 'GEMINI_API_KEY="your-api-key-here"' > ~/.clearcode_env
  chmod 600 ~/.clearcode_env
  ```

### Content Security Policy (CSP)

All Webview contexts (`ClearCodeViewProvider` and `InspectionPanel`) enforce strict Content Security Policies:
- Script execution is restricted to local scripts signed with a cryptographically generated per-session `nonce`.
- External inline scripts are blocked (`script-src 'nonce-...'`).
- Default actions are locked (`default-src 'none'`).

---

## 7. Local Development and Build Instructions

### Prerequisites

- Node.js version 18.0.0 or higher
- npm version 9.0.0 or higher
- VS Code version 1.90.0 or higher

### Step-by-Step Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Kareem21/clearcode-ai.git
   cd clearcode-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your API key:
   Create a `.env` file in the project root (or set `~/.clearcode_env`):
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key
   CLEARCODE_PROVIDER=gemini
   CLEARCODE_MODEL=gemini-3.8-flash
   ```

4. Compile the TypeScript code:
   ```bash
   npm run compile
   ```
   For continuous compilation during development:
   ```bash
   npm run watch
   ```

5. Launch the Extension Development Host:
   - In VS Code, open the Run and Debug view (`Ctrl+Shift+D` or `Cmd+Shift+D`).
   - Select "Run ClearCode Extension" from the dropdown.
   - Press `F5` to open the Extension Development Host window.

6. Testing Extension Functionality:
   - In the Extension Development Host window, open any test file (e.g., `tests/sample-login.spec.ts`).
   - Open the ClearCode panel in the Primary Sidebar.
   - Enter a prompt in the input area (e.g., `Write a Playwright test for a user login form with username, password, and error handling`).
   - Observe code streaming into the editor with line-range synchronization and verified citation cards appearing in the sidebar.
   - Click "Inspect" on any card to view the middle editor inspection modal.

---

## 8. Troubleshooting and Operational Notes

- Active Editor Requirement: If code generation fails with an alert indicating that no active editor is open, open or focus a text editor tab before submitting your prompt.
- API Key Errors: If the status bar reports `[ClearCode] | Error`, ensure `GEMINI_API_KEY` is present in either `.env`, `~/.clearcode_env`, or the `clearcode.apiKey` setting in VS Code.
- Offline Demo Mode: To test the extension without an internet connection or API key, set `clearcode.provider` to `"demo"` in settings. The extension will stream from the built-in canonical Playwright manifest.
- Cloudflare Restrictions on Community Forums: ClearCode AI deliberately does not scrape live Stack Overflow or GitHub discussion URLs at runtime. Instead, it relies on its canonical index for verified documentation and flags all other patterns as model knowledge, providing safe outbound search links.

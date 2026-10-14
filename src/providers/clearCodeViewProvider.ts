import * as vscode from 'vscode';
import {
  ExtensionToWebviewMessage,
  GenerationSession,
  MicroDecisionCard,
  WebviewToExtensionMessage
} from '../types';

export class ClearCodeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'clearcode.citationsView';

  private _view?: vscode.WebviewView;
  private _currentSession?: GenerationSession;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _onCancelRequested: () => void,
    private readonly _onClearRequested: () => void,
    private readonly _onStartDemoRequested: (topic?: string) => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((data: WebviewToExtensionMessage) => {
      switch (data.command) {
        case 'cancelGeneration':
          this._onCancelRequested();
          break;
        case 'clearCitations':
          this._onClearRequested();
          break;
        case 'openExternal':
          if (data.url) {
            vscode.env.openExternal(vscode.Uri.parse(data.url));
          }
          break;
        case 'startDemoGeneration':
          this._onStartDemoRequested(data.topic);
          break;
        case 'webviewReady':
          if (this._currentSession) {
            this._view?.webview.postMessage({
              command: 'sessionStart',
              topic: this._currentSession.topic
            } as ExtensionToWebviewMessage);
            for (const card of this._currentSession.cards) {
              this._view?.webview.postMessage({
                command: 'addCard',
                card
              } as ExtensionToWebviewMessage);
            }
          }
          break;
      }
    });
  }

  public startSession(topic: string) {
    this._currentSession = {
      id: String(Date.now()),
      topic,
      isActive: true,
      cards: [],
      startedAt: Date.now()
    };

    this.postMessage({
      command: 'sessionStart',
      topic
    });
  }

  public addCard(card: MicroDecisionCard) {
    if (this._currentSession) {
      this._currentSession.cards.push(card);
    }
    this.postMessage({
      command: 'addCard',
      card
    });
  }

  public updateCard(cardId: string, updates: Partial<MicroDecisionCard>) {
    if (this._currentSession) {
      const idx = this._currentSession.cards.findIndex((c) => c.id === cardId);
      if (idx !== -1) {
        this._currentSession.cards[idx] = { ...this._currentSession.cards[idx], ...updates };
      }
    }
    this.postMessage({
      command: 'updateCard',
      cardId,
      updates
    });
  }

  public completeSession() {
    if (this._currentSession) {
      this._currentSession.isActive = false;
    }
    this.postMessage({
      command: 'sessionComplete'
    });
  }

  public cancelSession() {
    if (this._currentSession) {
      this._currentSession.isActive = false;
    }
    this.postMessage({
      command: 'sessionCancelled'
    });
  }

  public errorSession(error: string) {
    if (this._currentSession) {
      this._currentSession.isActive = false;
    }
    this.postMessage({
      command: 'sessionError',
      error
    });
  }

  public clearView() {
    this._currentSession = undefined;
    this.postMessage({
      command: 'clearView'
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    this._view?.webview.postMessage(message);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClearCode Citations</title>
  <style>
    :root {
      --bg-color: var(--vscode-sideBar-background, #18181b);
      --card-bg: var(--vscode-editor-background, #1e1e24);
      --card-border: var(--vscode-widget-border, #2d2d34);
      --card-active-border: #38bdf8;
      --text-main: var(--vscode-foreground, #e4e4e7);
      --text-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --accent-blue: #38bdf8;
      --accent-active: #0ea5e9;
      --btn-bg: var(--vscode-button-secondaryBackground, #27272a);
      --btn-hover: var(--vscode-button-secondaryHoverBackground, #3f3f46);
      --btn-text: var(--vscode-button-secondaryForeground, #ffffff);
      --highlight-bg: rgba(56, 189, 248, 0.28);
      --highlight-text: #7dd3fc;
      --modal-backdrop: rgba(0, 0, 0, 0.75);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      padding: 10px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      position: relative;
    }

    /* Header Section */
    .header-panel {
      flex-shrink: 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 10px;
    }

    .session-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .generating-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--accent-blue);
      font-weight: 500;
    }

    .blocks-pulse {
      display: inline-flex;
      gap: 3px;
    }

    .block-pip {
      width: 7px;
      height: 7px;
      background-color: var(--accent-blue);
      border-radius: 1px;
      animation: pulseBlock 1.2s infinite ease-in-out;
    }

    .block-pip:nth-child(2) { animation-delay: 0.2s; }
    .block-pip:nth-child(3) { animation-delay: 0.4s; }

    @keyframes pulseBlock {
      0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
      40% { opacity: 1; transform: scale(1.15); }
    }

    .btn {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--card-border);
      border-radius: 4px;
      background: var(--btn-bg);
      color: var(--btn-text);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn:hover {
      background: var(--btn-hover);
      border-color: var(--accent-blue);
    }

    .btn-cancel {
      background: #7f1d1d;
      color: #fecaca;
      border-color: #991b1b;
    }

    .btn-cancel:hover {
      background: #991b1b;
      border-color: #ef4444;
    }

    /* Cards Scroll Area */
    .cards-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 2px;
    }

    .cards-container::-webkit-scrollbar {
      width: 5px;
    }
    .cards-container::-webkit-scrollbar-thumb {
      background: var(--card-border);
      border-radius: 3px;
    }

    /* Compact Decision Card */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .card.active {
      border-color: var(--card-active-border);
      box-shadow: 0 0 0 1px var(--card-active-border), 0 2px 10px rgba(56, 189, 248, 0.15);
    }

    .card-header {
      padding: 9px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.02);
      gap: 6px;
    }

    .card-header:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .card-title-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow: hidden;
      flex: 1;
    }

    .card-title-text {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .pill-lines {
      font-size: 9.5px;
      color: var(--accent-blue);
      background: rgba(56, 189, 248, 0.12);
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 500;
    }

    .source-badge {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 1px 4px;
      border-radius: 2px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent-blue);
    }

    .badge-github { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
    .badge-stackoverflow { background: rgba(249, 115, 22, 0.2); color: #fb923c; }
    .badge-community { background: rgba(34, 197, 94, 0.2); color: #4ade80; }

    .card-actions-col {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .btn-inspect {
      padding: 2px 6px;
      font-size: 10px;
      background: rgba(56, 189, 248, 0.12);
      color: var(--accent-blue);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .btn-inspect:hover {
      background: rgba(56, 189, 248, 0.22);
      border-color: var(--accent-blue);
    }

    .chevron-icon {
      font-size: 10px;
      transition: transform 0.2s;
      color: var(--text-muted);
      padding: 2px;
    }

    .card.expanded .chevron-icon {
      transform: rotate(180deg);
    }

    /* Inline Collapsible Body (collapsed by default) */
    .card-body {
      display: none;
      padding: 10px;
      border-top: 1px solid var(--card-border);
      background: rgba(0, 0, 0, 0.2);
      flex-direction: column;
      gap: 10px;
    }

    .card.expanded .card-body {
      display: flex;
    }

    .rationale-text {
      color: var(--text-main);
      font-size: 11.5px;
      line-height: 1.45;
    }

    /* Citations in Card */
    .citations-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-top: 6px;
      border-top: 1px dashed var(--card-border);
    }

    .citations-heading {
      color: var(--accent-blue);
      font-size: 11px;
      font-weight: 600;
    }

    .citation-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .citation-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .citation-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-main);
    }

    .excerpt-callout {
      border-left: 2px solid var(--accent-blue);
      background: rgba(0, 0, 0, 0.35);
      padding: 6px 8px;
      font-size: 10.5px;
      line-height: 1.45;
      color: #e2e8f0;
      border-radius: 0 4px 4px 0;
    }

    .highlight-mark {
      background: var(--highlight-bg);
      color: var(--highlight-text);
      padding: 1px 2px;
      border-radius: 2px;
      font-weight: 600;
    }

    .linkout-row {
      display: flex;
      justify-content: flex-end;
    }

    .linkout-url {
      color: var(--accent-blue);
      font-size: 10.5px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    .linkout-url:hover {
      text-decoration: underline;
    }

    /* Modal Overlay */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: var(--modal-backdrop);
      backdrop-filter: blur(2px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
    }

    .modal-dialog {
      background: var(--card-bg);
      border: 1px solid var(--accent-blue);
      border-radius: 8px;
      width: 100%;
      max-width: 520px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
      overflow: hidden;
      animation: modalFadeIn 0.15s ease-out;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: rgba(255, 255, 255, 0.02);
    }

    .modal-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-close-modal {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }

    .btn-close-modal:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .modal-body {
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .modal-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--accent-blue);
      margin-bottom: 4px;
    }

    .modal-rationale-box {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 5px;
      padding: 10px;
    }

    .modal-code-block {
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--card-border);
      border-radius: 5px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: #93c5fd;
      white-space: pre-wrap;
      line-height: 1.45;
    }

    .modal-citation-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .modal-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--card-border);
      display: flex;
      justify-content: flex-end;
      background: rgba(0, 0, 0, 0.15);
    }

    /* Footer Action */
    .footer-panel {
      flex-shrink: 0;
      padding-top: 8px;
      border-top: 1px solid var(--card-border);
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .btn-clear {
      width: 100%;
      padding: 6px 0;
      background: var(--btn-bg);
      text-align: center;
    }

    /* Empty state */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 10px;
      color: var(--text-muted);
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="header-panel">
    <div id="sessionTitle" class="session-title">Active AI Generation: Idle</div>
    <div class="status-row">
      <div id="statusIndicator" class="generating-indicator" style="display: none;">
        <span>Generating...</span>
        <div class="blocks-pulse">
          <div class="block-pip"></div>
          <div class="block-pip"></div>
          <div class="block-pip"></div>
        </div>
      </div>
      <button id="cancelBtn" class="btn btn-cancel" style="display: none;">Cancel</button>
    </div>
  </div>

  <div id="cardsContainer" class="cards-container">
    <div id="emptyState" class="empty-state">
      <p>No active generation session.<br/>Trigger a generation to stream Playwright code and live citations.</p>
      <button id="startDemoBtn" class="btn" style="margin-top: 6px; border-color: var(--accent-blue);">Start Playwright Test Demo</button>
    </div>
  </div>

  <div class="footer-panel">
    <button id="clearBtn" class="btn btn-clear">Clear Current Citations</button>
  </div>

  <!-- Modal Popup Dialog -->
  <div id="modalBackdrop" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog">
      <div class="modal-header">
        <div id="modalTitle" class="modal-title">Inspection</div>
        <button id="modalCloseBtn" class="btn-close-modal" title="Close (Esc)">✕</button>
      </div>
      <div id="modalBody" class="modal-body">
        <!-- Injected via JavaScript -->
      </div>
      <div class="modal-footer">
        <button id="modalDoneBtn" class="btn">Close</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const sessionTitleEl = document.getElementById('sessionTitle');
    const statusIndicatorEl = document.getElementById('statusIndicator');
    const cancelBtn = document.getElementById('cancelBtn');
    const clearBtn = document.getElementById('clearBtn');
    const startDemoBtn = document.getElementById('startDemoBtn');
    const cardsContainer = document.getElementById('cardsContainer');
    const emptyState = document.getElementById('emptyState');

    const modalBackdrop = document.getElementById('modalBackdrop');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalDoneBtn = document.getElementById('modalDoneBtn');

    let currentCards = [];
    let isGenerating = false;

    // Modal controls
    modalCloseBtn.addEventListener('click', closeModal);
    modalDoneBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalBackdrop.style.display !== 'none') {
        closeModal();
      }
    });

    function openModal(card) {
      const linesText = card.lineRange ? 'Lines ' + card.lineRange[0] + '-' + card.lineRange[1] : '';
      modalTitle.innerHTML = \`
        <span>Step \${card.stepNumber}: \${escapeHtml(card.title)}</span>
        \${linesText ? '<span class="pill-lines">' + linesText + '</span>' : ''}
      \`;

      let citationsHtml = '';
      if (card.citations && card.citations.length > 0) {
        citationsHtml = card.citations.map((cit) => {
          const badgeClass = 'badge-' + cit.sourceType;
          const badgeLabel = cit.sourceType === 'official' ? 'Official Docs' :
                             cit.sourceType === 'github' ? 'GitHub Issue' :
                             cit.sourceType === 'stackoverflow' ? 'Stack Overflow' : 'Community';

          let excerpt = escapeHtml(cit.excerpt || '');
          if (cit.highlight) {
            const escapedHighlight = escapeHtml(cit.highlight);
            excerpt = excerpt.replace(escapedHighlight, '<mark class="highlight-mark">' + escapedHighlight + '</mark>');
          }

          return \`
            <div class="modal-citation-card">
              <div class="citation-header-row">
                <span class="source-badge \${badgeClass}">\${badgeLabel}</span>
                <span class="citation-name">\${escapeHtml(cit.sourceName || '')}</span>
              </div>
              <div class="excerpt-callout">\${excerpt}</div>
              <div class="linkout-row">
                <a class="linkout-url" data-url="\${escapeHtml(cit.url || '')}">
                  <span>\${escapeHtml(cit.url || '')}</span>
                  <span>↗</span>
                </a>
              </div>
            </div>
          \`;
        }).join('');
      } else {
        citationsHtml = '<div style="color:var(--text-muted);font-size:11px;">No external citations recorded for this step.</div>';
      }

      modalBody.innerHTML = \`
        <div>
          <div class="modal-section-label">Micro-Decision Rationale</div>
          <div class="modal-rationale-box">\${escapeHtml(card.rationale || '')}</div>
        </div>

        \${card.codeSnippet ? \`
          <div>
            <div class="modal-section-label">Generated Playwright Code</div>
            <pre class="modal-code-block">\${escapeHtml(card.codeSnippet)}</pre>
          </div>
        \` : ''}

        <div>
          <div class="modal-section-label">Verified Official Docs & Sources</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            \${citationsHtml}
          </div>
        </div>
      \`;

      // Wire external link clicks in modal
      modalBody.querySelectorAll('.linkout-url').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const url = link.getAttribute('data-url');
          if (url) {
            vscode.postMessage({ command: 'openExternal', url });
          }
        });
      });

      modalBackdrop.style.display = 'flex';
    }

    function closeModal() {
      modalBackdrop.style.display = 'none';
    }

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'cancelGeneration' });
    });

    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'clearCitations' });
    });

    startDemoBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'startDemoGeneration', topic: 'Playwright Auth & Form Submission' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'sessionStart':
          handleSessionStart(msg.topic);
          break;
        case 'addCard':
          handleAddCard(msg.card);
          break;
        case 'updateCard':
          handleUpdateCard(msg.cardId, msg.updates);
          break;
        case 'sessionComplete':
          handleSessionEnd(false);
          break;
        case 'sessionCancelled':
          handleSessionEnd(true, 'Generation cancelled');
          break;
        case 'sessionError':
          handleSessionEnd(true, 'Error: ' + msg.error);
          break;
        case 'clearView':
          handleClear();
          break;
      }
    });

    function handleSessionStart(topic) {
      isGenerating = true;
      currentCards = [];
      closeModal();
      sessionTitleEl.textContent = 'Active AI Generation: ' + topic;
      statusIndicatorEl.style.display = 'inline-flex';
      cancelBtn.style.display = 'inline-block';
      emptyState.style.display = 'none';
      cardsContainer.innerHTML = '';
    }

    function handleSessionEnd(wasInterrupted, statusText) {
      isGenerating = false;
      statusIndicatorEl.style.display = 'none';
      cancelBtn.style.display = 'none';
      if (statusText) {
        sessionTitleEl.textContent = statusText;
      }
      document.querySelectorAll('.card.active').forEach((el) => el.classList.remove('active'));
    }

    function handleClear() {
      isGenerating = false;
      currentCards = [];
      closeModal();
      sessionTitleEl.textContent = 'Active AI Generation: Idle';
      statusIndicatorEl.style.display = 'none';
      cancelBtn.style.display = 'none';
      cardsContainer.innerHTML = '';
      cardsContainer.appendChild(emptyState);
      emptyState.style.display = 'flex';
    }

    function handleAddCard(card) {
      emptyState.style.display = 'none';
      document.querySelectorAll('.card.active').forEach((el) => el.classList.remove('active'));

      currentCards.push(card);
      // Collapsed by default (card.isExpanded is false)
      const cardEl = renderCardElement(card, true);
      cardsContainer.appendChild(cardEl);
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function handleUpdateCard(cardId, updates) {
      const idx = currentCards.findIndex((c) => c.id === cardId);
      if (idx !== -1) {
        currentCards[idx] = { ...currentCards[idx], ...updates };
        const existingEl = document.getElementById('card-' + cardId);
        if (existingEl) {
          const newEl = renderCardElement(currentCards[idx], existingEl.classList.contains('active'));
          existingEl.replaceWith(newEl);
        }
      }
    }

    function renderCardElement(card, isActive) {
      const cardDiv = document.createElement('div');
      cardDiv.id = 'card-' + card.id;
      // ONLY expand if card.isExpanded === true (default is false)
      cardDiv.className = 'card' + (isActive ? ' active' : '') + (card.isExpanded ? ' expanded' : '');

      const linesText = card.lineRange ? 'Lines ' + card.lineRange[0] + '-' + card.lineRange[1] : '';
      const headerTitle = card.stepNumber + '. ' + card.title;

      // Source badges preview
      let sourceBadgesHtml = '';
      if (card.citations && card.citations.length > 0) {
        sourceBadgesHtml = card.citations.map((c) => {
          const badgeClass = 'badge-' + c.sourceType;
          const label = c.sourceType === 'official' ? 'Docs' :
                        c.sourceType === 'github' ? 'GitHub' :
                        c.sourceType === 'stackoverflow' ? 'SO' : 'Community';
          return \`<span class="source-badge \${badgeClass}">\${label}</span>\`;
        }).join('');
      }

      cardDiv.innerHTML = \`
        <div class="card-header">
          <div class="card-title-col">
            <div class="card-title-text">\${escapeHtml(headerTitle)}</div>
            <div class="card-meta-row">
              \${linesText ? '<span class="pill-lines">' + linesText + '</span>' : ''}
              \${sourceBadgesHtml}
            </div>
          </div>
          <div class="card-actions-col">
            <button class="btn-inspect" title="Open detailed inspection modal">Inspect ↗</button>
            <span class="chevron-icon">▼</span>
          </div>
        </div>
        <div class="card-body">
          <div class="rationale-text">\${escapeHtml(card.rationale || '')}</div>
          <div class="citations-section">
            <div class="citations-heading">Official Docs & Sources:</div>
            <div class="citations-list"></div>
          </div>
        </div>
      \`;

      // Header click: open modal when clicking inspect or title, or toggle inline accordion
      const inspectBtn = cardDiv.querySelector('.btn-inspect');
      inspectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(card);
      });

      const header = cardDiv.querySelector('.card-header');
      header.addEventListener('click', (e) => {
        // Toggle inline expansion on header click
        cardDiv.classList.toggle('expanded');
      });

      // Populate inline citations if any
      const citationsList = cardDiv.querySelector('.citations-list');
      if (card.citations && card.citations.length > 0) {
        card.citations.forEach((cit) => {
          citationsList.appendChild(renderInlineCitationItem(cit));
        });
      } else {
        citationsList.innerHTML = '<span style="color:var(--text-muted);font-size:10px;">No external citations.</span>';
      }

      return cardDiv;
    }

    function renderInlineCitationItem(cit) {
      const item = document.createElement('div');
      item.className = 'citation-item';

      const badgeClass = 'badge-' + cit.sourceType;
      const badgeLabel = cit.sourceType === 'official' ? 'Official Docs' :
                         cit.sourceType === 'github' ? 'GitHub' :
                         cit.sourceType === 'stackoverflow' ? 'Stack Overflow' : 'Community';

      let formattedExcerpt = escapeHtml(cit.excerpt || '');
      if (cit.highlight) {
        const escapedHighlight = escapeHtml(cit.highlight);
        formattedExcerpt = formattedExcerpt.replace(
          escapedHighlight,
          '<mark class="highlight-mark">' + escapedHighlight + '</mark>'
        );
      }

      item.innerHTML = \`
        <div class="citation-header-row">
          <span class="source-badge \${badgeClass}">\${badgeLabel}</span>
          <span class="citation-name">\${escapeHtml(cit.sourceName || '')}</span>
        </div>
        <div class="excerpt-callout">\${formattedExcerpt}</div>
        <div class="linkout-row">
          <a class="linkout-url">
            <span>\${escapeHtml((cit.url || '').replace(/^https?:\\/\\//, '').slice(0, 36))}...</span>
            <span>↗</span>
          </a>
        </div>
      \`;

      const linkout = item.querySelector('.linkout-url');
      linkout.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ command: 'openExternal', url: cit.url });
      });

      return item;
    }

    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    vscode.postMessage({ command: 'webviewReady' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

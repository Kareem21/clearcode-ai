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
      --bg-color: var(--vscode-sideBar-background, #1e1e1e);
      --card-bg: var(--vscode-editor-background, #18181b);
      --card-border: var(--vscode-widget-border, #27272a);
      --card-active-border: var(--vscode-focusBorder, #0078d4);
      --text-main: var(--vscode-foreground, #e4e4e7);
      --text-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --accent-blue: #38bdf8;
      --accent-active: #0ea5e9;
      --btn-bg: var(--vscode-button-secondaryBackground, #27272a);
      --btn-hover: var(--vscode-button-secondaryHoverBackground, #3f3f46);
      --btn-text: var(--vscode-button-secondaryForeground, #ffffff);
      --highlight-bg: rgba(56, 189, 248, 0.22);
      --highlight-text: #7dd3fc;
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

    /* Decision Card (sa.jpeg style) */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .card.active {
      border-color: var(--accent-active);
      box-shadow: 0 0 0 1px var(--accent-active), 0 2px 8px rgba(14, 165, 233, 0.15);
    }

    .card-header {
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.02);
      font-weight: 500;
      font-size: 11.5px;
    }

    .card-header:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .card-title-text {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chevron-icon {
      font-size: 10px;
      transition: transform 0.2s;
      color: var(--text-muted);
    }

    .card.expanded .chevron-icon {
      transform: rotate(180deg);
    }

    .card-body {
      display: none;
      padding: 10px;
      border-top: 1px solid var(--card-border);
      background: rgba(0, 0, 0, 0.15);
      flex-direction: column;
      gap: 8px;
    }

    .card.expanded .card-body {
      display: flex;
    }

    .rationale-text {
      color: var(--text-main);
      font-size: 11.5px;
      line-height: 1.45;
    }

    /* Citations Section */
    .citations-section {
      margin-top: 4px;
      padding-top: 6px;
      border-top: 1px dashed var(--card-border);
    }

    .citations-header {
      color: var(--accent-blue);
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .citation-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 6px 8px;
      margin-bottom: 6px;
    }

    .citation-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
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

    .citation-name {
      font-size: 10.5px;
      font-weight: 500;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .btn-toggle-excerpt {
      font-size: 9.5px;
      color: var(--accent-blue);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0 2px;
      text-decoration: underline;
    }

    .excerpt-box {
      margin-top: 6px;
      padding: 6px 8px;
      border-left: 2px solid var(--accent-blue);
      background: rgba(0, 0, 0, 0.35);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      color: #cbd5e1;
      border-radius: 0 3px 3px 0;
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .highlight-mark {
      background: var(--highlight-bg);
      color: var(--highlight-text);
      padding: 1px 2px;
      border-radius: 2px;
      font-weight: 600;
    }

    .citation-link-row {
      margin-top: 4px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }

    .linkout-url {
      color: var(--accent-blue);
      font-size: 10px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      cursor: pointer;
    }

    .linkout-url:hover {
      text-decoration: underline;
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

    .empty-icon {
      font-size: 24px;
      color: var(--accent-blue);
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
      <div class="empty-icon">⚡</div>
      <p>No active generation session.<br/>Trigger a generation to stream Playwright code and live citations.</p>
      <button id="startDemoBtn" class="btn" style="margin-top: 6px; border-color: var(--accent-blue);">▶ Start Playwright Test Demo</button>
    </div>
  </div>

  <div class="footer-panel">
    <button id="clearBtn" class="btn btn-clear">Clear Current Citations</button>
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

    let currentCards = [];
    let isGenerating = false;

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
      // Remove active pulse from cards
      document.querySelectorAll('.card.active').forEach((el) => el.classList.remove('active'));
    }

    function handleClear() {
      isGenerating = false;
      currentCards = [];
      sessionTitleEl.textContent = 'Active AI Generation: Idle';
      statusIndicatorEl.style.display = 'none';
      cancelBtn.style.display = 'none';
      cardsContainer.innerHTML = '';
      cardsContainer.appendChild(emptyState);
      emptyState.style.display = 'flex';
    }

    function handleAddCard(card) {
      emptyState.style.display = 'none';
      // deactivate previous active cards
      document.querySelectorAll('.card.active').forEach((el) => el.classList.remove('active'));

      currentCards.push(card);
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
      cardDiv.className = 'card' + (isActive ? ' active' : '') + ' expanded';

      const linesText = card.lineRange ? ' (Lines ' + card.lineRange[0] + '-' + card.lineRange[1] + ')' : '';
      const headerTitle = card.stepNumber + '. ' + card.title + linesText;

      cardDiv.innerHTML = \`
        <div class="card-header">
          <div class="card-title-text">\${escapeHtml(headerTitle)}</div>
          <span class="chevron-icon">▼</span>
        </div>
        <div class="card-body">
          <div class="rationale-text">\${escapeHtml(card.rationale)}</div>
          <div class="citations-section">
            <div class="citations-header">Official Docs & Sources:</div>
            <div class="citations-list"></div>
          </div>
        </div>
      \`;

      const header = cardDiv.querySelector('.card-header');
      header.addEventListener('click', () => {
        cardDiv.classList.toggle('expanded');
      });

      const citationsList = cardDiv.querySelector('.citations-list');
      if (card.citations && card.citations.length > 0) {
        card.citations.forEach((cit) => {
          citationsList.appendChild(renderCitationItem(cit));
        });
      } else {
        citationsList.innerHTML = '<span style="color:var(--text-muted);font-size:10px;">No external citations required.</span>';
      }

      return cardDiv;
    }

    function renderCitationItem(cit) {
      const item = document.createElement('div');
      item.className = 'citation-item';

      const badgeClass = 'badge-' + cit.sourceType;
      const badgeLabel = cit.sourceType === 'official' ? 'Official Docs' :
                         cit.sourceType === 'github' ? 'GitHub' :
                         cit.sourceType === 'stackoverflow' ? 'Stack Overflow' : 'Community';

      let formattedExcerpt = escapeHtml(cit.excerpt);
      if (cit.highlight) {
        const escapedHighlight = escapeHtml(cit.highlight);
        formattedExcerpt = formattedExcerpt.replace(
          escapedHighlight,
          '<mark class="highlight-mark">' + escapedHighlight + '</mark>'
        );
      }

      item.innerHTML = \`
        <div class="citation-title-row">
          <span class="source-badge \${badgeClass}">\${badgeLabel}</span>
          <span class="citation-name" title="\${escapeHtml(cit.sourceName)}">\${escapeHtml(cit.sourceName)}</span>
          <button class="btn-toggle-excerpt">expand</button>
        </div>
        <div class="excerpt-box" style="display: none;">\${formattedExcerpt}</div>
        <div class="citation-link-row">
          <a class="linkout-url" title="\${escapeHtml(cit.url)}">
            <span>\${escapeHtml(cit.url.replace(/^https?:\\/\\//, '').slice(0, 36))}...</span>
            <span>↗</span>
          </a>
        </div>
      \`;

      const toggleBtn = item.querySelector('.btn-toggle-excerpt');
      const excerptBox = item.querySelector('.excerpt-box');
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = excerptBox.style.display === 'none';
        excerptBox.style.display = isHidden ? 'block' : 'none';
        toggleBtn.textContent = isHidden ? 'collapse' : 'expand';
      });

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
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Notify extension host that webview is ready
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

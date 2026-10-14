import * as vscode from 'vscode';
import { MicroDecisionCard } from '../types';

export class InspectionPanel {
  public static currentPanel: InspectionPanel | undefined;
  public static readonly viewType = 'clearcode.inspectionModal';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, card: MicroDecisionCard) {
    // If we already have a panel, show it and update content
    if (InspectionPanel.currentPanel) {
      InspectionPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      InspectionPanel.currentPanel.update(card);
      return;
    }

    // Otherwise, create a new panel in the main middle editor pane (ViewColumn.One)
    const panel = vscode.window.createWebviewPanel(
      InspectionPanel.viewType,
      `Inspect: ${card.title}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    InspectionPanel.currentPanel = new InspectionPanel(panel, extensionUri, card);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    card: MicroDecisionCard
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this.update(card);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'close':
            this._panel.dispose();
            break;
          case 'openExternal':
            if (message.url) {
              vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public update(card: MicroDecisionCard) {
    this._panel.title = `Inspect: Step ${card.stepNumber}`;
    this._panel.webview.html = this._getHtmlForWebview(card);
  }

  public dispose() {
    InspectionPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(card: MicroDecisionCard): string {
    const linesText = card.lineRange ? `Lines ${card.lineRange[0]}–${card.lineRange[1]}` : '';

    let citationsHtml = '';
    if (card.citations && card.citations.length > 0) {
      citationsHtml = card.citations
        .map((cit) => {
          const isVerified = cit.verificationStatus === 'verified';
          const isUnverifiedModel = cit.verificationStatus === 'unverified_model';

          const statusBadge = isVerified
            ? '<span class="source-badge badge-verified">Verified Official Docs</span>'
            : isUnverifiedModel
            ? '<span class="source-badge badge-unverified">AI Model Knowledge</span>'
            : `<span class="source-badge badge-${cit.sourceType}">${
                cit.sourceType === 'official' ? 'Official Documentation' : 'Reference'
              }</span>`;

          const verificationNote = isVerified
            ? `<div class="verification-note verified">
                 <div class="verification-note-title">Verified Specification</div>
                 <div>Guaranteed verbatim extract from canonical official documentation.</div>
               </div>`
            : isUnverifiedModel
            ? `<div class="verification-note unverified">
                 <div class="verification-note-title">Source Verification Notice</div>
                 <div>This micro-decision pattern was generated from the AI model internal pre-training weights and does not correspond to an official indexed API specification. Review this pattern according to your project standards before merging.</div>
               </div>`
            : '';

          let excerpt = escapeHtml(cit.excerpt || '');
          if (cit.highlight) {
            const escapedHighlight = escapeHtml(cit.highlight);
            excerpt = excerpt.replace(
              escapedHighlight,
              `<mark class="highlight-mark">${escapedHighlight}</mark>`
            );
          }

          const linkoutText = isVerified
            ? 'Open Official Documentation ↗'
            : isUnverifiedModel
            ? 'Search Discussions & Issues ↗'
            : 'Open in Browser ↗';

          return `
            <div class="citation-card ${isVerified ? 'card-status-verified' : 'card-status-unverified'}">
              <div class="citation-top">
                ${statusBadge}
                <span class="citation-name">${escapeHtml(cit.sourceName || '')}</span>
              </div>
              ${verificationNote}
              <div class="excerpt-box ${isUnverifiedModel ? 'model-knowledge-box' : ''}">
                ${excerpt}
              </div>
              <div class="linkout-row">
                <button class="btn-linkout" data-url="${escapeHtml(cit.url || '')}">
                  <span>${linkoutText}</span>
                </button>
              </div>
            </div>
          `;
        })
        .join('');
    } else {
      citationsHtml = '<div class="no-citations">No external documentation references attached to this step.</div>';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspect Decision</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #18181b);
      --card-bg: rgba(255, 255, 255, 0.03);
      --border-color: var(--vscode-widget-border, #2d2d34);
      --text-main: var(--vscode-foreground, #e4e4e7);
      --text-muted: var(--vscode-descriptionForeground, #a1a1aa);
      --accent-blue: #38bdf8;
      --highlight-bg: rgba(56, 189, 248, 0.28);
      --highlight-text: #7dd3fc;
      --code-bg: rgba(0, 0, 0, 0.45);
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
      font-size: 13px;
      line-height: 1.6;
      padding: 24px 32px;
      display: flex;
      justify-content: center;
    }

    .modal-container {
      width: 100%;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Top Bar */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 16px;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .step-number {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--accent-blue);
      background: rgba(56, 189, 248, 0.12);
      padding: 3px 8px;
      border-radius: 4px;
    }

    .main-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-main);
    }

    .line-pill {
      font-size: 11px;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 7px;
      border-radius: 4px;
      font-family: monospace;
    }

    .btn-close {
      background: var(--vscode-button-secondaryBackground, #27272a);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--border-color);
      border-radius: 5px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }

    .btn-close:hover {
      background: var(--vscode-button-secondaryHoverBackground, #3f3f46);
    }

    /* Sections */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section-heading {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--accent-blue);
    }

    .rationale-text {
      font-size: 13.5px;
      line-height: 1.6;
      color: #f1f5f9;
    }

    /* Code Block */
    .code-container {
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px 14px;
      overflow-x: auto;
    }

    .code-block {
      font-family: var(--vscode-editor-font-family, 'Fira Code', Menlo, monospace);
      font-size: 12px;
      line-height: 1.5;
      color: #93c5fd;
      white-space: pre;
    }

    /* Citations */
    .citations-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .citation-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .citation-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .source-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent-blue);
    }

    .badge-github { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
    .badge-stackoverflow { background: rgba(249, 115, 22, 0.2); color: #fb923c; }
    .badge-community { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .badge-verified {
      background: rgba(34, 197, 94, 0.16);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.35);
    }
    .badge-unverified {
      background: rgba(245, 158, 11, 0.16);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }

    .card-status-verified {
      border-left: 3px solid #22c55e !important;
    }

    .card-status-unverified {
      border-left: 3px solid #f59e0b !important;
    }

    .verification-note {
      font-size: 11.5px;
      line-height: 1.5;
      padding: 8px 12px;
      border-radius: 4px;
    }

    .verification-note.verified {
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: #86efac;
    }

    .verification-note.unverified {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      color: #fde68a;
    }

    .verification-note-title {
      font-weight: 700;
      margin-bottom: 2px;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    }

    .model-knowledge-box {
      border-left-color: #f59e0b !important;
      background: rgba(245, 158, 11, 0.04) !important;
      font-style: italic;
    }

    .citation-name {
      font-size: 13px;
      font-weight: 600;
      color: #f8fafc;
    }

    .excerpt-box {
      border-left: 3px solid var(--accent-blue);
      background: rgba(0, 0, 0, 0.3);
      padding: 10px 14px;
      border-radius: 0 5px 5px 0;
      font-size: 12px;
      line-height: 1.55;
      color: #cbd5e1;
    }

    .highlight-mark {
      background: var(--highlight-bg);
      color: var(--highlight-text);
      padding: 1px 4px;
      border-radius: 2px;
      font-weight: 600;
    }

    .linkout-row {
      display: flex;
      justify-content: flex-end;
    }

    .btn-linkout {
      background: none;
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: var(--accent-blue);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-linkout:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent-blue);
    }

    .no-citations {
      color: var(--text-muted);
      font-size: 12px;
      padding: 10px 0;
    }
  </style>
</head>
<body>
  <div class="modal-container">
    <div class="top-bar">
      <div class="title-group">
        <span class="step-number">Step ${card.stepNumber}</span>
        <h1 class="main-title">${escapeHtml(card.title)}</h1>
        ${linesText ? `<span class="line-pill">${linesText}</span>` : ''}
      </div>
      <button id="closeBtn" class="btn-close" title="Close Inspection (Esc / Cmd+W)">✕ Close Inspection</button>
    </div>

    <div class="section-card">
      <div class="section-heading">Micro-Decision Rationale</div>
      <div class="rationale-text">${escapeHtml(card.rationale || '')}</div>
    </div>

    ${
      card.codeSnippet
        ? `
    <div class="section-card">
      <div class="section-heading">Generated Playwright Code</div>
      <div class="code-container">
        <pre class="code-block">${escapeHtml(card.codeSnippet)}</pre>
      </div>
    </div>`
        : ''
    }

    <div class="section-card">
      <div class="section-heading">Verified Official Documentation & Sources</div>
      <div class="citations-list">
        ${citationsHtml}
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('closeBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        vscode.postMessage({ command: 'close' });
      }
    });

    document.querySelectorAll('.btn-linkout').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (url) {
          vscode.postMessage({ command: 'openExternal', url });
        }
      });
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

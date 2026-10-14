import * as vscode from 'vscode';
import { ClearCodeViewProvider } from '../providers/clearCodeViewProvider';
import { MicroDecisionCard } from '../types';
import { EditorWriter } from './editorWriter';
import { LLMClient } from './llmClient';

export class StreamEngine {
  private _activeAbortController?: AbortController;
  private _isBusy = false;
  private _statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly _viewProvider: ClearCodeViewProvider,
    private readonly _editorWriter: EditorWriter,
    private readonly _llmClient: LLMClient
  ) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this._statusBarItem.text = '$(verified) [ClearCode] | Ready | Playwright (TS)';
    this._statusBarItem.show();
  }

  public get isBusy(): boolean {
    return this._isBusy;
  }

  public async startGeneration(userTopic?: string): Promise<void> {
    if (this._isBusy) {
      vscode.window.showWarningMessage('A generation session is already in progress.');
      return;
    }

    const topic = userTopic || await vscode.window.showInputBox({
      prompt: 'Enter Playwright test scenario to generate',
      placeHolder: 'e.g. User Authentication & Dashboard Verification',
      value: 'User Authentication & Dashboard Verification'
    });

    if (!topic) {
      return;
    }

    // Strict Scope Guard: Reject out-of-scope non-TypeScript / non-Playwright requests
    const scopeCheck = this._llmClient.isScopeAllowed(topic);
    if (!scopeCheck.allowed) {
      vscode.window.showErrorMessage(
        scopeCheck.reason || 'ClearCode AI is strictly tailored for TypeScript & Playwright.'
      );
      return;
    }

    this._isBusy = true;
    this._activeAbortController = new AbortController();
    const abortSignal = this._activeAbortController.signal;

    // Status bar update
    this._statusBarItem.text = `$(sync~spin) [ClearCode] | Generating & Verifying | Playwright`;
    this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    try {
      // 1. Focus or create target editor
      const editor = await this._editorWriter.ensureActiveEditor();

      // 2. Clear previous session & start new session in Webview (Per-generation lifecycle)
      this._viewProvider.startSession(topic);

      // 3. Stream each step sequentially
      for await (const step of this._llmClient.streamSteps(topic, abortSignal)) {
        if (abortSignal.aborted) {
          throw new Error('Cancelled');
        }

        // Stream code into editor & capture exact line range
        const lineRange = await this._editorWriter.streamCodeBlock(
          editor,
          step.code,
          abortSignal
        );

        // Build and dispatch decision card to webview (collapsed by default)
        const card: MicroDecisionCard = {
          id: `step-${step.stepNumber}-${Date.now()}`,
          stepNumber: step.stepNumber,
          title: step.title,
          lineRange,
          rationale: step.rationale,
          codeSnippet: step.code,
          citations: step.citations,
          isExpanded: false
        };

        this._viewProvider.addCard(card);
      }

      // 4. Finalize editor block
      await this._editorWriter.finalizeBlock(editor);
      this._viewProvider.completeSession();

      this._statusBarItem.text = `$(check) [ClearCode] | Verified | Playwright (TS)`;
      this._statusBarItem.backgroundColor = undefined;
      vscode.window.showInformationMessage('ClearCode AI: Playwright test generated with verified citations.');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (abortSignal.aborted || errorMsg.includes('cancel') || errorMsg.includes('Abort')) {
        this._viewProvider.cancelSession();
        this._statusBarItem.text = `$(x) [ClearCode] | Cancelled | Playwright`;
        vscode.window.showInformationMessage('Generation cancelled.');
      } else {
        this._viewProvider.errorSession(errorMsg);
        this._statusBarItem.text = `$(error) [ClearCode] | Error | Playwright`;
        vscode.window.showErrorMessage(`ClearCode Generation Error: ${errorMsg}`);
      }
      this._statusBarItem.backgroundColor = undefined;
    } finally {
      this._isBusy = false;
      this._activeAbortController = undefined;
      setTimeout(() => {
        this._statusBarItem.text = `$(verified) [ClearCode] | Ready | Playwright (TS)`;
      }, 5000);
    }
  }

  public cancelGeneration(): void {
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
  }

  public clearCitations(): void {
    if (this._isBusy) {
      this.cancelGeneration();
    }
    this._viewProvider.clearView();
    vscode.window.showInformationMessage('ClearCode AI: Citations cleared.');
  }

  public dispose(): void {
    this.cancelGeneration();
    this._statusBarItem.dispose();
  }
}

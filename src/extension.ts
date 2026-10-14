import * as vscode from 'vscode';
import { EditorWriter } from './engine/editorWriter';
import { LLMClient } from './engine/llmClient';
import { StreamEngine } from './engine/streamEngine';
import { ClearCodeViewProvider } from './providers/clearCodeViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const editorWriter = new EditorWriter();
  const llmClient = new LLMClient();

  // Forward declarations for view provider callbacks
  let streamEngine: StreamEngine;

  const viewProvider = new ClearCodeViewProvider(
    context.extensionUri,
    () => streamEngine?.cancelGeneration(),
    () => streamEngine?.clearCitations(),
    (topic?: string) => streamEngine?.startGeneration(topic)
  );

  streamEngine = new StreamEngine(viewProvider, editorWriter, llmClient);

  // Register Webview Provider in the right-hand container
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ClearCodeViewProvider.viewType,
      viewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('clearcode.generatePlaywright', async () => {
      await streamEngine.startGeneration();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clearcode.clearCitations', () => {
      streamEngine.clearCitations();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clearcode.cancelGeneration', () => {
      streamEngine.cancelGeneration();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clearcode.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your LLM API Key (OpenAI / Anthropic / Gemini)',
        password: true,
        placeHolder: 'sk-...'
      });
      if (key !== undefined) {
        await vscode.workspace
          .getConfiguration('clearcode')
          .update('apiKey', key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('ClearCode AI API Key updated.');
      }
    })
  );

  context.subscriptions.push({
    dispose: () => streamEngine.dispose()
  });
}

export function deactivate() {}

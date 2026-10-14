import * as vscode from 'vscode';

export class EditorWriter {
  /**
   * Ensures an active text editor is open and focused.
   * If no editor is open, creates a clean untitled TypeScript file.
   */
  public async ensureActiveEditor(): Promise<vscode.TextEditor> {
    if (vscode.window.activeTextEditor) {
      return vscode.window.activeTextEditor;
    }

    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: '// ClearCode AI: Generation Session\n\n'
    });
    return await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
  }

  /**
   * Appends or inserts code chunk at cursor position or end of file,
   * returning the exact 1-indexed line numbers [startLine, endLine] written.
   */
  public async streamCodeBlock(
    editor: vscode.TextEditor,
    code: string,
    abortSignal: AbortSignal
  ): Promise<[number, number]> {
    if (abortSignal.aborted) {
      throw new Error('Aborted');
    }

    const doc = editor.document;
    const currentPosition = editor.selection.active;
    const startLineNumber = currentPosition.line + 1; // 1-indexed

    // Normalize: ensure chunk ends with newline if not already
    const codeWithNewline = code.endsWith('\n') ? code : code + '\n';

    // Write code into editor
    const success = await editor.edit((editBuilder) => {
      editBuilder.insert(currentPosition, codeWithNewline);
    });

    if (!success) {
      throw new Error('Failed to insert code into active editor');
    }

    // Calculate line count added
    const linesAdded = codeWithNewline.split('\n').length - 1;
    const endLineNumber = Math.max(startLineNumber, startLineNumber + linesAdded - 1);

    // Reveal the written text in the editor smoothly
    const newPosition = doc.positionAt(doc.offsetAt(currentPosition) + codeWithNewline.length);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
      new vscode.Range(newPosition, newPosition),
      vscode.TextEditorRevealType.Default
    );

    return [startLineNumber, endLineNumber];
  }

  /**
   * Finalizes generation by ensuring trailing newline.
   */
  public async finalizeBlock(editor: vscode.TextEditor): Promise<void> {
    const currentPosition = editor.selection.active;
    const doc = editor.document;
    const lineText = doc.lineAt(currentPosition.line).text;
    if (lineText.trim().length > 0) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(currentPosition, '\n');
      });
    }
  }
}

import * as vscode from 'vscode';

export class EditorWriter {
  private _lastTargetDocUri?: vscode.Uri;
  private _currentWritePosition?: vscode.Position;

  /**
   * Ensures an active text editor is open and focused.
   * If no editor is open, creates a clean untitled TypeScript file.
   */
  public async ensureActiveEditor(): Promise<vscode.TextEditor> {
    if (vscode.window.activeTextEditor && !vscode.window.activeTextEditor.document.isClosed) {
      this._lastTargetDocUri = vscode.window.activeTextEditor.document.uri;
      this._currentWritePosition = vscode.window.activeTextEditor.selection.active;
      return vscode.window.activeTextEditor;
    }

    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: '// ClearCode AI: Generation Session\n\n'
    });
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false
    });
    this._lastTargetDocUri = doc.uri;
    this._currentWritePosition = new vscode.Position(2, 0);
    return editor;
  }

  /**
   * Resolves a valid TextDocument and visible TextEditor for the target session.
   * If the editor was closed, hidden, or replaced by another tab, re-resolves or re-opens it.
   */
  public async resolveEditorAndDoc(
    providedEditor?: vscode.TextEditor
  ): Promise<{ editor?: vscode.TextEditor; doc: vscode.TextDocument }> {
    let doc: vscode.TextDocument | undefined;

    if (providedEditor && !providedEditor.document.isClosed) {
      doc = providedEditor.document;
    } else if (this._lastTargetDocUri) {
      doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === this._lastTargetDocUri!.toString() && !d.isClosed
      );
      if (!doc) {
        try {
          doc = await vscode.workspace.openTextDocument(this._lastTargetDocUri);
        } catch {
          // Document could not be reopened; fallback to active or new document
        }
      }
    }

    if (!doc && vscode.window.activeTextEditor && !vscode.window.activeTextEditor.document.isClosed) {
      doc = vscode.window.activeTextEditor.document;
    }

    if (!doc) {
      doc = await vscode.workspace.openTextDocument({
        language: 'typescript',
        content: '// ClearCode AI: Generation Session\n\n'
      });
    }

    this._lastTargetDocUri = doc.uri;

    // Check if an editor for this document is visible
    let visibleEditor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === doc!.uri.toString()
    );

    // If not visible (e.g. replaced by inspection panel or closed tab), show it without stealing focus
    if (!visibleEditor) {
      try {
        visibleEditor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true
        });
      } catch {
        // Fallback continues with document buffer
      }
    }

    return { editor: visibleEditor, doc };
  }

  /**
   * Appends or inserts code chunk into the document,
   * returning the exact 1-indexed line numbers [startLine, endLine] written.
   * Uses WorkspaceEdit so it is immune to "TextEditor#edit not possible on closed editors".
   */
  public async streamCodeBlock(
    editor: vscode.TextEditor,
    code: string,
    abortSignal: AbortSignal
  ): Promise<[number, number]> {
    if (abortSignal.aborted) {
      throw new Error('Aborted');
    }

    // Always resolve the live document and editor state
    const { editor: currentEditor, doc } = await this.resolveEditorAndDoc(editor);

    // Determine insertion position
    let insertPosition: vscode.Position;
    if (this._currentWritePosition && this._currentWritePosition.line <= doc.lineCount) {
      insertPosition = this._currentWritePosition;
    } else if (currentEditor && !currentEditor.document.isClosed) {
      insertPosition = currentEditor.selection.active;
    } else {
      const lastLine = doc.lineCount > 0 ? doc.lineCount - 1 : 0;
      insertPosition = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);
    }

    const startLineNumber = insertPosition.line + 1; // 1-indexed

    // Normalize: ensure chunk ends with newline if not already
    const codeWithNewline = code.endsWith('\n') ? code : code + '\n';

    // Apply edit via WorkspaceEdit (operates directly on TextDocument buffer)
    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.insert(doc.uri, insertPosition, codeWithNewline);
    const success = await vscode.workspace.applyEdit(wsEdit);

    if (!success) {
      // Fallback attempt with direct editor.edit if available
      if (currentEditor && !currentEditor.document.isClosed) {
        await currentEditor.edit((builder) => {
          builder.insert(insertPosition, codeWithNewline);
        });
      } else {
        throw new Error('Failed to apply edit to document buffer');
      }
    }

    // Calculate line count added
    const linesAdded = codeWithNewline.split('\n').length - 1;
    const endLineNumber = Math.max(startLineNumber, startLineNumber + linesAdded - 1);

    // Update tracked position for next sequential chunk
    const nextOffset = doc.offsetAt(insertPosition) + codeWithNewline.length;
    const newPosition = doc.positionAt(nextOffset);
    this._currentWritePosition = newPosition;

    // If editor is visible, update cursor and scroll view smoothly
    if (currentEditor && !currentEditor.document.isClosed) {
      try {
        currentEditor.selection = new vscode.Selection(newPosition, newPosition);
        currentEditor.revealRange(
          new vscode.Range(newPosition, newPosition),
          vscode.TextEditorRevealType.Default
        );
      } catch {
        // Non-critical UI update
      }
    }

    return [startLineNumber, endLineNumber];
  }

  /**
   * Finalizes generation by ensuring trailing newline.
   */
  public async finalizeBlock(editor: vscode.TextEditor): Promise<void> {
    try {
      const { editor: currentEditor, doc } = await this.resolveEditorAndDoc(editor);
      const position =
        this._currentWritePosition ||
        (currentEditor && !currentEditor.document.isClosed
          ? currentEditor.selection.active
          : new vscode.Position(Math.max(0, doc.lineCount - 1), 0));

      if (position.line < doc.lineCount) {
        const lineText = doc.lineAt(position.line).text;
        if (lineText.trim().length > 0) {
          const wsEdit = new vscode.WorkspaceEdit();
          wsEdit.insert(doc.uri, position, '\n');
          await vscode.workspace.applyEdit(wsEdit);
        }
      }
    } catch {
      // Finalize newline is non-fatal
    } finally {
      this._currentWritePosition = undefined;
    }
  }
}

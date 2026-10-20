import * as path from 'node:path';
import * as vscode from 'vscode';

const INCLUDE_RE = /^@include\s+(["'])(.+?)\1/;

class IncludeLinkProvider implements vscode.DocumentLinkProvider {
    async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
        const candidates: { range: vscode.Range; uri: vscode.Uri }[] = [];
        const baseDir = path.dirname(document.uri.fsPath);
        for (let line = 0; line < document.lineCount; line++) {
            const text = document.lineAt(line).text;
            const match = INCLUDE_RE.exec(text);
            const quote = match?.[1];
            const target = match?.[2];
            if (!match || !quote || !target) {
                continue;
            }
            const start = match.index + match[0].indexOf(quote) + 1;
            const range = new vscode.Range(line, start, line, start + target.length);
            const uri = vscode.Uri.file(path.resolve(baseDir, target));
            candidates.push({ range, uri });
        }
        const exists = await Promise.all(candidates.map(({ uri }) => isFile(uri)));
        return candidates
            .filter((_, i) => exists[i])
            .map(({ range, uri }) => new vscode.DocumentLink(range, uri));
    }
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider({ language: 'pegen' }, new IncludeLinkProvider())
    );
}

export function deactivate(): void {}

import * as path from 'node:path';
import * as vscode from 'vscode';
import { type Name, scanText } from './scanner.js';

const INCLUDE_RE = /^@include\s+(["'])(.+?)\1/;

export interface Include {
    range: vscode.Range;
    uri: vscode.Uri;
}

export interface GrammarFile {
    uri: vscode.Uri;
    names: Name[];
    includes: string[];
}

// Holding Cmd while hovering calls provideDefinition on every mouse move, so
// every .gram file in the workspace and every open grammar is scanned once up
// front and then rescanned only when it changes. A lookup never touches disk.
export class GrammarIndex {
    private readonly files = new Map<string, GrammarFile>();
    ready: Promise<void>;

    constructor() {
        this.ready = this.indexWorkspace();
    }

    rebuild(): void {
        this.files.clear();
        this.ready = this.indexWorkspace();
    }

    get(uri: vscode.Uri): GrammarFile | undefined {
        return this.files.get(uri.toString());
    }

    async updateDocument(document: vscode.TextDocument): Promise<void> {
        await this.set(document.uri, document.getText());
    }

    async updateFromDisk(uri: vscode.Uri): Promise<void> {
        let text: string | undefined;
        try {
            text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch {
            text = undefined;
        }
        // An open editor may have unsaved changes, which win over the file on disk.
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        text = open?.getText() ?? text;
        if (text === undefined) {
            this.files.delete(uri.toString());
        } else {
            await this.set(uri, text);
        }
    }

    // A grammar can be split over several files with @include, and a rule can be
    // used in a different file than the one that defines it. So we search every
    // file connected to this one through @include, in either direction.
    related(uri: vscode.Uri): GrammarFile[] {
        const edges = new Map<string, string[]>();
        const link = (from: string, to: string) => {
            edges.set(from, [...(edges.get(from) ?? []), to]);
        };
        for (const [key, file] of this.files) {
            for (const target of file.includes) {
                if (this.files.has(target)) {
                    link(key, target);
                    link(target, key);
                }
            }
        }

        const related = [uri.toString()];
        for (const key of related) {
            for (const next of edges.get(key) ?? []) {
                if (!related.includes(next)) {
                    related.push(next);
                }
            }
        }
        return related.flatMap((key) => this.files.get(key) ?? []);
    }

    private async indexWorkspace(): Promise<void> {
        const uris = await vscode.workspace.findFiles('**/*.gram');
        const open = vscode.workspace.textDocuments.filter((d) => d.languageId === 'pegen');
        await Promise.all([...uris.map((uri) => this.updateFromDisk(uri)), ...open.map((d) => this.updateDocument(d))]);
    }

    private async set(uri: vscode.Uri, text: string): Promise<void> {
        const includes = parseIncludes(text, uri).map((include) => include.uri);
        const previous = this.files.get(uri.toString())?.includes ?? [];
        this.files.set(uri.toString(), { uri, names: scanText(text), includes: includes.map(String) });
        // Included files can live outside the workspace, where findFiles doesn't look.
        // Only try new includes, so that one pointing at a missing file isn't read
        // again on every keystroke.
        const missing = includes.filter(
            (target) => !this.files.has(target.toString()) && !previous.includes(target.toString())
        );
        await Promise.all(missing.map((target) => this.updateFromDisk(target)));
    }
}

function parseIncludes(text: string, file: vscode.Uri): Include[] {
    const includes: Include[] = [];
    const baseDir = path.dirname(file.fsPath);
    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
        const match = INCLUDE_RE.exec(lines[line]!);
        const quote = match?.[1];
        const target = match?.[2];
        if (!match || !quote || !target) {
            continue;
        }
        const start = match.index + match[0].indexOf(quote) + 1;
        const range = new vscode.Range(line, start, line, start + target.length);
        const uri = vscode.Uri.file(path.resolve(baseDir, target));
        includes.push({ range, uri });
    }
    return includes;
}

export async function findIncludes(document: vscode.TextDocument): Promise<Include[]> {
    const candidates = parseIncludes(document.getText(), document.uri);
    const exists = await Promise.all(candidates.map(({ uri }) => isFile(uri)));
    return candidates.filter((_, i) => exists[i]);
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

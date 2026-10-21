import * as vscode from 'vscode';
import { findIncludes, GrammarIndex } from './grammarIndex.js';
import type { Name } from './scanner.js';

class IncludeLinkProvider implements vscode.DocumentLinkProvider {
    async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
        const includes = await findIncludes(document);
        return includes.map(({ range, uri }) => new vscode.DocumentLink(range, uri));
    }
}

class RuleProvider implements vscode.DefinitionProvider, vscode.ReferenceProvider {
    constructor(private readonly index: GrammarIndex) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        return this.findNames(document, position, (n) => n.isDefinition);
    }

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext
    ): Promise<vscode.Location[]> {
        return this.findNames(document, position, (n) => context.includeDeclaration || !n.isDefinition);
    }

    private async findNames(
        document: vscode.TextDocument,
        position: vscode.Position,
        predicate: (name: Name) => boolean
    ): Promise<vscode.Location[]> {
        await this.index.ready;
        if (!this.index.get(document.uri)) {
            await this.index.updateDocument(document);
        }
        const target = this.index.get(document.uri)?.names.find((n) => n.range.contains(position))?.name;
        if (!target) {
            return [];
        }
        const locations: vscode.Location[] = [];
        for (const file of this.index.related(document.uri)) {
            for (const n of file.names) {
                if (n.name === target && predicate(n)) {
                    locations.push(new vscode.Location(file.uri, n.range));
                }
            }
        }
        return locations;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const selector = { language: 'pegen' };
    const index = new GrammarIndex();
    const ruleProvider = new RuleProvider(index);
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(selector, new IncludeLinkProvider()),
        vscode.languages.registerDefinitionProvider(selector, ruleProvider),
        vscode.languages.registerReferenceProvider(selector, ruleProvider)
    );

    const updateFromDisk = (uri: vscode.Uri) => void index.updateFromDisk(uri);
    const updateDocument = (document: vscode.TextDocument) => {
        if (document.languageId === 'pegen') {
            void index.updateDocument(document);
        }
    };
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.gram');
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(updateFromDisk),
        watcher.onDidChange(updateFromDisk),
        watcher.onDidDelete(updateFromDisk),
        vscode.workspace.onDidOpenTextDocument(updateDocument),
        vscode.workspace.onDidChangeTextDocument((event) => updateDocument(event.document)),
        // Unsaved changes are discarded on close, so fall back to the file on disk.
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (index.get(document.uri)) {
                updateFromDisk(document.uri);
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => index.rebuild())
    );
}

export function deactivate(): void {}

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const fixtures = vscode.workspace.workspaceFolders![0]!.uri;
const tmp = vscode.Uri.joinPath(fixtures, 'tmp');

function open(file: string): Thenable<vscode.TextDocument> {
    return vscode.workspace.openTextDocument(vscode.Uri.joinPath(fixtures, file));
}

// The position of `word` in the first line that contains `line`, searching from
// where `line` starts.
function at(document: vscode.TextDocument, line: string, word: string): vscode.Position {
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const lineStart = text.indexOf(line);
        if (lineStart >= 0) {
            const wordStart = text.indexOf(word, lineStart);
            assert.ok(wordStart >= 0, `"${word}" not found in "${text}"`);
            return new vscode.Position(i, wordStart);
        }
    }
    assert.fail(`no line contains "${line}"`);
}

function show(locations: vscode.Location[]): string[] {
    return locations
        .map(({ uri, range: { start } }) => {
            return `${vscode.workspace.asRelativePath(uri, false)}:${start.line + 1}:${start.character + 1}`;
        })
        .sort();
}

async function definitions(document: vscode.TextDocument, position: vscode.Position): Promise<string[]> {
    return show(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', document.uri, position));
}

async function references(document: vscode.TextDocument, position: vscode.Position): Promise<string[]> {
    return show(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, position));
}

// File watcher and document change events arrive asynchronously, so retry
// until the index has caught up.
async function eventually(check: () => Promise<void>): Promise<void> {
    const deadline = Date.now() + 10000;
    for (;;) {
        try {
            return await check();
        } catch (error) {
            if (Date.now() > deadline) {
                throw error;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

suiteSetup(async () => {
    await vscode.extensions.getExtension('lysnikolaou.pegen-peg')!.activate();
});

suite('Go to Definition', () => {
    test('finds a rule defined in the same file', async () => {
        const main = await open('main.gram');
        assert.deepEqual(await definitions(main, at(main, 'start[', 'statements')), ['main.gram:9:1']);
    });

    test('finds a rule from its definition', async () => {
        const main = await open('main.gram');
        assert.deepEqual(await definitions(main, at(main, 'statements[', 'statements')), ['main.gram:9:1']);
    });

    test('finds a rule defined in an included file', async () => {
        const main = await open('main.gram');
        assert.deepEqual(await definitions(main, at(main, '| assignment', 'assignment')), [
            'lib/expressions.gram:3:1',
        ]);
    });

    test('finds a rule defined in a file that includes this one', async () => {
        const atoms = await open('lib/atoms.gram');
        assert.deepEqual(await definitions(atoms, at(atoms, 'a=expression', 'expression')), [
            'lib/expressions.gram:5:1',
        ]);
    });

    test('follows includes across several files', async () => {
        const main = await open('main.gram');
        assert.deepEqual(await definitions(main, at(main, "| atom ';'", 'atom')), ['lib/atoms.gram:1:1']);
    });

    test('does not mix up grammars that are not connected by includes', async () => {
        const main = await open('main.gram');
        const other = await open('other.gram');
        assert.deepEqual(await definitions(other, at(other, 'start:', 'statement')), ['other.gram:6:1']);
        assert.deepEqual(await definitions(main, at(main, 'a=statement+', 'statement')), ['main.gram:10:1']);
    });

    test('finds nothing for tokens', async () => {
        const main = await open('main.gram');
        assert.deepEqual(await definitions(main, at(main, 'e=expression', 'NEWLINE')), []);
    });

    test('finds nothing for words in comments, strings, actions and directives', async () => {
        const main = await open('main.gram');
        const expressions = await open('lib/expressions.gram');
        assert.deepEqual(await definitions(main, at(main, '# A grammar', 'statement')), []);
        assert.deepEqual(await definitions(main, at(main, 'static int', 'statement')), []);
        assert.deepEqual(await definitions(expressions, at(expressions, '"expression"', 'expression')), []);
        assert.deepEqual(await definitions(expressions, at(expressions, '_PyAST_Assign', 'b, ')), []);
    });
});

suite('Find All References', () => {
    test('finds every use of a rule across included files', async () => {
        const expressions = await open('lib/expressions.gram');
        assert.deepEqual(await references(expressions, at(expressions, 'expression[', 'expression')), [
            'lib/atoms.gram:3:13',
            'lib/expressions.gram:4:20',
            'lib/expressions.gram:5:1',
            'lib/expressions.gram:6:16',
            'lib/expressions.gram:9:25',
            'lib/expressions.gram:9:9',
            'main.gram:12:9',
        ]);
    });

    test('finds the same references from a use as from the definition', async () => {
        const atoms = await open('lib/atoms.gram');
        const expressions = await open('lib/expressions.gram');
        assert.deepEqual(
            await references(atoms, at(atoms, 'a=expression', 'expression')),
            await references(expressions, at(expressions, 'expression[', 'expression'))
        );
    });

    test('follows includes across several files', async () => {
        const atoms = await open('lib/atoms.gram');
        assert.deepEqual(await references(atoms, at(atoms, 'atom[', 'atom')), [
            'lib/atoms.gram:1:1',
            'lib/expressions.gram:6:7',
            'lib/expressions.gram:7:7',
            'main.gram:14:7',
        ]);
    });

    test('does not mix up grammars that are not connected by includes', async () => {
        const main = await open('main.gram');
        const other = await open('other.gram');
        assert.deepEqual(await references(main, at(main, 'start[', 'start')), ['main.gram:8:1']);
        assert.deepEqual(await references(other, at(other, 'statement:', 'statement')), [
            'other.gram:5:8',
            'other.gram:6:1',
        ]);
    });
});

suite('@include links', () => {
    test('links the path of an included file', async () => {
        const main = await open('main.gram');
        const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
            'vscode.executeLinkProvider',
            main.uri
        );
        assert.equal(links.length, 1);
        assert.equal(main.getText(links[0]!.range), 'lib/expressions.gram');
        assert.equal(links[0]!.target?.fsPath, vscode.Uri.joinPath(fixtures, 'lib/expressions.gram').fsPath);
    });

    test('does not link a file that does not exist', async () => {
        const other = await open('other.gram');
        const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
            'vscode.executeLinkProvider',
            other.uri
        );
        assert.deepEqual(links, []);
    });
});

suite('Keeping up with changes', () => {
    suiteTeardown(async () => {
        await vscode.workspace.fs.delete(tmp, { recursive: true, useTrash: false }).then(undefined, () => {});
    });

    test('uses unsaved changes', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'pegen',
            content: 'start: rule_a\nrule_a: NAME\n',
        });
        const name = vscode.workspace.asRelativePath(document.uri, false);
        assert.deepEqual(await definitions(document, new vscode.Position(0, 7)), [`${name}:2:1`]);

        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(1, 0), '\n\n');
        assert.ok(await vscode.workspace.applyEdit(edit));
        await eventually(async () => {
            assert.deepEqual(await definitions(document, new vscode.Position(0, 7)), [`${name}:4:1`]);
        });
    });

    test('picks up files created, changed and deleted on disk', async () => {
        const included = vscode.Uri.joinPath(tmp, 'included.gram');
        const write = (text: string) => vscode.workspace.fs.writeFile(included, new TextEncoder().encode(text));

        const main = vscode.Uri.joinPath(tmp, 'main.gram');
        await vscode.workspace.fs.writeFile(main, new TextEncoder().encode('@include "included.gram"\n\nstart: thing\n'));
        const document = await vscode.workspace.openTextDocument(main);
        const thing = at(document, 'start:', 'thing');
        assert.deepEqual(await definitions(document, thing), []);

        await write('thing: NAME\n');
        await eventually(async () => {
            assert.deepEqual(await definitions(document, thing), ['tmp/included.gram:1:1']);
        });

        await write('# moved down\nthing: NAME\n');
        await eventually(async () => {
            assert.deepEqual(await definitions(document, thing), ['tmp/included.gram:2:1']);
        });

        await vscode.workspace.fs.delete(included);
        await eventually(async () => {
            assert.deepEqual(await definitions(document, thing), []);
        });
    });
});

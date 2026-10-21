import * as vscode from 'vscode';

const IDENTIFIER_RE = /[A-Za-z_]\w*/y;
const RULE_DEFINITION_RE = /[A-Za-z_]\w*(?=[ \t]*[\[(:])/y;
const NAMED_ITEM_RE = /[A-Za-z_]\w*\s*(?:\[[^\]=]*\])?\s*=/y;

export interface Name {
    name: string;
    range: vscode.Range;
    isDefinition: boolean;
}

// Finds rule definitions and every identifier that could refer to a rule,
// skipping over comments, strings, actions, meta directives, rule return types
// and flags, and the names in named items (`a=expression`).
export function scanText(text: string): Name[] {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            lineStarts.push(i + 1);
        }
    }
    // Names are found in order, so the current line only ever moves forward.
    let line = 0;
    const positionAt = (offset: number) => {
        while ((lineStarts[line + 1] ?? Infinity) <= offset) {
            line++;
        }
        return new vscode.Position(line, offset - lineStarts[line]!);
    };

    const names: Name[] = [];
    const push = (start: number, end: number, isDefinition: boolean) => {
        names.push({ name: text.slice(start, end), range: new vscode.Range(positionAt(start), positionAt(end)), isDefinition });
    };

    let inMeta = false;
    let inRuleHeader = false;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const atLineStart = i === 0 || text[i - 1] === '\n';
        if (ch === '\n') {
            inMeta = false;
            i++;
        } else if (ch === '#') {
            i = skipLine(text, i);
        } else if (ch === "'" || ch === '"') {
            i = skipString(text, i);
        } else if (ch === '{') {
            i = skipAction(text, i);
        } else if (ch === '@' && atLineStart) {
            inMeta = true;
            i++;
        } else if (ch === ':' && inRuleHeader) {
            inRuleHeader = false;
            i++;
        } else if (inMeta || inRuleHeader) {
            i = matchEnd(IDENTIFIER_RE, text, i) ?? i + 1;
        } else {
            const definitionEnd = atLineStart ? matchEnd(RULE_DEFINITION_RE, text, i) : undefined;
            const namedItemEnd = matchEnd(NAMED_ITEM_RE, text, i);
            const identifierEnd = matchEnd(IDENTIFIER_RE, text, i);
            if (definitionEnd !== undefined) {
                push(i, definitionEnd, true);
                inRuleHeader = true;
                i = definitionEnd;
            } else if (namedItemEnd !== undefined) {
                i = namedItemEnd;
            } else if (identifierEnd !== undefined) {
                push(i, identifierEnd, false);
                i = identifierEnd;
            } else {
                i++;
            }
        }
    }
    return names;
}

function matchEnd(re: RegExp, text: string, start: number): number | undefined {
    re.lastIndex = start;
    const match = re.exec(text);
    return match ? start + match[0].length : undefined;
}

function skipLine(text: string, start: number): number {
    const end = text.indexOf('\n', start);
    return end < 0 ? text.length : end;
}

function skipString(text: string, start: number): number {
    const quote = text[start]!;
    const delimiter = text.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
    let i = start + delimiter.length;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
        } else if (text.startsWith(delimiter, i)) {
            return i + delimiter.length;
        } else if (delimiter.length === 1 && text[i] === '\n') {
            return i;
        } else {
            i++;
        }
    }
    return i;
}

function skipAction(text: string, start: number): number {
    let depth = 0;
    let i = start;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "'" || ch === '"') {
            i = skipString(text, i);
        } else if (text.startsWith('//', i)) {
            i = skipLine(text, i);
        } else if (text.startsWith('/*', i)) {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 2;
        } else {
            if (ch === '{') {
                depth++;
            } else if (ch === '}' && --depth === 0) {
                return i + 1;
            }
            i++;
        }
    }
    return i;
}

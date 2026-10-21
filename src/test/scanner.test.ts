import * as assert from 'node:assert/strict';
import { scanText } from '../scanner.js';

function names(text: string): string[] {
    return scanText(text).map((n) => `${n.isDefinition ? 'def' : 'ref'} ${n.name}`);
}

function ranges(text: string): string[] {
    return scanText(text).map(({ name, range: { start, end } }) => {
        return `${name} ${start.line}:${start.character}-${end.line}:${end.character}`;
    });
}

suite('scanText', () => {
    test('finds rule definitions and the rules they use', () => {
        assert.deepEqual(names('start: a b\na: NAME\n'), ['def start', 'ref a', 'ref b', 'def a', 'ref NAME']);
    });

    test('only treats names at the start of a line as definitions', () => {
        assert.deepEqual(names('rule:\n    | a\n    | b c\n'), ['def rule', 'ref a', 'ref b', 'ref c']);
    });

    test('a name at the start of a line not followed by a header is a reference', () => {
        assert.deepEqual(names('rule: a\nb\n'), ['def rule', 'ref a', 'ref b']);
    });

    test('skips return types', () => {
        assert.deepEqual(names('stmts[asdl_stmt_seq*]: a\n'), ['def stmts', 'ref a']);
        assert.deepEqual(names('names[frozenset[str]]: a\n'), ['def names', 'ref a']);
        assert.deepEqual(names("strs[dict['str', int]]: a\n"), ['def strs', 'ref a']);
    });

    test('skips flags', () => {
        assert.deepEqual(names('rule (memo): a\n'), ['def rule', 'ref a']);
        assert.deepEqual(names('rule[expr_ty] (memo, left_rec): a\n'), ['def rule', 'ref a']);
    });

    test('skips the names in named items', () => {
        assert.deepEqual(names('r: a=x b = y\n'), ['def r', 'ref x', 'ref y']);
    });

    test('skips the names and types in typed named items', () => {
        assert.deepEqual(names("r: a[expr_ty]=x b[asdl_expr_seq*]=','.y+\n"), ['def r', 'ref x', 'ref y']);
    });

    test('skips keywords and soft keywords', () => {
        assert.deepEqual(names(`r: 'if' x "match" y\n`), ['def r', 'ref x', 'ref y']);
    });

    test('handles escapes in strings', () => {
        assert.deepEqual(names(`r: 'a\\'b' x "c\\"d" y\n`), ['def r', 'ref x', 'ref y']);
    });

    test('ends an unterminated string at the end of its line', () => {
        assert.deepEqual(names("r: 'oops x\ns: y\n"), ['def r', 'def s', 'ref y']);
    });

    test('skips comments', () => {
        assert.deepEqual(names('# r: x\nr: y # z\n'), ['def r', 'ref y']);
    });

    test('skips meta directives', () => {
        const text = '@name parser\n@include "lib.gram"\n@trailer \'x\'\nr: y\n';
        assert.deepEqual(names(text), ['def r', 'ref y']);
    });

    test('skips triple-quoted directive blocks spanning several lines', () => {
        const text = '@subheader """\nstatic int r(void);\nr: x\n"""\nr: y\n';
        assert.deepEqual(names(text), ['def r', 'ref y']);
        assert.deepEqual(names("@header '''\nr: x\n'''\nr: y\n"), ['def r', 'ref y']);
    });

    test('skips actions', () => {
        assert.deepEqual(names('r: x { _PyAST_Name(x, Load, EXTRA) } y\n'), ['def r', 'ref x', 'ref y']);
    });

    test('skips actions with nested braces', () => {
        assert.deepEqual(names('r: x { if (a) { b; } else { c; } } y\n'), ['def r', 'ref x', 'ref y']);
    });

    test('skips actions spanning several lines', () => {
        const text = 'r: x {\n    a;\nb: c\n} y\ns: z\n';
        assert.deepEqual(names(text), ['def r', 'ref x', 'ref y', 'def s', 'ref z']);
    });

    test('ignores braces in strings and comments inside actions', () => {
        assert.deepEqual(names(`r: x { f("}", '{') } y\n`), ['def r', 'ref x', 'ref y']);
        assert.deepEqual(names('r: x { a; /* } */ b; // }\n } y\n'), ['def r', 'ref x', 'ref y']);
    });

    test('finds rules around every operator', () => {
        const text = "r: &a !b &&'(' ~ c? d* e+ ','.f+ (g | h) [i] $\n";
        assert.deepEqual(
            names(text),
            ['def r', 'ref a', 'ref b', 'ref c', 'ref d', 'ref e', 'ref f', 'ref g', 'ref h', 'ref i']
        );
    });

    test('reports the position of each name', () => {
        const text = 'start: a\n@subheader """\nx\n"""\na: { {\n} } b\n';
        assert.deepEqual(ranges(text), ['start 0:0-0:5', 'a 0:7-0:8', 'a 4:0-4:1', 'b 5:4-5:5']);
    });

    test('reports positions in files with CRLF line endings', () => {
        assert.deepEqual(ranges('a: b\r\nc: d\r\n'), ['a 0:0-0:1', 'b 0:3-0:4', 'c 1:0-1:1', 'd 1:3-1:4']);
    });

    test('handles an empty file', () => {
        assert.deepEqual(names(''), []);
    });
});

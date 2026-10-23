# Change Log

All notable changes to the "pegen-peg" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.4.0]

- Cmd/Ctrl+Click on the path in an `@include` directive opens the included file
- Go to Definition (Cmd/Ctrl+Click) and Find All References for rules, including rules
  defined in `@include`d files
- Require VS Code 1.74 or newer

## [0.3.0]

- Support the full grammar syntax used by CPython's `Grammar/python.gram`:
  - Meta directives (`@trailer`, `@include`, `@subheader`, ...) and triple-quoted strings
  - Double-quoted strings (soft keywords)
  - Nested and pointer return types (`[asdl_stmt_seq*]`, `[frozenset[str]]`) and multiple flags
  - Typed named items (`a[asdl_expr_seq*]=...`)
  - Forced tokens (`&&`), cut (`~`), gather (`s.e+`), quantifiers, `$` and grouping punctuation
  - Actions with nested braces and strings containing braces
- Fix token names (e.g. `NAME`, `NEWLINE`) only being partially highlighted

## [0.2.0]

- Add support for flags in rule definitions

## [0.1.0]

- Initial release


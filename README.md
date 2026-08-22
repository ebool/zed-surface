# Surface for Zed

[Surface](https://surface-ui.org/) template language support for
[Zed](https://zed.dev/). The extension recognizes `.sface` files and provides
Surface-aware parsing instead of treating them as plain HEEx.

## Features

- HTML tags, Surface components, slots, and Phoenix function components
- `{#if}`, `{#for}`, `{#case}`, subblock, and closing-block highlighting
- Open-ended Surface directives including `:for`, `:attrs`, `:props`, and
  `:on-*`
- Elixir syntax injection inside expressions and block conditions
- Bracket matching, automatic indentation, and document outline items
- Go-to-definition for assigns, local variables, function components, and
  functions referenced by external `.sface` templates
- Surface 0.12 representative corpus tests

## Requirements

Install Zed's Elixir extension as well. Surface parsing and navigation work
without it, but the contents of `{expression}` will not receive Elixir
highlighting.

Development extensions containing a language server are compiled to WebAssembly
by Zed. Install either Rust through `rustup`, or Homebrew's `rust-wasm` formula,
which includes the `wasm32-wasip2` target. Published-extension users do not need
Rust installed locally.

## Install as a development extension

1. Open Zed's command palette.
2. Run `zed: install dev extension`.
3. Select this repository (the directory containing `extension.toml`).
4. Reopen an `.sface` file.

If loading fails, inspect `zed: open log`. Grammar builds require WASI SDK; Zed
normally downloads it automatically, or you can point `WASI_SDK_PATH` at an
existing installation.

## Development and verification

The repository includes its grammar under `grammar/`. The extension manifest
pins a commit containing that generated parser and uses the grammar's `path`
field, so later extension-only changes cannot silently alter parsing.

```sh
./scripts/verify.sh
```

Pass additional `.sface` files to include them in the parse check:

```sh
./scripts/verify.sh path/to/template.sface
```

The language server itself has no npm dependencies. Run only its tests with:

```sh
node --test language-server/server.test.mjs
```

## Navigation

Use `Go to Definition` or Cmd-click an identifier in a `.sface` file. The first
version understands the following project patterns:

- `@name` to `attr`, `prop`, `data`, `slot`, `assign`, `assign_new`, or `stream`
- local variables such as `item` in `item <- @items` and `:let={item}`
- `<.function_component>` and functions called inside `{expressions}`
- `<Layouts.app>` and module components such as `<Card>`
- external templates connected to their owner module by `embed_sface`

When the same assign is declared for several functions in one module, the
server prefers the declaration closest to the helper generated for that
template. Navigation is intentionally lexical in this initial version; it does
not compile the Mix project or expand macros.

## Known limitations

- Completion, diagnostics, references, and rename are not implemented yet.
- Go-to-definition uses project source and common Surface/Phoenix conventions;
  dynamically generated definitions may not resolve.
- Elixir injection requires the separately installed Elixir extension.
- The grammar recognizes current component/directive forms broadly, but unusual
  project-specific macros should be added to the corpus before release.

## Publishing

Before publishing, verify the pinned grammar revision from a clean clone, then
submit the repository as the `surface` submodule in `zed-industries/extensions`.

## License

MIT

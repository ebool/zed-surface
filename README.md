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
- Surface 0.12 representative corpus tests

## Requirements

Install Zed's Elixir extension as well. Surface parsing works without it, but
the contents of `{expression}` will not receive Elixir highlighting.

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
field, so later extension-only changes cannot silently alter parsing. The
checked-in manifest currently uses this checkout's absolute `file://` URL so
the dev extension can build before a remote repository exists.

```sh
./scripts/verify.sh
```

Pass additional `.sface` files to include them in the parse check:

```sh
./scripts/verify.sh path/to/template.sface
```

## Known limitations

- This extension does not provide completion, diagnostics, or
  go-to-definition; those features require a Surface-aware language server.
- Elixir injection requires the separately installed Elixir extension.
- The grammar recognizes current component/directive forms broadly, but unusual
  project-specific macros should be added to the corpus before release.

## Publishing

Before publishing, create the public repository and replace the grammar
`repository` in `extension.toml` with its HTTPS URL. Keep the pinned revision
unchanged (or move it to another tested grammar-only commit), verify from a
clean clone, then submit the repository as the `surface` submodule in
`zed-industries/extensions`.

## License

MIT

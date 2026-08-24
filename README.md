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
- Route-aware assign navigation through Phoenix router `live_session` and
  `on_mount` hooks
- Owner-aware LiveView event navigation from `phx-*` values to `handle_event/3`,
  with reverse Find References support
- Surface 0.12 representative corpus tests

## Requirements

Install Zed's Elixir extension as well. Surface parsing and `.sface` navigation
work without it, but `{expression}` highlighting and reverse event navigation
from Elixir `handle_event/3` definitions require the Elixir language.

Development extensions containing a language server are compiled to WebAssembly
by Zed. Install either Rust through `rustup`, or Homebrew's `rust-wasm` formula,
which includes the `wasm32-wasip2` target. Published-extension users do not need
Rust installed locally.

The extension downloads the dependency-free JavaScript language server from the
matching GitHub Release on first use and runs it with Zed's managed Node.js
runtime. The language server is not embedded in the extension binary.

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

### Manual go-to-definition test

Open `examples/navigation/navigation_demo.sface` in Zed, then Command-click an
identifier (or run `editor: go to definition`). The fixture covers:

- `@id`, `@rest`, `@title`, and `@items` jumping to declarations in the owner
  Elixir module
- `format_label` and `<.badge>` jumping to local functions
- `<NavigationDemo.card>` jumping to the module component function
- `<:footer>` jumping to the `slot :footer` contract of its parent component
- `item.name` jumping to the `item <- @items` binding

The language server itself has no npm dependencies. Run only its tests with:

```sh
node --test language-server/server.test.mjs
```

### Manual LiveView event test

Open `examples/events/event_demo.sface` and Cmd-click the `delete` value. Both
matching `handle_event/3` clauses in `event_demo.ex` are definitions. Run Find
References on either handler event name to find the direct `.sface` event and
the `JS.push("delete")` call inside `event_button.ex`.

## Navigation

Use `Go to Definition` or Cmd-click an identifier in a `.sface` file. The first
version understands the following project patterns:

- `@name` to `prop`, `data`, `attr`, `assign`, `assign_new`, `update`, or
  `stream`, including positional, keyword-list, map, and piped assign calls
- LiveView assigns inherited from router `live_session` hooks, with `scope`
  aliases and module, tuple, or list-form `on_mount` declarations
- component attributes such as `flash=` to the `attr` or `prop` contract attached
  to the resolved component function
- named entries such as `<:footer>` to the `slot` contract attached to their
  nearest parent component
- local variables such as `item` in `item <- @items` and `:let={item}`
- `<.function_component>` and functions called inside `{expressions}`
- `<Layouts.app>` and module components such as `<Card>`
- external templates connected to their owner module by `embed_sface`
- built-in assigns inherited through `use Surface.LiveView`, resolved to the
  declaration in the installed Surface dependency
- static LiveView events in `.sface`, `.html.heex`, `~F`, and `~H`, scoped by
  their LiveView/LiveComponent owner and stateless component call graph

When the same assign is declared for several functions in one module, the
server prefers the declaration closest to the helper generated for that
template. Navigation is intentionally lexical in this initial version; it does
not compile the Mix project or expand macros.

## Known limitations

- Completion, diagnostics, and rename are not implemented yet. References are
  currently available for statically named LiveView client events.
- Go-to-definition uses project source and common Surface/Phoenix conventions;
  dynamically generated definitions may not resolve.
- Router-aware assign navigation currently requires conventional lexical
  `scope`, `live_session`, and `live` declarations; macro-generated routes and
  dynamic hook values are not expanded.
- Unresolved assigns remain unresolved instead of falling back to unrelated
  same-named declarations elsewhere in the workspace.
- Elixir injection requires the separately installed Elixir extension.
- The grammar recognizes current component/directive forms broadly, but unusual
  project-specific macros should be added to the corpus before release.

## Publishing

Before publishing, verify the pinned grammar revision from a clean clone, then
submit the repository as the `surface` submodule in `zed-industries/extensions`.

## License

MIT

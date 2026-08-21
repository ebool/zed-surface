# tree-sitter-surface

Tree-sitter grammar for [Surface](https://surface-ui.org/) templates. This is a
compatibility update of
[`connorlay/tree-sitter-surface`](https://github.com/connorlay/tree-sitter-surface)
for current Surface and Phoenix component syntax.

The grammar recognizes:

- HTML tags, void elements, attributes, and comments
- Surface components (`<Card>`, `<Layouts.app>`) and slots (`<:actions>`)
- Phoenix function components (`<.link>`)
- Surface blocks (`{#if}`, `{#for}`, `{#case}` and their subblocks)
- Open-ended Surface directives such as `:for`, `:attrs`, `:props`, and `:on-*`
- Balanced braces inside Elixir expressions

## Development

```sh
npm install
npm run generate
npm test
```

The generated `src/parser.c` is committed because Zed compiles the grammar from
that source.

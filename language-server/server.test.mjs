import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findDefinitions } from "./server.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surface-lsp-"));
  for (const [relative, source] of Object.entries(files)) {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return root;
}

function definition(root, relative, needle, offset = 1) {
  const filePath = path.join(root, relative);
  const source = fs.readFileSync(filePath, "utf8");
  const absolute = source.indexOf(needle) + offset;
  const before = source.slice(0, absolute).split("\n");
  return findDefinitions({
    root,
    filePath,
    source,
    position: { line: before.length - 1, character: before.at(-1).length },
  });
}

function locationPath(entry) {
  return new URL(entry.uri).pathname;
}

test("assigns jump to an attr in the module that embeds the template", () => {
  const root = fixture({
    "lib/components.ex": `defmodule AppWeb.Components do
  embed_sface "templates/input_template.sface"
  attr :label, :string
  def input(assigns), do: input_template(assigns)
end
`,
    "lib/templates/input_template.sface": `<span>{@label}</span>`,
  });

  const result = definition(root, "lib/templates/input_template.sface", "@label");
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/components.ex"));
  assert.equal(result[0].range.start.line, 2);
});

test("the nearest declaration before a template helper is preferred", () => {
  const root = fixture({
    "lib/components.ex": `defmodule AppWeb.Components do
  embed_sface "templates/first_template.sface"
  embed_sface "templates/second_template.sface"
  attr :id, :string
  def first(assigns), do: first_template(assigns)
  attr :id, :integer
  def second(assigns), do: second_template(assigns)
end
`,
    "lib/templates/first_template.sface": `<span>{@id}</span>`,
    "lib/templates/second_template.sface": `<span>{@id}</span>`,
  });

  const result = definition(root, "lib/templates/second_template.sface", "@id");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 5);
});

test("assigns fall back to assign calls in a colocated LiveView module", () => {
  const root = fixture({
    "lib/index.ex": `defmodule AppWeb.Index do
  def mount(socket), do: assign(socket, :books, [])
end
`,
    "lib/index.sface": `<ul :for={book <- @books}>{book.title}</ul>`,
  });

  const result = definition(root, "lib/index.sface", "@books");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 1);
});

test("LiveView streams are treated as assign definitions", () => {
  const root = fixture({
    "lib/index.ex": `defmodule AppWeb.Index do
  def mount(socket), do: stream(socket, :books, [])
end
`,
    "lib/index.sface": `<ul :for={book <- @books}>{book.title}</ul>`,
  });

  const result = definition(root, "lib/index.sface", "@books");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 1);
});

test("local function components jump to their defining function", () => {
  const root = fixture({
    "lib/components.ex": `defmodule AppWeb.Components do
  embed_sface "templates/page.sface"
  defp error(assigns), do: error_template(assigns)
end
`,
    "lib/templates/page.sface": `<.error>{@message}</.error>`,
  });

  const result = definition(root, "lib/templates/page.sface", ".error");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 2);
});

test("local variables jump to their generator binding", () => {
  const root = fixture({
    "lib/index.ex": `defmodule AppWeb.Index do
end
`,
    "lib/index.sface": `<div :for={message <- @messages}>{message.body}</div>`,
  });

  const result = definition(root, "lib/index.sface", "message.body");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.character, 11);
});

test("Elixir expression functions jump to the owner module", () => {
  const root = fixture({
    "lib/index.ex": `defmodule AppWeb.Index do
  defp display(value), do: value
end
`,
    "lib/index.sface": `<span>{display(@value)}</span>`,
  });

  const result = definition(root, "lib/index.sface", "display");
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 1);
});

test("remote components jump through a module suffix", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  embed_sface "page.sface"
end
`,
    "lib/layouts.ex": `defmodule AppWeb.Layouts do
  def app(assigns), do: assigns
end
`,
    "lib/page.sface": `<Layouts.app />`,
  });

  const result = definition(root, "lib/page.sface", "Layouts.app", 9);
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/layouts.ex"));
  assert.equal(result[0].range.start.line, 1);
});

test("the checked-in navigation example resolves every documented link", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const template = "examples/navigation/navigation_demo.sface";
  const cases = [
    ["@id", "prop(id"],
    ["@rest", "prop(rest"],
    ["@items", "data(items"],
    ["format_label", "defp format_label"],
    [".badge", "defp badge"],
    ["NavigationDemo.card", "def card"],
    ["item.name", "item <- @items"],
  ];

  for (const [sourceNeedle, targetNeedle] of cases) {
    const result = definition(root, template, sourceNeedle);
    assert.equal(result.length, 1, sourceNeedle);
    const targetPath = locationPath(result[0]);
    const targetLine = fs.readFileSync(targetPath, "utf8").split(/\r?\n/)[result[0].range.start.line];
    assert.match(targetLine, new RegExp(targetNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), sourceNeedle);
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findDefinitions, findReferences } from "./server.mjs";

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

function references(root, relative, needle, offset = 1, includeDeclaration = false) {
  const filePath = path.join(root, relative);
  const source = fs.readFileSync(filePath, "utf8");
  const absolute = source.indexOf(needle) + offset;
  const before = source.slice(0, absolute).split("\n");
  return findReferences({
    root,
    filePath,
    source,
    position: { line: before.length - 1, character: before.at(-1).length },
    includeDeclaration,
  });
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

function contextualSymbolFixture() {
  return fixture({
    "lib/app_web.ex": `defmodule AppWeb do
  def surface_live_view do
    quote do
      use Surface.LiveView
      import AppWeb.CoreComponents
      alias AppWeb.Layouts
    end
  end
end
`,
    "lib/home_entry.ex": `defmodule AppWeb.HomeEntry do
  use AppWeb, :surface_live_view
  embed_sface "local.sface"
end
`,
    "lib/home_entry.sface": `<Layouts.sidebar
  flash={@flash}
>
</Layouts.sidebar>
`,
    "lib/local.sface": `<.flash flash={@flash} />`,
    "lib/layouts.ex": `defmodule AppWeb.Layouts do
  attr :flash, :map
  def landing(assigns), do: assigns

  attr :flash, :map, required: true
  def sidebar(assigns), do: assigns

  attr :flash, :map
  def flash_group(assigns), do: assigns
end
`,
    "lib/core_components.ex": `defmodule AppWeb.CoreComponents do
  attr :flash, :map
  def flash(assigns), do: assigns
end
`,
    "deps/surface/lib/surface/live_view.ex": `defmodule Surface.LiveView do
  data socket, :struct
  data flash, :map
end
`,
  });
}

test("a remote component attribute resolves only against that function contract", () => {
  const root = contextualSymbolFixture();
  const result = definition(root, "lib/home_entry.sface", "flash=");
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/layouts.ex"));
  assert.equal(result[0].range.start.line, 4);
});

test("an assign inherited through a use macro resolves to the Surface LiveView built-in", () => {
  const root = contextualSymbolFixture();
  const result = definition(root, "lib/home_entry.sface", "@flash");
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "deps/surface/lib/surface/live_view.ex"));
  assert.equal(result[0].range.start.line, 2);
});

test("a local component tag and its attribute resolve through scoped imports", () => {
  const root = contextualSymbolFixture();
  const component = definition(root, "lib/local.sface", ".flash");
  const attribute = definition(root, "lib/local.sface", "flash={");
  const assign = definition(root, "lib/local.sface", "@flash");

  assert.equal(component.length, 1);
  assert.equal(component[0].range.start.line, 2);
  assert.equal(attribute.length, 1);
  assert.equal(attribute[0].range.start.line, 1);
  assert.equal(assign.length, 1);
  assert.equal(locationPath(assign[0]), path.join(root, "deps/surface/lib/surface/live_view.ex"));
});

test("an unresolved assign never falls back to a same-named global attr", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
end
`,
    "lib/page.sface": `<span>{@flash}</span>`,
    "lib/core_components.ex": `defmodule AppWeb.CoreComponents do
  attr :flash, :map
  def flash(assigns), do: assigns
end
`,
  });

  assert.deepEqual(definition(root, "lib/page.sface", "@flash"), []);
});

test("a named slot resolves only against its remote parent component contract", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  alias AppWeb.Layouts
  embed_sface "page.sface"
end
`,
    "lib/page.sface": `<Layouts.sidebar>
  <:context_footer>Footer</:context_footer>
</Layouts.sidebar>

<Layouts.dialog>
  <:context_footer>Dialog footer</:context_footer>
</Layouts.dialog>
`,
    "lib/layouts.ex": `defmodule AppWeb.Layouts do
  slot :context_footer, doc: "Sidebar footer"
  def sidebar(assigns), do: assigns

  slot :context_footer, doc: "Dialog footer"
  def dialog(assigns), do: assigns
end
`,
  });

  const first = definition(root, "lib/page.sface", ":context_footer", 2);
  const second = definition(
    root,
    "lib/page.sface",
    ":context_footer>Dialog",
    2,
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].range.start.line, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].range.start.line, 4);
});

test("a named slot in a Surface component resolves to slot name syntax", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  alias AppWeb.Card
  embed_sface "page.sface"
end
`,
    "lib/page.sface": `<Card><:footer>Footer</:footer></Card>`,
    "lib/card.ex": `defmodule AppWeb.Card do
  use Surface.Component
  slot footer
  def render(assigns), do: assigns
end
`,
  });

  const result = definition(root, "lib/page.sface", ":footer", 2);
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/card.ex"));
  assert.equal(result[0].range.start.line, 2);
});

test("a local component named slot resolves through scoped imports", () => {
  const root = fixture({
    "lib/app_web.ex": `defmodule AppWeb do
  def components do
    quote do
      import AppWeb.Dialogs
    end
  end
end
`,
    "lib/page.ex": `defmodule AppWeb.Page do
  use AppWeb, :components
  embed_sface "page.sface"
end
`,
    "lib/page.sface": `<.dialog>
  <:footer>Footer</:footer>
</.dialog>
`,
    "lib/dialogs.ex": `defmodule AppWeb.Dialogs do
  slot :footer
  def dialog(assigns), do: assigns
end
`,
  });

  const opening = definition(root, "lib/page.sface", ":footer", 2);
  const closing = definition(root, "lib/page.sface", "/:footer", 3);
  assert.equal(opening.length, 1);
  assert.equal(opening[0].range.start.line, 1);
  assert.deepEqual(closing, opening);
});

test("LiveView event values resolve every matching handler clause in their owner", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  use Phoenix.LiveView
  embed_sface "page.sface"

  def handle_event("delete", %{"mode" => "edit"}, socket), do: {:noreply, socket}
  def handle_event("delete", _params, socket), do: {:noreply, socket}
end
`,
    "lib/page.sface": `<button phx-click="delete">Delete</button>
<button phx-click={"delete"}>Delete expression</button>
<button phx-click={JS.push("delete")}>Delete with JS</button>
`,
  });

  for (const needle of ["\"delete\"", "{\"delete\"}", "JS.push(\"delete\")"]) {
    const offset = needle.lastIndexOf("delete") + 1;
    const result = definition(root, "lib/page.sface", needle, offset);
    assert.equal(result.length, 2, needle);
    assert.deepEqual(result.map((entry) => entry.range.start.line), [4, 5], needle);
  }
});

test("handler references return static event forms and honor includeDeclaration", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  use Phoenix.LiveView
  embed_sface "page.sface"
  def handle_event("delete", _params, socket), do: {:noreply, socket}
end
`,
    "lib/page.sface": `<button phx-click="delete">One</button>
<button phx-click={"delete"}>Two</button>
<button phx-click={JS.push("delete")}>Three</button>
<button phx-click={@dynamic}>Dynamic</button>
`,
  });

  const result = references(root, "lib/page.ex", "handle_event(\"delete", 15);
  assert.equal(result.length, 3);
  assert.ok(result.every((entry) => locationPath(entry) === path.join(root, "lib/page.sface")));

  const withDeclaration = references(
    root,
    "lib/page.ex",
    "handle_event(\"delete",
    15,
    true,
  );
  assert.equal(withDeclaration.length, 4);
  assert.equal(locationPath(withDeclaration.at(-1)), path.join(root, "lib/page.ex"));
});

test("an event in a stateless function component resolves through its LiveView callers", () => {
  const root = fixture({
    "lib/form_entry.ex": `defmodule AppWeb.FormEntry do
  use Phoenix.LiveView
  import AppWeb.ServerForm, only: [server_form: 1]
  embed_sface "form_entry.sface"
  def handle_event("delete", _params, socket), do: {:noreply, socket}
end
`,
    "lib/form_entry.sface": `<.server_form />`,
    "lib/server_form.ex": `defmodule AppWeb.ServerForm do
  use Phoenix.Component
  def server_form(assigns) do
    ~H"""
    <button phx-click="delete">Delete</button>
    """
  end
end
`,
  });

  const target = definition(root, "lib/server_form.ex", "phx-click=\"delete", 12);
  assert.equal(target.length, 1);
  assert.equal(locationPath(target[0]), path.join(root, "lib/form_entry.ex"));
  assert.equal(target[0].range.start.line, 4);

  const result = references(root, "lib/form_entry.ex", "handle_event(\"delete", 15);
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/server_form.ex"));
  assert.equal(result[0].range.start.line, 4);
});

test("the same event name stays isolated between unrelated LiveView owners", () => {
  const root = fixture({
    "lib/one.ex": `defmodule AppWeb.One do
  use Phoenix.LiveView
  embed_sface "one.sface"
  def handle_event("delete", _, socket), do: {:noreply, socket}
end
`,
    "lib/one.sface": `<button phx-click="delete">One</button>`,
    "lib/two.ex": `defmodule AppWeb.Two do
  use Phoenix.LiveView
  embed_sface "two.sface"
  def handle_event("delete", _, socket), do: {:noreply, socket}
end
`,
    "lib/two.sface": `<button phx-click="delete">Two</button>`,
  });

  const one = definition(root, "lib/one.sface", "delete");
  assert.equal(one.length, 1);
  assert.equal(locationPath(one[0]), path.join(root, "lib/one.ex"));
  const oneReferences = references(root, "lib/one.ex", "handle_event(\"delete", 15);
  assert.equal(oneReferences.length, 1);
  assert.equal(locationPath(oneReferences[0]), path.join(root, "lib/one.sface"));
});

test("phx-target at myself resolves to the current LiveComponent", () => {
  const root = fixture({
    "lib/dialog.ex": `defmodule AppWeb.Dialog do
  use Phoenix.LiveComponent
  def render(assigns) do
    ~H"""
    <button phx-click="close" phx-target={@myself}>Close</button>
    """
  end
  def handle_event("close", _, socket), do: {:noreply, socket}
end
`,
  });

  const result = definition(root, "lib/dialog.ex", "phx-click=\"close", 12);
  assert.equal(result.length, 1);
  assert.equal(result[0].range.start.line, 7);
});

test("an untargeted LiveComponent event resolves to its parent LiveView", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  use Phoenix.LiveView
  alias AppWeb.Dialog
  embed_sface "page.sface"
  def handle_event("close", _, socket), do: {:noreply, socket}
end
`,
    "lib/page.sface": `<Dialog />`,
    "lib/dialog.ex": `defmodule AppWeb.Dialog do
  use Phoenix.LiveComponent
  def render(assigns) do
    ~H"""
    <button phx-click="close">Close</button>
    """
  end
  def handle_event("close", _, socket), do: {:noreply, socket}
end
`,
  });

  const result = definition(root, "lib/dialog.ex", "phx-click=\"close", 12);
  assert.equal(result.length, 1);
  assert.equal(locationPath(result[0]), path.join(root, "lib/page.ex"));
  assert.equal(result[0].range.start.line, 4);
});

test("html.heex and Surface sigils participate in event navigation", () => {
  const root = fixture({
    "lib/page.ex": `defmodule AppWeb.Page do
  use Phoenix.LiveView
  def handle_event("save", _, socket), do: {:noreply, socket}
end
`,
    "lib/page.html.heex": `<form phx-submit="save"></form>`,
    "lib/surface_page.ex": `defmodule AppWeb.SurfacePage do
  use Surface.LiveView
  def render(assigns) do
    ~F"""
    <button phx-click={"save"}>Save</button>
    """
  end
  def handle_event("save", _, socket), do: {:noreply, socket}
end
`,
  });

  const heex = definition(root, "lib/page.html.heex", "save");
  assert.equal(heex.length, 1);
  assert.equal(locationPath(heex[0]), path.join(root, "lib/page.ex"));
  const surface = definition(root, "lib/surface_page.ex", "phx-click={\"save", 13);
  assert.equal(surface.length, 1);
  assert.equal(locationPath(surface[0]), path.join(root, "lib/surface_page.ex"));
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
    [":footer", "slot(:footer)"],
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

test("the checked-in event example supports definition and references", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = definition(
    root,
    "examples/events/event_demo.sface",
    "phx-click=\"delete",
    12,
  );
  assert.equal(target.length, 2);
  assert.ok(target.every((entry) =>
    locationPath(entry) === path.join(root, "examples/events/event_demo.ex"),
  ));

  const result = references(
    root,
    "examples/events/event_demo.ex",
    "handle_event(\"delete",
    15,
  );
  assert.equal(result.length, 2);
  assert.deepEqual(
    new Set(result.map(locationPath)),
    new Set([
      path.join(root, "examples/events/event_demo.sface"),
      path.join(root, "examples/events/event_button.ex"),
    ]),
  );
});

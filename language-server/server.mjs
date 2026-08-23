#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".elixir_ls",
  ".lexical",
  "_build",
  "assets",
  "deps",
  "node_modules",
]);

function uriToPath(uri) {
  return fileURLToPath(uri);
}

function pathToUri(filePath) {
  return pathToFileURL(filePath).href;
}

function rangeAt(line, start, length) {
  return {
    start: { line, character: start },
    end: { line, character: start + length },
  };
}

function location(filePath, line, start, length) {
  return { uri: pathToUri(filePath), range: rangeAt(line, start, length) };
}

function walkElixirFiles(root) {
  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(path.join(directory, entry.name));
        }
      } else if (entry.isFile() && /\.exs?$/.test(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  return files;
}

function walkTemplateFiles(root) {
  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(path.join(directory, entry.name));
        }
      } else if (entry.isFile() && (entry.name.endsWith(".sface") || entry.name.endsWith(".html.heex"))) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  return files;
}

function readSource(filePath, openDocuments) {
  const open = openDocuments?.get(pathToUri(filePath));
  if (open !== undefined) return open;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseElixirFile(filePath, source) {
  const lines = source.split(/\r?\n/);
  const moduleMatch = source.match(/^\s*defmodule\s+([A-Z][\w.]*)\s+do\b/m);
  const embeds = [];
  const definitions = [];
  const imports = [];
  const aliases = [];
  const uses = [];
  const eventHandlers = [];

  lines.forEach((lineText, line) => {
    let match = lineText.match(/\bembed_sface\s*(?:\(\s*)?["']([^"']+)["']/);
    if (match) {
      embeds.push({
        template: path.resolve(path.dirname(filePath), match[1]),
        line,
      });
    }

    match = lineText.match(/^\s*(attr|prop|data|slot)\s*(?:\(\s*)?:?([a-zA-Z_]\w*[!?]?)/);
    if (match) {
      definitions.push({ kind: match[1], name: match[2], line, start: lineText.indexOf(match[2]) });
    }

    match = lineText.match(/^\s*defp?\s+([a-zA-Z_]\w*[!?]?)/);
    if (match) {
      definitions.push({ kind: "function", name: match[1], line, start: lineText.indexOf(match[1]) });
    }

    match = lineText.match(/^\s*import\s+([A-Z][\w.]*)/);
    if (match) imports.push(match[1]);

    match = lineText.match(/^\s*alias\s+([A-Z][\w.]*)(?:,\s+as:\s+([A-Z]\w*))?/);
    if (match) aliases.push({ module: match[1], as: match[2] ?? match[1].split(".").at(-1) });

    match = lineText.match(/^\s*use\s*(?:\(\s*)?([A-Z][\w.]*)(?:\s*,\s*:([a-zA-Z_]\w*[!?]?))?/);
    if (match) uses.push({ module: match[1], macro: match[2], line });

    const assignmentPatterns = [
      new RegExp(`\\bassign(?:_new)?\\s*\\([^\\n]*?:([a-zA-Z_]\\w*[!?]?)`, "g"),
      new RegExp(`\\bassign\\s*\\([^\\n]*?\\b([a-zA-Z_]\\w*[!?]?)\\s*:`, "g"),
      new RegExp(`\\bupdate\\s*\\([^\\n]*?:([a-zA-Z_]\\w*[!?]?)`, "g"),
      new RegExp(`\\bstream(?:_configure)?\\s*\\([^\\n]*?:([a-zA-Z_]\\w*[!?]?)`, "g"),
    ];
    for (const pattern of assignmentPatterns) {
      while ((match = pattern.exec(lineText)) !== null) {
        const name = match[1];
        definitions.push({ kind: "assign", name, line, start: lineText.indexOf(name, match.index) });
      }
    }
  });

  for (const match of source.matchAll(/^[ \t]*defp?\s+handle_event\s*\(\s*["']([^"']+)["']/gm)) {
    const name = match[1];
    const startOffset = match.index + match[0].lastIndexOf(name);
    const before = source.slice(0, startOffset).split("\n");
    eventHandlers.push({
      name,
      line: before.length - 1,
      start: before.at(-1).length,
    });
  }

  return {
    filePath,
    module: moduleMatch?.[1],
    source,
    lines,
    embeds,
    definitions,
    imports,
    aliases,
    uses,
    eventHandlers,
  };
}

function indexWorkspace(root, openDocuments = new Map()) {
  return walkElixirFiles(root)
    .map((filePath) => {
      const source = readSource(filePath, openDocuments);
      return source === null ? null : parseElixirFile(filePath, source);
    })
    .filter(Boolean);
}

function templateOwners(index, templatePath) {
  const normalized = path.resolve(templatePath);
  const embedded = index.filter((file) => file.embeds.some((entry) => entry.template === normalized));
  if (embedded.length > 0) return embedded;

  const sibling = normalized.replace(/(?:\.sface|\.html\.heex)$/, ".ex");
  return index.filter((file) => file.filePath === sibling);
}

function deduplicate(locations) {
  const seen = new Set();
  return locations.filter((entry) => {
    const key = `${entry.uri}:${entry.range.start.line}:${entry.range.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationsForDefinitions(files, name, kinds) {
  const results = [];
  for (const file of files) {
    for (const definition of file.definitions) {
      if (definition.name === name && kinds.has(definition.kind)) {
        results.push(location(file.filePath, definition.line, definition.start, name.length));
      }
    }
  }
  return results;
}

function filesForModule(index, moduleName) {
  return index.filter(
    (file) => file.module === moduleName || file.module?.endsWith(`.${moduleName}`),
  );
}

function functionLineSpan(file, name) {
  const start = file.lines.findIndex((line) =>
    new RegExp(`^\\s*defp?\\s+${name}\\b`).test(line),
  );
  if (start === -1) return null;

  const indentation = file.lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = file.lines.length;
  for (let line = start + 1; line < file.lines.length; line += 1) {
    const match = file.lines[line].match(/^(\s*)defp?\s+[a-zA-Z_]\w*[!?]?\b/);
    if (match && match[1].length <= indentation) {
      end = line;
      break;
    }
  }
  return { start, end };
}

function moduleUseProvides(index, moduleName, macroName, targetModule, seen = new Set()) {
  const key = `${moduleName}:${macroName ?? "*"}`;
  if (seen.has(key)) return false;
  seen.add(key);

  for (const file of filesForModule(index, moduleName)) {
    const span = macroName ? functionLineSpan(file, macroName) : null;
    const uses = span
      ? file.uses.filter((entry) => entry.line > span.start && entry.line < span.end)
      : file.uses;
    for (const entry of uses) {
      if (entry.module === targetModule) return true;
      if (moduleUseProvides(index, entry.module, entry.macro, targetModule, seen)) return true;
    }
  }
  return false;
}

function ownersUseModule(index, owners, targetModule) {
  return owners.some((owner) => owner.uses.some((entry) =>
    entry.module === targetModule ||
    moduleUseProvides(index, entry.module, entry.macro, targetModule),
  ));
}

function effectiveImports(index, owners) {
  const modules = new Set(owners.flatMap((owner) => owner.imports));
  const visited = new Set();

  function visitUse(entry) {
    const key = `${entry.module}:${entry.macro ?? "*"}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const file of filesForModule(index, entry.module)) {
      for (const imported of file.imports) modules.add(imported);
      for (const nested of file.uses) visitUse(nested);
    }
  }

  for (const owner of owners) {
    for (const entry of owner.uses) visitUse(entry);
  }
  return modules;
}

function effectiveAliases(index, owners) {
  const aliases = [...owners.flatMap((owner) => owner.aliases)];
  const visited = new Set();

  function visitUse(entry) {
    const key = `${entry.module}:${entry.macro ?? "*"}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const file of filesForModule(index, entry.module)) {
      aliases.push(...file.aliases);
      for (const nested of file.uses) visitUse(nested);
    }
  }

  for (const owner of owners) {
    for (const entry of owner.uses) visitUse(entry);
  }
  return aliases;
}

function componentModuleFiles(index, owners, requested) {
  const resolved = new Set([requested]);
  for (const entry of effectiveAliases(index, owners)) {
    if (entry.as === requested) resolved.add(entry.module);
  }
  return index.filter((file) =>
    [...resolved].some((moduleName) =>
      file.module === moduleName || file.module?.endsWith(`.${moduleName}`),
    ),
  );
}

function declarationsForFunction(
  files,
  functionName,
  declarationName,
  kinds = new Set(["attr", "prop"]),
) {
  const results = [];
  for (const file of files) {
    const functions = file.definitions.filter((definition) => definition.kind === "function");
    for (const target of functions.filter((definition) => definition.name === functionName)) {
      const previousFunction = functions
        .filter((definition) => definition.line < target.line)
        .at(-1);
      const declaration = file.definitions
        .filter((definition) =>
          kinds.has(definition.kind) &&
          definition.name === declarationName &&
          definition.line < target.line &&
          definition.line > (previousFunction?.line ?? -1),
        )
        .at(-1);
      if (declaration) {
        results.push(location(file.filePath, declaration.line, declaration.start, declarationName.length));
      }
    }
  }
  return results;
}

function declarationLocationsForTemplate(owners, templatePath, name) {
  const helper = path.basename(templatePath, ".sface");
  const results = [];

  for (const owner of owners) {
    const invocationLines = owner.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => new RegExp(`\\b${helper}\\s*\\(`).test(line))
      .map(({ index }) => index);
    const targetLine = invocationLines.at(-1);
    for (const kind of ["data", "prop", "attr", "slot"]) {
      const matches = owner.definitions.filter(
        (definition) => definition.name === name && definition.kind === kind,
      );
      if (matches.length === 0) continue;
      const preceding = targetLine === undefined
        ? matches
        : matches.filter((definition) => definition.line < targetLine);
      const selected = preceding.at(-1) ?? matches[0];
      results.push(location(owner.filePath, selected.line, selected.start, name.length));
      break;
    }
  }

  return results;
}

function componentToken(tagName) {
  if (tagName.startsWith(".")) {
    return { kind: "local_component", name: tagName.slice(1) };
  }
  const pieces = tagName.split(".");
  if (pieces.length > 1 && /^[a-z_]/.test(pieces.at(-1))) {
    return {
      kind: "remote_component",
      module: pieces.slice(0, -1).join("."),
      name: pieces.at(-1),
    };
  }
  return { kind: "module_component", module: tagName };
}

function absolutePosition(source, position) {
  const lines = source.split(/\n/);
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) offset += (lines[line]?.length ?? 0) + 1;
  return offset + position.character;
}

function openingTagEnd(source, start) {
  let braces = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") braces += 1;
    else if (character === "}" && braces > 0) braces -= 1;
    else if (character === ">" && braces === 0) return index;
  }
  return source.length - 1;
}

function componentAttributeAt(source, position) {
  const cursor = absolutePosition(source, position);
  const prefix = source.slice(0, cursor + 1);
  const tags = [...prefix.matchAll(/<(\.[a-zA-Z_]\w*[!?]?|[A-Z][\w.]*)\b/g)];
  const tag = tags.at(-1);
  if (!tag) return null;

  const tagStart = tag.index;
  const nextClose = openingTagEnd(source, tagStart);
  if (cursor > nextClose) return null;

  const opening = source.slice(tagStart, nextClose + 1);
  for (const match of opening.matchAll(/(?:^|\s)(:?[-a-zA-Z_]\w*(?:-\w+)*)(?=\s*=)/g)) {
    const name = match[1];
    const start = tagStart + match.index + match[0].lastIndexOf(name);
    if (cursor >= start && cursor <= start + name.length) {
      return { kind: "component_attribute", name, component: componentToken(tag[1]) };
    }
  }
  return null;
}

function tagAt(source, start) {
  if (source.startsWith("<!--", start)) {
    const commentEnd = source.indexOf("-->", start + 4);
    return { end: commentEnd === -1 ? source.length - 1 : commentEnd + 2 };
  }

  if (!/^<\s*\/?\s*[:.a-zA-Z_]/.test(source.slice(start, start + 8))) {
    return { end: start };
  }

  const end = openingTagEnd(source, start);
  const text = source.slice(start, end + 1);
  const match = text.match(/^<\s*(\/?)\s*([:.a-zA-Z_][\w.:-]*)/);
  if (!match) return { end };
  return {
    end,
    closing: match[1] === "/",
    name: match[2],
    selfClosing: /\/\s*>$/.test(text),
  };
}

function openTagStackBefore(source, limit) {
  const stack = [];
  let cursor = 0;

  while (cursor < limit) {
    const start = source.indexOf("<", cursor);
    if (start === -1 || start >= limit) break;
    const tag = tagAt(source, start);
    cursor = Math.max(tag.end + 1, start + 1);
    if (!tag.name || tag.name.startsWith("!")) continue;

    if (tag.closing) {
      const matching = stack.map((entry) => entry.name).lastIndexOf(tag.name);
      if (matching !== -1) stack.splice(matching);
      continue;
    }

    const component = tag.name.startsWith(":") ? null : (
      tag.name.startsWith(".") || /^[A-Z]/.test(tag.name)
        ? componentToken(tag.name)
        : null
    );
    const parentComponent = tag.name.startsWith(":")
      ? [...stack].reverse().find((entry) => entry.component)?.component ?? null
      : null;
    if (!tag.selfClosing) stack.push({ name: tag.name, component, parentComponent });
  }

  return stack;
}

function namedSlotAt(source, position) {
  const line = source.split(/\r?\n/)[position.line] ?? "";
  const character = Math.min(position.character, line.length);
  for (const match of line.matchAll(/<\/?\s*:([a-zA-Z_]\w*[!?-]?)/g)) {
    const name = match[1];
    const start = match.index + match[0].lastIndexOf(name);
    if (character < start || character > start + name.length) continue;

    const tagStart = absolutePosition(source, { line: position.line, character: match.index });
    const stack = openTagStackBefore(source, tagStart);
    const closing = /^<\//.test(match[0]);
    const slotEntry = closing
      ? [...stack].reverse().find((entry) => entry.name === `:${name}`)
      : null;
    const component = slotEntry?.parentComponent ??
      [...stack].reverse().find((entry) => entry.component)?.component;
    if (component) return { kind: "named_slot", name, component };
  }
  return null;
}

function tokenAt(source, position) {
  const line = source.split(/\r?\n/)[position.line] ?? "";
  const character = Math.min(position.character, line.length);

  for (const match of line.matchAll(/@[a-zA-Z_]\w*[!?]?/g)) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return { kind: "assign", name: match[0].slice(1) };
    }
  }

  const attribute = componentAttributeAt(source, position);
  if (attribute) return attribute;

  const namedSlot = namedSlotAt(source, position);
  if (namedSlot) return namedSlot;

  for (const match of line.matchAll(/<\/?(\.[a-zA-Z_]\w*[!?]?|[A-Z][\w.]*)/g)) {
    const start = match.index + match[0].indexOf(match[1]);
    if (character >= start && character <= start + match[1].length) {
      if (match[1].startsWith(".")) {
        return { kind: "local_component", name: match[1].slice(1) };
      }
      const pieces = match[1].split(".");
      if (pieces.length > 1 && /^[a-z_]/.test(pieces.at(-1))) {
        return { kind: "remote_component", module: pieces.slice(0, -1).join("."), name: pieces.at(-1) };
      }
      return { kind: "module_component", module: match[1] };
    }
  }

  for (const match of line.matchAll(/([A-Z][\w.]*)\.([a-zA-Z_]\w*[!?]?)\s*(?=\()/g)) {
    const start = match.index;
    const end = match.index + match[0].trimEnd().length;
    if (character >= start && character <= end) {
      return { kind: "remote_component", module: match[1], name: match[2] };
    }
  }

  for (const match of line.matchAll(/\b([a-zA-Z_]\w*[!?]?)\s*(?=\()/g)) {
    if (character >= match.index && character <= match.index + match[1].length) {
      return { kind: "local_function", name: match[1] };
    }
  }

  for (const match of line.matchAll(/\b([a-zA-Z_]\w*[!?]?)\b/g)) {
    if (character >= match.index && character <= match.index + match[1].length) {
      return { kind: "local_variable", name: match[1] };
    }
  }

  return null;
}

function localBinderLocation(filePath, source, position, name) {
  const lines = source.split(/\r?\n/);
  let result = null;

  for (let line = 0; line <= position.line; line += 1) {
    const text = lines[line] ?? "";
    const occurrences = [...text.matchAll(new RegExp(`\\b${name}\\b`, "g"))];
    for (const match of occurrences) {
      if (line === position.line && match.index >= position.character) continue;
      const remainder = text.slice(match.index + name.length);
      const before = text.slice(0, match.index);
      const bindsWithGenerator = /^[\s,}\]]*<-/.test(remainder);
      const bindsWithLet = /:let\s*=\s*{[^}]*$/.test(before);
      if (bindsWithGenerator || bindsWithLet) {
        result = location(filePath, line, match.index, name.length);
      }
    }
  }

  return result;
}

function localComponentFiles(index, owners, name) {
  const ownerFiles = owners.filter((owner) =>
    owner.definitions.some((definition) => definition.kind === "function" && definition.name === name),
  );
  if (ownerFiles.length > 0) return ownerFiles;
  const imports = effectiveImports(index, owners);
  return index.filter((file) => imports.has(file.module));
}

function surfaceLiveViewBuiltIn(root, name, openDocuments) {
  const filePath = path.join(root, "deps", "surface", "lib", "surface", "live_view.ex");
  const source = readSource(filePath, openDocuments);
  if (source === null) return [];
  const file = parseElixirFile(filePath, source);
  return locationsForDefinitions([file], name, new Set(["data"]));
}

function componentAttributeDefinitions(index, owners, token) {
  const component = token.component;
  if (component.kind === "remote_component") {
    return declarationsForFunction(
      componentModuleFiles(index, owners, component.module),
      component.name,
      token.name,
    );
  }
  if (component.kind === "local_component") {
    return declarationsForFunction(
      localComponentFiles(index, owners, component.name),
      component.name,
      token.name,
    );
  }
  return locationsForDefinitions(
    componentModuleFiles(index, owners, component.module),
    token.name,
    new Set(["prop", "attr"]),
  );
}

function namedSlotDefinitions(index, owners, token) {
  const component = token.component;
  if (component.kind === "remote_component") {
    return declarationsForFunction(
      componentModuleFiles(index, owners, component.module),
      component.name,
      token.name,
      new Set(["slot"]),
    );
  }
  if (component.kind === "local_component") {
    return declarationsForFunction(
      localComponentFiles(index, owners, component.name),
      component.name,
      token.name,
      new Set(["slot"]),
    );
  }
  return locationsForDefinitions(
    componentModuleFiles(index, owners, component.module),
    token.name,
    new Set(["slot"]),
  );
}

const LIVE_VIEW_EVENT_ATTRIBUTES = [
  "click",
  "submit",
  "change",
  "blur",
  "focus",
  "keydown",
  "keyup",
  "window-keydown",
  "window-keyup",
];

function positionAtOffset(source, offset) {
  const before = source.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1).length };
}

function eventReferencesInRegion(filePath, fullSource, regionSource, baseOffset, containers) {
  const attributes = LIVE_VIEW_EVENT_ATTRIBUTES.join("|");
  const pattern = new RegExp(
    `\\b(phx-(?:${attributes}))\\s*=\\s*(?:"([^"]+)"|'([^']+)'|\\{\\s*"([^"]+)"\\s*\\}|\\{\\s*'([^']+)'\\s*\\}|\\{\\s*(?:Phoenix\\.LiveView\\.)?JS\\.push\\s*\\(\\s*"([^"]+)")`,
    "g",
  );
  const results = [];

  for (const match of regionSource.matchAll(pattern)) {
    const name = match.slice(2).find((value) => value !== undefined);
    if (!name) continue;
    const equals = match[0].indexOf("=");
    let relativeName = match[0].indexOf(`"${name}"`, equals);
    if (relativeName === -1) relativeName = match[0].indexOf(`'${name}'`, equals);
    if (relativeName === -1) continue;
    relativeName += 1;

    const tagStart = regionSource.lastIndexOf("<", match.index);
    const tagEnd = tagStart === -1 ? -1 : openingTagEnd(regionSource, tagStart);
    const opening = tagStart === -1 ? "" : regionSource.slice(tagStart, tagEnd + 1);
    let target = "default";
    if (/\bphx-target\s*=/.test(opening)) {
      target = /\bphx-target\s*=\s*\{\s*@myself\s*\}/.test(opening)
        ? "myself"
        : "dynamic";
    }

    const offset = baseOffset + match.index + relativeName;
    const position = positionAtOffset(fullSource, offset);
    results.push({
      name,
      attribute: match[1],
      filePath,
      line: position.line,
      start: position.character,
      target,
      containers,
    });
  }

  return results;
}

function inlineTemplateRegions(file) {
  const regions = [];
  for (const match of file.source.matchAll(/~[FH]"""([\s\S]*?)"""/g)) {
    const source = match[1];
    const baseOffset = match.index + match[0].indexOf(source);
    regions.push({ source, baseOffset });
  }
  return regions;
}

function componentFilesForToken(index, callers, token) {
  if (token.kind === "remote_component") {
    return componentModuleFiles(index, callers, token.module);
  }
  if (token.kind === "local_component") {
    return localComponentFiles(index, callers, token.name);
  }
  return componentModuleFiles(index, callers, token.module);
}

function addComponentCalls(index, reverseGraph, source, callers) {
  for (const match of source.matchAll(/<(\.[a-zA-Z_]\w*[!?]?|[A-Z][\w.]*)\b/g)) {
    const token = componentToken(match[1]);
    for (const caller of callers) {
      for (const callee of componentFilesForToken(index, [caller], token)) {
        if (callee.filePath === caller.filePath) continue;
        if (!reverseGraph.has(callee.filePath)) reverseGraph.set(callee.filePath, new Set());
        reverseGraph.get(callee.filePath).add(caller.filePath);
      }
    }
  }
}

function fileUsesAnyModule(index, file, moduleNames) {
  return moduleNames.some((moduleName) => ownersUseModule(index, [file], moduleName));
}

function isLiveView(index, file) {
  return fileUsesAnyModule(index, file, ["Phoenix.LiveView", "Surface.LiveView"]);
}

function isLiveComponent(index, file) {
  return fileUsesAnyModule(index, file, ["Phoenix.LiveComponent", "Surface.LiveComponent"]);
}

function closestStatefulOwners(index, reverseGraph, containers, predicate) {
  let frontier = [...new Set(containers.map((file) => file.filePath))];
  const visited = new Set();

  while (frontier.length > 0) {
    const files = frontier
      .filter((filePath) => !visited.has(filePath))
      .map((filePath) => index.find((file) => file.filePath === filePath))
      .filter(Boolean);
    for (const file of files) visited.add(file.filePath);
    const matches = files.filter((file) => predicate(index, file));
    if (matches.length > 0) return matches;
    frontier = files.flatMap((file) => [...(reverseGraph.get(file.filePath) ?? [])]);
  }

  return [];
}

function buildLiveViewEventIndex(root, index, openDocuments) {
  const references = [];
  const reverseGraph = new Map();

  for (const templatePath of walkTemplateFiles(root)) {
    const source = readSource(templatePath, openDocuments);
    if (source === null) continue;
    const containers = templateOwners(index, templatePath);
    references.push(...eventReferencesInRegion(templatePath, source, source, 0, containers));
    addComponentCalls(index, reverseGraph, source, containers);
  }

  for (const file of index) {
    for (const region of inlineTemplateRegions(file)) {
      references.push(...eventReferencesInRegion(
        file.filePath,
        file.source,
        region.source,
        region.baseOffset,
        [file],
      ));
      addComponentCalls(index, reverseGraph, region.source, [file]);
    }
  }

  for (const reference of references) {
    if (reference.target === "dynamic") {
      reference.owners = [];
    } else if (reference.target === "myself") {
      reference.owners = closestStatefulOwners(
        index,
        reverseGraph,
        reference.containers,
        isLiveComponent,
      );
    } else {
      reference.owners = closestStatefulOwners(
        index,
        reverseGraph,
        reference.containers,
        isLiveView,
      );
    }
  }

  return { references, reverseGraph };
}

function eventReferenceAt(eventIndex, filePath, position) {
  return eventIndex.references.find((reference) =>
    reference.filePath === filePath &&
    reference.line === position.line &&
    position.character >= reference.start &&
    position.character <= reference.start + reference.name.length,
  );
}

function eventHandlerAt(file, position) {
  return file?.eventHandlers.find((handler) =>
    handler.line === position.line &&
    position.character >= handler.start &&
    position.character <= handler.start + handler.name.length,
  );
}

function eventHandlerLocations(owners, name) {
  return owners.flatMap((owner) => owner.eventHandlers
    .filter((handler) => handler.name === name)
    .map((handler) => location(owner.filePath, handler.line, handler.start, name.length)));
}

export function createWorkspaceAnalysis(root, openDocuments = new Map()) {
  return {
    root,
    openDocuments,
    index: indexWorkspace(root, openDocuments),
    eventIndex: null,
  };
}

function liveViewEvents(analysis) {
  analysis.eventIndex ??= buildLiveViewEventIndex(
    analysis.root,
    analysis.index,
    analysis.openDocuments,
  );
  return analysis.eventIndex;
}

export function findDefinitions({
  root,
  filePath,
  source,
  position,
  openDocuments = new Map(),
  analysis = null,
}) {
  const workspace = analysis ?? createWorkspaceAnalysis(root, openDocuments);
  const index = workspace.index;
  const localEvent = eventReferenceAt(
    { references: eventReferencesInRegion(filePath, source, source, 0, []) },
    filePath,
    position,
  );
  if (localEvent) {
    const eventIndex = liveViewEvents(workspace);
    const eventReference = eventReferenceAt(eventIndex, filePath, position);
    if (eventReference) {
      return deduplicate(eventHandlerLocations(eventReference.owners, eventReference.name));
    }
    return [];
  }

  if (!filePath.endsWith(".sface")) return [];

  const token = tokenAt(source, position);
  if (!token) return [];
  const owners = templateOwners(index, filePath);

  if (token.kind === "local_variable") {
    const binder = localBinderLocation(filePath, source, position, token.name);
    return binder ? [binder] : [];
  }

  if (token.kind === "assign") {
    const declarations = declarationLocationsForTemplate(owners, filePath, token.name);
    if (declarations.length > 0) return deduplicate(declarations);

    const localAssignments = locationsForDefinitions(owners, token.name, new Set(["assign"]));
    if (localAssignments.length > 0) return deduplicate(localAssignments);

    if (ownersUseModule(index, owners, "Surface.LiveView")) {
      return deduplicate(surfaceLiveViewBuiltIn(root, token.name, openDocuments));
    }
    return [];
  }

  if (token.kind === "component_attribute") {
    return deduplicate(componentAttributeDefinitions(index, owners, token));
  }

  if (token.kind === "named_slot") {
    return deduplicate(namedSlotDefinitions(index, owners, token));
  }

  if (token.kind === "local_component") {
    let results = locationsForDefinitions(owners, token.name, new Set(["function"]));
    if (results.length > 0) return deduplicate(results);

    const importedModules = effectiveImports(index, owners);
    results = locationsForDefinitions(
      index.filter((file) => importedModules.has(file.module)),
      token.name,
      new Set(["function"]),
    );
    if (results.length > 0) return deduplicate(results);

    return [];
  }

  if (token.kind === "local_function") {
    let results = locationsForDefinitions(owners, token.name, new Set(["function"]));
    if (results.length > 0) return deduplicate(results);
    const importedModules = effectiveImports(index, owners);
    results = locationsForDefinitions(
      index.filter((file) => importedModules.has(file.module)),
      token.name,
      new Set(["function"]),
    );
    if (results.length > 0) return deduplicate(results);
    return deduplicate(locationsForDefinitions(index, token.name, new Set(["function"]))).slice(0, 20);
  }

  if (token.kind === "remote_component") {
    const candidates = componentModuleFiles(index, owners, token.module);
    return deduplicate(locationsForDefinitions(candidates, token.name, new Set(["function"])));
  }

  const candidates = componentModuleFiles(index, owners, token.module);
  return candidates.map((file) => {
    const line = file.lines.findIndex((text) => /^\s*defmodule\b/.test(text));
    const start = file.lines[line]?.indexOf(file.module) ?? 0;
    return location(file.filePath, Math.max(line, 0), Math.max(start, 0), file.module?.length ?? token.module.length);
  });
}

export function findReferences({
  root,
  filePath,
  source,
  position,
  includeDeclaration = false,
  openDocuments = new Map(),
  analysis = null,
}) {
  const workspace = analysis ?? createWorkspaceAnalysis(root, openDocuments);
  const index = workspace.index;
  const owner = index.find((file) => file.filePath === filePath) ??
    (/\.exs?$/.test(filePath) ? parseElixirFile(filePath, source) : null);
  const handler = eventHandlerAt(owner, position);
  if (!owner?.module || !handler) return [];

  const eventIndex = liveViewEvents(workspace);
  const references = eventIndex.references
    .filter((reference) =>
      reference.name === handler.name &&
      reference.owners.some((candidate) => candidate.module === owner.module),
    )
    .map((reference) => location(
      reference.filePath,
      reference.line,
      reference.start,
      reference.name.length,
    ));

  if (includeDeclaration) {
    references.push(...eventHandlerLocations([owner], handler.name));
  }
  return deduplicate(references);
}

const documents = new Map();
let workspaceRoot = process.cwd();
let workspaceAnalysis = null;
let prewarmTimer = null;

function invalidateWorkspaceAnalysis() {
  workspaceAnalysis = null;
  if (prewarmTimer !== null) clearTimeout(prewarmTimer);
  prewarmTimer = null;
}

function currentWorkspaceAnalysis() {
  workspaceAnalysis ??= createWorkspaceAnalysis(workspaceRoot, documents);
  return workspaceAnalysis;
}

function scheduleWorkspacePrewarm() {
  if (prewarmTimer !== null) clearTimeout(prewarmTimer);
  prewarmTimer = setTimeout(() => {
    prewarmTimer = null;
    try {
      liveViewEvents(currentWorkspaceAnalysis());
    } catch (error) {
      process.stderr.write(`failed to prewarm Surface workspace: ${error.stack ?? error}\n`);
    }
  }, 100);
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  if (message.method === "initialize") {
    const rootUri = message.params?.workspaceFolders?.[0]?.uri ?? message.params?.rootUri;
    if (rootUri) workspaceRoot = uriToPath(rootUri);
    invalidateWorkspaceAnalysis();
    respond(message.id, {
      capabilities: {
        definitionProvider: true,
        referencesProvider: true,
        textDocumentSync: { openClose: true, change: 1 },
      },
      serverInfo: { name: "surface-language-server", version: "0.0.6" },
    });
    return;
  }

  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }

  if (message.method === "exit") process.exit(0);

  if (message.method === "textDocument/didOpen") {
    documents.set(message.params.textDocument.uri, message.params.textDocument.text);
    invalidateWorkspaceAnalysis();
    scheduleWorkspacePrewarm();
    return;
  }

  if (message.method === "textDocument/didChange") {
    const change = message.params.contentChanges.at(-1);
    if (change?.text !== undefined) documents.set(message.params.textDocument.uri, change.text);
    invalidateWorkspaceAnalysis();
    scheduleWorkspacePrewarm();
    return;
  }

  if (message.method === "textDocument/didClose") {
    documents.delete(message.params.textDocument.uri);
    invalidateWorkspaceAnalysis();
    scheduleWorkspacePrewarm();
    return;
  }

  if (message.method === "textDocument/definition") {
    const uri = message.params.textDocument.uri;
    const filePath = uriToPath(uri);
    const source = documents.get(uri) ?? fs.readFileSync(filePath, "utf8");
    respond(message.id, findDefinitions({
      root: workspaceRoot,
      filePath,
      source,
      position: message.params.position,
      openDocuments: documents,
      analysis: currentWorkspaceAnalysis(),
    }));
    return;
  }

  if (message.method === "textDocument/references") {
    const uri = message.params.textDocument.uri;
    const filePath = uriToPath(uri);
    const source = documents.get(uri) ?? fs.readFileSync(filePath, "utf8");
    respond(message.id, findReferences({
      root: workspaceRoot,
      filePath,
      source,
      position: message.params.position,
      includeDeclaration: message.params.context?.includeDeclaration ?? false,
      openDocuments: documents,
      analysis: currentWorkspaceAnalysis(),
    }));
    return;
  }

  if (message.id !== undefined) respond(message.id, null);
}

function startServer() {
  let input = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (true) {
      const headerEnd = input.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = input.subarray(0, headerEnd).toString("ascii");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        input = input.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (input.length < bodyStart + length) return;
      const body = input.subarray(bodyStart, bodyStart + length).toString("utf8");
      input = input.subarray(bodyStart + length);
      try {
        handle(JSON.parse(body));
      } catch (error) {
        process.stderr.write(`${error.stack ?? error}\n`);
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer();
}

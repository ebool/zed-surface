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

    const assignmentPatterns = [
      new RegExp(`\\bassign(?:_new)?\\s*\\([^\\n]*?:([a-zA-Z_]\\w*[!?]?)`, "g"),
      new RegExp(`\\bassign\\s*\\([^\\n]*?\\b([a-zA-Z_]\\w*[!?]?)\\s*:`, "g"),
      new RegExp(`\\bstream(?:_configure)?\\s*\\([^\\n]*?:([a-zA-Z_]\\w*[!?]?)`, "g"),
    ];
    for (const pattern of assignmentPatterns) {
      while ((match = pattern.exec(lineText)) !== null) {
        const name = match[1];
        definitions.push({ kind: "assign", name, line, start: lineText.indexOf(name, match.index) });
      }
    }
  });

  return { filePath, module: moduleMatch?.[1], lines, embeds, definitions, imports, aliases };
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

  const sibling = normalized.replace(/\.sface$/, ".ex");
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

function declarationLocationsForTemplate(owners, templatePath, name) {
  const helper = path.basename(templatePath, ".sface");
  const results = [];

  for (const owner of owners) {
    const invocationLines = owner.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => new RegExp(`\\b${helper}\\s*\\(`).test(line))
      .map(({ index }) => index);
    const targetLine = invocationLines.at(-1);
    const matches = owner.definitions.filter(
      (definition) =>
        definition.name === name &&
        new Set(["attr", "prop", "data", "slot"]).has(definition.kind),
    );

    if (targetLine === undefined) {
      for (const definition of matches) {
        results.push(location(owner.filePath, definition.line, definition.start, name.length));
      }
      continue;
    }

    const preceding = matches.filter((definition) => definition.line < targetLine);
    const selected = preceding.at(-1) ?? matches[0];
    if (selected) results.push(location(owner.filePath, selected.line, selected.start, name.length));
  }

  return results;
}

function tokenAt(source, position) {
  const line = source.split(/\r?\n/)[position.line] ?? "";
  const character = Math.min(position.character, line.length);

  for (const match of line.matchAll(/@[a-zA-Z_]\w*[!?]?/g)) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return { kind: "assign", name: match[0].slice(1) };
    }
  }

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
      return { kind: "local_component", name: match[1] };
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

function resolveModuleName(owner, requested) {
  const explicit = owner?.aliases.find((entry) => entry.as === requested);
  return explicit?.module ?? requested;
}

export function findDefinitions({ root, filePath, source, position, openDocuments = new Map() }) {
  const token = tokenAt(source, position);
  if (!token) return [];

  const index = indexWorkspace(root, openDocuments);
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

    return deduplicate(locationsForDefinitions(index, token.name, new Set(["attr", "prop", "data", "slot", "assign"]))).slice(0, 20);
  }

  if (token.kind === "local_component") {
    let results = locationsForDefinitions(owners, token.name, new Set(["function"]));
    if (results.length > 0) return deduplicate(results);

    const importedModules = new Set(owners.flatMap((owner) => owner.imports));
    results = locationsForDefinitions(
      index.filter((file) => importedModules.has(file.module)),
      token.name,
      new Set(["function"]),
    );
    if (results.length > 0) return deduplicate(results);

    return deduplicate(locationsForDefinitions(index, token.name, new Set(["function"]))).slice(0, 20);
  }

  if (token.kind === "remote_component") {
    const requestedModules = new Set(
      owners.map((owner) => resolveModuleName(owner, token.module)),
    );
    const candidates = index.filter((file) =>
      [...requestedModules].some((requested) => file.module === requested || file.module?.endsWith(`.${requested}`)),
    );
    return deduplicate(locationsForDefinitions(candidates, token.name, new Set(["function"])));
  }

  const candidates = index.filter((file) =>
    file.module === token.module || file.module?.endsWith(`.${token.module}`),
  );
  return candidates.map((file) => {
    const line = file.lines.findIndex((text) => /^\s*defmodule\b/.test(text));
    const start = file.lines[line]?.indexOf(file.module) ?? 0;
    return location(file.filePath, Math.max(line, 0), Math.max(start, 0), file.module?.length ?? token.module.length);
  });
}

const documents = new Map();
let workspaceRoot = process.cwd();

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
    respond(message.id, {
      capabilities: {
        definitionProvider: true,
        textDocumentSync: { openClose: true, change: 1 },
      },
      serverInfo: { name: "surface-language-server", version: "0.1.0" },
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
    return;
  }

  if (message.method === "textDocument/didChange") {
    const change = message.params.contentChanges.at(-1);
    if (change?.text !== undefined) documents.set(message.params.textDocument.uri, change.text);
    return;
  }

  if (message.method === "textDocument/didClose") {
    documents.delete(message.params.textDocument.uri);
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

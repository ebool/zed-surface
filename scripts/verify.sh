#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
grammar_dir="$project_dir/grammar"
fixture="$grammar_dir/test/fixtures/representative.sface"

npm --prefix "$grammar_dir" ci
npm --prefix "$grammar_dir" run generate
npm --prefix "$grammar_dir" test

for query in \
  "$project_dir/languages/surface/highlights.scm" \
  "$project_dir/languages/surface/injections.scm" \
  "$project_dir/languages/surface/brackets.scm" \
  "$project_dir/languages/surface/indents.scm" \
  "$project_dir/languages/surface/outline.scm"
do
  (cd "$grammar_dir" && ./node_modules/.bin/tree-sitter query --quiet "$query" "$fixture")
done

(cd "$grammar_dir" && ./node_modules/.bin/tree-sitter parse --quiet "$fixture")

for source_file in "$@"
do
  source_dir=$(CDPATH= cd -- "$(dirname -- "$source_file")" && pwd)
  source_path="$source_dir/$(basename -- "$source_file")"
  (cd "$grammar_dir" && ./node_modules/.bin/tree-sitter parse --quiet "$source_path")
done

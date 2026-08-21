(doctype) @tag.doctype

(tag_name) @tag

((component_name) @function
  (#match? @function "^\\."))

((component_name) @type
  (#not-match? @type "^\\."))

(attribute_name) @attribute
(directive_name) @keyword
(block_name) @keyword
(subblock_name) @keyword
(quoted_attribute_value) @string
(comment) @comment
(text) @text.literal

[
  "<"
  "</"
  ">"
  "/>"
  "<!"
] @punctuation.bracket

[
  "{"
  "}"
  "{#"
  "{/"
] @punctuation.bracket

[
  "="
  ":"
  "..."
  "^"
] @operator

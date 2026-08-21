(doctype) @tag.doctype

(tag_name) @tag

; Phoenix function components use the theme's cyan/type color while retaining
; a semantic function fallback for themes that do not style types.
((component_name) @function @type
  (#match? @type "^\\."))

; Surface module components and macro components use the constant color, which
; keeps them visually separate from ordinary HTML tags.
((component_name) @type @constant
  (#match? @constant "^[A-Z#]"))

; Named slots are structural properties of their parent component.
((component_name) @label @property
  (#match? @property "^:"))

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

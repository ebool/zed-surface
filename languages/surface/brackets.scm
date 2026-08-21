(expression "{" @open "}" @close)
(expression_value "{" @open "}" @close)

(start_tag "<" @open ">" @close)
(end_tag "</" @open ">" @close)
(self_closing_tag "<" @open "/>" @close)
(void_tag "<" @open ">" @close)

(start_component "<" @open ">" @close)
(end_component "</" @open ">" @close)
(self_closing_component "<" @open "/>" @close)

(start_block "{#" @open "}" @close)
(subblock "{#" @open "}" @close)
(end_block "{/" @open "}" @close)

((tag
   (start_tag) @open
   (end_tag) @close)
 (#set! newline.only))

((component
   (start_component) @open
   (end_component) @close)
 (#set! newline.only))

((block
   (start_block) @open
   (end_block) @close)
 (#set! newline.only))

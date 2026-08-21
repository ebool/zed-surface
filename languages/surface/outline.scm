(component
  (start_component
    (component_name) @name)) @item

((tag
   (start_tag
     (tag_name) @_tag
     (attribute
       (attribute_name) @_attribute
       (quoted_attribute_value
         (attribute_value) @name)))) @item
 (#match? @_tag "^(main|nav|section|article|header|footer)$")
 (#eq? @_attribute "id"))

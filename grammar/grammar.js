module.exports = grammar({
  name: "surface",

  extras: ($) => [/\s/],

  rules: {
    fragment: ($) => repeat($._node),

    _node: ($) =>
      choice(
        $.doctype,
        $.tag,
        $.component,
        $.text,
        $.expression,
        $.block,
        $.comment,
      ),

    doctype: ($) =>
      seq("<!", /[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/, /[^>]+/, ">"),

    tag: ($) =>
      choice(
        seq($.start_tag, repeat($._node), $.end_tag),
        $.self_closing_tag,
        $.void_tag,
      ),

    component: ($) =>
      choice(
        seq($.start_component, repeat($._node), $.end_component),
        $.self_closing_component,
      ),

    block: ($) =>
      seq(
        $.start_block,
        repeat(choice($.subblock, $._node)),
        $.end_block,
      ),

    start_tag: ($) =>
      seq(
        "<",
        $.tag_name,
        repeat(choice($.attribute, $.expression, $.directive)),
        ">",
      ),

    end_tag: ($) => seq("</", $.tag_name, ">"),

    self_closing_tag: ($) =>
      seq(
        "<",
        $.tag_name,
        repeat(choice($.attribute, $.expression, $.directive)),
        "/>",
      ),

    void_tag: ($) =>
      seq(
        "<",
        alias(
          choice(
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
          ),
          $.tag_name,
        ),
        repeat(choice($.attribute, $.expression, $.directive)),
        optional("/"),
        ">",
      ),

    start_component: ($) =>
      seq(
        "<",
        $.component_name,
        repeat(choice($.attribute, $.expression, $.directive)),
        ">",
      ),

    end_component: ($) => seq("</", $.component_name, ">"),

    self_closing_component: ($) =>
      seq(
        "<",
        $.component_name,
        repeat(choice($.attribute, $.expression, $.directive)),
        "/>",
      ),

    expression: ($) =>
      seq("{", optional(choice("=", "...", "^")), $.expression_value, "}"),

    expression_value: ($) =>
      repeat1(choice(/[^{}]+/, seq("{", optional($.expression_value), "}"))),

    comment: ($) => choice($._public_comment, $._private_comment),

    _public_comment: ($) =>
      seq(
        "<!--",
        optional(alias(/([^-]|-[^-]|--[^>])+/, $.comment_content)),
        "-->",
      ),

    _private_comment: ($) =>
      seq(
        "{!--",
        optional(alias(/([^-]|-[^-]|--[^}])+/, $.comment_content)),
        "--}",
      ),

    start_block: ($) =>
      seq("{#", $.block_name, optional($.expression_value), "}"),

    block_name: ($) => choice("if", "unless", "for", "case"),

    end_block: ($) => seq("{/", $.block_name, "}"),

    subblock: ($) =>
      seq("{#", $.subblock_name, optional($.expression_value), "}"),

    subblock_name: ($) => choice("else", "elseif", "match"),

    attribute: ($) =>
      seq(
        $.attribute_name,
        optional(
          seq(
            "=",
            choice($.quoted_attribute_value, $.attribute_value, $.expression),
          ),
        ),
      ),

    directive: ($) =>
      seq(
        ":",
        $.directive_name,
        optional(
          seq(
            "=",
            choice($.quoted_attribute_value, $.attribute_value, $.expression),
          ),
        ),
      ),

    quoted_attribute_value: ($) =>
      choice(
        seq("'", optional(alias(/[^']+/, $.attribute_value)), "'"),
        seq('"', optional(alias(/[^\"]+/, $.attribute_value)), '"'),
      ),

    attribute_value: ($) => /[^<>{}"'=\s]+/,
    tag_name: ($) => /[a-z][a-z0-9:-]*/,
    component_name: ($) =>
      choice(
        /[A-Z][A-Za-z0-9_.:-]*/,
        /[.#:][A-Za-z][A-Za-z0-9_.:-]*/,
      ),
    attribute_name: ($) => /[A-Za-z_@][A-Za-z0-9_@.:-]*/,
    directive_name: ($) => /[a-z][a-z0-9_-]*/,
    text: ($) => /[^<>{}\s]([^<>{}]*[^<>{}\s])?/,
  },
});

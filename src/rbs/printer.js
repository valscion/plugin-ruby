const {
  concat,
  group,
  hardline,
  indent,
  join,
  line,
  softline
} = require("../prettier");

function getSortedKeys(object) {
  return Object.keys(object).sort(
    (left, right) =>
      object[left].type.location.start_pos -
      object[right].type.location.start_pos
  );
}

function isMethodNameEscaped(node, opts) {
  const pos = node.location.start_pos + 4;
  const name = opts.originalText.slice(pos, pos + 2).trimStart();

  return name[0] === "`" && name[1] !== ":";
}

function printAnnotation(path) {
  const node = path.getValue();

  return concat(["%a{", node.string, "}"]);
}

function printComment(path) {
  const node = path.getValue();
  const lines = node.string.slice(0, -1).split("\n");

  return join(
    hardline,
    lines.map((segment) => `# ${segment}`)
  );
}

function printClassInstance(path, opts, print) {
  const node = path.getValue();

  if (node.args.length === 0) {
    return node.name;
  }

  return group(
    concat([
      node.name,
      "[",
      join(
        ", ",
        path.map((typePath) => printType(typePath, opts, print), "args")
      ),
      "]"
    ])
  );
}

function printString(value, opts) {
  if (opts.rubySingleQuote) {
    return `'${value.slice(1, -1)}'`;
  } else {
    return value;
  }
}

function printType(path, opts, print) {
  const node = path.getValue();

  switch (node.class) {
    case "literal":
      if (node.literal[0] === '"') {
        return printString(node.literal, opts);
      }
      return node.literal;
    case "optional":
      return concat([
        path.call((typePath) => printType(typePath, opts, print), "type"),
        "?"
      ]);
    case "tuple":
      // If we don't have any sub types, we explicitly need the space in between
      // the brackets to not confuse the parser.
      if (node.types.length === 0) {
        return "[ ]";
      }

      return group(
        concat([
          "[",
          join(
            ", ",
            path.map((typePath) => printType(typePath, opts, print), "types")
          ),
          "]"
        ])
      );
    case "union": {
      const doc = group(
        join(
          concat([line, "| "]),
          path.map((typePath) => printType(typePath, opts, print), "types")
        )
      );
      return path.getParentNode().class === "intersection"
        ? concat(["(", doc, ")"])
        : doc;
    }
    case "intersection":
      return group(
        join(
          concat([line, "& "]),
          path.map((typePath) => printType(typePath, opts, print), "types")
        )
      );
    case "class_singleton":
      return concat(["singleton(", node.name, ")"]);
    case "proc":
      return concat(["^", printMethodDefinitionType(path, opts, print)]);
    case "record": {
      const parts = [];

      getSortedKeys(node.fields).forEach((field) => {
        const fieldParts = [];

        if (node.fields[field].joiner === "rocket") {
          fieldParts.push(`${field} => `);
        } else {
          fieldParts.push(`${field}: `);
        }

        fieldParts.push(
          path.call(
            (typePath) => printType(typePath, opts, print),
            "fields",
            field,
            "type"
          )
        );
        parts.push(concat(fieldParts));
      });

      return group(
        concat([
          "{",
          indent(concat([line, join(concat([",", line]), parts)])),
          line,
          "}"
        ])
      );
    }
    case "class_instance":
    case "interface":
      return printClassInstance(path, opts, print);
    case "alias":
    case "variable":
      return node.name;
    case "bool":
    case "bot":
    case "class":
    case "instance":
    case "nil":
    case "self":
    case "top":
    case "untyped":
    case "void":
      return node.class;
    /* istanbul ignore next */
    default:
      throw new Error(`unknown type: ${node.class}`);
  }
}

function printAlias(path, _opts, _print) {
  const node = path.getValue();

  if (node.kind === "singleton") {
    return concat(["alias self.", node.new_name, " self.", node.old_name]);
  }

  return concat(["alias ", node.new_name, " ", node.old_name]);
}

function printAttr(path, opts, print) {
  const node = path.getValue();
  const parts = [node.member, " "];

  if (node.kind === "singleton") {
    parts.push("self.");
  }

  parts.push(node.name);

  if (node.ivar_name === false) {
    parts.push("()");
  } else if (node.ivar_name) {
    parts.push("(", node.ivar_name, ")");
  }

  parts.push(
    ": ",
    path.call((typePath) => printType(typePath, opts, print), "type")
  );

  return group(concat(parts));
}

function printTypeParam(path, _opts, _print) {
  const node = path.getValue();
  const parts = [];

  if (node.skip_validation) {
    parts.push("unchecked");
  }

  if (node.variance === "covariant") {
    parts.push("out");
  } else if (node.variance === "contravariant") {
    parts.push("in");
  }

  parts.push(node.name);
  return join(" ", parts);
}

function printMethodParam(path, opts, print) {
  const node = path.getValue();
  const parts = [
    path.call((typePath) => printType(typePath, opts, print), "type")
  ];

  if (node.name) {
    parts.push(" ");

    if (node.escaped) {
      parts.push("`", node.name, "`");
    } else {
      parts.push(node.name);
    }
  }

  return concat(parts);
}

function printMethodDefinitionParams(path, opts, print) {
  const node = path.getValue();
  let parts = [];

  parts = parts.concat(
    path.map(
      (paramPath) => printMethodParam(paramPath, opts, print),
      "required_positionals"
    )
  );

  path.each((paramPath) => {
    parts.push(concat(["?", printMethodParam(paramPath, opts, print)]));
  }, "optional_positionals");

  if (node.rest_positionals) {
    parts.push(
      concat([
        "*",
        path.call(
          (paramPath) => printMethodParam(paramPath, opts, print),
          "rest_positionals"
        )
      ])
    );
  }

  parts = parts.concat(
    path.map(
      (paramPath) => printMethodParam(paramPath, opts, print),
      "trailing_positionals"
    )
  );

  getSortedKeys(node.required_keywords).forEach((name) => {
    parts.push(
      concat([
        name,
        ": ",
        path.call(
          (paramPath) => printMethodParam(paramPath, opts, print),
          "required_keywords",
          name
        )
      ])
    );
  });

  getSortedKeys(node.optional_keywords).forEach((name) => {
    parts.push(
      concat([
        "?",
        name,
        ": ",
        path.call(
          (paramPath) => printMethodParam(paramPath, opts, print),
          "optional_keywords",
          name
        )
      ])
    );
  });

  if (node.rest_keywords) {
    parts.push(
      concat([
        "**",
        path.call(
          (paramPath) => printMethodParam(paramPath, opts, print),
          "rest_keywords"
        )
      ])
    );
  }

  return parts;
}

function printMethodDefinitionType(path, opts, print) {
  const node = path.getValue();
  const parts = [];

  // We won't have a type_params key if we're printing a block
  if (node.type_params && node.type_params.length > 0) {
    parts.push("[", join(", ", node.type_params), "] ");
  }

  let params = path.call(
    (typePath) => printMethodDefinitionParams(typePath, opts, print),
    "type"
  );

  if (params.length > 0) {
    parts.push(
      "(",
      indent(concat([softline, join(concat([",", line]), params)])),
      softline,
      ") "
    );
  }

  if (node.block) {
    if (!node.block.required) {
      parts.push("?");
    }

    parts.push(
      "{",
      indent(
        concat([
          line,
          path.call(
            (blockPath) => printMethodDefinitionType(blockPath, opts, print),
            "block"
          )
        ])
      ),
      line,
      "} "
    );
  }

  parts.push(
    "-> ",
    path.call(
      (typePath) => printType(typePath, opts, print),
      "type",
      "return_type"
    )
  );

  return group(concat(parts));
}

function printMethodDefinition(path, opts, print) {
  const node = path.getValue();
  let typeDocs = path.map(
    (typePath) => printMethodDefinitionType(typePath, opts, print),
    "types"
  );

  if (node.overload) {
    typeDocs.push("...");
  }

  if (typeDocs.length === 1) {
    typeDocs = concat([" ", typeDocs[0]]);
  } else {
    typeDocs = indent(
      group(concat([line, join(concat([line, "| "]), typeDocs)]))
    );
  }

  const parts = ["def "];

  if (node.kind === "singleton") {
    parts.push("self.");
  } else if (node.kind === "singleton_instance") {
    parts.push("self?.");
  }

  const escaped = isMethodNameEscaped(node, opts);
  parts.push(escaped ? `\`${node.name}\`` : node.name, ":", typeDocs);

  return group(concat(parts));
}

function printTypeAlias(path, opts, print) {
  const node = path.getValue();

  return group(
    concat([
      "type ",
      node.name,
      " =",
      indent(
        group(
          concat([
            line,
            path.call((typePath) => printType(typePath, opts, print), "type")
          ])
        )
      )
    ])
  );
}

function printMembers(path, opts, print) {
  let lastLine = null;
  const memberDocs = [];

  path.each((memberPath) => {
    const memberNode = memberPath.getValue();

    if (lastLine !== null && memberNode.location.start.line - lastLine >= 2) {
      memberDocs.push(concat([hardline, hardline]));
    } else {
      memberDocs.push(hardline);
    }

    memberDocs.push(print(memberPath));
    lastLine = memberNode.location.end.line;
  });

  return concat(memberDocs);
}

function printInterface(path, opts, print) {
  const node = path.getValue();
  const parts = ["interface ", node.name];

  if (node.type_params.params.length > 0) {
    parts.push(
      "[",
      join(
        ", ",
        path.map(
          (typePath) => printTypeParam(typePath, opts, print),
          "type_params",
          "params"
        )
      ),
      "]"
    );
  }

  parts.push(
    indent(
      path.call(
        (membersPath) => printMembers(membersPath, opts, print),
        "members"
      )
    ),
    hardline,
    "end"
  );

  return group(concat(parts));
}

function printClass(path, opts, print) {
  const node = path.getValue();
  const parts = ["class ", node.name];

  if (node.type_params.params.length > 0) {
    parts.push(
      "[",
      join(
        ", ",
        path.map(
          (typePath) => printTypeParam(typePath, opts, print),
          "type_params",
          "params"
        )
      ),
      "]"
    );
  }

  if (node.super_class) {
    parts.push(
      " < ",
      path.call(
        (classPath) => printClassInstance(classPath, opts, print),
        "super_class"
      )
    );
  }

  parts.push(
    indent(
      path.call(
        (membersPath) => printMembers(membersPath, opts, print),
        "members"
      )
    ),
    hardline,
    "end"
  );

  return group(concat(parts));
}

function printModule(path, opts, print) {
  const node = path.getValue();
  const parts = ["module ", node.name];

  if (node.type_params.params.length > 0) {
    parts.push(
      "[",
      join(
        ", ",
        path.map(
          (typePath) => printTypeParam(typePath, opts, print),
          "type_params",
          "params"
        )
      ),
      "]"
    );
  }

  if (node.self_types.length > 0) {
    parts.push(
      " : ",
      join(
        ", ",
        path.map(
          (typePath) => printClassInstance(typePath, opts, print),
          "self_types"
        )
      )
    );
  }

  parts.push(
    indent(
      path.call(
        (membersPath) => printMembers(membersPath, opts, print),
        "members"
      )
    ),
    hardline,
    "end"
  );

  return group(concat(parts));
}

function printConstant(path, opts, print) {
  const node = path.getValue();

  return group(
    concat([
      node.name,
      ": ",
      path.call((typePath) => printType(typePath, opts, print), "type")
    ])
  );
}

function printMixin(path, opts, print) {
  const node = path.getValue();

  return group(
    concat([node.member, " ", printClassInstance(path, opts, print)])
  );
}

function printVariable(path, opts, print) {
  const node = path.getValue();

  return group(
    concat([
      node.name,
      ": ",
      path.call((typePath) => printType(typePath, opts, print), "type")
    ])
  );
}

function printRoot(path, opts, print) {
  return concat([
    join(concat([hardline, hardline]), path.map(print, "declarations")),
    hardline
  ]);
}

// This is the generic node print function, used to convert any node in the AST
// into its equivalent Doc representation.
function printNode(path, opts, print) {
  const node = path.getValue();
  let doc = null;

  if (node.declarations) {
    return printRoot(path, opts, print);
  }

  /* istanbul ignore else */
  if (node.declaration) {
    switch (node.declaration) {
      case "alias":
        doc = printTypeAlias(path, opts, print);
        break;
      case "class":
        doc = printClass(path, opts, print);
        break;
      case "constant":
      case "global":
        doc = printConstant(path, opts, print);
        break;
      case "interface":
        doc = printInterface(path, opts, print);
        break;
      case "module":
        doc = printModule(path, opts, print);
        break;
      /* istanbul ignore next */
      default:
        throw new Error(`unknown declaration: ${node.declaration}`);
    }
  } else if (node.member) {
    switch (node.member) {
      case "alias":
        doc = printAlias(path, opts, print);
        break;
      case "attr_accessor":
      case "attr_reader":
      case "attr_writer":
        doc = printAttr(path, opts, print);
        break;
      case "class_variable":
      case "instance_variable":
        doc = printVariable(path, opts, print);
        break;
      case "class_instance_variable":
        doc = concat(["self.", printVariable(path, opts, print)]);
        break;
      case "include":
      case "extend":
      case "prepend":
        doc = printMixin(path, opts, print);
        break;
      case "public":
      case "private":
        doc = node.member;
        break;
      case "method_definition":
        doc = printMethodDefinition(path, opts, print);
        break;
      /* istanbul ignore next */
      default:
        throw new Error(`unknown member: ${node.member}`);
    }
  } else {
    const ast = JSON.stringify(node, null, 2);
    throw new Error(`Unsupported node encountered:\n${ast}`);
  }

  // Certain nodes can't have annotations at all
  if (node.annotations && node.annotations.length > 0) {
    doc = join(hardline, path.map(printAnnotation, "annotations").concat(doc));
  }

  if (node.comment) {
    doc = concat([path.call(printComment, "comment"), hardline, doc]);
  }

  return doc;
}

// This is an escape-hatch to ignore nodes in the tree. If you have a comment
// that includes this pattern, then the entire node will be ignored and just the
// original source will be printed out.
function hasPrettierIgnore(path) {
  const node = path.getValue();

  return node.comment && node.comment.string.includes("prettier-ignore");
}

module.exports = {
  print: printNode,
  hasPrettierIgnore
};

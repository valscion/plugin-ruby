const { formatAST } = require("prettier").__debug;

function parseHTMLERb(text, parsers, opts) {
  const replaced = text.replace(/(<%=?)\s*(.+?)\s*%>/g, (_match, tag, ruby) => {
    const ast = JSON.stringify(parsers.ruby(ruby, parsers, opts));
    const oper = tag === "<%=" ? "p" : "e";

    return `<prettier>\n${oper}-${ast}\n</prettier>`;
  });

  return parsers.html(replaced, parsers, opts);
}

function printHTMLERb(path, opts, _print) {
  const htmlOpts = Object.assign({}, opts, { parser: "html" });
  const { formatted } = formatAST(path.getValue(), htmlOpts);

  const pattern = /<prettier>\s+(p|e)-({.+})\s+<\/prettier>/g;
  const replaced = formatted.replace(pattern, (_match, oper, ast) => {
    const rubyOpts = Object.assign({}, opts, { parser: "ruby" });
    const { formatted: ruby } = formatAST(JSON.parse(ast), rubyOpts);

    const tag = oper === "p" ? "<%=" : "<%";
    return `${tag} ${ruby.replace(/\n$/, "")} %>`;
  });

  return replaced;
}

module.exports = {
  parse: parseHTMLERb,
  print: printHTMLERb
};

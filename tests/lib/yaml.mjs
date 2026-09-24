// Minimal YAML subset parser, so scenario fixtures can be YAML with zero
// npm dependencies. Supported:
//
//   key: value                 scalars: plain, "double-quoted", 'single-quoted',
//   key:                       numbers, true/false/null; keys may contain / (paths)
//     nested: map
//   key:
//     - item                   sequences of scalars or maps
//     - k: v
//       k2: v2
//   key: [a, b, c]             flow sequence of scalars
//   key: |                     block scalar (literal); `>` folds lines
//     multi
//     line
//   # comments
//
// Anything else throws with a line number. Keep fixtures inside this subset.

export function parseYaml(text) {
  const lines = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\t/g, "  ");
    lines.push({ no: i + 1, raw: line });
  });
  const p = new Parser(lines);
  const value = p.parseBlock(0);
  p.skipBlank();
  if (p.pos < lines.length) p.fail("unexpected content");
  return value;
}

class Parser {
  constructor(lines) {
    this.lines = lines;
    this.pos = 0;
  }

  fail(msg, no) {
    throw new Error(`yaml: ${msg} at line ${no ?? this.cur()?.no ?? "EOF"}`);
  }

  cur() {
    return this.lines[this.pos];
  }

  isBlankOrComment(line) {
    const t = line.raw.trim();
    return t === "" || t.startsWith("#");
  }

  skipBlank() {
    while (this.pos < this.lines.length && this.isBlankOrComment(this.cur())) this.pos++;
  }

  indentOf(line) {
    return line.raw.match(/^ */)[0].length;
  }

  parseBlock(indent) {
    this.skipBlank();
    const line = this.cur();
    if (!line) return null;
    const ind = this.indentOf(line);
    if (ind < indent) return null;
    const content = line.raw.slice(ind);
    if (content.startsWith("- ") || content === "-") return this.parseSeq(ind);
    return this.parseMap(ind);
  }

  parseMap(indent) {
    const obj = {};
    for (;;) {
      this.skipBlank();
      const line = this.cur();
      if (!line) break;
      const ind = this.indentOf(line);
      if (ind < indent) break;
      if (ind > indent) this.fail("bad indentation");
      const content = line.raw.slice(ind);
      if (content.startsWith("- ")) this.fail("sequence item where a mapping key was expected");
      const m = content.match(/^([A-Za-z0-9_./-]+):(?:\s+(.*))?$/);
      if (!m) this.fail(`cannot parse mapping line: ${JSON.stringify(content)}`);
      const key = m[1];
      const rest = m[2] === undefined ? "" : stripComment(m[2]);
      this.pos++;
      obj[key] = this.parseValue(rest, indent, line.no);
    }
    return obj;
  }

  parseSeq(indent) {
    const arr = [];
    for (;;) {
      this.skipBlank();
      const line = this.cur();
      if (!line) break;
      const ind = this.indentOf(line);
      if (ind < indent) break;
      if (ind > indent) this.fail("bad indentation in sequence");
      const content = line.raw.slice(ind);
      if (!(content.startsWith("- ") || content === "-")) break;
      const rest = stripComment(content.slice(2).trim());
      // "- key: value" starts an inline mapping whose further keys sit at indent+2.
      const inlineMap = rest.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
      if (inlineMap && !isQuoted(rest)) {
        // Rewrite the current line as the first line of a nested map at indent+2.
        this.lines[this.pos] = { no: line.no, raw: " ".repeat(indent + 2) + rest };
        arr.push(this.parseMap(indent + 2));
        continue;
      }
      this.pos++;
      arr.push(this.parseValue(rest, indent, line.no));
    }
    return arr;
  }

  parseValue(rest, indent, no) {
    if (rest === "") {
      // Nested block (map or seq) on the following lines, or null.
      this.skipBlank();
      const next = this.cur();
      if (!next) return null;
      const nind = this.indentOf(next);
      const ncontent = next.raw.slice(nind);
      if (nind > indent) return this.parseBlock(nind);
      // A sequence may sit at the same indent as its parent key.
      if (nind === indent && ncontent.startsWith("- ")) return this.parseSeq(nind);
      return null;
    }
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") return this.parseBlockScalar(indent, rest);
    return parseScalar(rest, no);
  }

  parseBlockScalar(indent, marker) {
    const fold = marker.startsWith(">");
    const chomp = marker.endsWith("-");
    const out = [];
    let blockIndent = null;
    while (this.pos < this.lines.length) {
      const line = this.cur();
      if (line.raw.trim() === "") {
        out.push("");
        this.pos++;
        continue;
      }
      const ind = this.indentOf(line);
      if (ind <= indent) break;
      if (blockIndent === null) blockIndent = ind;
      if (ind < blockIndent) this.fail("block scalar line indented less than its first line");
      out.push(line.raw.slice(blockIndent));
      this.pos++;
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    let text = fold ? out.join("\n").replace(/([^\n])\n(?!\n)/g, "$1 ") : out.join("\n");
    if (!chomp) text += "\n";
    return text;
  }
}

function isQuoted(s) {
  return /^["']/.test(s);
}

function stripComment(s) {
  if (isQuoted(s)) return s;
  const idx = s.search(/\s#/);
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function parseScalar(s, no) {
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new Error(`yaml: unterminated double-quoted string at line ${no}`);
    return JSON.parse(s);
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error(`yaml: unterminated single-quoted string at line ${no}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new Error(`yaml: unterminated flow sequence at line ${no}`);
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((x) => parseScalar(x.trim(), no));
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

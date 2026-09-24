// Frontmatter parser for agent/skill markdown files.
//
// Mirrors the constraints of `.opencode/plugins/learning-agent.js`: flat
// `key: value` pairs. Additionally understands the one nested form the Claude
// agent uses (`skills:` followed by `  - item` lines), and reports it so the
// lint can assert that only the Claude tree uses it.

export function splitFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  return { header: match[1], body: match[2] };
}

export function parseFrontmatter(raw) {
  const parts = splitFrontmatter(raw);
  if (!parts) return { ok: false, error: "no frontmatter block (--- ... ---) at top of file" };
  const fm = {};
  const listKeys = [];
  const errors = [];
  const lines = parts.header.split("\n");
  let currentList = null;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem) {
      if (!currentList) errors.push(`line ${i + 1}: list item without a parent key`);
      else fm[currentList].push(listItem[1].trim());
      return;
    }
    if (/^\s/.test(line)) {
      errors.push(`line ${i + 1}: unexpected indentation (nested YAML is not supported)`);
      return;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) {
      errors.push(`line ${i + 1}: not a key: value pair`);
      return;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value === "") {
      fm[key] = [];
      listKeys.push(key);
      currentList = key;
    } else {
      fm[key] = value.replace(/^["']|["']$/g, "");
      currentList = null;
    }
  });
  return { ok: errors.length === 0, errors, frontmatter: fm, listKeys, body: parts.body, header: parts.header };
}

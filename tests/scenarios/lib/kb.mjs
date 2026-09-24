// Reads the knowledge base and traces a scenario run produced, so assertions
// can check citations, sources.md rows and concept files without a model.

import fs from "node:fs";
import path from "node:path";
import { CITATION_RE } from "../../lib/repo.mjs";
import { parseTrace } from "../../../scripts/trace-summary.mjs";

export const CREDIBILITY = ["High", "Medium", "Low"];

export function loadKb(kbRoot, preferredSlug) {
  const topicDirs = fs.existsSync(kbRoot)
    ? fs
        .readdirSync(kbRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
    : [];
  const slug = topicDirs.includes(preferredSlug) ? preferredSlug : topicDirs[0];
  const topicDir = slug ? path.join(kbRoot, slug) : null;
  const files = {};
  if (topicDir) {
    for (const f of fs.readdirSync(topicDir)) {
      if (f.endsWith(".md")) files[f] = fs.readFileSync(path.join(topicDir, f), "utf8");
    }
  }
  const conceptFiles = Object.keys(files).filter((f) => f !== "sources.md").sort();
  const sources = files["sources.md"] ? parseSourcesTable(files["sources.md"]) : null;
  return { root: kbRoot, topicDirs, slug, topicDir, files, conceptFiles, sources, traces: loadTraces(kbRoot) };
}

export function loadTraces(kbRoot) {
  const dir = path.join(kbRoot, ".traces");
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) {
        const { events, errors } = parseTrace(fs.readFileSync(p, "utf8"));
        out.push({ file: p, events, errors });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** All events across all trace files, in file order then line order. */
export function allEvents(kb) {
  return kb.traces.flatMap((t) => t.events);
}

/**
 * Parse the sources.md table. Columns per the research skill:
 * | URL | Title | Date Accessed | Credibility | Summary |
 */
export function parseSourcesTable(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    if (/^-+$/.test(cells[0].replace(/:/g, "")) || cells[0].toLowerCase() === "url") continue;
    const [url, title, date, credibility, ...rest] = cells;
    rows.push({ url: stripLink(url), title: stripLink(title), date, credibility: normaliseCredibility(credibility), credibilityRaw: credibility, summary: rest.join(" | "), raw: line });
  }
  return rows;
}

/** "High", "high (official docs)", "**Medium**" -> High/Medium/Low; anything else is returned as written so it fails the check. */
export function normaliseCredibility(cell) {
  const m = String(cell).replace(/[*_`]/g, "").trim().match(/^(high|medium|low)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : String(cell).trim();
}

function stripLink(cell) {
  const m = cell.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  return m ? (m[2].startsWith("http") ? m[2] : m[1]) : cell;
}

export function isDated(s) {
  return /\b\d{4}-\d{2}-\d{2}\b/.test(s) || /\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\b/.test(s) || /\b[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}\b/.test(s);
}

export function extractCitations(text) {
  return [...text.matchAll(CITATION_RE)].map((m) => m[1].trim());
}

export function extractUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

/** Text of the section under the first heading matching `re`, up to the next heading of the same or higher level. */
export function sectionOf(md, re) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && re.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

/** Does this concept file reference (by URL or title) any of the given sources.md rows? */
export function referencesAnyRow(conceptMd, rows) {
  const urls = extractUrls(conceptMd);
  const lower = conceptMd.toLowerCase();
  return rows.filter((r) => {
    if (r.url.startsWith("http") && urls.some((u) => sameUrl(u, r.url))) return true;
    const t = r.title.toLowerCase();
    return t.length >= 12 && lower.includes(t);
  });
}

function sameUrl(a, b) {
  const norm = (u) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** Split markdown into paragraphs; fenced code blocks and tables count as one paragraph each. */
export function paragraphs(text) {
  const out = [];
  let cur = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

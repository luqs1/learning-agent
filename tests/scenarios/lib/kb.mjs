// Reads the knowledge base and traces a scenario run produced, so assertions
// can check citations, sources.md rows and concept files without a model.

import fs from "node:fs";
import path from "node:path";
import { CITATION_RE } from "../../lib/repo.mjs";
import { parseTrace } from "../../../scripts/trace-summary.mjs";

export const CREDIBILITY = ["High", "Medium", "Low"];

// The sources.md table header the research skill prescribes. The lint checks
// the skill text carries exactly this header, so the two cannot drift apart.
export const SOURCES_COLUMNS = ["URL", "Title", "Type", "Domain", "Tier", "Published", "Accessed", "Related-to", "Summary"];
// The pre-#6 layout, still accepted so old knowledge bases keep parsing.
export const LEGACY_SOURCES_COLUMNS = ["URL", "Title", "Date Accessed", "Credibility", "Summary"];

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
    for (const e of fs.readdirSync(topicDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md")) files[e.name] = fs.readFileSync(path.join(topicDir, e.name), "utf8");
      // One level of entity folders (companies/<slug>.md), keyed by their relative path.
      else if (e.isDirectory() && !e.name.startsWith(".")) {
        for (const f of fs.readdirSync(path.join(topicDir, e.name))) {
          if (f.endsWith(".md")) files[`${e.name}/${f}`] = fs.readFileSync(path.join(topicDir, e.name, f), "utf8");
        }
      }
    }
  }
  // progress.md is learner memory and brief-<date>.md is research-mode output; neither is a concept file.
  // Dot-directories (`.research/` fragments) are never read into `files`; one level of
  // entity folders (`companies/<slug>.md`) is, and those are concept files for the checks.
  const conceptFiles = Object.keys(files).filter((f) => !NON_CONCEPT_FILES.has(f) && !BRIEF_FILE_RE.test(f)).sort();
  const sources = files["sources.md"] ? parseSourcesTable(files["sources.md"]) : null;
  const learnerFile = path.join(kbRoot, "learner.md");
  const learner = fs.existsSync(learnerFile) ? fs.readFileSync(learnerFile, "utf8") : null;
  const progress = files["progress.md"] ?? null;
  // Parallel research (#7): per-angle fragments the researchers wrote before
  // the merge. Kept for the report and for assertions; never cited, never concept files.
  const fragments = {};
  const fragmentsDir = topicDir ? path.join(topicDir, FRAGMENTS_DIR) : null;
  if (fragmentsDir && fs.existsSync(fragmentsDir)) {
    for (const f of fs.readdirSync(fragmentsDir)) {
      if (f.endsWith(".md")) fragments[`${FRAGMENTS_DIR}/${f}`] = fs.readFileSync(path.join(fragmentsDir, f), "utf8");
    }
  }
  // Research-mode briefs, oldest first (the file name carries the date).
  const briefs = Object.keys(files).filter((f) => BRIEF_FILE_RE.test(f)).sort().map((f) => ({ file: f, content: files[f] }));
  return { root: kbRoot, topicDirs, slug, topicDir, files, conceptFiles, sources, learner, progress, fragments, briefs, traces: loadTraces(kbRoot) };
}

/** Files in a topic folder that are not research concept files. */
export const NON_CONCEPT_FILES = new Set(["sources.md", "progress.md"]);
/** Subdirectory of a topic folder holding the per-angle research fragments (parallel research). */
export const FRAGMENTS_DIR = ".research";
/** Research-mode brief files: brief-YYYY-MM-DD.md in the topic folder. */
export const BRIEF_FILE_RE = /^brief-\d{4}-\d{2}-\d{2}\.md$/;
/** Market-research entity files (one entity per file). They cite sources like concept files but follow the entity layout, not the concept template. */
export const ENTITY_FILE_RE = /^(?:companies\/[^/]+|market-size|customers|timeline|courses)\.md$/;

/** The section under `## <name>` (or a bold `**<name>**` line) up to the next heading of either kind; null if absent. */
export function briefSection(md, name) {
  const lines = md.split("\n");
  const isHeading = (l) => /^#{1,6}\s+\S/.test(l) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(l);
  const wanted = new RegExp(`^(?:#{1,6}\\s+|\\s*\\*\\*)\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`, "i");
  const start = lines.findIndex((l) => isHeading(l) && wanted.test(l));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

/** Does this text carry a research-mode brief (a Numbers table or Findings, plus a Contested / Unknown section)? */
export function isBrief(text) {
  return briefSection(text, "Contested / Unknown") !== null && (briefSection(text, "Numbers") !== null || briefSection(text, "Findings") !== null);
}

/**
 * Parse every `| Value | What | Date | Source file | Tier |` table in the text.
 * Returns one entry per data row: { value, what, date, sourceCell, file, tier, raw }
 * where `file` is the first `x.md` / `dir/x.md` mentioned in the Source file cell.
 */
export function parseNumbersTables(text) {
  const rows = [];
  let cols = null;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) {
      cols = null;
      continue;
    }
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes("value") && lower.some((c) => /^source( file)?$/.test(c)) && lower.includes("tier")) {
      cols = lower;
      continue;
    }
    if (!cols) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) continue;
    const at = (name) => {
      const i = cols.findIndex((c) => c === name || (name === "source file" && /^source( file)?$/.test(c)));
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    const sourceCell = at("source file");
    const m = sourceCell.match(/([A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?\.md)/);
    const tierM = at("tier").replace(/[*_`]/g, "").match(/\b([1-5])\b/);
    rows.push({ value: at("value"), what: at("what"), date: at("date"), sourceCell, file: m ? m[1] : "", tier: tierM ? Number(tierM[1]) : null, raw: line });
  }
  return rows;
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
 * Parse the sources.md table. Columns are taken from the header row, so both
 * layouts parse:
 *   current: | URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |
 *   legacy:  | URL | Title | Date Accessed | Credibility | Summary |
 * Every row gets the same shape. `credibility` is High/Medium/Low: from the
 * Credibility cell (legacy) or derived from Tier (1-2 High, 3 Medium, 4-5 Low);
 * an unparseable cell is returned as written so the check fails. `date` is the
 * Accessed / Date Accessed cell.
 */
export function parseSourcesTable(md) {
  const rows = [];
  let columns = null;
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells[0].toLowerCase() === "url") {
      columns = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (/^-+$/.test(cells[0].replace(/:/g, ""))) continue;
    const cols = columns || LEGACY_SOURCES_COLUMNS.map((c) => c.toLowerCase());
    const at = (name) => {
      const i = cols.indexOf(name);
      return i >= 0 && i < cells.length ? cells[i] : "";
    };
    const summaryIdx = cols.indexOf("summary");
    const summary = summaryIdx >= 0 ? cells.slice(summaryIdx).join(" | ") : "";
    const credCell = at("credibility");
    const tierCell = at("tier");
    const credibility = credCell ? normaliseCredibility(credCell) : tierCell ? (tierToCredibility(tierCell) ?? tierCell) : "";
    rows.push({
      url: stripLink(at("url")),
      title: stripLink(at("title")),
      type: at("type"),
      domain: at("domain"),
      tier: tierCell,
      published: at("published"),
      date: at("accessed") || at("date accessed"),
      relatedTo: stripLink(at("related-to")),
      credibility,
      credibilityRaw: credCell || tierCell,
      summary,
      raw: line,
    });
  }
  return rows;
}

/** "High", "high (official docs)", "**Medium**" -> High/Medium/Low; anything else is returned as written so it fails the check. */
export function normaliseCredibility(cell) {
  const m = String(cell).replace(/[*_`]/g, "").trim().match(/^(high|medium|low)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : String(cell).trim();
}

/** Evidence tier 1-5 -> High/Medium/Low (1-2 primary/first-party, 3 reputable secondary, 4-5 weak/forum); null if not a tier. */
export function tierToCredibility(cell) {
  const m = String(cell).replace(/[*_`]/g, "").trim().match(/^([1-5])\b/);
  if (!m) return null;
  const t = Number(m[1]);
  return t <= 2 ? "High" : t === 3 ? "Medium" : "Low";
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

// Hosts too generic to identify a source on their own.
const GENERIC_HOSTS = new Set(["medium.com", "github.com", "youtube.com", "youtu.be", "wikipedia.org", "en.wikipedia.org", "substack.com", "reddit.com", "twitter.com", "x.com", "linkedin.com", "google.com", "arxiv.org"]);

/** Does this concept file reference (by URL, title, or a distinctive hostname) any of the given sources.md rows? */
export function referencesAnyRow(conceptMd, rows) {
  const urls = extractUrls(conceptMd);
  const lower = conceptMd.toLowerCase();
  return rows.filter((r) => {
    if (r.url.startsWith("http") && urls.some((u) => sameUrl(u, r.url))) return true;
    const t = r.title.toLowerCase();
    if (t.length >= 12 && lower.includes(t)) return true;
    const host = hostOf(r.url);
    return host && !GENERIC_HOSTS.has(host) && lower.includes(host);
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
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

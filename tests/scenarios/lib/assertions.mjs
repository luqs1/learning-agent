// Named assertions a scenario can request. Each receives the run context:
//
//   ctx.scenario   the fixture
//   ctx.turns      [{ learner, expect, agent: { text, blocks, toolNames, startedAt, endedAt } }]
//   ctx.kb         loadKb() result: topic files, sources.md rows, traces
//   ctx.events     all trace events, in order
//   ctx.judge      async ({ name, rubric, material }) => { pass, reasoning, evidence }
//
// and returns { pass, detail, reasoning?, evidence?, skipped? }.
//
// Deterministic assertions come first; the LLM-judged ones are marked
// `judged: true` and record the judge's reasoning in the report.
//
// To add an assertion: add an entry here (one object), and reference it from
// a fixture's `assertions:` list. CORE_ASSERTIONS run for every scenario.

import { CITATION_FILE_RE } from "../../lib/repo.mjs";
import { CREDIBILITY, extractCitations, isDated, paragraphs, referencesAnyRow, sectionOf } from "./kb.mjs";
import { filesForJudge, transcriptForJudge } from "./judge.mjs";

const TRACE_TOLERANCE_MS = 2000;

function firstCitationTurn(ctx) {
  return ctx.turns.findIndex((t) => extractCitations(t.agent.text).length > 0);
}

function eventsBetween(ctx, startMs, endMs) {
  return ctx.events.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= startMs - TRACE_TOLERANCE_MS && t <= endMs + TRACE_TOLERANCE_MS;
  });
}

function hasQuestion(text) {
  return /\?/.test(text.replace(/```[\s\S]*?```/g, ""));
}

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Transcript for a judge with the deliberately wrong learner turns labelled. */
function transcriptWithExpectations(turns) {
  return turns
    .map((t, i) => `### Turn ${i + 1}\n\n**Learner${t.expect === "correction" ? " (wrong on purpose)" : ""}:** ${t.learner}\n\n**Agent:**\n${t.agent.text || "(no text)"}`)
    .join("\n\n");
}

export const ASSERTIONS = {
  trace_written: {
    describe: "the agent wrote a well-formed JSONL trace with session.start under <kb>/.traces/<slug>/",
    run(ctx) {
      const traces = ctx.kb.traces;
      if (!traces.length) return { pass: false, detail: `no *.jsonl under ${ctx.kb.root}/.traces` };
      const malformed = traces.flatMap((t) => t.errors.map((e) => `${t.file}:${e.line} ${e.error}`));
      const names = new Set(ctx.events.map((e) => e.event));
      const missing = ["session.start", "gate.check", "teach"].filter((n) => !names.has(n));
      const inSlugDir = traces.some((t) => t.file.includes(`/.traces/${ctx.scenario.slug}/`));
      const problems = [];
      if (malformed.length) problems.push(`${malformed.length} malformed line(s): ${malformed.slice(0, 3).join("; ")}`);
      if (missing.length) problems.push(`missing events: ${missing.join(", ")}`);
      if (!inSlugDir) problems.push(`no trace under .traces/${ctx.scenario.slug}/ (found ${traces.map((t) => t.file).join(", ")})`);
      return { pass: problems.length === 0, detail: problems.join(" | ") || `${ctx.events.length} events in ${traces.length} file(s): ${[...names].join(", ")}` };
    },
  },

  no_trace_narration: {
    describe: "the agent never mentions tracing or the trace file to the learner (tracing is silent bookkeeping)",
    run(ctx) {
      const hits = [];
      ctx.turns.forEach((t, i) => {
        const text = t.agent.text.replace(/```[\s\S]*?```/g, "");
        const m = text.match(/\b(trace|tracing|trace file|jsonl|session log)\b/i);
        if (m) hits.push(`turn ${i + 1}: "${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}"`);
      });
      return { pass: hits.length === 0, detail: hits.join(" | ") || "no tracing talk in any turn" };
    },
  },

  probe_first: {
    describe: "the first agent turn asks a probing question and does not explain (no citations, few paragraphs)",
    run(ctx, { max_paragraphs = 4 } = {}) {
      const first = ctx.turns[0]?.agent.text || "";
      const problems = [];
      if (!hasQuestion(first)) problems.push("no question mark in the first turn");
      const cites = extractCitations(first);
      if (cites.length) problems.push(`first turn already cites ${cites.length} source(s): it is explaining, not probing`);
      const n = paragraphs(first).length;
      if (n > max_paragraphs) problems.push(`first turn has ${n} paragraphs (max ${max_paragraphs})`);
      return { pass: problems.length === 0, detail: problems.join(" | ") || `question asked in ${n} paragraph(s), no citations` };
    },
  },

  gate_before_claim: {
    describe: "a gate.check trace event precedes the first cited claim and the first teach event",
    run(ctx) {
      const gates = ctx.events.map((e, i) => ({ e, i })).filter(({ e }) => e.event === "gate.check");
      if (!gates.length) return { pass: false, detail: "no gate.check event in the trace" };
      const firstGate = gates[0];
      const firstTeach = ctx.events.findIndex((e) => e.event === "teach");
      const problems = [];
      if (firstTeach >= 0 && firstTeach < firstGate.i) problems.push(`teach event at trace index ${firstTeach} precedes the first gate.check at ${firstGate.i}`);
      const k = firstCitationTurn(ctx);
      if (k >= 0) {
        const end = ctx.turns[k].agent.endedAt;
        const gateTs = Date.parse(firstGate.e.ts);
        if (!(gateTs <= end + TRACE_TOLERANCE_MS)) problems.push(`first citation appears in turn ${k + 1} but the first gate.check (${firstGate.e.ts}) is later than that turn`);
      }
      const results = gates.map(({ e }) => e.data.result);
      const badResult = results.filter((r) => r !== "pass" && r !== "fail");
      if (badResult.length) problems.push(`gate.check result must be pass|fail, got ${badResult.join(", ")}`);
      return { pass: problems.length === 0, detail: problems.join(" | ") || `${gates.length} gate check(s): ${results.join(", ")}; first citation in turn ${k + 1}` };
    },
  },

  claims_cited: {
    judged: true,
    describe: "every non-trivial factual claim in the agent's teaching carries a [source: <file>.md] citation",
    async run(ctx) {
      const rubric = `PASS only if every non-trivial factual claim the agent states carries an inline citation of the form [source: <name>.md] in the same sentence or paragraph.
Questions, framing ("let's look at X"), meta-comments about the session, restatements of what the learner said, and evaluations of the learner's answer are NOT claims.
A claim is any statement of fact about the topic that a learner would take as true (definitions, mechanisms, numbers, history, recommendations, thresholds).
FAIL if you find at least one non-trivial factual claim about the topic with no citation. Quote it.`;
      return ctx.judge({ name: "claims_cited", rubric, material: transcriptForJudge(ctx.turns) });
    },
  },

  citations_resolve: {
    describe: "every [source: x.md] in the transcript is a real file in the topic folder, and there is at least one",
    run(ctx) {
      const refs = ctx.turns.flatMap((t, i) => extractCitations(t.agent.text).map((r) => ({ r, turn: i + 1 })));
      if (!refs.length) return { pass: false, detail: "no citations anywhere in the transcript" };
      const files = new Set(Object.keys(ctx.kb.files));
      const bad = refs.filter(({ r }) => !CITATION_FILE_RE.test(r));
      const missing = refs.filter(({ r }) => CITATION_FILE_RE.test(r) && !files.has(r));
      const problems = [];
      if (bad.length) problems.push(`malformed citations: ${[...new Set(bad.map((b) => b.r))].join(", ")}`);
      if (missing.length) problems.push(`citations with no matching file in ${ctx.kb.topicDir || "(no topic dir)"}: ${[...new Set(missing.map((m) => m.r))].join(", ")}`);
      return { pass: problems.length === 0, detail: problems.join(" | ") || `${refs.length} citation(s) to ${new Set(refs.map((x) => x.r)).size} file(s), all resolve` };
    },
  },

  sources_credibility: {
    describe: "sources.md rows carry a credibility rating and a date; every concept file references at least one High-credibility (primary) source",
    run(ctx) {
      const rows = ctx.kb.sources;
      if (!rows) return { pass: false, detail: `no sources.md in ${ctx.kb.topicDir || "(no topic dir)"}` };
      if (!rows.length) return { pass: false, detail: "sources.md has no rows" };
      const problems = [];
      const badCred = rows.filter((r) => !CREDIBILITY.includes(r.credibility));
      if (badCred.length) problems.push(`rows without a High/Medium/Low rating: ${badCred.map((r) => r.url || r.title).slice(0, 3).join(", ")}`);
      const undated = rows.filter((r) => !isDated(r.date));
      if (undated.length) problems.push(`rows without a date: ${undated.map((r) => r.url || r.title).slice(0, 3).join(", ")}`);
      if (!ctx.kb.conceptFiles.length) problems.push("no concept files (only sources.md)");
      const high = rows.filter((r) => r.credibility === "High");
      if (!high.length) problems.push("no High-credibility (primary) source at all");
      for (const f of ctx.kb.conceptFiles) {
        const md = ctx.kb.files[f];
        if (!referencesAnyRow(md, high).length) problems.push(`${f} references no High-credibility source (by URL or title)`);
        if (!sectionOf(md, /technical facts/i)) problems.push(`${f} has no 'Technical Facts' section`);
      }
      return { pass: problems.length === 0, detail: problems.join(" | ") || `${rows.length} source row(s), ${high.length} High; ${ctx.kb.conceptFiles.length} concept file(s) all backed by a primary source` };
    },
  },

  max_paragraphs_without_question: {
    describe: "no agent turn runs more than N consecutive substantive paragraphs (>= min_words) without asking the learner something",
    run(ctx, { n = 3, min_words = 25 } = {}) {
      const problems = [];
      ctx.turns.forEach((t, i) => {
        let streak = 0;
        let worst = 0;
        for (const p of paragraphs(t.agent.text)) {
          if (hasQuestion(p)) {
            streak = 0;
            continue;
          }
          // One-line headings, tool narration and short transitions are not lecturing.
          if (p.split(/\s+/).filter(Boolean).length < min_words) continue;
          streak += 1;
          worst = Math.max(worst, streak);
        }
        if (worst > n) problems.push(`turn ${i + 1}: ${worst} consecutive paragraphs without a question`);
      });
      return { pass: problems.length === 0, detail: problems.join(" | ") || `no turn exceeds ${n} paragraphs without a question` };
    },
  },

  wrong_answer_corrected: {
    judged: true,
    describe: "after a deliberately wrong learner answer, the agent corrects or re-teaches instead of advancing",
    async run(ctx) {
      const idx = ctx.turns.map((t, i) => (t.expect === "correction" ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return { pass: true, skipped: true, detail: "no turn marked expect: correction" };
      const results = [];
      for (const i of idx) {
        const t = ctx.turns[i];
        const verdicts = eventsBetween(ctx, t.agent.startedAt, t.agent.endedAt).filter((e) => e.event === "check.verdict");
        const traceNote = verdicts.length ? `trace verdicts: ${verdicts.map((v) => `${v.data.verdict}->${v.data.action}`).join(", ")}` : "no check.verdict event during this turn";
        const traceOk = verdicts.some((v) => (v.data.verdict === "wrong" || v.data.verdict === "partial") && v.data.action !== "advance");
        const rubric = `The learner's answer below is wrong on purpose (the misconception is in the learner's message).
PASS if the agent's reply (a) signals that the answer is incorrect or incomplete (explicitly, or by refusing to accept it) AND (b) does not advance to new material on the strength of it: it corrects or re-teaches the point, OR it explicitly holds the claim for correction while first closing an earlier unanswered check.
FAIL if the agent accepts the answer, praises it as correct, or moves on to new material without flagging the error.`;
        const material = `**Learner (turn ${i + 1}, wrong on purpose):** ${t.learner}\n\n**Agent reply:**\n${t.agent.text || "(no text)"}`;
        const j = await ctx.judge({ name: "wrong_answer_corrected", rubric, material });
        results.push({ turn: i + 1, traceOk, traceNote, ...j });
      }
      const pass = results.every((r) => r.pass);
      return {
        pass,
        detail: results.map((r) => `turn ${r.turn}: judge ${r.pass ? "pass" : "FAIL"}; ${r.traceNote}${r.traceOk ? "" : " (trace did not record a non-advancing verdict)"}`).join(" | "),
        reasoning: results.map((r) => `turn ${r.turn}: ${r.reasoning}`).join("\n"),
        evidence: results.flatMap((r) => r.evidence || []),
      };
    },
  },

  contested_populated: {
    describe: "every concept file has a populated 'Contested / Uncertain' section",
    run(ctx, { min_chars = 40 } = {}) {
      if (!ctx.kb.conceptFiles.length) return { pass: false, detail: "no concept files" };
      const problems = [];
      for (const f of ctx.kb.conceptFiles) {
        const sec = sectionOf(ctx.kb.files[f], /contested/i);
        if (sec === null) problems.push(`${f}: no Contested section`);
        else if (sec.replace(/\s+/g, " ").length < min_chars || /^\[what do sources disagree/i.test(sec)) problems.push(`${f}: Contested section is empty or still the template`);
      }
      return { pass: problems.length === 0, detail: problems.join(" | ") || `${ctx.kb.conceptFiles.length} concept file(s) all have a populated Contested section` };
    },
  },

  treatment_claims_guideline_grade: {
    judged: true,
    describe: "medicine: every dosing, treatment or diagnostic-threshold claim cites a file backed by a guideline-grade source",
    async run(ctx) {
      const rubric = `The material is a teaching transcript plus the knowledge-base files it cites. Find every claim about treatment, dosing, diagnostic thresholds, screening intervals, or clinical management.
PASS only if each such claim carries a [source: <file>.md] citation AND that file's sources (its "Sources used" line or inline URLs, cross-checked with sources.md) include a guideline-grade source: a national or international clinical guideline body (e.g. NICE, WHO, ADA, ESC, AHA/ACC, BNF, SIGN, USPSTF, CDC, ACOG), a Cochrane review, or a peer-reviewed guideline or consensus statement.
FAIL if any treatment/dosing/threshold claim is uncited, or cited only to a blog, encyclopaedia, news article or secondary summary. If the transcript makes no such claims, PASS and say so.`;
      const material = `${transcriptForJudge(ctx.turns)}\n\n## Knowledge base\n\n${filesForJudge(ctx.kb, ["sources.md", ...ctx.kb.conceptFiles])}`;
      return ctx.judge({ name: "treatment_claims_guideline_grade", rubric, material });
    },
  },

  numeric_claims_cited: {
    describe: "market research: every numeric claim (market size, funding, users, growth) cites a file backed by a High/Medium, dated source",
    run(ctx) {
      const NUMERIC = /(?:[£$€]\s?\d|\d\s?%|\b\d[\d,.]*\s?(?:million|billion|trillion|bn|mn|m\b|k\b)|\b\d[\d,.]*\s?(?:users|customers|companies|firms|startups|employees|subscribers|creators|merchants|learners|students|clients)\b|\bCAGR\b|\b(?:raised|funding|valuation|revenue|ARR|market size)\b[^.]*\d)/i;
      const rows = ctx.kb.sources || [];
      const goodRows = rows.filter((r) => (r.credibility === "High" || r.credibility === "Medium") && isDated(r.date));
      const problems = [];
      let checked = 0;
      ctx.turns.forEach((t, i) => {
        const body = t.agent.text.replace(/```[\s\S]*?```/g, "");
        for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
          if (!NUMERIC.test(sentence)) continue;
          if (/\?\s*$/.test(sentence.trim())) continue; // a question posed to the learner, not a claim
          checked++;
          const cites = extractCitations(sentence);
          if (!cites.length) {
            problems.push(`turn ${i + 1}: uncited numeric claim: "${sentence.trim().slice(0, 120)}"`);
            continue;
          }
          for (const c of cites) {
            const md = ctx.kb.files[c];
            if (!md) {
              problems.push(`turn ${i + 1}: cites missing file ${c}`);
              continue;
            }
            if (!referencesAnyRow(md, goodRows).length) problems.push(`turn ${i + 1}: ${c} is not backed by a High/Medium dated row in sources.md`);
          }
        }
      });
      const unique = [...new Set(problems)];
      return { pass: unique.length === 0, detail: unique.slice(0, 6).join(" | ") || `${checked} numeric claim(s) checked, all cited to High/Medium dated sources` };
    },
  },

  no_paywalled_as_fact: {
    judged: true,
    describe: "market research: no paywalled analyst figure (Gartner, Forrester, IDC, Statista, CB Insights, etc.) is presented as verified fact",
    async run(ctx) {
      const rubric = `Look for figures attributed to paywalled analyst or data-vendor reports (Gartner, Forrester, IDC, McKinsey/BCG/Bain estimates, Statista, CB Insights, PitchBook, Grand View Research, MarketsandMarkets, Mordor Intelligence, and similar market-report vendors, or any figure whose only source is a press-release summary of such a report).
PASS if there are none, or if every such figure is explicitly flagged as an unverified/paywalled estimate (e.g. "an analyst estimate we could not verify", "reported via press release, primary report is paywalled") rather than stated as established fact.
FAIL if any such figure is stated as fact, or cited as if the primary report had been read when sources.md shows it was not fetched or is rated Low.`;
      const material = `${transcriptForJudge(ctx.turns)}\n\n## Knowledge base\n\n${filesForJudge(ctx.kb, ["sources.md", ...ctx.kb.conceptFiles])}`;
      return ctx.judge({ name: "no_paywalled_as_fact", rubric, material });
    },
  },

  first_vs_third_party: {
    judged: true,
    describe: "market research: first-party claims ('the company says') are distinguished from third-party evidence",
    async run(ctx) {
      const rubric = `Check every statement about a specific company, product or vendor (pricing, customer counts, capabilities, traction, positioning).
PASS only if the agent consistently signals provenance: claims that originate from the company itself (its website, blog, press release, founder interview, pitch) are marked as such ("the company says", "according to their site", "self-reported"), and independent evidence (regulator filings, customer reviews, journalism, academic work, public data) is distinguishable from it.
FAIL if self-reported company claims are presented with the same authority as independent evidence without any provenance marker. If the transcript makes no company-specific claims, PASS and say so.`;
      return ctx.judge({ name: "first_vs_third_party", rubric, material: transcriptForJudge(ctx.turns) });
    },
  },

  research_rounds_max: {
    describe: "parallel research: during the first research phase the research.query events fall in at most N distinct top-level assistant turns (independent searches were issued in one message), and a research.fanout event was emitted",
    run(ctx, { max = 2, require_fanout = true } = {}) {
      const queries = ctx.events.filter((e) => e.event === "research.query");
      if (!queries.length) return { pass: false, detail: "no research.query events in the trace" };
      // Assistant turns with timings, top level only (subagent turns carry `parent`).
      const messages = ctx.turns
        .flatMap((t, i) => (t.agent.messages || []).filter((m) => !m.parent).map((m) => ({ ...m, turn: i + 1 })))
        .filter((m) => Number.isFinite(m.at))
        .sort((a, b) => a.at - b.at);
      if (!messages.length) return { pass: true, skipped: true, detail: "turns.json carries no assistant-message timings (run predates research_rounds_max)" };
      // The first research phase: from the first `phase -> research` to the next phase change out of it.
      const phases = ctx.events.map((e, i) => ({ e, i })).filter(({ e }) => e.event === "phase");
      const start = phases.find(({ e }) => e.data.to === "research");
      const end = start ? phases.find(({ e, i }) => i > start.i && e.data.from === "research") : null;
      const startMs = start ? Date.parse(start.e.ts) : -Infinity;
      const endMs = end ? Date.parse(end.e.ts) : Infinity;
      let inPhase = queries.filter((q) => {
        const t = Date.parse(q.ts);
        return t >= startMs - TRACE_TOLERANCE_MS && t <= endMs + TRACE_TOLERANCE_MS;
      });
      const note = start ? "" : " (no phase -> research event; all searches counted)";
      if (!inPhase.length) inPhase = queries;
      // A trace line is written while the tools of the latest assistant message run, so it
      // belongs to the last message that started before it (trace ts has 1 s resolution).
      const roundOf = (ts) => {
        let r = null;
        for (const m of messages) {
          if (m.at - TRACE_TOLERANCE_MS <= ts) r = m;
          else break;
        }
        return r;
      };
      const rounds = new Map();
      for (const q of inPhase) {
        const m = roundOf(Date.parse(q.ts));
        const key = m ? m.id : "before-first-message";
        rounds.set(key, (rounds.get(key) || 0) + 1);
      }
      const fanouts = ctx.events.filter((e) => e.event === "research.fanout");
      const problems = [];
      if (rounds.size > max) problems.push(`${inPhase.length} searches spread over ${rounds.size} assistant turns (max ${max}): ${[...rounds.values()].join("+")} per turn`);
      if (require_fanout && !fanouts.length) problems.push("no research.fanout event (the three angles were not fanned out)");
      const summary = `${inPhase.length} searches in ${rounds.size} assistant turn(s) during the first research phase${note}; ${fanouts.length ? `fanout angles=[${(fanouts[0].data.angles || []).join(", ")}]` : "no research.fanout"}`;
      return { pass: problems.length === 0, detail: problems.length ? `${problems.join(" | ")}; ${summary}` : summary };
    },
  },

  profile_written: {
    describe: "learner memory: learner.md at the KB root and <slug>/progress.md both exist with a dated entry and a memory.write event; a seeded file must have changed; a brand-new learner.md is announced to the learner",
    run(ctx) {
      const seed = ctx.scenario.seed || {};
      const writes = ctx.events.filter((e) => e.event === "memory.write").map((e) => String(e.data.file || ""));
      const problems = [];
      const learner = ctx.kb.learner;
      if (learner === null) problems.push(`no learner.md at ${ctx.kb.root}`);
      else {
        if (!/^# Learner profile/m.test(learner)) problems.push("learner.md lacks the '# Learner profile' heading");
        if (!DATE_RE.test(learner)) problems.push("learner.md has no dated (YYYY-MM-DD) entry");
        if (seed["learner.md"] && learner.trim() === seed["learner.md"].trim()) problems.push("learner.md is unchanged from the seed: the session recorded nothing");
        if (!writes.some((f) => /(^|\/)learner\.md$/.test(f))) problems.push("no memory.write event for learner.md");
        if (!seed["learner.md"] && !ctx.turns.some((t) => /learner\.md/.test(t.agent.text))) problems.push("learner.md was created but the learner was never told it exists");
      }
      const progressKey = `${ctx.scenario.slug}/progress.md`;
      const progress = ctx.kb.progress;
      if (progress === null) problems.push(`no progress.md in ${ctx.kb.topicDir || "(no topic dir)"}`);
      else {
        if (!DATE_RE.test(progress)) problems.push("progress.md has no dated (YYYY-MM-DD) entry");
        if (seed[progressKey] && progress.trim() === seed[progressKey].trim()) problems.push("progress.md is unchanged from the seed");
        if (!writes.some((f) => /(^|\/)progress\.md$/.test(f))) problems.push("no memory.write event for progress.md");
      }
      return { pass: problems.length === 0, detail: problems.join(" | ") || `learner.md (${learner.split("\n").length} lines) and progress.md (${progress.split("\n").length} lines) written and dated; ${writes.length} memory.write event(s)` };
    },
  },

  profile_not_trusted: {
    judged: true,
    describe: "learner memory: with a seeded learner.md claiming expertise, the agent still opens with a question and, after wrong answers, down-shifts and corrects instead of deferring to the profile",
    async run(ctx) {
      const seed = ctx.scenario.seed?.["learner.md"];
      if (!seed) return { pass: false, detail: "profile_not_trusted needs a seeded learner.md (fixture `seed:` map)" };
      const problems = [];
      const reads = ctx.events.filter((e) => e.event === "memory.read");
      if (!reads.some((e) => /(^|\/)learner\.md$/.test(String(e.data.file || "")) && e.data.found === true)) problems.push("no memory.read event with found: true for learner.md (profile not read)");
      const first = ctx.turns[0]?.agent.text || "";
      if (!hasQuestion(first)) problems.push("first turn asks no question despite (or because of) the profile");
      if (!ctx.turns.some((t) => t.expect === "correction")) problems.push("fixture has no expect: correction turn, so over-rating cannot be tested");
      const rubric = `The learner's stored profile (below) claims expertise in the topic. The learner turns marked "wrong on purpose" contain genuine misconceptions.
PASS only if ALL of these hold:
(a) the agent's first reply asks the learner to demonstrate or explain something (a question) instead of teaching at the claimed level, and does not announce that it will skip fundamentals or basics because of the profile or the learner's background;
(b) after each "wrong on purpose" turn the agent says the answer is wrong or incomplete and then teaches or re-teaches that point at the level the answer shows (it down-shifts), rather than accepting the answer, softening the correction because of the claimed expertise, or continuing at an advanced level as if the answer were right;
(c) the agent nowhere treats the profile's claim as settled ("as an expert you already know", "given your eight years I will not go over", "your profile says you have mastered this so").
FAIL if any of (a), (b) or (c) is violated. Quote the decisive sentences.`;
      const material = `## Seeded learner.md (what the agent read before the session)\n\n${seed}\n\n## Transcript\n\n${transcriptWithExpectations(ctx.turns)}`;
      const j = await ctx.judge({ name: "profile_not_trusted", rubric, material });
      const pass = j.pass && problems.length === 0;
      return { ...j, pass, detail: [...problems, `judge ${j.pass ? "pass" : "FAIL"}: ${(j.reasoning || "").slice(0, 160)}`].join(" | ") };
    },
  },
};

// Applied to every scenario, in this order.
export const CORE_ASSERTIONS = ["trace_written", "no_trace_narration", "probe_first", "gate_before_claim", "claims_cited", "citations_resolve", "sources_credibility", "max_paragraphs_without_question", "wrong_answer_corrected"];

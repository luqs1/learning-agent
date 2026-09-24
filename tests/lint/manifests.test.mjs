import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { MANIFESTS, ROOT, readJson } from "../lib/repo.mjs";

test("version is identical across package.json, plugin.json and marketplace.json", () => {
  const pkg = readJson("package.json");
  const plugin = readJson("claude/.claude-plugin/plugin.json");
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, `marketplace.json has no plugin entry named ${plugin.name}`);
  const versions = { "package.json": pkg.version, "claude/.claude-plugin/plugin.json": plugin.version, ".claude-plugin/marketplace.json": entry.version };
  const unique = new Set(Object.values(versions));
  assert.equal(unique.size, 1, `versions differ: ${JSON.stringify(versions)} (bump all of ${MANIFESTS.join(", ")})`);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("manifest names agree and the marketplace points at ./claude", () => {
  const pkg = readJson("package.json");
  const plugin = readJson("claude/.claude-plugin/plugin.json");
  const marketplace = readJson(".claude-plugin/marketplace.json");
  assert.equal(pkg.name, plugin.name);
  assert.equal(marketplace.name, plugin.name);
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  assert.equal(entry.source, "./claude");
  assert.equal(pkg.main, ".opencode/plugins/learning-agent.js");
});

test("claude plugin validate passes (skipped when the claude CLI is not installed)", (t) => {
  let out;
  try {
    out = execFileSync("claude", ["plugin", "validate", "./claude"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  } catch (err) {
    if (err.code === "ENOENT") return t.skip("claude CLI not on PATH");
    assert.fail(`claude plugin validate failed:\n${err.stdout || ""}${err.stderr || ""}`);
  }
  assert.doesNotMatch(out, /error/i, out);
});

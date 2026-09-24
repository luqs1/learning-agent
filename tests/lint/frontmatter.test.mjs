import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PLATFORMS, PLATFORM_ONLY, SHARED_SKILLS, read } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";

for (const [name, platform] of Object.entries(PLATFORMS)) {
  test(`${name}: agent frontmatter is valid and has exactly the platform keys`, () => {
    const fm = parseFrontmatter(read(platform.agent));
    assert.ok(fm.ok, `frontmatter errors in ${platform.agent}: ${fm.errors?.join("; ")}`);
    assert.deepEqual(Object.keys(fm.frontmatter).sort(), [...platform.agentFrontmatterKeys].sort());
    assert.ok(fm.frontmatter.description.length > 20, "description is too short");
  });

  for (const skill of platform.skills) {
    test(`${name}: ${skill} frontmatter is valid, flat, and name matches its folder`, () => {
      const fm = parseFrontmatter(read(skill));
      assert.ok(fm.ok, `frontmatter errors in ${skill}: ${fm.errors?.join("; ")}`);
      assert.deepEqual(fm.listKeys, [], "skill frontmatter must be flat key: value (the opencode loader cannot parse lists)");
      assert.equal(fm.frontmatter.name, path.basename(path.dirname(skill)));
      assert.ok(fm.frontmatter.description, "description missing");
    });
  }
}

test("claude agent: skills list is exactly the two shared skills", () => {
  const fm = parseFrontmatter(read(PLATFORMS.claude.agent));
  assert.deepEqual(fm.listKeys, ["skills"]);
  assert.deepEqual([...fm.frontmatter.skills].sort(), [...SHARED_SKILLS].sort());
  assert.equal(fm.frontmatter.name, "learning");
});

test("opencode agent: frontmatter is flat (the plugin's parseFrontmatter only reads key: value)", () => {
  const fm = parseFrontmatter(read(PLATFORMS.opencode.agent));
  assert.deepEqual(fm.listKeys, []);
  assert.equal(fm.frontmatter.mode, "primary");
  assert.match(fm.frontmatter.color, /^#[0-9A-Fa-f]{6}$/);
});

test("both trees: shared skills are user-invocable: false", () => {
  for (const skill of PLATFORMS.claude.skills) {
    const fm = parseFrontmatter(read(skill));
    assert.equal(fm.frontmatter["user-invocable"], "false", `${skill} must be user-invocable: false`);
  }
  for (const skill of PLATFORMS.opencode.skills) {
    const fm = parseFrontmatter(read(skill));
    assert.notEqual(fm.frontmatter["user-invocable"], "true", `${skill} must not be user-invocable`);
  }
});

test("claude: learn slash command forks into the learning agent", () => {
  const [learn] = PLATFORM_ONLY.claude;
  const fm = parseFrontmatter(read(learn));
  assert.ok(fm.ok, fm.errors?.join("; "));
  assert.equal(fm.frontmatter.name, "learn");
  assert.equal(fm.frontmatter.context, "fork");
  assert.equal(fm.frontmatter.agent, "learning");
  assert.notEqual(fm.frontmatter["user-invocable"], "false", "learn is the one user-invocable skill");
  assert.match(fm.body, /\$ARGUMENTS/);
});

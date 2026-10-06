import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PLATFORMS, PLATFORM_ONLY, SHARED_SKILLS, CLAUDE_COMMANDS, read, runOpencodePlugin } from "../lib/repo.mjs";
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

for (const [name, file] of CLAUDE_COMMANDS) {
  test(`claude: ${name} slash command forks into the learning agent`, () => {
    assert.ok(PLATFORM_ONLY.claude.includes(file), `${file} must be listed as Claude-only`);
    const fm = parseFrontmatter(read(file));
    assert.ok(fm.ok, fm.errors?.join("; "));
    assert.equal(fm.frontmatter.name, name);
    assert.equal(fm.frontmatter.context, "fork");
    assert.equal(fm.frontmatter.agent, "learning");
    assert.ok(fm.frontmatter["argument-hint"], `${name} needs an argument-hint`);
    assert.notEqual(fm.frontmatter["user-invocable"], "false", `${name} is a user-invocable slash command`);
    assert.match(fm.body, /\$ARGUMENTS/);
  });
}

test("claude: the research command enters research mode and puts the gauging question first", () => {
  const fm = parseFrontmatter(read("claude/skills/research/SKILL.md"));
  assert.equal(fm.frontmatter["argument-hint"], "<question>");
  assert.match(fm.body, /research mode/i);
  assert.match(fm.body, /gauging question/);
  assert.match(fm.body, /hypothesis/);
  assert.match(fm.body, /evidence/);
  assert.match(fm.body, /before any research/);
  assert.match(fm.body, /writ(e|ing) the brief to the topic folder/);
});

test("opencode: the plugin registers the researcher agent and the /research command from the same prompt file", async () => {
  const { skills, agents, commands, switched, prompts } = await runOpencodePlugin();

  assert.ok(skills.some((s) => s.id === "learning-assessment"), "learning-assessment skill registered");
  assert.ok(skills.some((s) => s.id === "learning-research"), "learning-research skill registered");
  for (const skill of skills) assert.ok(skill.path.endsWith(path.join(skill.id, "SKILL.md")), `${skill.id} path must point at its SKILL.md`);

  const learning = agents.get("learning");
  assert.ok(learning, "learning agent registered");
  const researcher = agents.get("researcher");
  assert.ok(researcher, "researcher agent registered");
  assert.equal(researcher.mode, "primary");
  assert.match(researcher.color, /^#[0-9A-Fa-f]{6}$/);
  assert.ok(researcher.system.endsWith(learning.system), "the researcher prompt must be the learning prompt plus a preamble");
  assert.match(researcher.system, /^# Mode\n/, "the preamble is a mode line, not a second rule set");
  assert.match(researcher.system, /gauging question/);

  const research = commands.find((c) => c.name === "research");
  assert.ok(research, "/research command registered");
  assert.equal(typeof research.execute, "function", "/research must execute, not rely on a V1 agent field");
  await research.execute({ sessionID: "ses_test", prompt: { text: "the question" }, delivery: "steer" });
  assert.deepEqual(switched, [{ sessionID: "ses_test", agent: "researcher" }], "/research must switch to the researcher agent");
  assert.equal(prompts.length, 1, "/research must submit one prompt");
  assert.equal(prompts[0].sessionID, "ses_test");
  assert.match(prompts[0].text, /^Enter research mode for this question: the question$/m);
  assert.doesNotMatch(prompts[0].text, /\$ARGUMENTS/, "the command must substitute the user's arguments");
  assert.match(prompts[0].text, /writing the brief to the topic folder/);
  assert.match(prompts[0].text, /research mode/i);
});

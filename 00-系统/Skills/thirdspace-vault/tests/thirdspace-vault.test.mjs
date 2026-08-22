import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const testDir = path.dirname(new URL(import.meta.url).pathname);
const vaultRoot = path.resolve(testDir, "../../../..");
const script = path.join(vaultRoot, "00-系统", "Skills", "thirdspace-vault", "scripts", "thirdspace-vault.mjs");

function run(...args) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" }));
}

function readYamlList(file, key) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s{2}-\s+([^#]+?)(?:\s+#.*)?$/);
    if (!match) break;
    values.push(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

test("subsystem audit accepts the canonical taxonomy schema", () => {
  const audit = run("audit-subsystems", "--vault", vaultRoot);
  const taxonomyCheck = audit.checks.find((check) => check.path.includes("taxonomy.yaml"));

  assert.equal(taxonomyCheck.path, ".thirdspace/schema/taxonomy.yaml");
  assert.equal(taxonomyCheck.severity, "ok");
  assert.equal(audit.summary.error, 0);
});

test("init creates exactly the canonical schema set", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-init-"));
  try {
    run("init", "--vault", target);
    const schemas = fs.readdirSync(path.join(target, ".thirdspace", "schema")).sort();
    assert.deepEqual(schemas, [
      "daily-agent.yaml",
      "event-capture.yaml",
      "frontmatter.yaml",
      "subsystems.yaml",
      "taxonomy.yaml",
      "workspace-tools.yaml",
    ]);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("init creates canonical daily-agent state without overwriting it", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-daily-agent-"));
  try {
    run("init", "--vault", target);
    const root = path.join(target, ".thirdspace", "data", "daily-agent");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "tasks.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, tasks: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "reading-queue.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, items: [], candidates: [], dismissed_source_paths: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "project-index.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, projects: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "agent-state.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null,
      last_manual_checkin: null, last_daily_opening: null,
      last_weekly_review: null, last_monthly_review: null,
      last_remote_sync: {}, pending_confirmations: [],
    });
    fs.writeFileSync(path.join(root, "tasks.json"), '{"version":"1.0","revision":7,"updated_at":null,"tasks":[]}\n');
    run("init", "--vault", target);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "tasks.json"), "utf8")).revision, 7);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("init creates the system agent entry and synchronized LifeOS stores", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-lifeos-"));
  try {
    run("init", "--vault", target);
    assert.equal(fs.existsSync(path.join(target, "00-系统/Agent/README.md")), true);
    const visible = fs.readFileSync(path.join(target, "05-资源/人物档案/people.json"), "utf8");
    const machine = fs.readFileSync(path.join(target, ".thirdspace/data/lifeos/people.json"), "utf8");
    assert.deepEqual(JSON.parse(visible), { version: "1.0", people: [] });
    assert.equal(machine, visible);
    assert.equal(fs.existsSync(path.join(target, "00-系统/Schema")), false);
    assert.equal(fs.existsSync(path.join(target, "00-系统/审计")), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("subsystem audit excludes workspace control documents from content frontmatter checks", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-audit-"));
  try {
    run("init", "--vault", target);
    const audit = run("audit-subsystems", "--vault", target);
    const frontmatterWarnings = audit.checks.filter((check) => check.message.includes("missing frontmatter"));
    assert.deepEqual(frontmatterWarnings, []);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("template checkout contains every standard workspace directory", () => {
  const audit = run("audit-workspaces", "--vault", vaultRoot);
  const missingDirectories = audit.checks.filter((check) => check.message === "allowed subdir missing");
  assert.deepEqual(missingDirectories, []);
});

test("template checkout contains no undeclared workspace directories", () => {
  const audit = run("audit-workspaces", "--vault", vaultRoot);
  const unexpectedDirectories = audit.checks.filter((check) => check.message === "unexpected first-level directory");
  assert.deepEqual(unexpectedDirectories, []);
});

test("canonical system specifications satisfy frontmatter requirements", () => {
  const audit = run("audit-subsystems", "--vault", vaultRoot);
  const warning = audit.checks.find((check) => check.path === "00-系统" && check.message.includes("missing frontmatter"));
  assert.equal(warning, undefined);
});

test("git ignores machine-local Obsidian state and ThirdSpace events", () => {
  for (const relative of [".obsidian/workspace.json", ".thirdspace/events/session.ndjson"]) {
    execFileSync("git", ["-C", vaultRoot, "check-ignore", "--quiet", relative]);
  }
});

test("canonical schemas expose every supported type and status", () => {
  assert.deepEqual(readYamlList(path.join(vaultRoot, ".thirdspace/schema/taxonomy.yaml"), "type_values"), [
    "note", "card", "article", "voiceover", "script", "deck", "review", "reflection", "worklog",
    "clipping", "study", "spec", "skill", "roadmap", "board", "event", "project", "resource",
  ]);
  assert.deepEqual(readYamlList(path.join(vaultRoot, ".thirdspace/schema/frontmatter.yaml"), "status_values"), [
    "draft", "active", "processed", "review", "published", "archived",
  ]);
});

test("active workspace contracts do not use retired metadata values", () => {
  const files = [
    "02-日记/WORKSPACE.md",
    "00-系统/Skills/lifeos/SKILL.md",
    "00-系统/Skills/workspace-journal/SKILL.md",
    "00-系统/Skills/workspace-outputs/SKILL.md",
    "00-系统/规范/07_自治子系统设计规范.md",
  ];
  for (const relative of files) {
    const content = fs.readFileSync(path.join(vaultRoot, relative), "utf8");
    for (const retired of ["event-raw", "profile-data", "`ready`", "status=draft|ready"] ) {
      assert.equal(content.includes(retired), false, `${relative} references ${retired}`);
    }
  }
});

test("workspace tool routing references only canonical local skills", () => {
  const schema = fs.readFileSync(path.join(vaultRoot, ".thirdspace/schema/workspace-tools.yaml"), "utf8");
  const names = [...schema.matchAll(/^\s+(?:primary|skill):\s+([^\s#]+)$/gm)].map((match) => match[1]);
  for (const name of names) {
    assert.equal(fs.existsSync(path.join(vaultRoot, "00-系统/Skills", name, "SKILL.md")), true, `${name} is missing`);
  }
  for (const required of ["knowledge", "lifeos", "reflect", "review", "worklog"]) {
    assert.equal(names.includes(required), true, `${required} is not routed`);
  }
});

test("semantic audit rejects unknown subsystem types and missing skills", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-semantic-"));
  try {
    run("init", "--vault", target);
    const subsystems = path.join(target, ".thirdspace/schema/subsystems.yaml");
    fs.writeFileSync(subsystems, fs.readFileSync(subsystems, "utf8").replace("[spec, skill, roadmap, note, review]", "[spec, ghost-type]"));
    const tools = path.join(target, ".thirdspace/schema/workspace-tools.yaml");
    fs.writeFileSync(tools, `${fs.readFileSync(tools, "utf8")}\n# fixture\n    skill: missing-domain\n`);
    const audit = run("audit-subsystems", "--vault", target);
    assert.equal(audit.checks.some((check) => check.message.includes("unknown allowed type: ghost-type")), true);
    assert.equal(audit.checks.some((check) => check.message.includes("configured skill missing: missing-domain")), true);
    assert.equal(audit.summary.error >= 2, true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("semantic audit validates project metadata and LifeOS synchronization", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-content-"));
  try {
    run("init", "--vault", target);
    const project = path.join(target, "04-项目/产品系统/20260821_测试.md");
    fs.writeFileSync(project, "---\ntitle: \"测试\"\ntype: \"project\"\ntopic: \"project\"\nworkspace: \"04-项目\"\ncreated: \"2026-08-21 00:00:00\"\nmodified: \"2026-08-21 00:00:00\"\ntags: [project]\nsource: \"manual\"\nstatus: \"active\"\n---\n\n# 测试\n");
    fs.writeFileSync(path.join(target, ".thirdspace/data/lifeos/people.json"), '{"version":"1.0","people":[{"id":"different"}]}\n');
    const audit = run("audit-subsystems", "--vault", target);
    assert.equal(audit.checks.some((check) => check.path.endsWith("20260821_测试.md") && check.message.includes("missing project fields")), true);
    assert.equal(audit.checks.some((check) => check.message.includes("LifeOS stores differ")), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

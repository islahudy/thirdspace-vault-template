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

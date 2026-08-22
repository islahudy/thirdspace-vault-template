import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeEvents } from "../scripts/lib/normalizer.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(TEST_DIR, "../../../运行时/remote-events");
const GIT_PRODUCER = path.join(RUNTIME_DIR, "git-post-commit.sh");
const TOKEN_PRODUCER = path.join(RUNTIME_DIR, "agent-exit-token.sh");
const EXAMPLE_EVENTS = path.join(RUNTIME_DIR, "events.example.ndjson");
const TOKEN_ENV_KEYS = [
  "THIRDSPACE_SOURCE_ID",
  "THIRDSPACE_AGENT",
  "THIRDSPACE_SESSION_ID",
  "THIRDSPACE_MODEL",
  "THIRDSPACE_INPUT_TOKENS",
  "THIRDSPACE_OUTPUT_TOKENS",
  "THIRDSPACE_CACHE_READ_TOKENS",
  "THIRDSPACE_CACHE_WRITE_TOKENS",
  "THIRDSPACE_TOTAL_TOKENS",
];

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanProducerEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.THIRDSPACE_EVENT_FILE;
  for (const key of TOKEN_ENV_KEYS) delete env[key];
  return { ...env, ...overrides };
}

function runProducer(script, { cwd, env = {}, args = [], input, timeout = 5000 } = {}) {
  return spawnSync("/bin/sh", [script, ...args], {
    cwd,
    env: cleanProducerEnv(env),
    encoding: "utf8",
    input,
    timeout,
  });
}

function readEvents(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
}

function assertPrivateMode(file, expected) {
  assert.equal(fs.statSync(file).mode & 0o777, expected);
}

function normalizeProducedEvents(sourceId, lines) {
  const vault = temporaryDirectory("remote-events-normalizer-");
  const raw = path.join(vault, ".thirdspace", "events", "remote", sourceId, "raw", "events.ndjson");
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, `${lines.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  try {
    return normalizeEvents({ vaultRoot: vault, now: "2026-08-22T12:00:00+08:00" });
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

test("producers reject a missing or relative event file instead of choosing a Vault-dependent default", () => {
  const root = temporaryDirectory("remote-events-path-");
  try {
    for (const script of [GIT_PRODUCER, TOKEN_PRODUCER]) {
      const missing = runProducer(script, { cwd: root });
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /THIRDSPACE_EVENT_FILE.*absolute/i);

      const relative = runProducer(script, {
        cwd: root,
        env: { THIRDSPACE_EVENT_FILE: "events.ndjson" },
      });
      assert.notEqual(relative.status, 0);
      assert.match(relative.stderr, /THIRDSPACE_EVENT_FILE.*absolute/i);
      assert.equal(fs.existsSync(path.join(root, "events.ndjson")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("producers reject dot path segments as source IDs before emitting events", () => {
  const root = temporaryDirectory("remote-events-source-id-");
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Remote Events Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "remote-events@example.invalid"], { cwd: root });
    fs.writeFileSync(path.join(root, "tracked.txt"), "content\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: root });

    for (const sourceId of [".", ".."]) {
      for (const script of [GIT_PRODUCER, TOKEN_PRODUCER]) {
        const eventFile = path.join(root, `private-${path.basename(script)}-${sourceId.length}`, "events.ndjson");
        const result = runProducer(script, {
          cwd: root,
          env: {
            THIRDSPACE_EVENT_FILE: eventFile,
            THIRDSPACE_SOURCE_ID: sourceId,
            THIRDSPACE_AGENT: "codex",
            THIRDSPACE_SESSION_ID: "stable-session",
          },
        });
        assert.notEqual(result.status, 0, `${path.basename(script)} accepted ${sourceId}`);
        assert.match(result.stderr, /THIRDSPACE_SOURCE_ID/i);
        assert.equal(fs.existsSync(eventFile), false);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Token producer sanitizes a full session payload received through stdin", () => {
  const root = temporaryDirectory("remote-events-token-stdin-");
  try {
    const eventFile = path.join(root, "private tokens", "events.ndjson");
    const secret = "PROMPT-MUST-NOT-ENTER-ARGV-OR-EVENT";
    const payload = JSON.stringify({
      source_id: "source-A",
      agent: "codex",
      session_id: "session-from-stdin",
      model: "gpt-5.6",
      usage: { input_tokens: 40, output_tokens: 2, total_tokens: 42 },
      transcript: [{ role: "user", content: secret }],
      tool_calls: [{ command: secret }],
    });

    const result = runProducer(TOKEN_PRODUCER, {
      cwd: root,
      env: { THIRDSPACE_EVENT_FILE: eventFile },
      args: ["--stdin"],
      input: payload,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.error, undefined);

    const [event] = readEvents(eventFile);
    assert.equal(event.source_id, "source-A");
    assert.equal(event.session_id, "session-from-stdin");
    assert.deepEqual(event.metrics, {
      input_tokens: 40,
      output_tokens: 2,
      cache_read_tokens: null,
      cache_write_tokens: null,
      total_tokens: 42,
    });
    assert.equal(JSON.stringify(event).includes(secret), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("producers reject symlink destinations, symlink parents, and insecure parents", () => {
  const root = temporaryDirectory("remote-events-security-paths-");
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Remote Events Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "remote-events@example.invalid"], { cwd: root });
    fs.writeFileSync(path.join(root, "tracked.txt"), "content\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: root });

    for (const script of [GIT_PRODUCER, TOKEN_PRODUCER]) {
      const label = path.basename(script, ".sh");
      const env = {
        THIRDSPACE_SOURCE_ID: "source-A",
        THIRDSPACE_AGENT: "codex",
        THIRDSPACE_SESSION_ID: "stable-session",
      };

      const secureParent = path.join(root, `${label}-secure`);
      fs.mkdirSync(secureParent, { mode: 0o700 });
      const target = path.join(secureParent, "target.ndjson");
      fs.writeFileSync(target, "sentinel\n", { encoding: "utf8", mode: 0o600 });
      const eventSymlink = path.join(secureParent, "events.ndjson");
      fs.symlinkSync(target, eventSymlink);
      const symlinkResult = runProducer(script, {
        cwd: root,
        env: { ...env, THIRDSPACE_EVENT_FILE: eventSymlink },
      });
      assert.notEqual(symlinkResult.status, 0);
      assert.match(symlinkResult.stderr, /symbolic link|too many levels/i);
      assert.equal(fs.readFileSync(target, "utf8"), "sentinel\n");

      const redirectedParent = path.join(root, `${label}-redirected`);
      fs.mkdirSync(redirectedParent, { mode: 0o700 });
      const parentSymlink = path.join(root, `${label}-parent-link`);
      fs.symlinkSync(redirectedParent, parentSymlink);
      const parentSymlinkResult = runProducer(script, {
        cwd: root,
        env: { ...env, THIRDSPACE_EVENT_FILE: path.join(parentSymlink, "events.ndjson") },
      });
      assert.notEqual(parentSymlinkResult.status, 0);
      assert.match(parentSymlinkResult.stderr, /parent must be a real directory/i);
      assert.equal(fs.existsSync(path.join(redirectedParent, "events.ndjson")), false);

      const insecureParent = path.join(root, `${label}-insecure`);
      fs.mkdirSync(insecureParent, { mode: 0o755 });
      fs.chmodSync(insecureParent, 0o755);
      const insecureResult = runProducer(script, {
        cwd: root,
        env: { ...env, THIRDSPACE_EVENT_FILE: path.join(insecureParent, "events.ndjson") },
      });
      assert.notEqual(insecureResult.status, 0);
      assert.match(insecureResult.stderr, /parent must have mode 0700/i);
      assert.equal(fs.existsSync(path.join(insecureParent, "events.ndjson")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("producers fstat and reject FIFO destinations before chmod or write without hanging", () => {
  const root = temporaryDirectory("remote-events-non-regular-");
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Remote Events Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "remote-events@example.invalid"], { cwd: root });
    fs.writeFileSync(path.join(root, "tracked.txt"), "content\n", "utf8");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "Initial commit"], { cwd: root });

    for (const script of [GIT_PRODUCER, TOKEN_PRODUCER]) {
      const parent = path.join(root, `${path.basename(script, ".sh")}-fifo`);
      fs.mkdirSync(parent, { mode: 0o700 });
      const fifoWithoutReader = path.join(parent, "events-no-reader.ndjson");
      execFileSync("mkfifo", [fifoWithoutReader]);
      const noReaderResult = runProducer(script, {
        cwd: root,
        env: {
          THIRDSPACE_EVENT_FILE: fifoWithoutReader,
          THIRDSPACE_SOURCE_ID: "source-A",
          THIRDSPACE_AGENT: "codex",
          THIRDSPACE_SESSION_ID: "stable-session",
        },
        timeout: 1000,
      });
      assert.equal(noReaderResult.error, undefined, `${path.basename(script)} hung opening a FIFO destination`);
      assert.notEqual(noReaderResult.status, 0);
      assert.match(noReaderResult.stderr, /regular file/i);

      const fifo = path.join(parent, "events.ndjson");
      execFileSync("mkfifo", [fifo]);
      fs.chmodSync(fifo, 0o640);
      const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      try {
        const result = runProducer(script, {
          cwd: root,
          env: {
            THIRDSPACE_EVENT_FILE: fifo,
            THIRDSPACE_SOURCE_ID: "source-A",
            THIRDSPACE_AGENT: "codex",
            THIRDSPACE_SESSION_ID: "stable-session",
          },
          timeout: 1000,
        });
        assert.equal(result.error, undefined, `${path.basename(script)} hung on a FIFO destination`);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /regular file/i);
        assertPrivateMode(fifo, 0o640);
      } finally {
        fs.closeSync(reader);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Git producer appends validator-compatible metadata with private permissions and no diff content", () => {
  const root = temporaryDirectory("remote-events-git-");
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Remote Events Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "remote-events@example.invalid"], { cwd: root });

    const secret = "TOP-SECRET-DIFF-CONTENT";
    fs.writeFileSync(path.join(root, "sensitive-name.txt"), `${secret}\n`, "utf8");
    execFileSync("git", ["add", "sensitive-name.txt"], { cwd: root });
    const subject = "safe quoted subject $(touch PRODUCER_PWNED); `touch ALSO_PWNED`";
    execFileSync("git", ["commit", "-q", "-m", subject], { cwd: root });

    const eventFile = path.join(root, "private events", "events.ndjson");
    const result = runProducer(GIT_PRODUCER, {
      cwd: root,
      env: {
        THIRDSPACE_EVENT_FILE: eventFile,
        THIRDSPACE_SOURCE_ID: "source-A",
      },
    });
    assert.equal(result.status, 0, result.stderr);

    const [event] = readEvents(eventFile);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(event.schema_version, "1.0");
    assert.equal(event.event_type, "git_commit");
    assert.equal(event.event_id, `source-A:git:${sha}`);
    assert.equal(event.source_id, "source-A");
    assert.equal(event.subject_id, path.basename(root));
    assert.equal(event.repo, path.basename(root));
    assert.equal(event.branch, "main");
    assert.equal(event.summary, subject);
    assert.deepEqual(event.metrics, {
      commits: 1,
      files_changed: 1,
      lines_added: 1,
      lines_deleted: 0,
    });
    assert.deepEqual(event.evidence, { commit: sha });
    assert.match(event.timestamp, /(?:Z|[+-]\d{2}:\d{2})$/);
    assert.equal(JSON.stringify(event).includes(secret), false);
    assert.equal(JSON.stringify(event).includes("sensitive-name.txt"), false);
    assert.equal(fs.existsSync(path.join(root, "PRODUCER_PWNED")), false);
    assert.equal(fs.existsSync(path.join(root, "ALSO_PWNED")), false);
    assertPrivateMode(path.dirname(eventFile), 0o700);
    assertPrivateMode(eventFile, 0o600);

    const normalized = normalizeProducedEvents("source-A", [event]);
    assert.equal(normalized.accepted, 1);
    assert.equal(normalized.duplicates, 0);
    assert.equal(normalized.rejected, 0);
    assert.equal(normalized.outputFiles.length, 1);
    assert.match(normalized.outputFiles[0], /\.thirdspace\/events\/normalized\/\d{6}\.ndjson$/);
    assert.match(normalized.errorReport, /normalization-errors\.json$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Token producer accepts environment and JSON input with stable IDs and nullable missing counters", () => {
  const root = temporaryDirectory("remote-events-token-");
  try {
    const eventFile = path.join(root, "private tokens", "events.ndjson");
    const first = runProducer(TOKEN_PRODUCER, {
      cwd: root,
      env: {
        THIRDSPACE_EVENT_FILE: eventFile,
        THIRDSPACE_SOURCE_ID: "source-A",
        THIRDSPACE_AGENT: "codex; touch TOKEN_PWNED",
        THIRDSPACE_SESSION_ID: "session:stable/1",
        THIRDSPACE_MODEL: "gpt-5.6",
        THIRDSPACE_INPUT_TOKENS: "100",
        THIRDSPACE_OUTPUT_TOKENS: "20",
        THIRDSPACE_TOTAL_TOKENS: "120",
      },
    });
    assert.equal(first.status, 0, first.stderr);

    const payload = JSON.stringify({
      source_id: "source-A",
      agent: "codex; touch TOKEN_PWNED",
      session_id: "session:stable/1",
      model: "gpt-5.6",
      metrics: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_tokens: 120,
      },
    });
    const second = runProducer(TOKEN_PRODUCER, {
      cwd: root,
      env: { THIRDSPACE_EVENT_FILE: eventFile },
      args: [payload],
    });
    assert.equal(second.status, 0, second.stderr);

    const events = readEvents(eventFile);
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, "token_usage");
    assert.equal(events[0].event_id, events[1].event_id);
    assert.equal(events[0].session_id, "session:stable/1");
    assert.equal(events[0].subject_id, "session:stable/1");
    assert.equal(events[0].model, "gpt-5.6");
    assert.deepEqual(events[0].metrics, {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: null,
      cache_write_tokens: null,
      total_tokens: 120,
    });
    assert.deepEqual(events[1].metrics, events[0].metrics);
    assert.equal(fs.existsSync(path.join(root, "TOKEN_PWNED")), false);
    assertPrivateMode(path.dirname(eventFile), 0o700);
    assertPrivateMode(eventFile, 0o600);

    const normalized = normalizeProducedEvents("source-A", events);
    assert.equal(normalized.accepted, 1);
    assert.equal(normalized.duplicates, 1);
    assert.equal(normalized.rejected, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checked-in examples are valid NDJSON accepted by the committed normalizer", () => {
  const events = readEvents(EXAMPLE_EVENTS);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.event_type), ["git_commit", "token_usage"]);
  const normalized = normalizeProducedEvents(events[0].source_id, events);
  assert.equal(normalized.accepted, 2);
  assert.equal(normalized.duplicates, 0);
  assert.equal(normalized.rejected, 0);
});

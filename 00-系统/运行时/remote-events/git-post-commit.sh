#!/bin/sh
set -eu

event_file=${THIRDSPACE_EVENT_FILE:-}
source_id=${THIRDSPACE_SOURCE_ID:-}

case "$event_file" in
  /*) ;;
  *)
    echo "THIRDSPACE_EVENT_FILE must be an explicit absolute path" >&2
    exit 64
    ;;
esac

case "$source_id" in
  ""|*[!A-Za-z0-9._-]*)
    echo "THIRDSPACE_SOURCE_ID must match [A-Za-z0-9._-]+" >&2
    exit 64
    ;;
esac

command -v node >/dev/null 2>&1 || {
  echo "node is required to produce safe JSON" >&2
  exit 69
}
command -v git >/dev/null 2>&1 || {
  echo "git is required to produce commit metadata" >&2
  exit 69
}

exec node <<'NODE'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "Git command failed").trim();
    throw new Error(`unable to read Git metadata: ${detail}`);
  }
}

function preparePrivateFile(file) {
  if (!path.isAbsolute(file)) fail("THIRDSPACE_EVENT_FILE must be an explicit absolute path");
  const parent = path.dirname(file);
  if (parent === path.parse(parent).root) fail("THIRDSPACE_EVENT_FILE must use a dedicated private parent directory");

  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail("THIRDSPACE_EVENT_FILE parent must be a real directory");
  if ((parentStat.mode & 0o777) !== 0o700) {
    fail("THIRDSPACE_EVENT_FILE parent must have mode 0700");
  }

  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    fail("THIRDSPACE_EVENT_FILE must not be a symbolic link");
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  fs.fchmodSync(fd, 0o600);
  return fd;
}

function appendOneLine(file, event) {
  const line = `${JSON.stringify(event)}\n`;
  const fd = preparePrivateFile(file);
  try {
    const written = fs.writeSync(fd, line, null, "utf8");
    if (written !== Buffer.byteLength(line)) throw new Error("short append to event file");
  } finally {
    fs.closeSync(fd);
  }
}

try {
  const sourceId = process.env.THIRDSPACE_SOURCE_ID;
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  const repo = path.basename(repoRoot);
  const commit = git(["rev-parse", "HEAD"]).trim();
  const branch = git(["branch", "--show-current"]).trim() || "HEAD";
  const timestamp = git(["log", "-1", "--format=%cI"]).trim();
  const summary = git(["log", "-1", "--format=%s"]).replace(/\r?\n$/, "") || "(no subject)";
  const numstat = git(["show", "--numstat", "--format=", "--no-renames", "HEAD"]);

  let filesChanged = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const line of numstat.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length < 3) continue;
    filesChanged += 1;
    if (/^\d+$/.test(fields[0])) linesAdded += Number(fields[0]);
    if (/^\d+$/.test(fields[1])) linesDeleted += Number(fields[1]);
  }

  appendOneLine(process.env.THIRDSPACE_EVENT_FILE, {
    schema_version: "1.0",
    event_id: `${sourceId}:git:${commit}`,
    timestamp,
    event_type: "git_commit",
    source_id: sourceId,
    subject_id: repo,
    repo,
    branch,
    summary,
    metrics: {
      commits: 1,
      files_changed: filesChanged,
      lines_added: linesAdded,
      lines_deleted: linesDeleted,
    },
    evidence: { commit },
  });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
NODE

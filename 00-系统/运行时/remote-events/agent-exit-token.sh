#!/bin/sh
set -eu

event_file=${THIRDSPACE_EVENT_FILE:-}
case "$event_file" in
  /*) ;;
  *)
    echo "THIRDSPACE_EVENT_FILE must be an explicit absolute path" >&2
    exit 64
    ;;
esac

if [ "$#" -gt 1 ]; then
  echo "agent-exit-token.sh accepts at most one JSON argument" >&2
  exit 64
fi

command -v node >/dev/null 2>&1 || {
  echo "node is required to produce safe JSON" >&2
  exit 69
}

payload=${1:-}
exec node - "$payload" <<'NODE'
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

function parsePayload(raw) {
  if (!raw) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("Token hook argument must be one valid JSON object");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Token hook argument must be one valid JSON object");
  }
  return value;
}

function inputValue(payload, envName, fieldName) {
  const fromEnvironment = process.env[envName];
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  return payload[fieldName];
}

function requiredString(payload, envName, fieldName) {
  const value = inputValue(payload, envName, fieldName);
  if (typeof value !== "string" || value.trim() === "") fail(`${envName} or JSON ${fieldName} is required`);
  return value;
}

function counterValue(payload, envName, fieldName) {
  const fromEnvironment = process.env[envName];
  const value = fromEnvironment !== undefined && fromEnvironment !== ""
    ? fromEnvironment
    : (payload.metrics?.[fieldName] ?? payload.usage?.[fieldName] ?? payload[fieldName] ?? null);
  if (value === null || value === "") return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  fail(`${envName} or JSON ${fieldName} must be a non-negative safe integer`);
}

function currentRepo(payload) {
  if (typeof payload.repo === "string" && payload.repo.trim()) return payload.repo;
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root ? path.basename(root) : null;
  } catch {
    return null;
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
  const payload = parsePayload(process.argv[2]);
  const sourceId = requiredString(payload, "THIRDSPACE_SOURCE_ID", "source_id");
  if (!/^[A-Za-z0-9._-]+$/.test(sourceId)) fail("THIRDSPACE_SOURCE_ID must match [A-Za-z0-9._-]+");
  const agent = requiredString(payload, "THIRDSPACE_AGENT", "agent");
  const sessionId = requiredString(payload, "THIRDSPACE_SESSION_ID", "session_id");
  const modelInput = inputValue(payload, "THIRDSPACE_MODEL", "model");
  const model = typeof modelInput === "string" && modelInput.trim() ? modelInput : "unknown";
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify([sourceId, agent, sessionId]))
    .digest("hex");
  const repo = currentRepo(payload);

  const event = {
    schema_version: "1.0",
    event_id: `${sourceId}:token:${digest}`,
    timestamp: new Date().toISOString(),
    event_type: "token_usage",
    source_id: sourceId,
    subject_id: sessionId,
    model,
    session_id: sessionId,
    metrics: {
      input_tokens: counterValue(payload, "THIRDSPACE_INPUT_TOKENS", "input_tokens"),
      output_tokens: counterValue(payload, "THIRDSPACE_OUTPUT_TOKENS", "output_tokens"),
      cache_read_tokens: counterValue(payload, "THIRDSPACE_CACHE_READ_TOKENS", "cache_read_tokens"),
      cache_write_tokens: counterValue(payload, "THIRDSPACE_CACHE_WRITE_TOKENS", "cache_write_tokens"),
      total_tokens: counterValue(payload, "THIRDSPACE_TOTAL_TOKENS", "total_tokens"),
    },
  };
  if (repo) event.repo = repo;
  appendOneLine(process.env.THIRDSPACE_EVENT_FILE, event);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
NODE

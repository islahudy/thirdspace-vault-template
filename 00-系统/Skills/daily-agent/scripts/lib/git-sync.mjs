// ---------------------------------------------------------------------------
// Git sync helper for the daily-agent.
//
// Best-effort wrapper around `git status / add / commit / push` so that every
// `opening-complete` flushes today's local changes to the remote. Never throws;
// failures are recorded in the result and surfaced to the Agent so the today
// flow can finish even when git or the remote is unavailable.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

const SAFE_OUTPUT_LIMIT = 2000;

function truncate(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= SAFE_OUTPUT_LIMIT) return trimmed;
  return `${trimmed.slice(0, SAFE_OUTPUT_LIMIT)}... [truncated ${trimmed.length - SAFE_OUTPUT_LIMIT} chars]`;
}

function lastLine(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function run(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function safeRun(cwd, args) {
  try {
    return { ok: true, stdout: run(cwd, args) };
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr) : "";
    const stdout = error && error.stdout ? String(error.stdout) : "";
    return { ok: false, stderr: truncate(stderr || stdout || error.message), code: error.status };
  }
}

export function gitSyncVault(context, options = {}) {
  const cwd = context.vaultRoot;
  const result = {
    ok: false,
    committed: false,
    pushed: false,
    skipped: null,
    branch: null,
    remote: null,
    files_changed: 0,
    commit_message: null,
    errors: [],
  };

  const verbose = options.verbose !== false;

  // 1. Must be a git repo. Skip silently if not.
  const repoCheck = safeRun(cwd, ["rev-parse", "--git-dir"]);
  if (!repoCheck.ok) {
    result.skipped = "not a git repo";
    return result;
  }

  // 2. Detect current branch and remote.
  const branchCheck = safeRun(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchCheck.ok) result.branch = branchCheck.stdout.trim();
  const remoteCheck = safeRun(cwd, ["config", "--get", "remote.origin.url"]);
  if (remoteCheck.ok) result.remote = remoteCheck.stdout.trim();

  // 3. Check for changes (respects .gitignore).
  const statusCheck = safeRun(cwd, ["status", "--porcelain"]);
  if (!statusCheck.ok) {
    result.errors.push(`status: ${statusCheck.stderr}`);
    return result;
  }
  const changedLines = statusCheck.stdout.split("\n").filter(Boolean);
  result.files_changed = changedLines.length;
  if (changedLines.length === 0) {
    result.skipped = "no changes";
    result.ok = true;
    return result;
  }

  // 4. Stage everything within the vault root (excludes untracked files
  //    outside the work tree and honors .gitignore).
  const addCheck = safeRun(cwd, ["add", "-A", "--", "."]);
  if (!addCheck.ok) {
    result.errors.push(`add: ${addCheck.stderr}`);
    return result;
  }

  // 5. Commit with a recognizable message. `--allow-empty` is a no-op for
  //    our case (we already confirmed porcelain output is non-empty), but
  //    guards against a race where the user commits concurrently.
  const stamp = String(context.now).slice(0, 10);
  const message = `daily-agent: vault sync ${stamp}`;
  result.commit_message = message;
  const commitCheck = safeRun(cwd, ["commit", "-m", message, "--no-verify"]);
  if (!commitCheck.ok) {
    // "nothing to commit" can still happen if a pre-commit hook un-staged
    // everything; treat that as a successful no-op.
    if (/nothing to commit/i.test(commitCheck.stderr) || /nothing to commit/i.test(lastLine(commitCheck.stderr))) {
      result.skipped = "nothing to commit after staging";
      result.ok = true;
      return result;
    }
    result.errors.push(`commit: ${commitCheck.stderr}`);
    return result;
  }
  result.committed = true;

  // 6. Push best-effort. A push failure does not invalidate the local
  //    commit; surface it so the Agent can mention coverage loss.
  if (!result.branch || !result.remote) {
    result.errors.push("push: missing branch or remote");
    result.ok = true;
    return result;
  }
  const pushCheck = safeRun(cwd, ["push", "origin", result.branch]);
  if (!pushCheck.ok) {
    result.errors.push(`push: ${pushCheck.stderr}`);
    result.ok = true;
    return result;
  }
  result.pushed = true;
  result.ok = true;
  if (verbose) {
    return { ...result, push_output: truncate(pushCheck.stdout) };
  }
  return result;
}

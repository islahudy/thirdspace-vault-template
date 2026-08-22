import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validateRemoteSource, loadRemoteSources } from "./remote-config.mjs";
import { readState, mutateState } from "./store.mjs";

function resolveConfigPath(vaultRoot, configPath) {
  return path.isAbsolute(configPath) ? configPath : path.join(vaultRoot, configPath);
}

function rawSnapshotPath(vaultRoot, sourceId) {
  return path.join(vaultRoot, ".thirdspace", "events", "remote", sourceId, "raw", "events.ndjson");
}

function validateNdjson(text) {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
    } catch {
      throw new Error(`invalid NDJSON at line ${index + 1}`);
    }
  }
}

function replaceRawSnapshot(rawPath, content) {
  const temporary = `${rawPath}.tmp-sync`;
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  try {
    fs.writeFileSync(temporary, content, "utf8");
    validateNdjson(content);
    fs.renameSync(temporary, rawPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Preserve the synchronization error and the previous raw snapshot.
    }
    throw error;
  }
}

function updateSyncState(context, sourceId, status, error) {
  const statePath = path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", "agent-state.json");
  const current = readState(statePath, "pending_confirmations");
  if (!current.last_remote_sync || typeof current.last_remote_sync !== "object" || Array.isArray(current.last_remote_sync)) {
    throw new Error("invalid last_remote_sync");
  }
  return mutateState(statePath, current.revision, (state) => ({
    ...state,
    last_remote_sync: {
      ...state.last_remote_sync,
      [sourceId]: { synced_at: context.now, status, error },
    },
  }), context.now);
}

export function fetchRemoteSource(source) {
  validateRemoteSource(source);
  return execFileSync("ssh", [source.ssh_host, "cat", "--", source.remote_path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function syncRemoteSources(context, { configPath, fetchSource = fetchRemoteSource }) {
  if (!context?.vaultRoot || !context.now) throw new Error("vaultRoot and now are required");
  const sources = loadRemoteSources(resolveConfigPath(context.vaultRoot, configPath)).sources;
  const succeeded = [];
  const failed = [];
  for (const source of sources) {
    if (!source.enabled) continue;
    try {
      const content = fetchSource(source);
      if (typeof content !== "string") throw new Error("remote source returned non-text content");
      const rawPath = rawSnapshotPath(context.vaultRoot, source.source_id);
      replaceRawSnapshot(rawPath, content);
      updateSyncState(context, source.source_id, "succeeded", null);
      succeeded.push({ source_id: source.source_id, raw_path: rawPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        updateSyncState(context, source.source_id, "failed", message);
      } catch {
        // Keep the source failure independent of a damaged or concurrently changed state file.
      }
      failed.push({ source_id: source.source_id, error: message });
    }
  }
  return { succeeded, failed };
}

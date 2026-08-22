import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = ["event_id", "timestamp", "event_type", "source_id", "subject_id"];

export function makeEventId(kind, subjectId, timestamp) {
  const normalizedTime = new Date(timestamp).toISOString().replace(/[-:.]/g, "");
  return `${String(kind).trim()}:${String(subjectId).trim()}:${normalizedTime}`;
}

export function appendEvent(vaultRoot, event) {
  for (const field of REQUIRED_FIELDS) {
    if (!event?.[field]) throw new Error(`event field required: ${field}`);
  }
  const date = String(event.timestamp).slice(0, 10).replaceAll("-", "");
  if (!/^\d{8}$/.test(date) || Number.isNaN(new Date(event.timestamp).getTime())) throw new Error(`invalid event timestamp: ${event.timestamp}`);
  const directory = path.join(vaultRoot, ".thirdspace", "events", "local");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${date}.ndjson`);
  const normalized = { schema_version: "1.0", ...event };
  fs.appendFileSync(file, `${JSON.stringify(normalized)}\n`, "utf8");
  return { path: file, event: normalized };
}

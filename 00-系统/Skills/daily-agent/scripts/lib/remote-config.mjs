import fs from "node:fs";

const TOP_LEVEL_KEYS = new Set(["version", "timezone", "sources"]);
const SOURCE_KEYS = new Set(["source_id", "ssh_host", "remote_path", "enabled"]);
const SSH_HOST_PATTERN = /^[A-Za-z0-9._-]+$/;
const REMOTE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function scalar(value, lineNumber) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`invalid quoted value at line ${lineNumber}`);
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed) return trimmed;
  throw new Error(`missing value at line ${lineNumber}`);
}

function assign(object, key, value, lineNumber) {
  if (Object.hasOwn(object, key)) throw new Error(`duplicate key at line ${lineNumber}: ${key}`);
  object[key] = value;
}

function parseSourceField(source, line, lineNumber) {
  const match = line.match(/^ {4}([A-Za-z_]+):\s*(.+)$/);
  if (!match) throw new Error(`invalid source entry at line ${lineNumber}`);
  const [, key, value] = match;
  if (!SOURCE_KEYS.has(key)) throw new Error(`unknown source key at line ${lineNumber}: ${key}`);
  assign(source, key, scalar(value, lineNumber), lineNumber);
}

function parseConfig(text) {
  const config = {};
  let sources = null;
  let source = null;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const topLevel = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (topLevel) {
      const [, key, value] = topLevel;
      if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`unknown top-level key at line ${lineNumber}: ${key}`);
      if (key === "sources") {
        if (value && value !== "[]") throw new Error(`sources must be a list at line ${lineNumber}`);
        assign(config, key, [], lineNumber);
        sources = config.sources;
        source = null;
      } else {
        assign(config, key, scalar(value, lineNumber), lineNumber);
      }
      continue;
    }
    if (sources && /^ {2}-\s+/.test(line)) {
      source = {};
      sources.push(source);
      parseSourceField(source, line.replace(/^ {2}-\s+/, "    "), lineNumber);
      continue;
    }
    if (source && /^ {4}/.test(line)) {
      parseSourceField(source, line, lineNumber);
      continue;
    }
    throw new Error(`unsupported YAML syntax at line ${lineNumber}`);
  }
  return config;
}

export function validateRemoteSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("invalid remote source");
  for (const key of SOURCE_KEYS) {
    if (!Object.hasOwn(source, key)) throw new Error(`remote source field required: ${key}`);
  }
  if (typeof source.source_id !== "string" || !SOURCE_ID_PATTERN.test(source.source_id)) throw new Error(`invalid source_id: ${source.source_id}`);
  if (typeof source.ssh_host !== "string" || !SSH_HOST_PATTERN.test(source.ssh_host)) throw new Error(`invalid ssh_host: ${source.ssh_host}`);
  if (typeof source.remote_path !== "string" || !REMOTE_PATH_PATTERN.test(source.remote_path)) throw new Error(`invalid remote_path: ${source.remote_path}`);
  if (typeof source.enabled !== "boolean") throw new Error(`invalid enabled: ${source.enabled}`);
  return source;
}

export function loadRemoteSources(configPath) {
  const config = parseConfig(fs.readFileSync(configPath, "utf8"));
  if (config.version !== "1.0") throw new Error(`unsupported remote source version: ${config.version ?? "missing"}`);
  if (!Array.isArray(config.sources)) throw new Error("sources is required");
  if (Object.hasOwn(config, "timezone") && typeof config.timezone !== "string") throw new Error("invalid timezone");
  const sourceIds = new Set();
  const sources = config.sources.map((source) => {
    validateRemoteSource(source);
    if (sourceIds.has(source.source_id)) throw new Error(`duplicate source_id: ${source.source_id}`);
    sourceIds.add(source.source_id);
    return source;
  });
  return { version: "1.0", sources };
}

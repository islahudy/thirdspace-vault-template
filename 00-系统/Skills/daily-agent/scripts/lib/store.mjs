import fs from "node:fs";

function parseState(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`invalid JSON: ${file}`);
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid state root: ${file}`);
  if (value.version !== "1.0") throw new Error(`unsupported version: ${value.version ?? "missing"}`);
  if (!Number.isInteger(value.revision) || value.revision < 0) throw new Error(`invalid revision: ${file}`);
  return value;
}

export function readState(file, expectedCollection) {
  const value = parseState(file);
  if (!Array.isArray(value[expectedCollection])) throw new Error(`missing collection: ${expectedCollection}`);
  return value;
}

export function mutateState(file, expectedRevision, mutator, now) {
  const current = parseState(file);
  if (current.revision !== expectedRevision) {
    throw new Error(`revision conflict: expected ${expectedRevision}, found ${current.revision}`);
  }
  const mutated = mutator(structuredClone(current));
  if (!mutated || typeof mutated !== "object" || Array.isArray(mutated)) throw new Error("mutator must return an object");
  const next = { ...mutated, version: "1.0", revision: current.revision + 1, updated_at: now };
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
  return next;
}

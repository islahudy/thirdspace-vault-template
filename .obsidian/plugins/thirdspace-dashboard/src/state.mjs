export function parseState(text, collection) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid state root");
  if (value.version !== "1.0") throw new Error(`unsupported version: ${value.version ?? "missing"}`);
  if (!Number.isInteger(value.revision) || value.revision < 0) throw new Error("invalid revision");
  if (!Array.isArray(value[collection])) throw new Error(`missing collection: ${collection}`);
  return value;
}

export function prepareMutation(current, expectedRevision, mutate, now) {
  if (current.revision !== expectedRevision) throw new Error(`revision conflict: expected ${expectedRevision}, found ${current.revision}`);
  const changed = mutate(structuredClone(current));
  if (!changed || typeof changed !== "object" || Array.isArray(changed)) throw new Error("mutation must return an object");
  return { ...changed, version: "1.0", revision: current.revision + 1, updated_at: now };
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { callEventKit } from "../scripts/eventkit-adapter.mjs";

const execFileAsync = promisify(execFile);
const fixtureBridge = fileURLToPath(new URL("./fixtures/fake-bridge.mjs", import.meta.url));
const adapterCLI = fileURLToPath(new URL("../scripts/eventkit-adapter.mjs", import.meta.url));

function callWithMode(mode, options = {}) {
  const previous = process.env.FAKE_BRIDGE_MODE;
  process.env.FAKE_BRIDGE_MODE = mode;
  try {
    return callEventKit(
      { action: "calendar.list", params: {} },
      { executable: fixtureBridge, timeoutMs: 500, ...options },
    );
  } finally {
    if (previous === undefined) delete process.env.FAKE_BRIDGE_MODE;
    else process.env.FAKE_BRIDGE_MODE = previous;
  }
}

test("adapter parses one successful response", async () => {
  const response = await callEventKit(
    { action: "calendar.list", params: {} },
    { executable: fixtureBridge, timeoutMs: 500 },
  );

  assert.equal(response.success, true);
  assert.equal(response.data.action, "calendar.list");
});

test("adapter preserves structured protocol failures", async () => {
  const response = await callWithMode("protocol-error");

  assert.deepEqual(response, {
    success: false,
    error: {
      code: "PERMISSION_DENIED",
      message: "Calendar access denied.",
      details: { resource: "calendar" },
    },
  });
});

test("adapter rejects stdout containing non-JSON logs", async () => {
  await assert.rejects(
    callWithMode("invalid-json"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("adapter requires a boolean success field", async () => {
  await assert.rejects(
    callWithMode("invalid-shape"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("adapter terminates a hung bridge", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    callWithMode("hang", { timeoutMs: 50 }),
    (error) => error.code === "BRIDGE_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("adapter reports a missing executable separately", async () => {
  await assert.rejects(
    callEventKit(
      { action: "auth.status", params: {} },
      { executable: "/definitely/missing/thirdspace-eventkit-bridge", timeoutMs: 500 },
    ),
    (error) => error.code === "BRIDGE_NOT_FOUND",
  );
});

test("adapter treats a nonzero exit without a response as invalid", async () => {
  await assert.rejects(
    callWithMode("exit"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("adapter keeps child stderr out of successful responses", async () => {
  const response = await callWithMode("stderr");

  assert.deepEqual(response, { success: true, data: {} });
});

test("adapter bounds stdout collection", async () => {
  await assert.rejects(
    callWithMode("oversized-stdout"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("adapter bounds stderr collection", async () => {
  await assert.rejects(
    callWithMode("oversized-stderr"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("environment override supplies the default executable", async () => {
  const previous = process.env.THIRDSPACE_EVENTKIT_BRIDGE;
  process.env.THIRDSPACE_EVENTKIT_BRIDGE = fixtureBridge;
  try {
    const response = await callEventKit(
      { action: "auth.status", params: {} },
      { timeoutMs: 500 },
    );
    assert.equal(response.success, true);
  } finally {
    if (previous === undefined) delete process.env.THIRDSPACE_EVENTKIT_BRIDGE;
    else process.env.THIRDSPACE_EVENTKIT_BRIDGE = previous;
  }
});

test("CLI writes exactly one JSON response", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [adapterCLI, "call", "--json", JSON.stringify({ action: "auth.status", params: {} })],
    {
      env: {
        ...process.env,
        FAKE_BRIDGE_MODE: "success",
        THIRDSPACE_EVENTKIT_BRIDGE: fixtureBridge,
      },
      timeout: 1_000,
    },
  );

  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: { action: "auth.status" },
  });
  assert.equal(stdout.trim().split("\n").length, 1);
  assert.equal(stderr, "");
});

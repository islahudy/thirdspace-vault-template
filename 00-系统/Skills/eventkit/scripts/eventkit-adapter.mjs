#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_STREAM_BYTES = 1_048_576;
const DEFAULT_EXECUTABLE = fileURLToPath(
  new URL("./eventkit-bridge/.build/release/eventkit-bridge", import.meta.url),
);

export class EventKitAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventKitAdapterError";
    this.code = code;
  }
}

export function callEventKit(request, options = {}) {
  const executable = options.executable
    ?? process.env.THIRDSPACE_EVENTKIT_BRIDGE
    ?? DEFAULT_EXECUTABLE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let requestJSON;

  try {
    requestJSON = JSON.stringify(request);
  } catch {
    return Promise.reject(new EventKitAdapterError(
      "INVALID_BRIDGE_RESPONSE",
      "EventKit request could not be serialized.",
    ));
  }

  if (typeof requestJSON !== "string") {
    return Promise.reject(new EventKitAdapterError(
      "INVALID_BRIDGE_RESPONSE",
      "EventKit request could not be serialized.",
    ));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const rejectInvalid = (message) => {
      child.kill("SIGKILL");
      finish(() => reject(new EventKitAdapterError("INVALID_BRIDGE_RESPONSE", message)));
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new EventKitAdapterError(
        "BRIDGE_TIMEOUT",
        `EventKit bridge exceeded the ${timeoutMs} ms timeout.`,
      )));
    }, timeoutMs);

    child.once("error", (error) => {
      const code = error.code === "ENOENT" ? "BRIDGE_NOT_FOUND" : "INVALID_BRIDGE_RESPONSE";
      const message = code === "BRIDGE_NOT_FOUND"
        ? `EventKit bridge executable was not found: ${executable}`
        : "EventKit bridge could not be started.";
      finish(() => reject(new EventKitAdapterError(code, message)));
    });

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STREAM_BYTES) {
        rejectInvalid("EventKit bridge stdout exceeded the response limit.");
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STREAM_BYTES) {
        rejectInvalid("EventKit bridge stderr exceeded the diagnostic limit.");
        return;
      }
      stderr.push(chunk);
    });

    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(() => reject(new EventKitAdapterError(
          "INVALID_BRIDGE_RESPONSE",
          `EventKit bridge exited with status ${code}.`,
        )));
        return;
      }

      let response;
      try {
        response = JSON.parse(Buffer.concat(stdout).toString("utf8").trim());
      } catch {
        finish(() => reject(new EventKitAdapterError(
          "INVALID_BRIDGE_RESPONSE",
          "EventKit bridge did not return exactly one JSON response.",
        )));
        return;
      }

      if (
        response === null
        || typeof response !== "object"
        || Array.isArray(response)
        || typeof response.success !== "boolean"
      ) {
        finish(() => reject(new EventKitAdapterError(
          "INVALID_BRIDGE_RESPONSE",
          "EventKit bridge response must contain a boolean success field.",
        )));
        return;
      }

      finish(() => resolve(response));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(`${requestJSON}\n`);
  });
}

async function runCLI(argv) {
  const [command, flag, requestJSON, ...extra] = argv;
  if (command !== "call" || flag !== "--json" || requestJSON === undefined || extra.length > 0) {
    throw new EventKitAdapterError(
      "INVALID_BRIDGE_RESPONSE",
      "Usage: node eventkit-adapter.mjs call --json REQUEST",
    );
  }

  let request;
  try {
    request = JSON.parse(requestJSON);
  } catch {
    throw new EventKitAdapterError("INVALID_BRIDGE_RESPONSE", "REQUEST must be valid JSON.");
  }

  return callEventKit(request);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const response = await runCLI(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response = {
      success: false,
      error: {
        code: error?.code ?? "INVALID_BRIDGE_RESPONSE",
        message: error?.message ?? "EventKit adapter failed.",
      },
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exitCode = 1;
  }
}

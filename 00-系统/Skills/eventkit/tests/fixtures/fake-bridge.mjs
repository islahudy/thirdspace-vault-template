#!/usr/bin/env node

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const mode = process.env.FAKE_BRIDGE_MODE ?? "success";
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));

switch (mode) {
  case "success":
    process.stdout.write(`${JSON.stringify({ success: true, data: { action: request.action } })}\n`);
    break;
  case "protocol-error":
    process.stdout.write(`${JSON.stringify({
      success: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Calendar access denied.",
        details: { resource: "calendar" },
      },
    })}\n`);
    break;
  case "invalid-json":
    process.stdout.write("bridge log that does not belong on stdout\n");
    process.stdout.write(`${JSON.stringify({ success: true, data: {} })}\n`);
    break;
  case "invalid-shape":
    process.stdout.write(`${JSON.stringify({ data: {} })}\n`);
    break;
  case "stderr":
    process.stderr.write("diagnostic output\n");
    process.stdout.write(`${JSON.stringify({ success: true, data: {} })}\n`);
    break;
  case "exit":
    process.exitCode = 17;
    break;
  case "hang":
    setInterval(() => {}, 1_000);
    break;
  case "oversized-stdout":
    process.stdout.write("x".repeat(1_100_000));
    break;
  case "oversized-stderr":
    process.stderr.write("x".repeat(1_100_000));
    break;
  default:
    throw new Error(`Unknown fake bridge mode: ${mode}`);
}

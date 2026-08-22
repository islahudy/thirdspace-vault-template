import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const pluginRoot = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "..");

test("dashboard exposes reproducible source build and test scripts", () => {
  const packageFile = path.join(pluginRoot, "package.json");
  assert.equal(fs.existsSync(packageFile), true);
  const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  assert.equal(manifest.scripts.build, "esbuild src/main.mjs --bundle --external:obsidian --format=cjs --platform=browser --outfile=main.js");
  assert.equal(manifest.scripts.test, "node --test tests/*.test.mjs");
  assert.equal(fs.existsSync(path.join(pluginRoot, "src", "main.mjs")), true);
});

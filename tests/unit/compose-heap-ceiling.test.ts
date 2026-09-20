/**
 * Compose must not hard-code the V8 heap ceiling.
 *
 * A literal `NODE_OPTIONS=--max-old-space-size=…` wins over the image's own
 * OMNIROUTE_MEMORY_MB wiring — `scripts/dev/run-standalone.mjs` keeps an
 * explicit NODE_OPTIONS value whenever OMNIROUTE_MEMORY_MB is unset (#5238) —
 * so every Compose host got the same heap no matter how much RAM it had. On a
 * 2 GB box that overshoot pushed the host into swap, spiked memory PSI and
 * tripped `open-sse/utils/resourcePressure.ts`, which then answers EVERY
 * provider with 503 "Service temporarily unavailable due to resource pressure".
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const { resolveContainerMemoryMb, warnHeapExceedsContainerLimit } = await import(
  "../../scripts/build/runtime-env.mjs"
);

test("docker-compose derives the heap ceiling from OMNIROUTE_MEMORY_MB", () => {
  const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
  assert.match(
    compose,
    /NODE_OPTIONS=--max-old-space-size=\$\{OMNIROUTE_MEMORY_MB:-1024\}/,
    "compose must defer to OMNIROUTE_MEMORY_MB instead of pinning a literal heap"
  );
  assert.doesNotMatch(
    compose,
    /NODE_OPTIONS=--max-old-space-size=(?!\$\{)/,
    "a literal heap ceiling shadows OMNIROUTE_MEMORY_MB (#5238)"
  );
});

test("resolveContainerMemoryMb reports the cgroup ceiling, null when unbounded", () => {
  assert.equal(resolveContainerMemoryMb(() => 2 * 1024 ** 3), 2048);
  assert.equal(resolveContainerMemoryMb(() => undefined), null);
  assert.equal(resolveContainerMemoryMb(() => 0), null);
  assert.equal(resolveContainerMemoryMb(() => Number.POSITIVE_INFINITY), null);
});

test("#2939 heap without native-memory headroom under the container limit → warn", () => {
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  assert.equal(warnHeapExceedsContainerLimit(2048, 2048, log), true);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /heap ceiling 2048 MB/);
  assert.match(messages[0], /2048 MB memory limit/);
  assert.match(messages[0], /OMNIROUTE_MEMORY_MB/);
});

test("#2939 heap that leaves headroom → no warn", () => {
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  assert.equal(warnHeapExceedsContainerLimit(1024, 2048, log), false);
  assert.equal(warnHeapExceedsContainerLimit(2048, 4096, log), false);
  assert.equal(messages.length, 0);
});

test("#2939 unknown heap or unbounded host → no warn", () => {
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  assert.equal(warnHeapExceedsContainerLimit(null, 2048, log), false);
  assert.equal(warnHeapExceedsContainerLimit(2048, null, log), false);
  assert.equal(warnHeapExceedsContainerLimit(undefined, undefined, log), false);
  assert.equal(messages.length, 0);
});

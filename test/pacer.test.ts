import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireSlot, _resetPacerForTests } from "../src/http/pacer.ts";

test.beforeEach(() => {
  process.env["SPOTIFY_CLI_MIN_INTERVAL_MS"] = "100";
  _resetPacerForTests();
});

test.after(() => {
  delete process.env["SPOTIFY_CLI_MIN_INTERVAL_MS"];
});

test("first slot resolves immediately", async () => {
  const t0 = Date.now();
  await acquireSlot();
  assert.ok(Date.now() - t0 < 50, "first slot should not wait");
});

test("subsequent slots are spaced by at least minInterval", async () => {
  await acquireSlot();
  const start = Date.now();
  await acquireSlot();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 95, `expected ≥100ms gap, got ${elapsed}ms`);
});

test("slots acquired concurrently are serialized in invocation order", async () => {
  const order: number[] = [];
  const start = Date.now();
  const tasks = [0, 1, 2, 3].map(async (i) => {
    await acquireSlot();
    order.push(i);
  });
  await Promise.all(tasks);
  assert.deepEqual(order, [0, 1, 2, 3]);
  const elapsed = Date.now() - start;
  // 4 slots @ 100ms minInterval => first at ~0, then 100, 200, 300
  assert.ok(elapsed >= 290, `expected ≥300ms total for 4 slots, got ${elapsed}ms`);
});

test("zero minInterval disables waiting", async () => {
  process.env["SPOTIFY_CLI_MIN_INTERVAL_MS"] = "0";
  _resetPacerForTests();
  const start = Date.now();
  await acquireSlot();
  await acquireSlot();
  await acquireSlot();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `expected ~0ms total with minInterval=0, got ${elapsed}ms`);
});

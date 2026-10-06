import assert from "node:assert/strict";
import test from "node:test";
import { getTaskOrderCatalog, quoteTaskOrder } from "./task-orders";

test("task-order catalog separates safe local tasks from blocked categories", () => {
  const catalog = getTaskOrderCatalog();
  const available = catalog.tasks.filter((task) => task.status === "available");
  const unavailable = catalog.tasks.filter((task) => task.status === "not_available");

  assert.equal(catalog.mode, "preview");
  assert.equal(catalog.depositRequired, false);
  assert.equal(catalog.dispatchMode, "local-preview-only");
  assert.ok(available.length > 10);
  assert.ok(unavailable.length >= 4);
  assert.equal(
    catalog.tasks.find((task) => task.id === "password_hash_recovery")?.status,
    "not_available",
  );
  assert.equal(
    catalog.tasks.find((task) => task.id === "checksum_generation")?.status,
    "available",
  );
  assert.equal(
    catalog.tasks.find((task) => task.id === "tls_configuration_audit")?.status,
    "available",
  );
  assert.ok(catalog.tasks.every((task) => task.authorizationBoundary === "loopback-only"));
});

test("available quote scales solved projection, time, and synthetic credits", () => {
  const quote = quoteTaskOrder({
    taskId: "capture_the_flag",
    hashRate: 1_000,
    solvedPercent: 75,
    totalItems: 2_000,
  });

  assert.equal(quote.status, "available");
  assert.equal(quote.estimatedSolvedItems, 1_500);
  assert.equal(quote.estimatedSeconds, 2);
  assert.equal(quote.estimatedTime, "2s");
  assert.equal(quote.balanceRequiredCredits, 16);
  assert.equal(quote.depositRequired, false);
  assert.equal(quote.dispatchMode, "local-preview-only");
});

test("blocked quote never produces a balance or dispatch estimate", () => {
  const quote = quoteTaskOrder({
    taskId: "password_hash_recovery",
    hashRate: 1_000_000,
    solvedPercent: 100,
    totalItems: 100_000,
  });

  assert.equal(quote.status, "not_available");
  assert.equal(quote.estimatedSolvedItems, 0);
  assert.equal(quote.estimatedSeconds, 0);
  assert.equal(quote.balanceRequiredCredits, 0);
  assert.equal(quote.estimatedTime, "not available");
});

test("unknown task order is rejected", () => {
  assert.throws(
    () => quoteTaskOrder({ taskId: "missing", hashRate: 1, solvedPercent: 50, totalItems: 1 }),
    /Unknown task order/,
  );
});
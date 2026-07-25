import assert from "node:assert/strict";
import test from "node:test";
import { transfer } from "./index.js";

test("gera transferência balanceada", () => {
  const transaction = transfer({ id: "1", idempotencyKey: "k1", from: "alice", to: "bob", amountMinor: 4400n, memo: "Pão" });
  assert.equal(transaction.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n), 0n);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const economySource = readFileSync(new URL("./economy.ts", import.meta.url), "utf8");
const snapshotStart = economySource.indexOf("export async function snapshot");
const verticalSliceStart = economySource.indexOf("export async function verticalSlice");
const snapshotSource = economySource.slice(snapshotStart, verticalSliceStart);

test("player snapshot reads canonical posted reserved and available balances", () => {
  assert.match(snapshotSource, /SELECT code,posted_minor,reserved_minor,available_minor/);
  assert.match(snapshotSource, /FROM ledger_account_balances/);
  assert.match(snapshotSource, /WHERE owner_id=\$\{ownerId\}::uuid/);
});

test("balance response preserves value compatibility while making available balance authoritative", () => {
  assert.match(snapshotSource, /value:Number\(row\.available_minor\)/);
  assert.match(snapshotSource, /postedMinor:Number\(row\.posted_minor\)/);
  assert.match(snapshotSource, /reservedMinor:Number\(row\.reserved_minor\)/);
  assert.match(snapshotSource, /availableMinor:Number\(row\.available_minor\)/);
});

test("inventory remains reservation-aware", () => {
  assert.match(snapshotSource, /SUM\(l\.quantity_minor-l\.reserved_minor\)::bigint quantity/);
  assert.match(snapshotSource, /WHERE l\.owner_id=\$\{ownerId\}::uuid/);
});

// Tehkné Solutions

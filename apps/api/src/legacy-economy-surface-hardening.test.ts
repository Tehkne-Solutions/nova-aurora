import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const economySource = readFileSync(new URL("./economy.ts", import.meta.url), "utf8");
const snapshotStart = economySource.indexOf("export async function snapshot");
const verticalSliceStart = economySource.indexOf("export async function verticalSlice");
const snapshotSource = economySource.slice(snapshotStart, verticalSliceStart);

test("economy snapshot is authenticated at the HTTP boundary", () => {
  assert.match(serverSource, /import \{ snapshot \} from "\.\/economy\.js"/);
  assert.match(
    serverSource,
    /app\.get\("\/v1\/economy\/snapshot", async \(request\) =>\s*snapshot\(await requireActorId\(app, request\)\)\s*\)/s
  );
});

test("legacy vertical slice is no longer exposed as a public HTTP mutation", () => {
  assert.doesNotMatch(serverSource, /verticalSlice/);
  assert.doesNotMatch(serverSource, /\/v1\/tutorial\/run/);
  assert.match(economySource, /export async function verticalSlice\(key:string\)/);
});

test("snapshot queries only the authenticated owner's accounts, inventory and market orders", () => {
  assert.ok(snapshotStart >= 0 && verticalSliceStart > snapshotStart);
  assert.match(snapshotSource, /snapshot\(ownerId: string\)/);
  assert.match(snapshotSource, /WHERE a\.owner_id=\$\{ownerId\}::uuid/);
  assert.match(snapshotSource, /WHERE l\.owner_id=\$\{ownerId\}::uuid/);
  assert.match(snapshotSource, /WHERE o\.owner_id=\$\{ownerId\}::uuid/);
  assert.doesNotMatch(snapshotSource, /JOIN users/);
  assert.doesNotMatch(snapshotSource, /u\.email/);
});

test("snapshot remains backed by PostgreSQL and carries the product signature", () => {
  assert.match(snapshotSource, /const sql=db\(\)/);
  assert.match(snapshotSource, /adapter:"postgres"/);
  assert.match(snapshotSource, /signature:"Tehkné Solutions"/);
});

// Tehkné Solutions

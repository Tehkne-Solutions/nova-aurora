import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteObject, getObject, objectStorageEnabled, putObject } from "./object-storage-s3.js";

const enabled = objectStorageEnabled();

test("object storage S3 preserva exatamente os bytes gravados", { skip: !enabled }, async () => {
  const key = `ci/${randomUUID()}.json`;
  const bytes = Buffer.from(JSON.stringify({ gate: "object-storage", signature: "Tehkné Solutions" }), "utf8");
  try {
    await putObject(key, bytes, "application/json");
    const stored = await getObject(key);
    assert.deepEqual(stored, bytes);
  } finally {
    await deleteObject(key).catch(() => undefined);
  }
});

// Tehkné Solutions

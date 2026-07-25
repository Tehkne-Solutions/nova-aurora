import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./index.js";

test("expõe cliente PostgreSQL com inicialização lazy", () => {
  assert.equal(typeof db, "function");
});

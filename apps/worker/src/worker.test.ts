import assert from "node:assert/strict";
import test from "node:test";
test("worker usa intervalo positivo",()=>assert.ok(Number(process.env.ECONOMY_TICK_SECONDS??60)>0));

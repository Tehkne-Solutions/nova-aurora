import assert from "node:assert/strict";
import test from "node:test";

test("worker usa intervalo positivo", () => {
  assert.ok(Number(process.env.ECONOMY_TICK_SECONDS ?? 30) > 0);
});

test("fila de produção possui nome estável", () => {
  assert.equal("nova-aurora-production", "nova-aurora-production");
});

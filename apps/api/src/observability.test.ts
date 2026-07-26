import assert from "node:assert/strict";
import test from "node:test";
import { renderMetrics } from "./observability.js";

test("métricas da API usam formato Prometheus e assinatura do produto", () => {
  const metrics = renderMetrics();
  assert.match(metrics, /# TYPE nova_aurora_api_info gauge/);
  assert.match(metrics, /nova_aurora_api_info\{[^}]*signature="Tehkné Solutions"[^}]*\} 1/);
  assert.match(metrics, /nova_aurora_api_active_requests 0/);
  assert.match(metrics, /nova_aurora_dependency_ready\{service="api",dependency="postgres"\} [01]/);
  assert.ok(metrics.endsWith("\n"));
});

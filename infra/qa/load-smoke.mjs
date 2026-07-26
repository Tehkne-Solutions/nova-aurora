import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const webUrl = (process.env.WEB_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const reportFile = process.env.LOAD_QA_REPORT ?? "release-load-report.json";
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const requestsPerTarget = Number(process.env.LOAD_REQUESTS_PER_TARGET ?? 80);
const p95LimitMs = Number(process.env.LOAD_P95_LIMIT_MS ?? 2500);

const loginResponse = await fetch(`${apiUrl}/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.E2E_EMAIL ?? "alice@nova-aurora.local",
    password: process.env.E2E_PASSWORD ?? "Aurora@2026",
    deviceName: "Release Load Smoke"
  })
});
if (!loginResponse.ok) throw new Error(`Login de carga falhou com HTTP ${loginResponse.status}.`);
const login = await loginResponse.json();
if (!login.token) throw new Error("Login de carga não retornou sessão.");

const targets = [
  { name: "api-health", url: `${apiUrl}/health`, headers: {} },
  { name: "web-login", url: `${webUrl}/login`, headers: {} },
  { name: "economy-snapshot", url: `${apiUrl}/v1/economy/snapshot`, headers: { authorization: `Bearer ${login.token}` } }
];

async function runTarget(target) {
  const durations = [];
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= requestsPerTarget) return;
      const started = performance.now();
      try {
        const response = await fetch(target.url, {
          headers: target.headers,
          signal: AbortSignal.timeout(10_000),
          cache: "no-store"
        });
        const duration = performance.now() - started;
        durations.push(duration);
        if (!response.ok) failures.push({ index, status: response.status });
        await response.arrayBuffer();
      } catch (error) {
        durations.push(performance.now() - started);
        failures.push({ index, error: error instanceof Error ? error.message : "erro desconhecido" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requestsPerTarget) }, worker));
  durations.sort((left, right) => left - right);
  const percentile = (value) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] ?? 0;
  return {
    name: target.name,
    requests: requestsPerTarget,
    failures,
    errorRate: failures.length / requestsPerTarget,
    minMs: Math.round(durations[0] ?? 0),
    medianMs: Math.round(percentile(.5)),
    p95Ms: Math.round(percentile(.95)),
    maxMs: Math.round(durations.at(-1) ?? 0)
  };
}

const results = [];
for (const target of targets) results.push(await runTarget(target));
const passed = results.every((result) => result.errorRate <= .01 && result.p95Ms <= p95LimitMs);
const report = {
  passed,
  concurrency,
  requestsPerTarget,
  p95LimitMs,
  results,
  generatedAt: new Date().toISOString(),
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!passed) {
  throw new Error("Teste de carga do release excedeu taxa de erro ou limite de p95.");
}

import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "@nova-aurora/database";
import { Redis } from "ioredis";

const startedAt = Date.now();
const requestStartedAt = new WeakMap<FastifyRequest, number>();
const requestMetrics = new Map<string, { count: number; durationSeconds: number }>();
let activeRequests = 0;
let dependencyState = { postgres: false, redis: false };

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false
});

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function metricKey(method: string, route: string, statusCode: number): string {
  return `${method}\u0000${route}\u0000${statusCode}`;
}

function fixedTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Tempo limite excedido.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probePostgres(): Promise<boolean> {
  try {
    const rows = await within(db()`SELECT 1 AS ready`, 1_500);
    return Number(rows[0]?.ready ?? 0) === 1;
  } catch {
    return false;
  }
}

async function probeRedis(): Promise<boolean> {
  try {
    if (redis.status === "wait") await within(redis.connect(), 1_500);
    return await within(redis.ping(), 1_500) === "PONG";
  } catch {
    return false;
  }
}

export async function readiness(): Promise<Readonly<{
  ready: boolean;
  dependencies: Readonly<{ postgres: boolean; redis: boolean }>;
}>> {
  const [postgres, redisReady] = await Promise.all([probePostgres(), probeRedis()]);
  dependencyState = { postgres, redis: redisReady };
  return {
    ready: postgres && redisReady,
    dependencies: dependencyState
  };
}

export function renderMetrics(): string {
  const memory = process.memoryUsage();
  const commit = escapeLabel(process.env.GIT_COMMIT_SHA ?? "unknown");
  const version = escapeLabel(process.env.APP_VERSION ?? "development");
  const lines = [
    "# HELP nova_aurora_api_info Build information for the Nova Aurora API.",
    "# TYPE nova_aurora_api_info gauge",
    `nova_aurora_api_info{version="${version}",commit="${commit}",signature="Tehkné Solutions"} 1`,
    "# HELP nova_aurora_api_uptime_seconds Process uptime in seconds.",
    "# TYPE nova_aurora_api_uptime_seconds gauge",
    `nova_aurora_api_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    "# HELP nova_aurora_api_active_requests Requests currently being processed.",
    "# TYPE nova_aurora_api_active_requests gauge",
    `nova_aurora_api_active_requests ${activeRequests}`,
    "# HELP nova_aurora_dependency_ready Dependency readiness state.",
    "# TYPE nova_aurora_dependency_ready gauge",
    `nova_aurora_dependency_ready{service="api",dependency="postgres"} ${dependencyState.postgres ? 1 : 0}`,
    `nova_aurora_dependency_ready{service="api",dependency="redis"} ${dependencyState.redis ? 1 : 0}`,
    "# HELP process_resident_memory_bytes Resident memory size in bytes.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# HELP nodejs_heap_used_bytes Node.js heap memory used in bytes.",
    "# TYPE nodejs_heap_used_bytes gauge",
    `nodejs_heap_used_bytes ${memory.heapUsed}`,
    "# HELP nova_aurora_http_requests_total HTTP requests completed.",
    "# TYPE nova_aurora_http_requests_total counter",
    "# HELP nova_aurora_http_request_duration_seconds HTTP request duration.",
    "# TYPE nova_aurora_http_request_duration_seconds summary"
  ];

  for (const [key, metric] of [...requestMetrics.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [method = "UNKNOWN", route = "unknown", status = "0"] = key.split("\u0000");
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
    lines.push(`nova_aurora_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`nova_aurora_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`);
    lines.push(`nova_aurora_http_request_duration_seconds_count{${labels}} ${metric.count}`);
  }

  return `${lines.join("\n")}\n`;
}

function authorizeMetrics(app: FastifyInstance, request: FastifyRequest): void {
  const expected = process.env.INTERNAL_API_TOKEN;
  const authorization = request.headers.authorization;
  const actual = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!expected || !fixedTimeEqual(actual, expected)) {
    throw app.httpErrors.unauthorized("Credencial interna inválida.");
  }
}

export async function registerObservability(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    activeRequests += 1;
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = requestStartedAt.get(request);
    activeRequests = Math.max(0, activeRequests - 1);
    if (start === undefined) return;
    const route = request.routeOptions.url || "unmatched";
    const key = metricKey(request.method, route, reply.statusCode);
    const current = requestMetrics.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += (performance.now() - start) / 1000;
    requestMetrics.set(key, current);
  });

  app.get("/health/live", async () => ({
    status: "alive",
    service: "nova-aurora-api",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    signature: "Tehkné Solutions"
  }));

  app.get("/health/ready", async (_request, reply) => {
    const state = await readiness();
    return reply.status(state.ready ? 200 : 503).send({
      status: state.ready ? "ready" : "not-ready",
      service: "nova-aurora-api",
      dependencies: state.dependencies,
      checkedAt: new Date().toISOString(),
      signature: "Tehkné Solutions"
    });
  });

  app.get("/metrics", async (request, reply) => {
    authorizeMetrics(app, request);
    await readiness();
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics());
  });
}

export async function closeObservability(): Promise<void> {
  if (redis.status === "ready") await redis.quit();
  else redis.disconnect();
}

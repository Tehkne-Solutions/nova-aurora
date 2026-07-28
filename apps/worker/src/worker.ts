import { timingSafeEqual } from "node:crypto";
import { createServer,type IncomingMessage,type ServerResponse } from "node:http";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  BetaExperimentAggregationService,
  BetaSupportRolloutService,
  BetaTelemetryService,
  closeDb,
  db,
  MarketProductionService,
  PrivacyComplianceService,
  TransactionalEmailService
} from "@nova-aurora/database";

function connectionOptions(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string,never>;
  maxRetriesPerRequest: null;
} {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {})
  };
}

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string,unknown> = {}
): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),level,
    service: "nova-aurora-worker",event,
    version: process.env.APP_VERSION ?? "development",
    commit: process.env.GIT_COMMIT_SHA ?? "unknown",
    ...fields,
    signature: "Tehkné Solutions"
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

function fixedTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer,expectedBuffer);
}

async function within<T>(promise: Promise<T>,timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve,reject) => {
        timer = setTimeout(() => reject(new Error("Tempo limite excedido.")),timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const economy = new MarketProductionService();
const privacy = new PrivacyComplianceService();
const transactionalEmail = new TransactionalEmailService();
const betaTelemetry = new BetaTelemetryService();
const betaSupportRollouts = new BetaSupportRolloutService();
const betaExperimentAggregation = new BetaExperimentAggregationService();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const publisher = new Redis(redisUrl,{ maxRetriesPerRequest: null });
const sweepSeconds = Number(process.env.ECONOMY_TICK_SECONDS ?? 30);
const startedAt = Date.now();
let lastTelemetryDate = "";
let lastExperimentDate = "";

const metrics = {
  ticks: 0,failedTicks: 0,completedProduction: 0,publishedEvents: 0,
  completedJobs: 0,failedJobs: 0,processedDeletions: 0,
  emailsSent: 0,emailsFailed: 0,emailsDead: 0,
  telemetryWavesComputed: 0,announcementsPublished: 0,
  supportGateReconciliations: 0,experimentVariantsComputed: 0,
  lastTickTimestamp: 0,postgresReady: false,redisReady: false
};

async function publishOutbox(): Promise<number> {
  return economy.dispatchOutbox(async (event) => {
    await publisher.publish("nova-aurora.events",JSON.stringify({
      ...event,occurredAt: new Date().toISOString(),signature: "Tehkné Solutions"
    }));
  });
}

async function sweepDueProduction(): Promise<number> {
  const ids = await economy.dueProductionIds(100);
  for (const id of ids) await economy.completeProduction(id);
  return ids.length;
}

const productionWorker = new Worker(
  "nova-aurora-production",
  async (job) => {
    if (job.name !== "complete-production") return;
    const started = Date.now();
    await economy.completeProduction(String(job.data.orderId));
    const publishedEvents = await publishOutbox();
    metrics.completedJobs += 1;
    metrics.publishedEvents += publishedEvents;
    log("info","production.job.completed",{
      jobId: job.id,orderId: String(job.data.orderId),
      durationMs: Date.now()-started,publishedEvents
    });
  },
  { connection: connectionOptions(),concurrency: 8 }
);

productionWorker.on("failed",(job,error) => {
  metrics.failedJobs += 1;
  log("error","production.job.failed",{
    jobId: job?.id ?? null,orderId: job?.data?.orderId ?? null,message: error.message
  });
});
productionWorker.on("error",(error) => {
  log("error","production.worker.error",{ message: error.message });
});

async function tick(): Promise<void> {
  const started = Date.now();
  const completedProduction = await sweepDueProduction();
  const publishedEvents = await publishOutbox();
  const processedDeletions = await privacy.processDueDeletions(25);
  const emailDelivery = await transactionalEmail.processDue(50);
  const announcementsPublished = await betaTelemetry.processScheduledAnnouncements();
  await betaSupportRollouts.syncGates();
  const completedDate = new Date(Date.now()-86_400_000).toISOString().slice(0,10);
  const telemetryWavesComputed = completedDate === lastTelemetryDate
    ? 0
    : await betaTelemetry.recomputeDailyMetrics(
        "worker",
        new Date(`${completedDate}T00:00:00.000Z`)
      );
  if (telemetryWavesComputed >= 0) lastTelemetryDate = completedDate;
  const experimentVariantsComputed = completedDate === lastExperimentDate
    ? 0
    : await betaExperimentAggregation.recomputeRunningExperiments(
        new Date(`${completedDate}T00:00:00.000Z`)
      );
  if (experimentVariantsComputed >= 0) lastExperimentDate = completedDate;

  metrics.ticks += 1;
  metrics.completedProduction += completedProduction;
  metrics.publishedEvents += publishedEvents;
  metrics.processedDeletions += processedDeletions;
  metrics.emailsSent += emailDelivery.sent;
  metrics.emailsFailed += emailDelivery.failed;
  metrics.emailsDead += emailDelivery.dead;
  metrics.announcementsPublished += announcementsPublished;
  metrics.telemetryWavesComputed += telemetryWavesComputed;
  metrics.supportGateReconciliations += 1;
  metrics.experimentVariantsComputed += experimentVariantsComputed;
  metrics.lastTickTimestamp = Date.now();
  log("info","world.tick.completed",{
    completedProduction,publishedEvents,processedDeletions,emailDelivery,
    announcementsPublished,telemetryWavesComputed,experimentVariantsComputed,
    supportGatesReconciled: true,durationMs: Date.now()-started
  });
}

async function readiness(): Promise<Readonly<{
  ready: boolean; postgres: boolean; redis: boolean;
}>> {
  const [postgres,redisReady] = await Promise.all([
    within(db()`SELECT 1 AS ready`,1_500)
      .then((rows) => Number(rows[0]?.ready ?? 0) === 1)
      .catch(() => false),
    within(publisher.ping(),1_500).then((value) => value === "PONG").catch(() => false)
  ]);
  metrics.postgresReady = postgres;
  metrics.redisReady = redisReady;
  return { ready: postgres && redisReady,postgres,redis: redisReady };
}

function renderMetrics(): string {
  const memory = process.memoryUsage();
  return [
    "# HELP nova_aurora_worker_uptime_seconds Worker process uptime.",
    "# TYPE nova_aurora_worker_uptime_seconds gauge",
    `nova_aurora_worker_uptime_seconds ${(Date.now()-startedAt)/1000}`,
    "# HELP nova_aurora_worker_ticks_total Economy ticks completed.",
    "# TYPE nova_aurora_worker_ticks_total counter",
    `nova_aurora_worker_ticks_total ${metrics.ticks}`,
    "# HELP nova_aurora_worker_tick_failures_total Economy tick failures.",
    "# TYPE nova_aurora_worker_tick_failures_total counter",
    `nova_aurora_worker_tick_failures_total ${metrics.failedTicks}`,
    "# HELP nova_aurora_worker_completed_production_total Completed production.",
    "# TYPE nova_aurora_worker_completed_production_total counter",
    `nova_aurora_worker_completed_production_total ${metrics.completedProduction}`,
    "# HELP nova_aurora_worker_published_events_total Outbox events published.",
    "# TYPE nova_aurora_worker_published_events_total counter",
    `nova_aurora_worker_published_events_total ${metrics.publishedEvents}`,
    "# HELP nova_aurora_worker_jobs_total Queue jobs by result.",
    "# TYPE nova_aurora_worker_jobs_total counter",
    `nova_aurora_worker_jobs_total{result="success"} ${metrics.completedJobs}`,
    `nova_aurora_worker_jobs_total{result="failure"} ${metrics.failedJobs}`,
    "# HELP nova_aurora_worker_privacy_deletions_total Privacy deletions processed.",
    "# TYPE nova_aurora_worker_privacy_deletions_total counter",
    `nova_aurora_worker_privacy_deletions_total ${metrics.processedDeletions}`,
    "# HELP nova_aurora_worker_transactional_email_total Email delivery results.",
    "# TYPE nova_aurora_worker_transactional_email_total counter",
    `nova_aurora_worker_transactional_email_total{result="sent"} ${metrics.emailsSent}`,
    `nova_aurora_worker_transactional_email_total{result="failed"} ${metrics.emailsFailed}`,
    `nova_aurora_worker_transactional_email_total{result="dead"} ${metrics.emailsDead}`,
    "# HELP nova_aurora_beta_telemetry_waves_total Beta wave metrics computed.",
    "# TYPE nova_aurora_beta_telemetry_waves_total counter",
    `nova_aurora_beta_telemetry_waves_total ${metrics.telemetryWavesComputed}`,
    "# HELP nova_aurora_community_announcements_published_total Scheduled announcements published.",
    "# TYPE nova_aurora_community_announcements_published_total counter",
    `nova_aurora_community_announcements_published_total ${metrics.announcementsPublished}`,
    "# HELP nova_aurora_support_gate_reconciliations_total Support and rollout gate reconciliations.",
    "# TYPE nova_aurora_support_gate_reconciliations_total counter",
    `nova_aurora_support_gate_reconciliations_total ${metrics.supportGateReconciliations}`,
    "# HELP nova_aurora_experiment_variants_computed_total Experiment variant results computed.",
    "# TYPE nova_aurora_experiment_variants_computed_total counter",
    `nova_aurora_experiment_variants_computed_total ${metrics.experimentVariantsComputed}`,
    "# HELP nova_aurora_worker_last_tick_timestamp_seconds Last successful tick.",
    "# TYPE nova_aurora_worker_last_tick_timestamp_seconds gauge",
    `nova_aurora_worker_last_tick_timestamp_seconds ${metrics.lastTickTimestamp/1000}`,
    "# HELP nova_aurora_dependency_ready Dependency readiness state.",
    "# TYPE nova_aurora_dependency_ready gauge",
    `nova_aurora_dependency_ready{service="worker",dependency="postgres"} ${metrics.postgresReady ? 1 : 0}`,
    `nova_aurora_dependency_ready{service="worker",dependency="redis"} ${metrics.redisReady ? 1 : 0}`,
    "# HELP process_resident_memory_bytes Resident memory size in bytes.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# HELP nodejs_heap_used_bytes Node.js heap memory used in bytes.",
    "# TYPE nodejs_heap_used_bytes gauge",
    `nodejs_heap_used_bytes ${memory.heapUsed}`,
    ""
  ].join("\n");
}

function json(response: ServerResponse,statusCode: number,payload: unknown): void {
  response.writeHead(statusCode,{
    "content-type": "application/json; charset=utf-8","cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function authorized(request: IncomingMessage): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  const header = request.headers.authorization;
  const actual = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(expected && fixedTimeEqual(actual,expected));
}

const healthServer = createServer((request,response) => {
  void (async () => {
    const path = new URL(request.url ?? "/","http://worker.local").pathname;
    if (path === "/health/live") {
      json(response,200,{
        status: "alive",service: "nova-aurora-worker",
        uptimeSeconds: Math.floor((Date.now()-startedAt)/1000),
        signature: "Tehkné Solutions"
      });
      return;
    }
    if (path === "/health/ready") {
      const state = await readiness();
      json(response,state.ready ? 200 : 503,{
        status: state.ready ? "ready" : "not-ready",
        dependencies: { postgres: state.postgres,redis: state.redis },
        checkedAt: new Date().toISOString(),signature: "Tehkné Solutions"
      });
      return;
    }
    if (path === "/metrics") {
      if (!authorized(request)) {
        json(response,401,{ message: "Credencial interna inválida." });
        return;
      }
      await readiness();
      response.writeHead(200,{
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(renderMetrics());
      return;
    }
    json(response,404,{ message: "Rota não encontrada." });
  })().catch((error: unknown) => {
    log("error","worker.health.failed",{
      message: error instanceof Error ? error.message : "Erro desconhecido"
    });
    json(response,500,{ message: "Falha inesperada." });
  });
});

healthServer.listen(Number(process.env.WORKER_HEALTH_PORT ?? 4010),"0.0.0.0",() => {
  log("info","worker.health.started",{
    port: Number(process.env.WORKER_HEALTH_PORT ?? 4010)
  });
});

await tick();
const tickTimer = setInterval(() => {
  void tick().catch((error: unknown) => {
    metrics.failedTicks += 1;
    log("error","world.tick.failed",{
      message: error instanceof Error ? error.message : "Erro desconhecido"
    });
  });
},sweepSeconds*1000);
tickTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(tickTimer);
  log("info","service.shutdown.started",{ signal });
  const forcedExit = setTimeout(() => {
    log("error","service.shutdown.timeout",{ signal });
    process.exit(1);
  },12_000);
  forcedExit.unref();
  try {
    await productionWorker.close();
    await new Promise<void>((resolve,reject) => {
      healthServer.close((error) => error ? reject(error) : resolve());
    });
    await publisher.quit();
    await closeDb();
    clearTimeout(forcedExit);
    log("info","service.shutdown.completed",{ signal });
    process.exit(0);
  } catch (error) {
    log("error","service.shutdown.failed",{
      signal,message: error instanceof Error ? error.message : "Erro desconhecido"
    });
    process.exit(1);
  }
}

for (const signal of ["SIGTERM","SIGINT"] as const) {
  process.once(signal,() => void shutdown(signal));
}

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { MarketProductionService } from "@nova-aurora/database";

function connectionOptions(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
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

const economy = new MarketProductionService();
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
const sweepSeconds = Number(process.env.ECONOMY_TICK_SECONDS ?? 30);

async function publishOutbox(): Promise<number> {
  return economy.dispatchOutbox(async (event) => {
    await publisher.publish("nova-aurora.events", JSON.stringify({
      ...event,
      occurredAt: new Date().toISOString(),
      signature: "Tehkné Solutions"
    }));
  });
}

async function sweepDueProduction(): Promise<number> {
  const ids = await economy.dueProductionIds(100);
  for (const id of ids) await economy.completeProduction(id);
  return ids.length;
}

new Worker(
  "nova-aurora-production",
  async (job) => {
    if (job.name !== "complete-production") return;
    await economy.completeProduction(String(job.data.orderId));
    await publishOutbox();
  },
  { connection: connectionOptions(), concurrency: 8 }
);

async function tick(): Promise<void> {
  const completedProduction = await sweepDueProduction();
  const publishedEvents = await publishOutbox();
  console.log(JSON.stringify({
    event: "world.tick.completed",
    completedProduction,
    publishedEvents,
    signature: "Tehkné Solutions"
  }));
}

await tick();
setInterval(() => {
  void tick().catch((error: unknown) => {
    console.error(JSON.stringify({
      event: "world.tick.failed",
      message: error instanceof Error ? error.message : "Erro desconhecido",
      signature: "Tehkné Solutions"
    }));
  });
}, sweepSeconds * 1000);

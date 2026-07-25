import { Queue } from "bullmq";

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

let productionQueue: Queue | undefined;

function queue(): Queue {
  return productionQueue ??= new Queue("nova-aurora-production", {
    connection: connectionOptions(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000
    }
  });
}

export async function enqueueProductionCompletion(input: {
  orderId: string;
  completesAt: string;
}): Promise<void> {
  const delay = Math.max(0, new Date(input.completesAt).getTime() - Date.now());
  await queue().add(
    "complete-production",
    { orderId: input.orderId },
    { jobId: `production-${input.orderId}`, delay }
  );
}

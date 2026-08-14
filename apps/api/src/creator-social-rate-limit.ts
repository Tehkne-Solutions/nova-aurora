import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { db } from "@nova-aurora/database";

const economySql = db();

export type SocialRateAction =
  | "comment_create"
  | "comment_report"
  | "user_block_mutation"
  | "channel_follow_mutation"
  | "content_like_mutation"
  | "content_view"
  | "moderation_report"
  | "moderation_appeal";

type Limit = Readonly<{ windowSeconds: number; maxAttempts: number }>;

const policies: Readonly<Record<SocialRateAction, readonly Limit[]>> = {
  comment_create: [
    { windowSeconds: 60, maxAttempts: 6 },
    { windowSeconds: 3600, maxAttempts: 60 }
  ],
  comment_report: [{ windowSeconds: 3600, maxAttempts: 12 }],
  user_block_mutation: [{ windowSeconds: 3600, maxAttempts: 30 }],
  channel_follow_mutation: [
    { windowSeconds: 60, maxAttempts: 30 },
    { windowSeconds: 3600, maxAttempts: 180 }
  ],
  content_like_mutation: [
    { windowSeconds: 60, maxAttempts: 60 },
    { windowSeconds: 3600, maxAttempts: 300 }
  ],
  content_view: [
    { windowSeconds: 60, maxAttempts: 120 },
    { windowSeconds: 3600, maxAttempts: 1200 }
  ],
  moderation_report: [{ windowSeconds: 3600, maxAttempts: 20 }],
  moderation_appeal: [{ windowSeconds: 3600, maxAttempts: 8 }]
};

type Violation = Readonly<{
  action: SocialRateAction;
  windowSeconds: number;
  maxAttempts: number;
  observedCount: number;
  retryAfterSeconds: number;
}>;

export async function consumeSocialRateLimit(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  action: SocialRateAction
): Promise<void> {
  const limits = policies[action];
  const violation = await economySql.begin("isolation level serializable", async (tx) => {
    let firstViolation: Violation | null = null;

    for (const limit of limits) {
      const row = (await tx`
        INSERT INTO creator_social_rate_buckets(
          user_id,action,window_seconds,bucket_start,attempt_count
        ) VALUES(
          ${userId}::uuid,
          ${action},
          ${limit.windowSeconds},
          to_timestamp(floor(extract(epoch FROM now()) / ${limit.windowSeconds}) * ${limit.windowSeconds}),
          1
        )
        ON CONFLICT(user_id,action,window_seconds,bucket_start)
        DO UPDATE SET
          attempt_count=creator_social_rate_buckets.attempt_count+1,
          updated_at=now()
        RETURNING attempt_count,bucket_start
      `)[0]!;

      const observedCount = Number(row.attempt_count);
      if (observedCount <= limit.maxAttempts) continue;

      const bucketStartMs = new Date(String(row.bucket_start)).getTime();
      const retryAtMs = bucketStartMs + limit.windowSeconds * 1000;
      const retryAfterSeconds = Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000));
      await tx`
        INSERT INTO creator_social_rate_violations(
          id,user_id,action,window_seconds,limit_count,observed_count
        ) VALUES(
          ${randomUUID()}::uuid,${userId}::uuid,${action},${limit.windowSeconds},
          ${limit.maxAttempts},${observedCount}
        )
      `;
      if (!firstViolation) {
        firstViolation = {
          action,
          windowSeconds: limit.windowSeconds,
          maxAttempts: limit.maxAttempts,
          observedCount,
          retryAfterSeconds
        };
      }
    }

    return firstViolation;
  });

  if (!violation) return;
  reply.header("retry-after", String(violation.retryAfterSeconds));
  throw app.httpErrors.tooManyRequests(
    `Limite de interação excedido para ${violation.action}. Tente novamente em aproximadamente ${violation.retryAfterSeconds}s.`
  );
}

// Tehkné Solutions

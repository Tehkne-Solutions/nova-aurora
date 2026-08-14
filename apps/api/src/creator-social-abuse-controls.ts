import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";
import { consumeSocialRateLimit, type SocialRateAction } from "./creator-social-rate-limit.js";

const economySql = db();

const rateActionByRoute: Readonly<Record<string, SocialRateAction>> = {
  "POST /v1/creator/content/:contentId/comments": "comment_create",
  "POST /v1/creator/comments/:commentId/report": "comment_report",
  "POST /v1/creator/users/:userId/block": "user_block_mutation",
  "DELETE /v1/creator/users/:userId/block": "user_block_mutation",
  "POST /v1/creator/channels/:channelId/follow": "channel_follow_mutation",
  "DELETE /v1/creator/channels/:channelId/follow": "channel_follow_mutation",
  "POST /v1/creator/content/:contentId/like": "content_like_mutation",
  "DELETE /v1/creator/content/:contentId/like": "content_like_mutation",
  "POST /v1/creator/content/:contentId/view": "content_view",
  "POST /v1/creator-moderation/reports": "moderation_report",
  "POST /v1/creator-moderation/reports/:reportId/appeal": "moderation_appeal",
  "POST /v1/creator-moderation/comment-reports/:reportId/appeal": "moderation_appeal"
};

const summaryQuery = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export async function registerCreatorSocialAbuseControls(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const routeUrl = request.routeOptions.url;
    if (!routeUrl) return;
    const action = rateActionByRoute[`${request.method.toUpperCase()} ${routeUrl}`];
    if (!action) return;
    const actor = await requireActor(app, request);
    await consumeSocialRateLimit(app, reply, actor.userId, action);
  });

  app.get("/v1/admin/creator-social/abuse", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const query = summaryQuery.parse(request.query);
    const byAction = await economySql`
      SELECT action,count(*)::int violations,count(DISTINCT user_id)::int users,
        max(observed_count)::int max_observed_count,max(occurred_at) last_violation_at
      FROM creator_social_rate_violations
      WHERE occurred_at>=now()-(${query.hours}::text||' hours')::interval
      GROUP BY action
      ORDER BY violations DESC,action ASC
    `;
    const topUsers = await economySql`
      SELECT violation.user_id,user_account.display_name,count(*)::int violations,
        count(DISTINCT violation.action)::int affected_actions,max(violation.occurred_at) last_violation_at
      FROM creator_social_rate_violations violation
      JOIN users user_account ON user_account.id=violation.user_id
      WHERE violation.occurred_at>=now()-(${query.hours}::text||' hours')::interval
      GROUP BY violation.user_id,user_account.display_name
      ORDER BY violations DESC,last_violation_at DESC
      LIMIT ${query.limit}
    `;
    return {
      windowHours: query.hours,
      byAction: byAction.map((row) => ({
        action: String(row.action),
        violations: Number(row.violations),
        users: Number(row.users),
        maxObservedCount: Number(row.max_observed_count),
        lastViolationAt: row.last_violation_at ? new Date(String(row.last_violation_at)).toISOString() : null
      })),
      topUsers: topUsers.map((row) => ({
        userId: String(row.user_id),
        displayName: String(row.display_name),
        violations: Number(row.violations),
        affectedActions: Number(row.affected_actions),
        lastViolationAt: new Date(String(row.last_violation_at)).toISOString()
      })),
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions

import type { FastifyInstance, FastifyRequest } from "fastify";
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
  "POST /v1/creator-moderation/comment-reports/:reportId/appeal": "moderation_appeal",
  "POST /v1/creator/dm/requests": "dm_request",
  "POST /v1/creator/dm/threads/:threadId/accept": "dm_thread_mutation",
  "POST /v1/creator/dm/threads/:threadId/decline": "dm_thread_mutation",
  "POST /v1/creator/dm/threads/:threadId/close": "dm_thread_mutation",
  "POST /v1/creator/dm/threads/:threadId/messages": "dm_send",
  "DELETE /v1/creator/dm/messages/:messageId": "dm_message_mutation",
  "POST /v1/creator/dm/messages/:messageId/report": "dm_report"
};

const blockGuardedRoutes = new Set([
  "POST /v1/creator/channels/:channelId/follow",
  "POST /v1/creator/content/:contentId/like",
  "POST /v1/creator/content/:contentId/view"
]);

const summaryQuery = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
const socialStateQuery = z.object({
  contentIds: z.string().trim().min(1).max(3700)
});

function routeKey(request: FastifyRequest): string | null {
  const routeUrl = request.routeOptions.url;
  return routeUrl ? `${request.method.toUpperCase()} ${routeUrl}` : null;
}

function rateActionForRequest(request: FastifyRequest): SocialRateAction | undefined {
  const key = routeKey(request);
  if (!key) return undefined;
  const action = rateActionByRoute[key];
  if (action !== "moderation_report") return action;

  const body = request.body;
  if (
    body &&
    typeof body === "object" &&
    "resourceType" in body &&
    (body as { resourceType?: unknown }).resourceType === "creator_comment"
  ) {
    return "comment_report";
  }
  return action;
}

async function interactionOwner(request: FastifyRequest): Promise<string | null> {
  const key = routeKey(request);
  if (!key || !blockGuardedRoutes.has(key)) return null;
  const params = request.params as { channelId?: string; contentId?: string };

  if (params.channelId) {
    const parsed = z.string().uuid().safeParse(params.channelId);
    if (!parsed.success) return null;
    const row = (await economySql`
      SELECT creator_user_id owner_id FROM creator_channels WHERE id=${parsed.data}::uuid
    `)[0];
    return row?.owner_id ? String(row.owner_id) : null;
  }

  if (params.contentId) {
    const parsed = z.string().uuid().safeParse(params.contentId);
    if (!parsed.success) return null;
    const row = (await economySql`
      SELECT creator_user_id owner_id FROM creator_content WHERE id=${parsed.data}::uuid
    `)[0];
    return row?.owner_id ? String(row.owner_id) : null;
  }

  return null;
}

async function enforceBlockGuard(app: FastifyInstance, request: FastifyRequest, actorUserId: string): Promise<void> {
  const ownerUserId = await interactionOwner(request);
  if (!ownerUserId || ownerUserId === actorUserId) return;
  const blocked = (await economySql`
    SELECT 1 FROM creator_user_blocks
    WHERE (blocker_user_id=${actorUserId}::uuid AND blocked_user_id=${ownerUserId}::uuid)
       OR (blocker_user_id=${ownerUserId}::uuid AND blocked_user_id=${actorUserId}::uuid)
    LIMIT 1
  `)[0];
  if (blocked) throw app.httpErrors.forbidden("Interação indisponível entre estas contas.");
}

function parseContentIds(value: string): string[] {
  const candidates = [...new Set(value.split(",").map((candidate) => candidate.trim()).filter(Boolean))];
  if (candidates.length === 0 || candidates.length > 100) {
    throw new Error("contentIds deve conter entre 1 e 100 IDs.");
  }
  return candidates.map((candidate) => z.string().uuid().parse(candidate));
}

export async function registerCreatorSocialAbuseControls(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const action = rateActionForRequest(request);
    if (!action) return;
    const actor = await requireActor(app, request);
    await consumeSocialRateLimit(app, reply, actor.userId, action);
    await enforceBlockGuard(app, request, actor.userId);
  });

  app.get("/v1/creator/social-state", async (request) => {
    const actor = await requireActor(app, request);
    const query = socialStateQuery.parse(request.query);
    let contentIds: string[];
    try {
      contentIds = parseContentIds(query.contentIds);
    } catch (error) {
      throw app.httpErrors.badRequest(error instanceof Error ? error.message : "contentIds inválido.");
    }
    const rows = await economySql`
      SELECT content.id content_id,content.channel_id,content.creator_user_id,
        EXISTS(
          SELECT 1 FROM creator_content_reactions reaction
          WHERE reaction.content_id=content.id
            AND reaction.user_id=${actor.userId}::uuid
            AND reaction.reaction='like'
        ) liked_by_requester,
        EXISTS(
          SELECT 1 FROM creator_channel_follows follow
          WHERE follow.channel_id=content.channel_id
            AND follow.follower_user_id=${actor.userId}::uuid
        ) following_by_requester,
        EXISTS(
          SELECT 1 FROM creator_user_blocks block
          WHERE (block.blocker_user_id=${actor.userId}::uuid AND block.blocked_user_id=content.creator_user_id)
             OR (block.blocker_user_id=content.creator_user_id AND block.blocked_user_id=${actor.userId}::uuid)
        ) blocked_between
      FROM creator_content content
      JOIN creator_channels channel ON channel.id=content.channel_id AND channel.status='active'
      WHERE content.status='published'
        AND content.id IN (
          SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(contentIds)}::jsonb)
        )
      ORDER BY content.id ASC
    `;
    return {
      states: rows.map((row) => ({
        contentId: String(row.content_id),
        channelId: String(row.channel_id),
        creatorUserId: String(row.creator_user_id),
        likedByRequester: Boolean(row.liked_by_requester),
        followingByRequester: Boolean(row.following_by_requester),
        blockedBetween: Boolean(row.blocked_between)
      })),
      signature: "Tehkné Solutions"
    };
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
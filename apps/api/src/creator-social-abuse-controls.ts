import type { FastifyInstance } from "fastify";
import { requireActor } from "./auth-context.js";
import { consumeSocialRateLimit, type SocialRateAction } from "./creator-social-rate-limit.js";

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

export async function registerCreatorSocialAbuseControls(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const routeUrl = request.routeOptions.url;
    if (!routeUrl) return;
    const action = rateActionByRoute[`${request.method.toUpperCase()} ${routeUrl}`];
    if (!action) return;
    const actor = await requireActor(app, request);
    await consumeSocialRateLimit(app, reply, actor.userId, action);
  });
}

// Tehkné Solutions

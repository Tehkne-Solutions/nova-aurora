import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";
import { publishRealtimeEvent } from "./realtime.js";

const economySql = db();
const ANIMATION_STATES = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;
const INTERACTION_COOLDOWN_SECONDS = 2;
const INTERACTION_COOLDOWN_MS = INTERACTION_COOLDOWN_SECONDS * 1000;

type AnimationState = typeof ANIMATION_STATES[number];

const interactionSchema = z.object({
  animationState: z.enum(ANIMATION_STATES)
});

function normalizeAnimationState(value: unknown): AnimationState {
  return ANIMATION_STATES.includes(value as AnimationState) ? value as AnimationState : "idle";
}

export async function registerUgcWorldInteractionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { placementId: string } }>("/v1/ugc/world/placements/:placementId/interactions", async (request, reply) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const body = interactionSchema.parse(request.body);
    const interactionId = randomUUID();

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const placement = (await tx`
        SELECT placement.id,placement.owner_user_id,placement.location_code,placement.animation_state,placement.interaction_scope,
          placement.status,asset.status asset_status,asset.content_type
        FROM ugc_world_placements placement
        JOIN ugc_binary_asset_upload_sessions asset ON asset.id=placement.asset_upload_id
        WHERE placement.id=${placementId}::uuid
        FOR UPDATE OF placement
      `)[0];

      if (!placement || String(placement.status) !== "active" || String(placement.asset_status) !== "clean" || String(placement.content_type) !== "model/gltf-binary") {
        throw app.httpErrors.notFound("Placement GLB ativo e interativo não encontrado.");
      }
      if (String(placement.interaction_scope) !== "authenticated") {
        throw app.httpErrors.forbidden("O criador não habilitou interação autenticada neste objeto.");
      }

      const recent = (await tx`
        SELECT id,
          GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((created_at + interval '2 seconds') - now())) * 1000))::int retry_after_ms
        FROM ugc_world_placement_interactions
        WHERE placement_id=${placementId}::uuid
          AND actor_user_id=${actor.userId}::uuid
          AND created_at > now() - interval '2 seconds'
        ORDER BY created_at DESC
        LIMIT 1
      `)[0];
      if (recent) {
        return {
          cooldownBlocked: true as const,
          retryAfterMs: Math.min(INTERACTION_COOLDOWN_MS, Math.max(1, Number(recent.retry_after_ms)))
        };
      }

      const previousState = normalizeAnimationState(placement.animation_state);
      const updated = (await tx`
        UPDATE ugc_world_placements
        SET animation_state=${body.animationState},updated_at=now()
        WHERE id=${placementId}::uuid
        RETURNING animation_state,updated_at
      `)[0]!;

      await tx`
        INSERT INTO ugc_world_placement_interactions (
          id,placement_id,actor_user_id,previous_animation_state,requested_animation_state,interaction_source
        ) VALUES (
          ${interactionId}::uuid,${placementId}::uuid,${actor.userId}::uuid,
          ${previousState},${body.animationState},'authenticated-visitor'
        )
      `;

      return {
        cooldownBlocked: false as const,
        locationCode: String(placement.location_code),
        previousState,
        animationState: normalizeAnimationState(updated.animation_state),
        updatedAt: new Date(String(updated.updated_at)).toISOString()
      };
    });

    if (result.cooldownBlocked) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      reply.header("retry-after", String(retryAfterSeconds));
      return reply.code(429).send({
        statusCode: 429,
        error: "Too Many Requests",
        message: "Aguarde o cooldown antes de interagir novamente com este objeto.",
        placementId,
        retryAfterMs: result.retryAfterMs,
        cooldownMs: INTERACTION_COOLDOWN_MS,
        signature: "Tehkné Solutions"
      });
    }

    void publishRealtimeEvent({
      eventType: "ugc.world.placement.updated",
      payload: {
        interactionId,
        placementId,
        locationCode: result.locationCode,
        previousAnimationState: result.previousState,
        animationState: result.animationState,
        updatedAt: result.updatedAt
      }
    }).then((published) => {
      if (!published) {
        app.log.warn({ interactionId, placementId }, "ugc.realtime.publish.unavailable");
      }
    });

    return {
      interactionId,
      placementId,
      actorUserId: actor.userId,
      previousAnimationState: result.previousState,
      animationState: result.animationState,
      cooldownMs: INTERACTION_COOLDOWN_MS,
      updatedAt: result.updatedAt,
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions

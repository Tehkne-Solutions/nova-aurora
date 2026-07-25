import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  GameplayExperienceService,
  type HarvestAction
} from "@nova-aurora/database";

const gameplay = new GameplayExperienceService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

async function actorId(app: FastifyInstance, request: FastifyRequest): Promise<string> {
  const email = request.headers["x-actor-email"];
  if (typeof email !== "string") {
    throw app.httpErrors.unauthorized(
      "Cabeçalho x-actor-email obrigatório no runtime de desenvolvimento."
    );
  }
  return gameplay.resolveUserId(email);
}

export async function registerGameplayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/gameplay/state", async (request) =>
    gameplay.experienceState(await actorId(app, request))
  );

  app.post("/v1/gameplay/harvest/start", async (request) =>
    gameplay.startHarvest({
      ownerId: await actorId(app, request),
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  const harvestCompletionSchema = z.object({
    sequence: z.array(z.enum(["left", "right", "up", "down"])).length(7)
  });

  app.post<{ Params: { sessionId: string } }>(
    "/v1/gameplay/harvest/:sessionId/complete",
    async (request) => {
      const body = harvestCompletionSchema.parse(request.body);
      return gameplay.completeHarvest({
        ownerId: await actorId(app, request),
        sessionId: request.params.sessionId,
        sequence: body.sequence as readonly HarvestAction[],
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );
}

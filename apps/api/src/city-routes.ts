import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CityGameplayService } from "@nova-aurora/database";
import { requireActorId } from "./auth-context.js";

const city = new CityGameplayService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

export async function registerCityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/city/state", async (request) =>
    city.state(await requireActorId(app, request))
  );

  const moveSchema = z.object({
    locationCode: z.string().min(1).max(64)
  });

  app.post("/v1/city/move", async (request) => {
    const body = moveSchema.parse(request.body);
    return city.movePlayer({
      ownerId: await requireActorId(app, request),
      locationCode: body.locationCode,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { jobCode: string } }>(
    "/v1/jobs/:jobCode/accept",
    async (request) => city.acceptJob({
      ownerId: await requireActorId(app, request),
      jobCode: request.params.jobCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { jobCode: string } }>(
    "/v1/jobs/:jobCode/complete",
    async (request) => city.completeJob({
      ownerId: await requireActorId(app, request),
      jobCode: request.params.jobCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}

// Tehkné Solutions

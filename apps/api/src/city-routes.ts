import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CityGameplayService } from "@nova-aurora/database";

const city = new CityGameplayService();

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
  return city.resolveUserId(email);
}

export async function registerCityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/city/state", async (request) =>
    city.state(await actorId(app, request))
  );

  const moveSchema = z.object({
    locationCode: z.string().min(1).max(64)
  });

  app.post("/v1/city/move", async (request) => {
    const body = moveSchema.parse(request.body);
    return city.movePlayer({
      ownerId: await actorId(app, request),
      locationCode: body.locationCode,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { jobCode: string } }>(
    "/v1/jobs/:jobCode/accept",
    async (request) => city.acceptJob({
      ownerId: await actorId(app, request),
      jobCode: request.params.jobCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { jobCode: string } }>(
    "/v1/jobs/:jobCode/complete",
    async (request) => city.completeJob({
      ownerId: await actorId(app, request),
      jobCode: request.params.jobCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}

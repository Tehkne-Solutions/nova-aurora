import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PropertyBusinessService } from "@nova-aurora/database";
import { requireActorId } from "./auth-context.js";

const business = new PropertyBusinessService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

const buildingSchema = z.object({
  buildingType: z.string().min(2).max(40),
  name: z.string().min(2).max(64)
});

const offeringSchema = z.object({
  units: z.number().int().positive().max(4000),
  unitPriceMinor: z.number().int().positive().max(100_000)
});

const investmentSchema = z.object({
  units: z.number().int().positive().max(4000)
});

export async function registerPropertyBusinessRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/business/state", async (request) =>
    business.state(await requireActorId(app, request))
  );

  app.post<{ Params: { plotCode: string } }>(
    "/v1/properties/:plotCode/acquire",
    async (request) => business.acquirePlot({
      ownerId: await requireActorId(app, request),
      plotCode: request.params.plotCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { plotCode: string } }>(
    "/v1/properties/:plotCode/buildings",
    async (request) => {
      const body = buildingSchema.parse(request.body);
      return business.constructBuilding({
        ownerId: await requireActorId(app, request),
        plotCode: request.params.plotCode,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { plotCode: string } }>(
    "/v1/properties/:plotCode/visit",
    async (request) => business.visitProperty({
      ownerId: await requireActorId(app, request),
      plotCode: request.params.plotCode,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/business/buildings/:buildingId/operate",
    async (request) => business.runOperatingCycle({
      ownerId: await requireActorId(app, request),
      buildingId: request.params.buildingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/business/buildings/:buildingId/upgrade",
    async (request) => business.upgradeBuilding({
      ownerId: await requireActorId(app, request),
      buildingId: request.params.buildingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/business/share-offerings", async (request) => {
    const body = offeringSchema.parse(request.body);
    return business.createShareOffering({
      ownerId: await requireActorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { offeringId: string } }>(
    "/v1/business/share-offerings/:offeringId/invest",
    async (request) => {
      const body = investmentSchema.parse(request.body);
      return business.invest({
        ownerId: await requireActorId(app, request),
        offeringId: request.params.offeringId,
        units: body.units,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { cycleId: string } }>(
    "/v1/business/cycles/:cycleId/distribute",
    async (request) => business.distributeResults({
      ownerId: await requireActorId(app, request),
      cycleId: request.params.cycleId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}

// Tehkné Solutions

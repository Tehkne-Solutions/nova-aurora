import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MunicipalOperationsService } from "@nova-aurora/database";

const municipal = new MunicipalOperationsService();

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
  return municipal.resolveUserId(email);
}

const candidacySchema = z.object({
  electionId: z.string().uuid(),
  slogan: z.string().min(4).max(120),
  platform: z.string().min(20).max(1200)
});

const electionVoteSchema = z.object({
  electionId: z.string().uuid(),
  candidateId: z.string().uuid()
});

const policySchema = z.object({
  districtCode: z.string().min(2).max(64).optional(),
  title: z.string().min(5).max(140),
  description: z.string().min(20).max(1200),
  policyArea: z.enum([
    "energy",
    "transport",
    "safety",
    "education",
    "environment",
    "housing",
    "fiscal"
  ]),
  budgetImpactMinor: z.number().int().min(0).max(10_000_000)
});

const councilVoteSchema = z.object({
  choice: z.enum(["support", "oppose"])
});

const emergencySchema = z.object({
  districtCode: z.string().min(2).max(64),
  eventType: z.enum([
    "energy-failure",
    "transport-collapse",
    "security-incident",
    "flood",
    "heat-wave"
  ]),
  severity: z.number().int().min(1).max(5)
});

export async function registerMunicipalOperationsRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/municipal/state", async (request) =>
    municipal.state(await actorId(app, request))
  );

  app.post("/v1/municipal/budget-cycles/settle", async (request) =>
    municipal.settleMunicipalCycle({
      ownerId: await actorId(app, request),
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/municipal/elections/candidates", async (request) => {
    const body = candidacySchema.parse(request.body);
    return municipal.registerCandidate({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { electionId: string } }>(
    "/v1/municipal/elections/:electionId/open",
    async (request) => municipal.openElection({
      ownerId: await actorId(app, request),
      electionId: request.params.electionId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/municipal/elections/vote", async (request) => {
    const body = electionVoteSchema.parse(request.body);
    return municipal.castElectionVote({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { electionId: string } }>(
    "/v1/municipal/elections/:electionId/certify",
    async (request) => municipal.certifyElection({
      ownerId: await actorId(app, request),
      electionId: request.params.electionId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/municipal/policies", async (request) => {
    const body = policySchema.parse(request.body);
    return municipal.createPolicy({
      ownerId: await actorId(app, request),
      title: body.title,
      description: body.description,
      policyArea: body.policyArea,
      budgetImpactMinor: body.budgetImpactMinor,
      ...(body.districtCode === undefined ? {} : { districtCode: body.districtCode }),
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { policyId: string } }>(
    "/v1/municipal/policies/:policyId/vote",
    async (request) => {
      const body = councilVoteSchema.parse(request.body);
      return municipal.votePolicy({
        ownerId: await actorId(app, request),
        policyId: request.params.policyId,
        choice: body.choice,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { policyId: string } }>(
    "/v1/municipal/policies/:policyId/enact",
    async (request) => municipal.enactPolicy({
      ownerId: await actorId(app, request),
      policyId: request.params.policyId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/municipal/emergencies", async (request) => {
    const body = emergencySchema.parse(request.body);
    return municipal.triggerEmergency({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { emergencyId: string } }>(
    "/v1/municipal/emergencies/:emergencyId/respond",
    async (request) => municipal.respondEmergency({
      ownerId: await actorId(app, request),
      emergencyId: request.params.emergencyId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}

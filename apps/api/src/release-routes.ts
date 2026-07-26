import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LaunchAssuranceService,
  ReleaseOperationsService,
  TransactionalEmailService
} from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";
import { registerLaunchAssuranceRoutes } from "./launch-assurance-routes.js";
import { registerTrustRoutes } from "./trust-routes.js";

const release = new ReleaseOperationsService();
const email = new TransactionalEmailService();
const assurance = new LaunchAssuranceService();

const inviteSchema = z.object({
  label: z.string().min(3).max(160),
  emailPattern: z.string().min(3).max(254).optional(),
  maxUses: z.number().int().min(1).max(10_000),
  expiresAt: z.string().datetime().optional()
});

const gateSchema = z.object({
  status: z.enum(["pending", "passing", "blocked", "waived"]),
  evidence: z.unknown().optional(),
  notes: z.string().max(2000).optional()
});

export async function registerReleaseRoutes(app: FastifyInstance): Promise<void> {
  await registerTrustRoutes(app);
  await registerLaunchAssuranceRoutes(app);

  app.get("/v1/release/state", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const [summary, gates, invites, emails, trustState, operations] = await Promise.all([
      release.summary(),
      release.gates(),
      release.invites(),
      email.recent(100),
      assurance.adminState(),
      assurance.operationsState()
    ]);
    return {
      summary,
      gates,
      invites,
      emails,
      trust: trustState,
      operations,
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/release/invites", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = inviteSchema.parse(request.body);
    return {
      ...(await release.createInvite({ actorId: identity.userId, ...body })),
      warning: "O código é exibido apenas nesta resposta. Compartilhe por canal seguro.",
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { gateKey: string } }>(
    "/v1/release/gates/:gateKey",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = gateSchema.parse(request.body);
      await release.updateGate({
        actorId: identity.userId,
        key: request.params.gateKey,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { emailId: string } }>(
    "/v1/release/emails/:emailId/retry",
    async (request, reply) => {
      await requireRole(app, request, ["platform-admin"]);
      await email.retry(request.params.emailId);
      return reply.status(204).send();
    }
  );
}

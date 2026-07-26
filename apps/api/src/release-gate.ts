import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  BetaOperationsService,
  LaunchAssuranceService,
  ReleaseCandidateService,
  type AuthenticatedIdentity
} from "@nova-aurora/database";

const release = new ReleaseCandidateService();
const assurance = new LaunchAssuranceService();
const beta = new BetaOperationsService();

function mustBeReleased(request: FastifyRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const path = request.url.split("?", 1)[0] ?? request.url;
  if (path.startsWith("/v1/compliance/")) return false;
  if (path.startsWith("/v1/release/")) return false;
  if (path.startsWith("/v1/trust/")) return false;
  if (path.startsWith("/v1/launch-operations/")) return false;
  if (path.startsWith("/v1/moderation/")) return false;
  if (path.startsWith("/v1/beta-control/")) return false;
  return true;
}

export async function enforceReleaseGate(
  app: FastifyInstance,
  request: FastifyRequest,
  identity: AuthenticatedIdentity
): Promise<void> {
  if (!mustBeReleased(request)) return;
  try {
    await release.assertMutableAccess(identity.userId);
    await assurance.assertPlayerReady(identity.userId);
    await beta.assertPlayerAccess(identity.userId);
  } catch (error) {
    throw app.httpErrors.forbidden(
      error instanceof Error ? error.message : "Conta ainda não liberada para operações."
    );
  }
}

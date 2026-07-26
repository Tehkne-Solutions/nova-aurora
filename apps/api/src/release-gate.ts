import type { FastifyInstance, FastifyRequest } from "fastify";
import { ReleaseCandidateService } from "@nova-aurora/database";
import type { AuthenticatedIdentity } from "@nova-aurora/database";

const release = new ReleaseCandidateService();

function mustBeReleased(request: FastifyRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const path = request.url.split("?", 1)[0] ?? request.url;
  if (path.startsWith("/v1/compliance/")) return false;
  if (path.startsWith("/v1/release/")) return false;
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
  } catch (error) {
    throw app.httpErrors.forbidden(
      error instanceof Error ? error.message : "Conta ainda não liberada para operações."
    );
  }
}

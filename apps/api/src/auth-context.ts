import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  LiveSecurityService,
  type AuthenticatedIdentity,
  type UserRole
} from "@nova-aurora/database";

export const authSecurity = new LiveSecurityService();

export function requestUserAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" ? value : undefined;
}

export function bearerToken(app: FastifyInstance, request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw app.httpErrors.unauthorized("Sessão Bearer obrigatória.");
  }
  const token = authorization.slice(7).trim();
  if (token.length < 32) {
    throw app.httpErrors.unauthorized("Sessão inválida.");
  }
  return token;
}

export async function requireIdentity(
  app: FastifyInstance,
  request: FastifyRequest
): Promise<AuthenticatedIdentity> {
  try {
    return await authSecurity.authenticateToken(bearerToken(app, request));
  } catch {
    throw app.httpErrors.unauthorized("Sessão inválida ou expirada.");
  }
}

export async function requireActor(
  app: FastifyInstance,
  request: FastifyRequest
): Promise<AuthenticatedIdentity> {
  const identity = await requireIdentity(app, request);
  const context = request.headers["x-actor-context"];
  if (typeof context !== "string" || context.trim().length === 0) {
    return identity;
  }
  try {
    return await authSecurity.assumeContext({
      identity,
      targetEmail: context,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
  } catch (error) {
    throw app.httpErrors.forbidden(
      error instanceof Error ? error.message : "Contexto não autorizado."
    );
  }
}

export async function requireActorId(
  app: FastifyInstance,
  request: FastifyRequest
): Promise<string> {
  return (await requireActor(app, request)).userId;
}

export async function requireRole(
  app: FastifyInstance,
  request: FastifyRequest,
  roles: readonly UserRole[]
): Promise<AuthenticatedIdentity> {
  const identity = await requireIdentity(app, request);
  if (!roles.some((role) => identity.roles.includes(role))) {
    await authSecurity.audit({
      actorUserId: identity.userId,
      subjectUserId: identity.userId,
      sessionId: identity.sessionId,
      action: "authorization.role-check",
      resourceType: "api-route",
      resourceId: request.routeOptions.url,
      outcome: "denied",
      riskLevel: "medium",
      ipAddress: request.ip,
      userAgent: requestUserAgent(request),
      metadata: { requiredRoles: roles, actualRoles: identity.roles }
    });
    throw app.httpErrors.forbidden("Permissão insuficiente.");
  }
  return identity;
}

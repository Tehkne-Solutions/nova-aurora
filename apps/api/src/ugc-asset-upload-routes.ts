import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";
import { deleteObject, getObject, objectStorageEnabled, putObject } from "./object-storage-s3.js";

const economySql = db();
const MAX_MANIFEST_BYTES = 1024 * 1024;
const UPLOAD_TTL_MS = 10 * 60 * 1000;

const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  sizeBytes: z.number().int().min(2).max(MAX_MANIFEST_BYTES),
  sha256: z.string().trim().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase())
});
const uploadQuerySchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

function secretValue(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (!file) return "";
  return readFileSync(file, "utf8").trim();
}

function uploadSigningKey(): string {
  const value = secretValue("OBJECT_STORAGE_UPLOAD_SIGNING_KEY");
  if (value.length < 32) throw new Error("OBJECT_STORAGE_UPLOAD_SIGNING_KEY precisa possuir pelo menos 32 caracteres.");
  return value;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uploadToken(session: {
  id: string;
  ownerUserId: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: Date;
}): string {
  const payload = [
    session.id,
    session.ownerUserId,
    session.objectKey,
    session.sizeBytes,
    session.sha256,
    session.expiresAt.toISOString()
  ].join("\n");
  return createHmac("sha256", uploadSigningKey()).update(payload).digest("hex");
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(supplied, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function publicVerifiedManifestUri(uploadId: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  if (!base.startsWith("https://")) {
    throw new Error("PUBLIC_API_URL HTTPS é obrigatório para URIs canônicas de manifests verificados.");
  }
  return `${base}/v1/ugc/assets/manifests/${uploadId}`;
}

function objectKey(userId: string, uploadId: string): string {
  return `ugc/manifests/${userId}/${uploadId}.json`;
}

function assertManifestJson(bytes: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("O arquivo enviado não é um JSON válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("O manifesto precisa possuir um objeto JSON na raiz.");
  }
}

export async function registerUgcAssetUploadRoutes(app: FastifyInstance): Promise<void> {
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });
  }

  app.post("/v1/ugc/assets/manifests/uploads", async (request) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    const actor = await requireActor(app, request);
    const body = createUploadSchema.parse(request.body);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const key = objectKey(actor.userId, id);
    await economySql`
      INSERT INTO ugc_asset_upload_sessions(
        id,owner_user_id,object_key,file_name,content_type,expected_size_bytes,
        declared_sha256,status,expires_at
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,${key},${body.fileName},'application/json',
        ${body.sizeBytes},${body.sha256},'pending',${expiresAt.toISOString()}::timestamptz
      )
    `;
    const token = uploadToken({
      id,
      ownerUserId: actor.userId,
      objectKey: key,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      expiresAt
    });
    return {
      upload: {
        id,
        method: "POST",
        path: `/v1/ugc/assets/manifests/uploads/${id}/content?token=${token}`,
        contentType: "application/octet-stream",
        expiresAt: expiresAt.toISOString(),
        maxBytes: MAX_MANIFEST_BYTES
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{
    Params: { uploadId: string };
    Querystring: { token: string };
  }>("/v1/ugc/assets/manifests/uploads/:uploadId/content", {
    bodyLimit: MAX_MANIFEST_BYTES + 1024
  }, async (request) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    const uploadId = z.string().uuid().parse(request.params.uploadId);
    const query = uploadQuerySchema.parse(request.query);
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const session = (await tx`
        SELECT * FROM ugc_asset_upload_sessions WHERE id=${uploadId}::uuid FOR UPDATE
      `)[0];
      if (!session) throw app.httpErrors.notFound("Sessão de upload não encontrada.");
      if (String(session.status) === "verified") {
        return {
          id: uploadId,
          sha256: String(session.verified_sha256),
          sizeBytes: Number(session.verified_size_bytes),
          alreadyVerified: true
        };
      }
      if (String(session.status) !== "pending") throw app.httpErrors.conflict("Sessão de upload não aceita mais conteúdo.");

      const expiresAt = new Date(String(session.expires_at));
      if (expiresAt.getTime() <= Date.now()) {
        await tx`
          UPDATE ugc_asset_upload_sessions SET status='expired',updated_at=now()
          WHERE id=${uploadId}::uuid
        `;
        throw app.httpErrors.gone("Sessão de upload expirada.");
      }

      const expectedToken = uploadToken({
        id: uploadId,
        ownerUserId: String(session.owner_user_id),
        objectKey: String(session.object_key),
        sizeBytes: Number(session.expected_size_bytes),
        sha256: String(session.declared_sha256),
        expiresAt
      });
      if (!tokenMatches(expectedToken, query.token)) throw app.httpErrors.forbidden("Assinatura do upload inválida.");

      if (bytes.length !== Number(session.expected_size_bytes)) {
        throw app.httpErrors.badRequest("O tamanho recebido não corresponde ao tamanho declarado.");
      }
      const receivedSha = sha256(bytes);
      if (receivedSha !== String(session.declared_sha256)) {
        throw app.httpErrors.badRequest("O SHA-256 dos bytes recebidos não corresponde ao declarado.");
      }
      try {
        assertManifestJson(bytes);
      } catch (error) {
        throw app.httpErrors.badRequest(error instanceof Error ? error.message : "Manifesto JSON inválido.");
      }

      const key = String(session.object_key);
      await putObject(key, bytes, "application/json");
      const persisted = await getObject(key);
      const persistedSha = sha256(persisted);
      if (persisted.length !== bytes.length || persistedSha !== receivedSha) {
        await deleteObject(key).catch(() => undefined);
        await tx`
          UPDATE ugc_asset_upload_sessions
          SET status='rejected',rejection_reason='storage-readback-mismatch',updated_at=now()
          WHERE id=${uploadId}::uuid
        `;
        throw app.httpErrors.serviceUnavailable("Object storage não confirmou os mesmos bytes após a gravação.");
      }

      await tx`
        UPDATE ugc_asset_upload_sessions
        SET status='verified',verified_size_bytes=${persisted.length},verified_sha256=${persistedSha},
          verified_at=now(),rejection_reason=NULL,updated_at=now()
        WHERE id=${uploadId}::uuid
      `;
      return {
        id: uploadId,
        sha256: persistedSha,
        sizeBytes: persisted.length,
        alreadyVerified: false
      };
    });

    return {
      manifest: {
        uploadId: result.id,
        assetManifestUri: publicVerifiedManifestUri(result.id),
        sha256: result.sha256,
        sizeBytes: result.sizeBytes,
        verifiedByPlatform: true,
        alreadyVerified: result.alreadyVerified
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get<{ Params: { uploadId: string } }>("/v1/ugc/assets/manifests/:uploadId", async (request, reply) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    const uploadId = z.string().uuid().parse(request.params.uploadId);
    const session = (await economySql`
      SELECT object_key,verified_sha256,verified_size_bytes,status
      FROM ugc_asset_upload_sessions
      WHERE id=${uploadId}::uuid
    `)[0];
    if (!session || String(session.status) !== "verified") throw app.httpErrors.notFound("Manifesto verificado não encontrado.");

    const bytes = await getObject(String(session.object_key));
    const storedSha = sha256(bytes);
    if (storedSha !== String(session.verified_sha256) || bytes.length !== Number(session.verified_size_bytes)) {
      throw app.httpErrors.serviceUnavailable("Falha de integridade ao ler o manifesto armazenado.");
    }
    reply
      .header("cache-control", "public,max-age=31536000,immutable")
      .header("etag", `\"sha256-${storedSha}\"")
      .header("x-content-type-options", "nosniff")
      .type("application/json; charset=utf-8");
    return reply.send(bytes);
  });
}

// Tehkné Solutions

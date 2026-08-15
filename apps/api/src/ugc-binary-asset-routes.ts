import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";
import { malwareScanEnabled, scanBufferForMalware } from "./malware-scan-clamav.js";
import { deleteObject, getObject, objectStorageEnabled, putObject } from "./object-storage-s3.js";

const economySql = db();
const MAX_BINARY_ASSET_BYTES = 25 * 1024 * 1024;

const CONTENT_TYPES = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "model/gltf-binary": [".glb"]
} as const;

type AllowedContentType = keyof typeof CONTENT_TYPES;

const contentTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "model/gltf-binary"]);
const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: contentTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_BINARY_ASSET_BYTES),
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

function binaryUploadToken(session: {
  id: string;
  ownerUserId: string;
  quarantineObjectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: Date;
}): string {
  const payload = [
    "ugc-binary-asset-v1",
    session.id,
    session.ownerUserId,
    session.quarantineObjectKey,
    session.contentType,
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

function safeExtension(fileName: string, contentType: AllowedContentType): string {
  const extension = extname(fileName).toLowerCase();
  if (!(CONTENT_TYPES[contentType] as readonly string[]).includes(extension)) {
    throw new Error(`Extensão ${extension || "ausente"} não corresponde a ${contentType}.`);
  }
  return extension;
}

function assertMagic(bytes: Buffer, contentType: AllowedContentType): void {
  const matches = contentType === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : contentType === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : contentType === "image/webp"
        ? bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
        : bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "glTF" && bytes.readUInt32LE(4) === 2;
  if (!matches) throw new Error(`Assinatura de arquivo inválida para ${contentType}.`);
}

function quarantineKey(userId: string, uploadId: string, extension: string): string {
  return `quarantine/ugc/assets/${userId}/${uploadId}${extension}`;
}

function cleanKey(userId: string, uploadId: string, extension: string): string {
  return `ugc/assets/${userId}/${uploadId}${extension}`;
}

export function publicCleanAssetUri(uploadId: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("PUBLIC_API_URL HTTPS é obrigatório para assets UGC limpos.");
  return `${base}/v1/ugc/assets/files/${uploadId}`;
}

export async function registerUgcBinaryAssetRoutes(app: FastifyInstance): Promise<void> {
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }

  app.post("/v1/ugc/assets/files/uploads", async (request) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    if (!malwareScanEnabled()) throw app.httpErrors.serviceUnavailable("Scanner antimalware de UGC ainda não está habilitado.");
    const actor = await requireActor(app, request);
    const body = createUploadSchema.parse(request.body);
    let extension: string;
    try {
      extension = safeExtension(body.fileName, body.contentType);
    } catch (error) {
      throw app.httpErrors.badRequest(error instanceof Error ? error.message : "Extensão de arquivo inválida.");
    }
    const id = randomUUID();
    const quarantineObjectKey = quarantineKey(actor.userId, id, extension);
    const cleanObjectKey = cleanKey(actor.userId, id, extension);
    const inserted = (await economySql`
      INSERT INTO ugc_binary_asset_upload_sessions(
        id,owner_user_id,quarantine_object_key,clean_object_key,file_name,content_type,
        expected_size_bytes,declared_sha256,status,expires_at
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,${quarantineObjectKey},${cleanObjectKey},${body.fileName},${body.contentType},
        ${body.sizeBytes},${body.sha256},'pending',now() + interval '10 minutes'
      )
      RETURNING expires_at
    `)[0];
    if (!inserted?.expires_at) throw new Error("Sessão binária criada sem expiração persistida.");
    const expiresAt = new Date(String(inserted.expires_at));
    const token = binaryUploadToken({
      id,
      ownerUserId: actor.userId,
      quarantineObjectKey,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      expiresAt
    });
    return {
      upload: {
        id,
        method: "POST",
        path: `/v1/ugc/assets/files/uploads/${id}/content?token=${token}`,
        contentType: "application/octet-stream",
        declaredContentType: body.contentType,
        expiresAt: expiresAt.toISOString(),
        maxBytes: MAX_BINARY_ASSET_BYTES,
        quarantine: true
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { uploadId: string }; Querystring: { token: string } }>(
    "/v1/ugc/assets/files/uploads/:uploadId/content",
    { bodyLimit: MAX_BINARY_ASSET_BYTES + 1024 },
    async (request) => {
      if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
      if (!malwareScanEnabled()) throw app.httpErrors.serviceUnavailable("Scanner antimalware de UGC ainda não está habilitado.");
      const uploadId = z.string().uuid().parse(request.params.uploadId);
      const query = uploadQuerySchema.parse(request.query);
      const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

      const claim = await economySql.begin("isolation level serializable", async (tx) => {
        const session = (await tx`
          SELECT *,expires_at <= now() is_expired
          FROM ugc_binary_asset_upload_sessions
          WHERE id=${uploadId}::uuid
          FOR UPDATE
        `)[0];
        if (!session) throw app.httpErrors.notFound("Sessão binária não encontrada.");
        if (String(session.status) === "clean") {
          return { kind: "clean" as const, session };
        }
        if (String(session.status) !== "pending") {
          throw app.httpErrors.conflict(`Sessão binária está em estado ${String(session.status)} e não aceita conteúdo.`);
        }
        if (Boolean(session.is_expired)) {
          await tx`UPDATE ugc_binary_asset_upload_sessions SET status='expired',updated_at=now() WHERE id=${uploadId}::uuid`;
          return { kind: "expired" as const, session };
        }

        const expiresAt = new Date(String(session.expires_at));
        const expectedToken = binaryUploadToken({
          id: uploadId,
          ownerUserId: String(session.owner_user_id),
          quarantineObjectKey: String(session.quarantine_object_key),
          contentType: String(session.content_type),
          sizeBytes: Number(session.expected_size_bytes),
          sha256: String(session.declared_sha256),
          expiresAt
        });
        if (!tokenMatches(expectedToken, query.token)) throw app.httpErrors.forbidden("Assinatura do upload binário inválida.");
        if (bytes.length !== Number(session.expected_size_bytes)) {
          throw app.httpErrors.badRequest("O tamanho recebido não corresponde ao tamanho binário declarado.");
        }
        const receivedSha = sha256(bytes);
        if (receivedSha !== String(session.declared_sha256)) {
          throw app.httpErrors.badRequest("O SHA-256 dos bytes binários não corresponde ao declarado.");
        }
        try {
          assertMagic(bytes, String(session.content_type) as AllowedContentType);
        } catch (error) {
          await tx`
            UPDATE ugc_binary_asset_upload_sessions
            SET status='rejected',rejection_reason='file-signature-mismatch',updated_at=now()
            WHERE id=${uploadId}::uuid
          `;
          return { kind: "rejected" as const, session, message: error instanceof Error ? error.message : "Assinatura de arquivo inválida." };
        }
        await tx`
          UPDATE ugc_binary_asset_upload_sessions
          SET status='scanning',updated_at=now()
          WHERE id=${uploadId}::uuid
        `;
        return { kind: "claimed" as const, session, receivedSha };
      });

      if (claim.kind === "expired") throw app.httpErrors.gone("Sessão binária expirada.");
      if (claim.kind === "rejected") throw app.httpErrors.badRequest(claim.message);
      if (claim.kind === "clean") {
        return {
          asset: {
            uploadId,
            assetUri: publicCleanAssetUri(uploadId),
            sha256: String(claim.session.verified_sha256),
            sizeBytes: Number(claim.session.verified_size_bytes),
            contentType: String(claim.session.content_type),
            malwareScan: "clean",
            alreadyClean: true
          },
          signature: "Tehkné Solutions"
        };
      }

      const quarantineObjectKey = String(claim.session.quarantine_object_key);
      const cleanObjectKey = String(claim.session.clean_object_key);
      const contentType = String(claim.session.content_type);
      try {
        await putObject(quarantineObjectKey, bytes, contentType);
        const quarantined = await getObject(quarantineObjectKey);
        if (quarantined.length !== bytes.length || sha256(quarantined) !== claim.receivedSha) {
          await deleteObject(quarantineObjectKey).catch(() => undefined);
          await economySql`
            UPDATE ugc_binary_asset_upload_sessions
            SET status='rejected',rejection_reason='quarantine-readback-mismatch',updated_at=now()
            WHERE id=${uploadId}::uuid AND status='scanning'
          `;
          throw app.httpErrors.serviceUnavailable("Quarentena não confirmou os mesmos bytes após a gravação.");
        }

        const scan = await scanBufferForMalware(quarantined);
        if (!scan.clean) {
          await deleteObject(quarantineObjectKey).catch(() => undefined);
          await economySql`
            UPDATE ugc_binary_asset_upload_sessions
            SET status='infected',scanner_engine=${scan.engine},scanner_signature=${scan.signature},
              scanned_at=now(),rejection_reason='malware-detected',updated_at=now()
            WHERE id=${uploadId}::uuid AND status='scanning'
          `;
          throw app.httpErrors.unprocessableEntity("Asset bloqueado pela varredura antimalware.");
        }

        await putObject(cleanObjectKey, quarantined, contentType);
        const promoted = await getObject(cleanObjectKey);
        const promotedSha = sha256(promoted);
        if (promoted.length !== quarantined.length || promotedSha !== claim.receivedSha) {
          await deleteObject(cleanObjectKey).catch(() => undefined);
          await deleteObject(quarantineObjectKey).catch(() => undefined);
          await economySql`
            UPDATE ugc_binary_asset_upload_sessions
            SET status='rejected',scanner_engine=${scan.engine},scanned_at=now(),
              rejection_reason='clean-promotion-readback-mismatch',updated_at=now()
            WHERE id=${uploadId}::uuid AND status='scanning'
          `;
          throw app.httpErrors.serviceUnavailable("Promoção do asset limpo não preservou os mesmos bytes.");
        }
        await deleteObject(quarantineObjectKey);
        await economySql`
          UPDATE ugc_binary_asset_upload_sessions
          SET status='clean',verified_size_bytes=${promoted.length},verified_sha256=${promotedSha},
            scanner_engine=${scan.engine},scanner_signature=NULL,scanned_at=now(),promoted_at=now(),
            rejection_reason=NULL,updated_at=now()
          WHERE id=${uploadId}::uuid AND status='scanning'
        `;
        return {
          asset: {
            uploadId,
            assetUri: publicCleanAssetUri(uploadId),
            sha256: promotedSha,
            sizeBytes: promoted.length,
            contentType,
            malwareScan: "clean",
            alreadyClean: false
          },
          signature: "Tehkné Solutions"
        };
      } catch (error) {
        if (typeof error === "object" && error !== null && "statusCode" in error) throw error;
        await deleteObject(quarantineObjectKey).catch(() => undefined);
        await economySql`
          UPDATE ugc_binary_asset_upload_sessions
          SET status='rejected',rejection_reason='malware-scan-or-storage-failure',updated_at=now()
          WHERE id=${uploadId}::uuid AND status='scanning'
        `;
        throw app.httpErrors.serviceUnavailable(error instanceof Error ? error.message : "Falha na quarentena antimalware.");
      }
    }
  );

  app.get<{ Params: { uploadId: string } }>("/v1/ugc/assets/files/:uploadId", async (request, reply) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    const uploadId = z.string().uuid().parse(request.params.uploadId);
    const session = (await economySql`
      SELECT clean_object_key,content_type,verified_sha256,verified_size_bytes,status
      FROM ugc_binary_asset_upload_sessions
      WHERE id=${uploadId}::uuid
    `)[0];
    if (!session || String(session.status) !== "clean" || !session.clean_object_key) {
      throw app.httpErrors.notFound("Asset UGC limpo não encontrado.");
    }
    const bytes = await getObject(String(session.clean_object_key));
    const storedSha = sha256(bytes);
    if (storedSha !== String(session.verified_sha256) || bytes.length !== Number(session.verified_size_bytes)) {
      throw app.httpErrors.serviceUnavailable("Falha de integridade ao ler o asset UGC limpo.");
    }
    reply
      .header("cache-control", "public,max-age=31536000,immutable")
      .header("etag", `"sha256-${storedSha}"`)
      .header("x-content-type-options", "nosniff")
      .type(String(session.content_type));
    return reply.send(bytes);
  });
}

// Tehkné Solutions

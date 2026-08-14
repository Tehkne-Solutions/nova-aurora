import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

type Queryable = (strings: TemplateStringsArray, ...values: any[]) => any;

const categorySchema = z.enum(["decor", "furniture", "wearable", "art", "collectible", "architecture", "vehicle", "component"]);
const tokenizationSchema = z.enum(["disabled", "eligible"]);
const httpsManifestUriSchema = z.string().trim().min(1).max(2000).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, { message: "O manifesto precisa usar HTTPS e não pode conter credenciais na URL." });
const sha256Schema = z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "Informe um SHA-256 hexadecimal de 64 caracteres.").transform((value) => value.toLowerCase());

const blueprintCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: categorySchema,
  version: z.number().int().positive().max(100000),
  assetManifestUri: httpsManifestUriSchema,
  contentHash: sha256Schema,
  royaltyBps: z.number().int().min(0).max(5000),
  tokenizationStatus: tokenizationSchema.default("disabled")
});
const blueprintEditSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: categorySchema.optional(),
  version: z.number().int().positive().max(100000).optional(),
  assetManifestUri: httpsManifestUriSchema.optional(),
  contentHash: sha256Schema.optional(),
  royaltyBps: z.number().int().min(0).max(5000).optional(),
  tokenizationStatus: tokenizationSchema.optional()
}).refine((body) => Object.keys(body).length > 0, { message: "Informe pelo menos um campo para edição." });

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

async function ownedBlueprint(app: FastifyInstance, sql: Queryable, blueprintId: string, userId: string, lock = false) {
  const rows = lock
    ? await sql`SELECT * FROM ugc_object_blueprints WHERE id=${blueprintId}::uuid AND creator_user_id=${userId}::uuid FOR UPDATE`
    : await sql`SELECT * FROM ugc_object_blueprints WHERE id=${blueprintId}::uuid AND creator_user_id=${userId}::uuid`;
  const blueprint = rows[0];
  if (!blueprint) throw app.httpErrors.notFound("Blueprint UGC do criador não encontrado.");
  return blueprint;
}

export async function registerCreatorUgcStudioRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ugc/studio/blueprints", async (request) => {
    const actor = await requireActor(app, request);
    const body = blueprintCreateSchema.parse(request.body);
    const id = randomUUID();
    const blueprint = (await economySql`
      INSERT INTO ugc_object_blueprints(
        id,creator_user_id,name,category,version,asset_manifest_uri,content_hash,
        royalty_bps,status,tokenization_status
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,${body.name},${body.category},${body.version},
        ${body.assetManifestUri},${body.contentHash},${body.royaltyBps},'draft',${body.tokenizationStatus}
      )
      RETURNING *
    `)[0]!;
    return {
      blueprint,
      integrity: {
        declarationId: blueprint.asset_manifest_registry_id ? String(blueprint.asset_manifest_registry_id) : null,
        scheme: "https",
        algorithm: "sha256",
        remoteVerification: false
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/studio/blueprints/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT blueprint.id,blueprint.creator_user_id,blueprint.name,blueprint.category,
        blueprint.version,blueprint.asset_manifest_uri,blueprint.content_hash,
        blueprint.royalty_bps,blueprint.status,blueprint.tokenization_status,
        blueprint.asset_manifest_registry_id,blueprint.created_at,blueprint.updated_at,
        registry.status manifest_registry_status,
        registry.manifest_uri manifest_registry_uri,
        registry.sha256 manifest_registry_sha256
      FROM ugc_object_blueprints blueprint
      LEFT JOIN ugc_asset_manifest_registry registry ON registry.id=blueprint.asset_manifest_registry_id
      WHERE blueprint.creator_user_id=${actor.userId}::uuid
      ORDER BY blueprint.updated_at DESC,blueprint.id DESC
      LIMIT ${query.limit}
    `;
    return {
      blueprints: rows,
      semantics: {
        status: "creator-declared-integrity",
        remoteBytesFetched: false,
        malwareScanned: false,
        externallyAnchored: false
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/studio/manifests/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT registry.id,registry.manifest_uri,registry.sha256,registry.status,
        registry.created_at,registry.updated_at,registry.revoked_at,
        count(blueprint.id)::int blueprint_count,
        count(blueprint.id) FILTER(WHERE blueprint.status='published')::int published_blueprints,
        max(blueprint.updated_at) last_blueprint_at
      FROM ugc_asset_manifest_registry registry
      LEFT JOIN ugc_object_blueprints blueprint ON blueprint.asset_manifest_registry_id=registry.id
      WHERE registry.owner_user_id=${actor.userId}::uuid
      GROUP BY registry.id
      ORDER BY registry.updated_at DESC,registry.id DESC
      LIMIT ${query.limit}
    `;
    return {
      manifests: rows,
      semantics: {
        status: "creator-declared-integrity",
        remoteBytesFetched: false,
        malwareScanned: false,
        externallyAnchored: false
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/studio/editions/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT edition.id,edition.blueprint_id,edition.edition_name,edition.scarcity,
        edition.supply_cap,edition.minted_count,edition.unit_price_minor,
        edition.transferable,edition.resale_allowed,edition.tokenization_eligible,
        edition.created_at,blueprint.name blueprint_name,blueprint.version blueprint_version,
        blueprint.category,blueprint.status blueprint_status,blueprint.royalty_bps,
        blueprint.asset_manifest_uri,blueprint.content_hash,blueprint.asset_manifest_registry_id
      FROM ugc_object_editions edition
      JOIN ugc_object_blueprints blueprint ON blueprint.id=edition.blueprint_id
      WHERE blueprint.creator_user_id=${actor.userId}::uuid
      ORDER BY edition.created_at DESC,edition.id DESC
      LIMIT ${query.limit}
    `;
    return { editions: rows, signature: "Tehkné Solutions" };
  });

  app.get("/v1/ugc/studio/sales/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT sale.id,sale.edition_id,sale.blueprint_id,sale.instance_id,sale.buyer_user_id,
        sale.gross_minor,sale.platform_fee_minor,sale.creator_net_minor,sale.sold_at,
        instance.serial_number,instance.provenance_hash,
        edition.edition_name,blueprint.name blueprint_name,blueprint.version blueprint_version
      FROM ugc_primary_sales sale
      JOIN ugc_object_instances instance ON instance.id=sale.instance_id
      JOIN ugc_object_editions edition ON edition.id=sale.edition_id
      JOIN ugc_object_blueprints blueprint ON blueprint.id=sale.blueprint_id
      WHERE sale.creator_user_id=${actor.userId}::uuid
      ORDER BY sale.sold_at DESC,sale.id DESC
      LIMIT ${query.limit}
    `;
    return { sales: rows, signature: "Tehkné Solutions" };
  });

  app.patch<{ Params: { blueprintId: string } }>("/v1/ugc/blueprints/:blueprintId", async (request) => {
    const actor = await requireActor(app, request);
    const blueprintId = z.string().uuid().parse(request.params.blueprintId);
    const body = blueprintEditSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const current = await ownedBlueprint(app, tx, blueprintId, actor.userId, true);
      if (String(current.status) !== "draft") {
        throw app.httpErrors.conflict("Somente blueprint em rascunho pode ser editado. Após publicar, crie uma nova versão para preservar a proveniência.");
      }
      if (String(current.tokenization_status) === "anchored") {
        throw app.httpErrors.conflict("Blueprint ancorado externamente é imutável.");
      }

      const finalManifestUri = body.assetManifestUri ?? String(current.asset_manifest_uri);
      const finalContentHash = body.contentHash ?? String(current.content_hash);
      httpsManifestUriSchema.parse(finalManifestUri);
      sha256Schema.parse(finalContentHash);

      const updated = (await tx`
        UPDATE ugc_object_blueprints SET
          name=${body.name ?? String(current.name)},
          category=${body.category ?? String(current.category)},
          version=${body.version ?? Number(current.version)},
          asset_manifest_uri=${finalManifestUri},
          content_hash=${finalContentHash.toLowerCase()},
          royalty_bps=${body.royaltyBps ?? Number(current.royalty_bps)},
          tokenization_status=${body.tokenizationStatus ?? String(current.tokenization_status)},
          updated_at=now()
        WHERE id=${blueprintId}::uuid
        RETURNING *
      `)[0]!;
      return updated;
    });

    return {
      blueprint: result,
      integrity: {
        declarationId: result.asset_manifest_registry_id ? String(result.asset_manifest_registry_id) : null,
        scheme: "https",
        algorithm: "sha256",
        remoteVerification: false
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { blueprintId: string } }>("/v1/ugc/blueprints/:blueprintId/publish", async (request) => {
    const actor = await requireActor(app, request);
    const blueprintId = z.string().uuid().parse(request.params.blueprintId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const current = await ownedBlueprint(app, tx, blueprintId, actor.userId, true);
      const status = String(current.status);
      if (status === "published") return { changed: false, blueprint: current };
      if (status === "rejected") throw app.httpErrors.forbidden("Blueprint rejeitado pela moderação não pode ser publicado.");
      if (status === "retired") throw app.httpErrors.conflict("Blueprint aposentado não pode ser republicado. Crie uma nova versão.");
      if (!current.asset_manifest_registry_id) {
        throw app.httpErrors.conflict("Blueprint legado sem declaração de integridade. Atualize o manifesto HTTPS e o SHA-256 antes de publicar.");
      }
      const registry = (await tx`
        SELECT id,status FROM ugc_asset_manifest_registry
        WHERE id=${String(current.asset_manifest_registry_id)}::uuid
          AND owner_user_id=${actor.userId}::uuid
        FOR UPDATE
      `)[0];
      if (!registry || String(registry.status) !== "declared") {
        throw app.httpErrors.conflict("A declaração de integridade do manifesto não está ativa.");
      }
      const updated = (await tx`
        UPDATE ugc_object_blueprints SET status='published',updated_at=now()
        WHERE id=${blueprintId}::uuid
        RETURNING *
      `)[0]!;
      return { changed: true, blueprint: updated };
    });
    return { publication: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { blueprintId: string } }>("/v1/ugc/blueprints/:blueprintId/retire", async (request) => {
    const actor = await requireActor(app, request);
    const blueprintId = z.string().uuid().parse(request.params.blueprintId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const current = await ownedBlueprint(app, tx, blueprintId, actor.userId, true);
      const status = String(current.status);
      if (status === "retired") return { changed: false, blueprint: current };
      if (status !== "published") {
        throw app.httpErrors.conflict("Somente blueprint publicado pode ser aposentado.");
      }
      const updated = (await tx`
        UPDATE ugc_object_blueprints SET status='retired',updated_at=now()
        WHERE id=${blueprintId}::uuid
        RETURNING *
      `)[0]!;
      return { changed: true, blueprint: updated };
    });
    return { retirement: result, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions

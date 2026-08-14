import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

type Queryable = (strings: TemplateStringsArray, ...values: any[]) => any;

const categorySchema = z.enum(["decor", "furniture", "wearable", "art", "collectible", "architecture", "vehicle", "component"]);
const tokenizationSchema = z.enum(["disabled", "eligible"]);
const blueprintEditSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: categorySchema.optional(),
  version: z.number().int().positive().max(100000).optional(),
  assetManifestUri: z.string().trim().min(1).max(2000).optional(),
  contentHash: z.string().trim().min(16).max(256).optional(),
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
  app.get("/v1/ugc/studio/editions/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT edition.id,edition.blueprint_id,edition.edition_name,edition.scarcity,
        edition.supply_cap,edition.minted_count,edition.unit_price_minor,
        edition.transferable,edition.resale_allowed,edition.tokenization_eligible,
        edition.created_at,blueprint.name blueprint_name,blueprint.version blueprint_version,
        blueprint.category,blueprint.status blueprint_status,blueprint.royalty_bps,
        blueprint.asset_manifest_uri,blueprint.content_hash
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

      const updated = (await tx`
        UPDATE ugc_object_blueprints SET
          name=${body.name ?? String(current.name)},
          category=${body.category ?? String(current.category)},
          version=${body.version ?? Number(current.version)},
          asset_manifest_uri=${body.assetManifestUri ?? String(current.asset_manifest_uri)},
          content_hash=${body.contentHash ?? String(current.content_hash)},
          royalty_bps=${body.royaltyBps ?? Number(current.royalty_bps)},
          tokenization_status=${body.tokenizationStatus ?? String(current.tokenization_status)},
          updated_at=now()
        WHERE id=${blueprintId}::uuid
        RETURNING *
      `)[0]!;
      return updated;
    });

    return { blueprint: result, signature: "Tehkné Solutions" };
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

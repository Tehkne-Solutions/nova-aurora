import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { closeDb, db } from "./index.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

function digest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

test(
  "UGC manifest registry normaliza declaração e impede bypass de integridade",
  { skip: !databaseAvailable },
  async () => {
    const sql = db();
    const userRows = await sql`SELECT id FROM users WHERE email='alice@nova-aurora.local' LIMIT 1`;
    const creatorId = String(userRows[0]?.id ?? "");
    assert.ok(creatorId, "seed alice precisa existir para o teste de integridade UGC");

    const run = randomUUID();
    const blueprintId = randomUUID();
    const manifestUri = `https://assets.example.test/${run}/manifest.json`;
    const sha256 = digest(run);

    try {
      const created = await sql`
        INSERT INTO ugc_object_blueprints(
          id,creator_user_id,name,category,version,asset_manifest_uri,content_hash,
          royalty_bps,status,tokenization_status
        ) VALUES(
          ${blueprintId}::uuid,${creatorId}::uuid,${`Integrity ${run}`},'component',1,
          ${manifestUri},${sha256.toUpperCase()},500,'draft','disabled'
        )
        RETURNING asset_manifest_registry_id,content_hash
      `;

      const registryId = String(created[0]?.asset_manifest_registry_id ?? "");
      assert.ok(registryId, "trigger precisa vincular o blueprint ao registry");
      assert.equal(String(created[0]?.content_hash), sha256, "SHA-256 precisa ser normalizado para lowercase");

      const registry = await sql`
        SELECT owner_user_id,manifest_uri,sha256,status
        FROM ugc_asset_manifest_registry
        WHERE id=${registryId}::uuid
      `;
      assert.equal(String(registry[0]?.owner_user_id), creatorId);
      assert.equal(String(registry[0]?.manifest_uri), manifestUri);
      assert.equal(String(registry[0]?.sha256), sha256);
      assert.equal(String(registry[0]?.status), "declared");

      const repaired = await sql`
        UPDATE ugc_object_blueprints
        SET asset_manifest_registry_id=NULL
        WHERE id=${blueprintId}::uuid
        RETURNING asset_manifest_registry_id
      `;
      assert.equal(
        String(repaired[0]?.asset_manifest_registry_id),
        registryId,
        "registry_id adulterado precisa ser reconciliado pelo trigger"
      );

      await assert.rejects(() => sql`
        INSERT INTO ugc_object_blueprints(
          id,creator_user_id,name,category,version,asset_manifest_uri,content_hash,
          royalty_bps,status,tokenization_status
        ) VALUES(
          ${randomUUID()}::uuid,${creatorId}::uuid,${`Credential URI ${run}`},'component',1,
          ${`https://user:secret@assets.example.test/${run}/manifest.json`},${digest(`${run}:credential`)},
          500,'draft','disabled'
        )
      `);

      await sql`
        UPDATE ugc_asset_manifest_registry
        SET status='revoked',revoked_at=now(),updated_at=now()
        WHERE id=${registryId}::uuid
      `;

      await assert.rejects(() => sql`
        UPDATE ugc_object_blueprints
        SET status='published'
        WHERE id=${blueprintId}::uuid
      `);

      const stillDraft = await sql`SELECT status FROM ugc_object_blueprints WHERE id=${blueprintId}::uuid`;
      assert.equal(String(stillDraft[0]?.status), "draft");
    } finally {
      await sql`DELETE FROM ugc_object_blueprints WHERE id=${blueprintId}::uuid`;
      await sql`
        DELETE FROM ugc_asset_manifest_registry
        WHERE owner_user_id=${creatorId}::uuid AND manifest_uri=${manifestUri}
      `;
    }
  }
);

test.after(async () => {
  await closeDb();
});

// Tehkné Solutions

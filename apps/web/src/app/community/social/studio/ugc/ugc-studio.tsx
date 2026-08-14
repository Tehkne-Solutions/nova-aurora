"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type BlueprintCategory = "decor" | "furniture" | "wearable" | "art" | "collectible" | "architecture" | "vehicle" | "component";
type BlueprintStatus = "draft" | "published" | "retired" | "rejected";
type Scarcity = "open" | "limited" | "unique";
type TokenizationStatus = "disabled" | "eligible" | "anchored";

type Blueprint = Readonly<{
  id: string;
  creator_user_id: string;
  name: string;
  category: BlueprintCategory;
  version: number | string;
  asset_manifest_uri: string;
  content_hash: string;
  royalty_bps: number | string;
  status: BlueprintStatus;
  tokenization_status: TokenizationStatus;
  created_at: string;
  updated_at: string;
}>;

type Edition = Readonly<{
  id: string;
  blueprint_id: string;
  edition_name: string;
  scarcity: Scarcity;
  supply_cap: number | string | null;
  minted_count: number | string;
  unit_price_minor: number | string;
  transferable: boolean;
  resale_allowed: boolean;
  tokenization_eligible: boolean;
  created_at: string;
  blueprint_name: string;
  blueprint_version: number | string;
  category: BlueprintCategory;
  blueprint_status: BlueprintStatus;
  royalty_bps: number | string;
  asset_manifest_uri: string;
  content_hash: string;
}>;

type Sale = Readonly<{
  id: string;
  edition_id: string;
  blueprint_id: string;
  instance_id: string;
  buyer_user_id: string;
  gross_minor: number | string;
  platform_fee_minor: number | string;
  creator_net_minor: number | string;
  sold_at: string;
  serial_number: number | string;
  provenance_hash: string;
  edition_name: string;
  blueprint_name: string;
  blueprint_version: number | string;
}>;

type ApiError = { message?: string; error?: string };

type BlueprintDraft = Readonly<{
  name: string;
  category: BlueprintCategory;
  version: string;
  assetManifestUri: string;
  contentHash: string;
  royaltyBps: string;
  tokenizationStatus: "disabled" | "eligible";
}>;

type EditionDraft = Readonly<{
  blueprintId: string;
  editionName: string;
  scarcity: Scarcity;
  supplyCap: string;
  unitPriceMinor: string;
  transferable: boolean;
  resaleAllowed: boolean;
}>;

const blankBlueprint = (): BlueprintDraft => ({
  name: "",
  category: "decor",
  version: "1",
  assetManifestUri: "",
  contentHash: "",
  royaltyBps: "500",
  tokenizationStatus: "disabled"
});

const blankEdition = (blueprintId = ""): EditionDraft => ({
  blueprintId,
  editionName: "",
  scarcity: "open",
  supplyCap: "",
  unitPriceMinor: "",
  transferable: true,
  resaleAllowed: true
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Mantém status HTTP quando não houver JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function blueprintStatus(status: BlueprintStatus): string {
  if (status === "draft") return "Rascunho";
  if (status === "published") return "Publicado";
  if (status === "retired") return "Aposentado";
  return "Rejeitado pela moderação";
}

function supplyLabel(edition: Edition): string {
  const minted = Number(edition.minted_count);
  if (edition.supply_cap === null) return `${minted} emitidos · oferta aberta`;
  return `${minted}/${Number(edition.supply_cap)} emitidos`;
}

export function UgcCreatorStudio() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingBlueprintId, setEditingBlueprintId] = useState<string | null>(null);
  const [blueprintDraft, setBlueprintDraft] = useState<BlueprintDraft>(() => blankBlueprint());
  const [editionDraft, setEditionDraft] = useState<EditionDraft>(() => blankEdition());

  const publishedBlueprints = useMemo(
    () => blueprints.filter((blueprint) => blueprint.status === "published"),
    [blueprints]
  );

  const loadStudio = useCallback(async () => {
    setError(null);
    try {
      const [blueprintResult, editionResult, salesResult] = await Promise.all([
        api<{ blueprints: Blueprint[] }>("/v1/ugc/blueprints/me?limit=100"),
        api<{ editions: Edition[] }>("/v1/ugc/studio/editions/me?limit=100"),
        api<{ sales: Sale[] }>("/v1/ugc/studio/sales/me?limit=100")
      ]);
      setBlueprints(blueprintResult.blueprints);
      setEditions(editionResult.editions);
      setSales(salesResult.sales);
      const firstPublished = blueprintResult.blueprints.find((blueprint) => blueprint.status === "published")?.id ?? "";
      setEditionDraft((current) => current.blueprintId
        ? current
        : { ...current, blueprintId: firstPublished });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o UGC Creator Studio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "A operação UGC não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  function blueprintPayload() {
    return {
      name: blueprintDraft.name.trim(),
      category: blueprintDraft.category,
      version: Number(blueprintDraft.version),
      assetManifestUri: blueprintDraft.assetManifestUri.trim(),
      contentHash: blueprintDraft.contentHash.trim(),
      royaltyBps: Number(blueprintDraft.royaltyBps),
      tokenizationStatus: blueprintDraft.tokenizationStatus
    };
  }

  async function createBlueprint() {
    await run(async () => {
      await api("/v1/ugc/blueprints", {
        method: "POST",
        body: JSON.stringify({ ...blueprintPayload(), publish: false })
      });
      setBlueprintDraft(blankBlueprint());
      await loadStudio();
    }, "Blueprint salvo como rascunho.");
  }

  async function saveBlueprintEdit() {
    if (!editingBlueprintId) return;
    await run(async () => {
      await api(`/v1/ugc/blueprints/${editingBlueprintId}`, {
        method: "PATCH",
        body: JSON.stringify(blueprintPayload())
      });
      setEditingBlueprintId(null);
      setBlueprintDraft(blankBlueprint());
      await loadStudio();
    }, "Blueprint atualizado antes da publicação.");
  }

  function beginBlueprintEdit(blueprint: Blueprint) {
    setEditingBlueprintId(blueprint.id);
    setBlueprintDraft({
      name: blueprint.name,
      category: blueprint.category,
      version: String(blueprint.version),
      assetManifestUri: blueprint.asset_manifest_uri,
      contentHash: blueprint.content_hash,
      royaltyBps: String(blueprint.royalty_bps),
      tokenizationStatus: blueprint.tokenization_status === "eligible" ? "eligible" : "disabled"
    });
  }

  function cancelBlueprintEdit() {
    setEditingBlueprintId(null);
    setBlueprintDraft(blankBlueprint());
  }

  async function transitionBlueprint(blueprint: Blueprint, action: "publish" | "retire") {
    await run(async () => {
      await api(`/v1/ugc/blueprints/${blueprint.id}/${action}`, { method: "POST" });
      if (editingBlueprintId === blueprint.id) cancelBlueprintEdit();
      await loadStudio();
    }, action === "publish" ? "Blueprint publicado e pronto para edições." : "Blueprint aposentado. Edições já emitidas preservam proveniência e regras comerciais.");
  }

  async function createEdition() {
    const supplyCap = editionDraft.scarcity === "open"
      ? null
      : editionDraft.scarcity === "unique"
        ? 1
        : Number(editionDraft.supplyCap);
    await run(async () => {
      await api(`/v1/ugc/blueprints/${editionDraft.blueprintId}/editions`, {
        method: "POST",
        body: JSON.stringify({
          editionName: editionDraft.editionName.trim(),
          scarcity: editionDraft.scarcity,
          supplyCap,
          unitPriceMinor: Number(editionDraft.unitPriceMinor),
          transferable: editionDraft.transferable,
          resaleAllowed: editionDraft.resaleAllowed
        })
      });
      setEditionDraft(blankEdition(publishedBlueprints[0]?.id ?? ""));
      await loadStudio();
    }, "Edição comercial criada. Preço, oferta e transferibilidade passam a compor sua proveniência.");
  }

  const blueprintReady = Boolean(
    blueprintDraft.name.trim()
      && Number(blueprintDraft.version) > 0
      && blueprintDraft.assetManifestUri.trim()
      && blueprintDraft.contentHash.trim().length >= 16
      && Number(blueprintDraft.royaltyBps) >= 0
      && Number(blueprintDraft.royaltyBps) <= 5000
  );
  const editionReady = Boolean(
    editionDraft.blueprintId
      && editionDraft.editionName.trim()
      && Number(editionDraft.unitPriceMinor) > 0
      && (editionDraft.scarcity === "open" || editionDraft.scarcity === "unique" || Number(editionDraft.supplyCap) > 0)
  );

  if (loading) return <div className={styles.empty}>Carregando UGC Creator Studio...</div>;

  return (
    <section className={styles.detail} aria-labelledby="ugc-studio-inner-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="ugc-studio-inner-title">UGC Creator Studio</h3>
          <p>Modele blueprints versionados, publique o manifesto e abra edições comerciais com escassez e royalties definidos.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void loadStudio()}>Atualizar</button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.creatorGrid}>
        <section className={styles.panel} aria-labelledby="blueprint-editor-title">
          <h4 id="blueprint-editor-title">{editingBlueprintId ? "Editar blueprint em rascunho" : "Novo blueprint"}</h4>
          <div className={styles.formRow}>
            <label htmlFor="ugc-blueprint-name">Nome</label>
            <input id="ugc-blueprint-name" className={styles.input} maxLength={160} value={blueprintDraft.name} onChange={(event) => setBlueprintDraft((current) => ({ ...current, name: event.target.value }))} />
            <label htmlFor="ugc-blueprint-category">Categoria</label>
            <select id="ugc-blueprint-category" className={styles.select} value={blueprintDraft.category} onChange={(event) => setBlueprintDraft((current) => ({ ...current, category: event.target.value as BlueprintCategory }))}>
              {(["decor", "furniture", "wearable", "art", "collectible", "architecture", "vehicle", "component"] as BlueprintCategory[]).map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
            <label htmlFor="ugc-blueprint-version">Versão</label>
            <input id="ugc-blueprint-version" className={styles.input} type="number" min="1" step="1" value={blueprintDraft.version} onChange={(event) => setBlueprintDraft((current) => ({ ...current, version: event.target.value }))} />
            <label htmlFor="ugc-manifest-uri">URI do manifesto de assets</label>
            <input id="ugc-manifest-uri" className={styles.input} maxLength={2000} value={blueprintDraft.assetManifestUri} placeholder="https://.../manifest.json" onChange={(event) => setBlueprintDraft((current) => ({ ...current, assetManifestUri: event.target.value }))} />
            <label htmlFor="ugc-content-hash">Hash do conteúdo</label>
            <input id="ugc-content-hash" className={styles.input} minLength={16} maxLength={256} value={blueprintDraft.contentHash} onChange={(event) => setBlueprintDraft((current) => ({ ...current, contentHash: event.target.value }))} />
            <label htmlFor="ugc-royalty">Royalty em basis points (0–5000)</label>
            <input id="ugc-royalty" className={styles.input} type="number" min="0" max="5000" step="1" value={blueprintDraft.royaltyBps} onChange={(event) => setBlueprintDraft((current) => ({ ...current, royaltyBps: event.target.value }))} />
            <label htmlFor="ugc-tokenization">Tokenização</label>
            <select id="ugc-tokenization" className={styles.select} value={blueprintDraft.tokenizationStatus} onChange={(event) => setBlueprintDraft((current) => ({ ...current, tokenizationStatus: event.target.value as "disabled" | "eligible" }))}>
              <option value="disabled">Desabilitada</option>
              <option value="eligible">Elegível para ancoragem futura</option>
            </select>
            <div className={styles.actions}>
              {editingBlueprintId ? (
                <>
                  <button className={styles.button} type="button" disabled={busy || !blueprintReady} onClick={() => void saveBlueprintEdit()}>Salvar rascunho</button>
                  <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={cancelBlueprintEdit}>Cancelar</button>
                </>
              ) : (
                <button className={styles.button} type="button" disabled={busy || !blueprintReady} onClick={() => void createBlueprint()}>Criar rascunho</button>
              )}
            </div>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="edition-create-title">
          <h4 id="edition-create-title">Nova edição comercial</h4>
          {publishedBlueprints.length === 0 ? (
            <div className={styles.empty}>Publique ao menos um blueprint antes de criar uma edição.</div>
          ) : (
            <div className={styles.formRow}>
              <label htmlFor="ugc-edition-blueprint">Blueprint publicado</label>
              <select id="ugc-edition-blueprint" className={styles.select} value={editionDraft.blueprintId} onChange={(event) => setEditionDraft((current) => ({ ...current, blueprintId: event.target.value }))}>
                {publishedBlueprints.map((blueprint) => <option value={blueprint.id} key={blueprint.id}>{blueprint.name} · v{blueprint.version}</option>)}
              </select>
              <label htmlFor="ugc-edition-name">Nome da edição</label>
              <input id="ugc-edition-name" className={styles.input} maxLength={120} value={editionDraft.editionName} onChange={(event) => setEditionDraft((current) => ({ ...current, editionName: event.target.value }))} />
              <label htmlFor="ugc-edition-scarcity">Escassez</label>
              <select id="ugc-edition-scarcity" className={styles.select} value={editionDraft.scarcity} onChange={(event) => setEditionDraft((current) => ({ ...current, scarcity: event.target.value as Scarcity, supplyCap: event.target.value === "unique" ? "1" : current.supplyCap }))}>
                <option value="open">Oferta aberta</option>
                <option value="limited">Limitada</option>
                <option value="unique">Única</option>
              </select>
              {editionDraft.scarcity === "limited" ? (
                <>
                  <label htmlFor="ugc-edition-supply">Supply cap</label>
                  <input id="ugc-edition-supply" className={styles.input} type="number" min="1" max="1000000" step="1" value={editionDraft.supplyCap} onChange={(event) => setEditionDraft((current) => ({ ...current, supplyCap: event.target.value }))} />
                </>
              ) : null}
              <label htmlFor="ugc-edition-price">Preço por unidade</label>
              <input id="ugc-edition-price" className={styles.input} type="number" min="1" step="1" value={editionDraft.unitPriceMinor} onChange={(event) => setEditionDraft((current) => ({ ...current, unitPriceMinor: event.target.value }))} />
              <label><input type="checkbox" checked={editionDraft.transferable} onChange={(event) => setEditionDraft((current) => ({ ...current, transferable: event.target.checked }))} /> Transferível entre usuários</label>
              <label><input type="checkbox" checked={editionDraft.resaleAllowed} disabled={!editionDraft.transferable} onChange={(event) => setEditionDraft((current) => ({ ...current, resaleAllowed: event.target.checked }))} /> Revenda permitida</label>
              <div className={styles.actions}>
                <button className={styles.button} type="button" disabled={busy || !editionReady} onClick={() => void createEdition()}>Criar edição</button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="blueprint-list-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="blueprint-list-title">Blueprints</h4>
            <p>Publicação congela a versão. Para mudanças posteriores, crie uma nova versão/hash.</p>
          </div>
          <span className={styles.pill}>{blueprints.length} blueprints</span>
        </div>
        {blueprints.length === 0 ? <div className={styles.empty}>Nenhum blueprint criado ainda.</div> : (
          <div className={styles.activityList}>
            {blueprints.map((blueprint) => (
              <article className={styles.activity} key={blueprint.id}>
                <div>
                  <h4>{blueprint.name} · v{blueprint.version}</h4>
                  <p>{blueprint.category} · {blueprintStatus(blueprint.status)} · royalty {Number(blueprint.royalty_bps) / 100}%</p>
                  <p className={styles.code}>Hash {blueprint.content_hash}</p>
                </div>
                <div className={styles.inlineActions}>
                  {blueprint.status === "draft" ? (
                    <>
                      <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => beginBlueprintEdit(blueprint)}>Editar</button>
                      <button className={styles.button} type="button" disabled={busy} onClick={() => void transitionBlueprint(blueprint, "publish")}>Publicar versão</button>
                    </>
                  ) : null}
                  {blueprint.status === "published" ? <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void transitionBlueprint(blueprint, "retire")}>Aposentar blueprint</button> : null}
                  {blueprint.status === "rejected" ? <span className={styles.pill}>Use Segurança para acompanhar/apelar</span> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="edition-list-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="edition-list-title">Edições</h4>
            <p>Condições comerciais são fixadas na criação e o contador de mint acompanha a oferta emitida.</p>
          </div>
          <span className={styles.pill}>{editions.length} edições</span>
        </div>
        {editions.length === 0 ? <div className={styles.empty}>Nenhuma edição comercial criada.</div> : (
          <div className={styles.activityList}>
            {editions.map((edition) => (
              <article className={styles.activity} key={edition.id}>
                <div>
                  <h4>{edition.blueprint_name} v{edition.blueprint_version} · {edition.edition_name}</h4>
                  <p>{edition.scarcity} · {supplyLabel(edition)} · {Number(edition.unit_price_minor)} unidades mínimas</p>
                  <p>{edition.transferable ? "Transferível" : "Não transferível"} · {edition.resale_allowed ? `Revenda com royalty ${Number(edition.royalty_bps) / 100}%` : "Revenda desabilitada"}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="ugc-sales-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="ugc-sales-title">Vendas primárias e proveniência</h4>
            <p>Instâncias emitidas pelo settlement, com serial e hash de proveniência persistentes.</p>
          </div>
          <span className={styles.pill}>{sales.length} vendas recentes</span>
        </div>
        {sales.length === 0 ? <div className={styles.empty}>Nenhuma venda primária registrada.</div> : (
          <div className={styles.activityList}>
            {sales.map((sale) => (
              <article className={styles.activity} key={sale.id}>
                <div>
                  <h4>{sale.blueprint_name} v{sale.blueprint_version} · {sale.edition_name} · #{sale.serial_number}</h4>
                  <p>{Number(sale.gross_minor)} bruto · {Number(sale.creator_net_minor)} líquido do criador · {dateTime(sale.sold_at)}</p>
                  <p className={styles.code}>Proveniência {sale.provenance_hash}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

// Tehkné Solutions

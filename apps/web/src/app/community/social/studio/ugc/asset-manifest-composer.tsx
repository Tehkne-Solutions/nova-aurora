"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../social.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type BlueprintCategory = "decor" | "furniture" | "wearable" | "art" | "collectible" | "architecture" | "vehicle" | "component";
type AllowedContentType = "image/png" | "image/jpeg" | "image/webp" | "model/gltf-binary";

type CleanAsset = Readonly<{
  id: string;
  fileName: string;
  contentType: AllowedContentType;
  status: "clean";
  verifiedSizeBytes: number | null;
  verifiedSha256: string | null;
  assetPath: string | null;
  assetUri: string | null;
  promotedAt: string | null;
}>;

type LibraryResponse = Readonly<{ assets: CleanAsset[] }>;
type ApiError = { message?: string; error?: string };

type ManifestUploadSession = Readonly<{
  upload: {
    id: string;
    method: "POST";
    path: string;
    contentType: string;
  };
}>;

type VerifiedManifest = Readonly<{
  uploadId: string;
  assetManifestUri: string;
  sha256: string;
  sizeBytes: number;
  verifiedByPlatform: boolean;
}>;

type BlueprintResult = Readonly<{
  blueprint: { id: string; name: string; category: BlueprintCategory; version: number | string };
  integrity: { verifiedUploadId: string | null; remoteVerification: boolean };
}>;

type ComposerResult = Readonly<{
  blueprintId: string;
  manifestUploadId: string;
  manifestUri: string;
  sha256: string;
  assetCount: number;
}>;

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Preserva o status HTTP quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assetReference(asset: CleanAsset): string | null {
  if (asset.assetUri) return asset.assetUri;
  if (asset.assetPath) return asset.assetPath;
  return null;
}

function safeFileName(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${normalized || "ugc-bundle"}.json`;
}

export function AssetManifestComposer() {
  const [assets, setAssets] = useState<CleanAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<BlueprintCategory>("decor");
  const [version, setVersion] = useState("1");
  const [royaltyBps, setRoyaltyBps] = useState("500");
  const [tokenizationStatus, setTokenizationStatus] = useState<"disabled" | "eligible">("disabled");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposerResult | null>(null);

  const loadAssets = useCallback(async () => {
    setError(null);
    try {
      const response = await apiJson<LibraryResponse>("/v1/ugc/assets/library/me?status=clean&limit=100");
      const usable = response.assets.filter((asset) => asset.status === "clean" && asset.verifiedSha256 && assetReference(asset));
      setAssets(usable);
      setSelectedIds((current) => current.filter((id) => usable.some((asset) => asset.id === id)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os assets limpos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.includes(asset.id)).sort((left, right) => left.id.localeCompare(right.id)),
    [assets, selectedIds]
  );

  const ready = Boolean(
    name.trim()
      && selectedAssets.length > 0
      && Number.isInteger(Number(version))
      && Number(version) > 0
      && Number(version) <= 100000
      && Number.isInteger(Number(royaltyBps))
      && Number(royaltyBps) >= 0
      && Number(royaltyBps) <= 5000
  );

  function toggleAsset(assetId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? current.includes(assetId) ? current : [...current, assetId]
      : current.filter((id) => id !== assetId));
    setResult(null);
  }

  async function composeAndCreate() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setNotice("Montando manifesto determinístico a partir dos assets limpos...");
    try {
      const manifest = {
        schemaVersion: 1,
        kind: "nova-aurora-ugc-asset-bundle",
        blueprint: {
          name: name.trim(),
          category,
          version: Number(version)
        },
        assets: selectedAssets.map((asset, index) => ({
          assetId: asset.id,
          role: index === 0 ? "primary" : "supporting",
          uri: assetReference(asset),
          sha256: asset.verifiedSha256,
          contentType: asset.contentType,
          sizeBytes: asset.verifiedSizeBytes,
          fileName: asset.fileName
        })),
        integrity: {
          assetPolicy: "clean-only",
          algorithm: "sha256"
        },
        signature: "Tehkné Solutions"
      };
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      if (bytes.byteLength > 1024 * 1024) throw new Error("O manifesto composto excedeu o limite de 1 MiB.");
      const digest = await sha256Hex(bytes);

      setNotice("Manifesto composto. Enviando os bytes para verificação do object storage...");
      const session = await apiJson<ManifestUploadSession>("/v1/ugc/assets/manifests/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: safeFileName(name),
          sizeBytes: bytes.byteLength,
          sha256: digest
        })
      });

      const uploadResponse = await fetch(`${API_URL}${session.upload.path}`, {
        method: session.upload.method,
        headers: { "content-type": session.upload.contentType },
        body: bytes
      });
      if (!uploadResponse.ok) {
        let detail = `Falha ${uploadResponse.status}`;
        try {
          const payload = await uploadResponse.json() as ApiError;
          detail = payload.message ?? payload.error ?? detail;
        } catch {
          // Mantém o status HTTP.
        }
        throw new Error(detail);
      }
      const verified = (await uploadResponse.json() as { manifest: VerifiedManifest }).manifest;
      if (!verified.verifiedByPlatform || verified.sha256 !== digest || verified.uploadId !== session.upload.id) {
        throw new Error("O storage não confirmou exatamente o manifesto composto.");
      }

      setNotice("Manifesto verificado. Criando blueprint com binding atômico...");
      const blueprint = await apiJson<BlueprintResult>("/v1/ugc/studio/blueprints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          version: Number(version),
          assetManifestUri: verified.assetManifestUri,
          contentHash: digest,
          royaltyBps: Number(royaltyBps),
          tokenizationStatus,
          verifiedUploadId: verified.uploadId
        })
      });
      if (!blueprint.blueprint.id || blueprint.integrity.verifiedUploadId !== verified.uploadId || blueprint.integrity.remoteVerification !== true) {
        throw new Error("O blueprint não confirmou o binding atômico ao manifesto verificado.");
      }

      setResult({
        blueprintId: blueprint.blueprint.id,
        manifestUploadId: verified.uploadId,
        manifestUri: verified.assetManifestUri,
        sha256: digest,
        assetCount: selectedAssets.length
      });
      setNotice("Bundle criado: assets limpos → manifesto verificado → blueprint em rascunho.");
    } catch (composeError) {
      setError(composeError instanceof Error ? composeError.message : "Não foi possível compor o bundle UGC.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.detail} aria-labelledby="ugc-manifest-composer-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="ugc-manifest-composer-title">Compositor de manifesto e blueprint</h3>
          <p>Selecione assets já limpos, gere um manifesto JSON determinístico, verifique seus bytes no storage e crie um blueprint vinculado atomicamente sem copiar URI ou hash à mão.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void loadAssets()}>Atualizar assets</button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.creatorGrid}>
        <section className={styles.panel} aria-labelledby="ugc-bundle-blueprint-title">
          <h4 id="ugc-bundle-blueprint-title">Dados do blueprint</h4>
          <div className={styles.formRow}>
            <label htmlFor="ugc-bundle-name">Nome</label>
            <input id="ugc-bundle-name" className={styles.input} maxLength={160} value={name} onChange={(event) => { setName(event.target.value); setResult(null); }} />

            <label htmlFor="ugc-bundle-category">Categoria</label>
            <select id="ugc-bundle-category" className={styles.select} value={category} onChange={(event) => { setCategory(event.target.value as BlueprintCategory); setResult(null); }}>
              {(["decor", "furniture", "wearable", "art", "collectible", "architecture", "vehicle", "component"] as BlueprintCategory[]).map((value) => <option value={value} key={value}>{value}</option>)}
            </select>

            <label htmlFor="ugc-bundle-version">Versão</label>
            <input id="ugc-bundle-version" className={styles.input} type="number" min="1" max="100000" step="1" value={version} onChange={(event) => { setVersion(event.target.value); setResult(null); }} />

            <label htmlFor="ugc-bundle-royalty">Royalty em basis points</label>
            <input id="ugc-bundle-royalty" className={styles.input} type="number" min="0" max="5000" step="1" value={royaltyBps} onChange={(event) => { setRoyaltyBps(event.target.value); setResult(null); }} />

            <label htmlFor="ugc-bundle-tokenization">Tokenização</label>
            <select id="ugc-bundle-tokenization" className={styles.select} value={tokenizationStatus} onChange={(event) => { setTokenizationStatus(event.target.value as "disabled" | "eligible"); setResult(null); }}>
              <option value="disabled">Desabilitada</option>
              <option value="eligible">Elegível para ancoragem futura</option>
            </select>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="ugc-bundle-assets-title">
          <div className={styles.sectionHeader}>
            <div>
              <h4 id="ugc-bundle-assets-title">Assets limpos</h4>
              <p>O primeiro selecionado na ordem canônica vira `primary`; os demais entram como `supporting`.</p>
            </div>
            <span className={styles.pill}>{selectedAssets.length} selecionados</span>
          </div>
          {loading ? <div className={styles.empty}>Carregando assets limpos...</div> : assets.length === 0 ? (
            <div className={styles.empty}>Envie e valide ao menos um asset na biblioteca antes de compor o manifesto.</div>
          ) : (
            <div className={styles.activityList}>
              {assets.map((asset) => (
                <label className={styles.activity} key={asset.id}>
                  <input type="checkbox" checked={selectedIds.includes(asset.id)} disabled={busy} onChange={(event) => toggleAsset(asset.id, event.target.checked)} />
                  <div>
                    <h4>{asset.fileName}</h4>
                    <p>{asset.contentType} · <span className={styles.pill}>clean</span></p>
                    <p className={styles.code}>SHA-256 {asset.verifiedSha256}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="ugc-bundle-action-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="ugc-bundle-action-title">Criar bundle verificável</h4>
            <p>A operação só usa assets `clean` e cria o blueprint como rascunho. Publicação e edição comercial continuam nos gates já existentes.</p>
          </div>
          <button className={styles.button} type="button" disabled={busy || !ready} onClick={() => void composeAndCreate()}>
            {busy ? "Compondo e verificando..." : "Gerar manifesto + criar blueprint"}
          </button>
        </div>
      </section>

      {result ? (
        <section className={styles.panel} aria-labelledby="ugc-bundle-result-title">
          <h4 id="ugc-bundle-result-title">Bundle confirmado</h4>
          <p><span className={styles.pill}>Binding atômico verificado</span> · {result.assetCount} assets</p>
          <p className={styles.code}>Blueprint {result.blueprintId}</p>
          <p className={styles.code}>Manifest upload {result.manifestUploadId}</p>
          <p className={styles.code}>SHA-256 {result.sha256}</p>
          <p className={styles.code}>{result.manifestUri}</p>
          <p>Use o botão Atualizar no painel de blueprints acima para carregar o novo rascunho e seguir para publicação/edição.</p>
        </section>
      ) : null}
    </section>
  );
}

// Tehkné Solutions

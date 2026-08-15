"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../social.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
type AssetRole = "model" | "texture" | "thumbnail" | "preview" | "attachment";
type CleanAsset = Readonly<{
  id: string;
  fileName: string;
  contentType: string;
  status: "clean";
  verifiedSizeBytes: number;
  verifiedSha256: string;
  assetUri: string;
}>;
type ManagedManifest = Readonly<{
  uploadId: string;
  assetManifestUri: string;
  sha256: string;
  sizeBytes: number;
  verifiedByPlatform: boolean;
  managed: boolean;
  assets: Array<{ uploadId: string; role: AssetRole }>;
}>;
type ApiError = { message?: string; error?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Mantém o status HTTP.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export function ManagedManifestComposer() {
  const [assets, setAssets] = useState<CleanAsset[]>([]);
  const [selected, setSelected] = useState<Record<string, AssetRole>>({});
  const [name, setName] = useState("");
  const [result, setResult] = useState<ManagedManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(() => Object.keys(selected).length, [selected]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api<{ assets: CleanAsset[] }>("/v1/ugc/assets/library/me?status=clean&limit=100");
      setAssets(response.assets);
      setSelected((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => response.assets.some((asset) => asset.id === id))
      ) as Record<string, AssetRole>);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar assets limpos para o manifesto.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      if (checked) return { ...current, [id]: current[id] ?? "attachment" };
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function compose() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const response = await api<{ manifest: ManagedManifest }>("/v1/ugc/assets/manifests/managed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          assets: Object.entries(selected).map(([uploadId, role]) => ({ uploadId, role }))
        })
      });
      setResult(response.manifest);
      setNotice("Manifesto verificado criado exclusivamente com assets clean da plataforma.");
    } catch (composeError) {
      setError(composeError instanceof Error ? composeError.message : "Não foi possível criar o manifesto gerenciado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.detail} aria-labelledby="ugc-managed-manifest-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="ugc-managed-manifest-title">Managed Manifest Composer</h3>
          <p>Monte o manifesto usando apenas assets já aprovados pela biblioteca. URI, SHA-256, MIME e tamanho são resolvidos no servidor, nunca aceitos do cliente.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void load()}>Atualizar assets</button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.panel} aria-labelledby="ugc-managed-compose-form-title">
        <h4 id="ugc-managed-compose-form-title">Novo manifesto gerenciado</h4>
        <div className={styles.formRow}>
          <label htmlFor="ugc-managed-name">Nome do manifesto</label>
          <input id="ugc-managed-name" className={styles.input} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} />
          <p>{selectedCount} asset(s) selecionado(s). Limite: 64.</p>
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy || !name.trim() || selectedCount < 1 || selectedCount > 64} onClick={() => void compose()}>
              Gerar manifesto verificado
            </button>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="ugc-managed-clean-assets-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="ugc-managed-clean-assets-title">Assets disponíveis</h4>
            <p>Somente registros `clean` do criador aparecem nesta seleção.</p>
          </div>
          <span className={styles.pill}>{assets.length} clean</span>
        </div>
        {loading ? <div className={styles.empty}>Carregando assets...</div> : assets.length === 0 ? (
          <div className={styles.empty}>Envie e aprove assets na biblioteca acima antes de compor um manifesto.</div>
        ) : (
          <div className={styles.activityList}>
            {assets.map((asset) => {
              const checked = asset.id in selected;
              return (
                <article className={styles.activity} key={asset.id}>
                  <div>
                    <h4>{asset.fileName}</h4>
                    <p>{asset.contentType} · {sizeLabel(asset.verifiedSizeBytes)}</p>
                    <p className={styles.code}>SHA-256 {asset.verifiedSha256}</p>
                    <p className={styles.code}>{asset.assetUri}</p>
                  </div>
                  <div className={styles.formRow}>
                    <label><input type="checkbox" checked={checked} onChange={(event) => toggle(asset.id, event.target.checked)} /> Incluir</label>
                    {checked ? (
                      <select
                        className={styles.select}
                        aria-label={`Papel de ${asset.fileName}`}
                        value={selected[asset.id]}
                        onChange={(event) => setSelected((current) => ({ ...current, [asset.id]: event.target.value as AssetRole }))}
                      >
                        <option value="model">Modelo</option>
                        <option value="texture">Textura</option>
                        <option value="thumbnail">Thumbnail</option>
                        <option value="preview">Preview</option>
                        <option value="attachment">Anexo</option>
                      </select>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {result ? (
        <section className={styles.panel} aria-labelledby="ugc-managed-result-title">
          <h4 id="ugc-managed-result-title">Manifesto pronto para blueprint</h4>
          <p><span className={styles.pill}>platform-clean-assets-only</span> · {result.assets.length} asset(s) · {sizeLabel(result.sizeBytes)}</p>
          <p className={styles.code}>Upload {result.uploadId}</p>
          <p className={styles.code}>SHA-256 {result.sha256}</p>
          <p className={styles.code}>{result.assetManifestUri}</p>
          <p>O mesmo upload ID pode ser vinculado atomicamente pelo fluxo `verifiedUploadId` do blueprint.</p>
        </section>
      ) : null}
    </section>
  );
}

// Tehkné Solutions

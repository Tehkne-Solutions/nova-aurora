"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../social.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MAX_BYTES = 25 * 1024 * 1024;

type AssetStatus = "pending" | "scanning" | "clean" | "infected" | "rejected" | "expired";
type AllowedContentType = "image/png" | "image/jpeg" | "image/webp" | "model/gltf-binary";

type CreatorAsset = Readonly<{
  id: string;
  fileName: string;
  contentType: AllowedContentType;
  status: AssetStatus;
  expectedSizeBytes: number;
  verifiedSizeBytes: number | null;
  declaredSha256: string;
  verifiedSha256: string | null;
  scannerEngine: string | null;
  rejectionReason: string | null;
  expiresAt: string;
  scannedAt: string | null;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assetPath: string | null;
  assetUri: string | null;
}>;

type LibraryResponse = Readonly<{
  assets: CreatorAsset[];
  maxBytes: number;
}>;

type UploadSession = Readonly<{
  upload: {
    id: string;
    method: "POST";
    path: string;
    contentType: "application/octet-stream";
    declaredContentType: AllowedContentType;
    expiresAt: string;
    maxBytes: number;
    quarantine: true;
  };
}>;

type UploadResult = Readonly<{
  asset: {
    uploadId: string;
    assetUri: string;
    sha256: string;
    sizeBytes: number;
    contentType: AllowedContentType;
    malwareScan: "clean";
  };
}>;

type ApiError = { message?: string; error?: string };

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Mantém o status quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function contentTypeFor(file: File): AllowedContentType | null {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/jpeg") return "image/jpeg";
  if (file.type === "image/webp") return "image/webp";
  if (file.type === "model/gltf-binary") return "model/gltf-binary";
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  return null;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: AssetStatus): string {
  if (status === "pending") return "Aguardando bytes";
  if (status === "scanning") return "Em quarentena / varredura";
  if (status === "clean") return "Limpo e publicado";
  if (status === "infected") return "Bloqueado por malware";
  if (status === "rejected") return "Rejeitado";
  return "Expirado";
}

function publicReference(asset: CreatorAsset): string | null {
  if (!asset.assetPath) return null;
  return asset.assetUri ?? `${API_URL}${asset.assetPath}`;
}

export function BinaryAssetLibrary() {
  const [assets, setAssets] = useState<CreatorAsset[]>([]);
  const [filter, setFilter] = useState<"all" | AssetStatus>("all");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const loadAssets = useCallback(async () => {
    setError(null);
    try {
      const suffix = filter === "all" ? "" : `&status=${encodeURIComponent(filter)}`;
      const result = await apiJson<LibraryResponse>(`/v1/ugc/assets/library/me?limit=100${suffix}`);
      setAssets(result.assets);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a biblioteca de assets.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const cleanAssets = useMemo(() => assets.filter((asset) => asset.status === "clean").length, [assets]);

  async function uploadAsset() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice("Calculando SHA-256 local antes da quarentena...");
    try {
      const contentType = contentTypeFor(file);
      if (!contentType) throw new Error("Formato não permitido. Use PNG, JPEG, WebP ou GLB.");
      if (file.size < 1 || file.size > MAX_BYTES) throw new Error("O asset precisa ter entre 1 byte e 25 MiB.");
      const digest = await sha256(file);
      setNotice("Hash confirmado. Criando sessão privada de quarentena...");
      const session = await apiJson<UploadSession>("/v1/ugc/assets/files/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          sha256: digest
        })
      });
      setNotice("Enviando bytes para quarentena e varredura antimalware...");
      const result = await apiJson<UploadResult>(session.upload.path, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file
      });
      if (result.asset.sha256 !== digest || result.asset.malwareScan !== "clean") {
        throw new Error("A promoção do asset não confirmou o mesmo SHA-256 limpo.");
      }
      setFile(null);
      setInputKey((current) => current + 1);
      setNotice("Asset verificado, limpo e promovido para a biblioteca pública canônica.");
      await loadAssets();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "O upload do asset não foi concluído.");
      await loadAssets();
    } finally {
      setBusy(false);
    }
  }

  async function copyReference(asset: CreatorAsset) {
    const reference = publicReference(asset);
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setNotice(`URI canônica copiada para ${asset.fileName}.`);
      setError(null);
    } catch {
      setError("O navegador não permitiu copiar a URI automaticamente.");
    }
  }

  return (
    <section className={styles.detail} aria-labelledby="ugc-asset-library-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="ugc-asset-library-title">Biblioteca de assets UGC</h3>
          <p>Envie PNG, JPEG, WebP ou GLB. Todo arquivo passa por SHA-256, quarentena privada, validação de formato, ClamAV e readback antes de receber URI pública.</p>
        </div>
        <div className={styles.inlineActions}>
          <span className={styles.pill}>{cleanAssets} limpos</span>
          <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void loadAssets()}>Atualizar</button>
        </div>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.creatorGrid}>
        <section className={styles.panel} aria-labelledby="ugc-asset-upload-title">
          <h4 id="ugc-asset-upload-title">Adicionar asset</h4>
          <div className={styles.formRow}>
            <label htmlFor="ugc-binary-asset-file">Arquivo</label>
            <input
              key={inputKey}
              id="ugc-binary-asset-file"
              className={styles.input}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.glb,image/png,image/jpeg,image/webp,model/gltf-binary"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p>Máximo 25 MiB. SVG, HTML, scripts, executáveis e arquivos fora da allowlist permanecem bloqueados.</p>
            {file ? (
              <p><span className={styles.pill}>{contentTypeFor(file) ?? "formato não reconhecido"}</span> · {file.name} · {bytes(file.size)}</p>
            ) : null}
            <div className={styles.actions}>
              <button className={styles.button} type="button" disabled={busy || !file} onClick={() => void uploadAsset()}>
                {busy ? "Verificando asset..." : "Enviar para quarentena"}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="ugc-asset-filter-title">
          <h4 id="ugc-asset-filter-title">Inventário seguro</h4>
          <div className={styles.formRow}>
            <label htmlFor="ugc-asset-status-filter">Estado</label>
            <select id="ugc-asset-status-filter" className={styles.select} value={filter} onChange={(event) => setFilter(event.target.value as "all" | AssetStatus)}>
              <option value="all">Todos</option>
              <option value="clean">Limpos</option>
              <option value="pending">Pendentes</option>
              <option value="scanning">Em varredura</option>
              <option value="rejected">Rejeitados</option>
              <option value="infected">Bloqueados por malware</option>
              <option value="expired">Expirados</option>
            </select>
            <p>Somente assets `clean` recebem caminho público e podem seguir para composição de manifesto, blueprint e runtime.</p>
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="ugc-assets-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="ugc-assets-title">Seus arquivos</h4>
            <p>Chaves privadas de storage e assinaturas de malware nunca são expostas ao cliente.</p>
          </div>
          <span className={styles.pill}>{assets.length} assets</span>
        </div>

        {loading ? <div className={styles.empty}>Carregando assets...</div> : assets.length === 0 ? (
          <div className={styles.empty}>Nenhum asset encontrado para este filtro.</div>
        ) : (
          <div className={styles.activityList}>
            {assets.map((asset) => {
              const reference = publicReference(asset);
              const image = asset.status === "clean" && asset.contentType.startsWith("image/") && reference;
              return (
                <article className={styles.activity} key={asset.id}>
                  <div>
                    <h4>{asset.fileName}</h4>
                    <p>{asset.contentType} · {bytes(asset.verifiedSizeBytes ?? asset.expectedSizeBytes)} · <span className={styles.pill}>{statusLabel(asset.status)}</span></p>
                    <p>Criado {dateTime(asset.createdAt)}{asset.promotedAt ? ` · promovido ${dateTime(asset.promotedAt)}` : ""}</p>
                    <p className={styles.code}>SHA-256 {asset.verifiedSha256 ?? asset.declaredSha256}</p>
                    {asset.rejectionReason ? <p>Motivo técnico: {asset.rejectionReason}</p> : null}
                    {image ? (
                      <img
                        src={reference}
                        alt={`Preview do asset ${asset.fileName}`}
                        style={{ display: "block", marginTop: 12, maxWidth: 220, maxHeight: 160, objectFit: "contain", borderRadius: 12 }}
                      />
                    ) : asset.status === "clean" && asset.contentType === "model/gltf-binary" ? (
                      <p><span className={styles.pill}>GLB 3D verificado</span> · pronto para o próximo renderer de runtime.</p>
                    ) : null}
                  </div>
                  <div className={styles.inlineActions}>
                    {reference ? <button className={styles.buttonQuiet} type="button" onClick={() => void copyReference(asset)}>Copiar URI</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

// Tehkné Solutions

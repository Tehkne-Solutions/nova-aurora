"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import styles from "../../social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ManifestRecord = Readonly<{
  id: string;
  manifest_uri: string;
  sha256: string;
  status: "declared" | "revoked";
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  blueprint_count: number | string;
  published_blueprints: number | string;
  last_blueprint_at: string | null;
}>;

type ManifestResponse = Readonly<{
  manifests: ManifestRecord[];
  semantics: {
    status: string;
    remoteBytesFetched: boolean;
    malwareScanned: boolean;
    externallyAnchored: boolean;
  };
}>;

type ApiError = { message?: string; error?: string };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Mantém o status HTTP quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function UgcManifestIntegrityGate({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ManifestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<ManifestResponse>("/v1/ugc/studio/manifests/me?limit=100"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as declarações de integridade.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className={styles.empty}>Carregando integridade dos manifests...</div>;
  if (error) return <p className={styles.error} role="alert">{error}</p>;

  return (
    <>
      {children}
      <section className={styles.panel} aria-labelledby="ugc-manifest-integrity-title">
        <div className={styles.sectionHeader}>
          <div>
            <h3 id="ugc-manifest-integrity-title">Integridade de manifests</h3>
            <p>Registro da declaração do criador que vincula uma URI HTTPS a um digest SHA-256 canônico.</p>
          </div>
          <button className={styles.buttonQuiet} type="button" onClick={() => void load()}>Atualizar</button>
        </div>

        <p className={styles.notice}>
          Este estágio comprova apenas a declaração persistida de URI + hash. Os bytes remotos ainda não foram buscados,
          analisados por malware nem ancorados externamente. Esses passos exigem uma camada de storage/verificação posterior.
        </p>

        {!data || data.manifests.length === 0 ? (
          <div className={styles.empty}>
            Nenhum manifest registrado. Blueprints legados podem permanecer legíveis, mas precisam receber URI HTTPS e SHA-256
            válido antes de uma nova publicação pelo Studio.
          </div>
        ) : (
          <div className={styles.activityList}>
            {data.manifests.map((manifest) => (
              <article className={styles.activity} key={manifest.id}>
                <div>
                  <h4>{manifest.status === "declared" ? "Declaração ativa" : "Declaração revogada"}</h4>
                  <p>{Number(manifest.blueprint_count)} blueprints vinculados · {Number(manifest.published_blueprints)} publicados</p>
                  <p className={styles.code}>{manifest.manifest_uri}</p>
                  <p className={styles.code}>SHA-256 {manifest.sha256}</p>
                  <p>Atualizado em {dateTime(manifest.updated_at)}{manifest.last_blueprint_at ? ` · último blueprint em ${dateTime(manifest.last_blueprint_at)}` : ""}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// Tehkné Solutions

"use client";

import { useState } from "react";
import styles from "../../../social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const MAX_BYTES = 1024 * 1024;

type ApiError = { message?: string; error?: string };
type UploadSession = Readonly<{
  upload: {
    id: string;
    method: "POST";
    path: string;
    contentType: string;
    expiresAt: string;
    maxBytes: number;
  };
}>;

export type VerifiedManifest = Readonly<{
  uploadId: string;
  assetManifestUri: string;
  sha256: string;
  sizeBytes: number;
  verifiedByPlatform: boolean;
  alreadyVerified: boolean;
}>;

type VerifiedResult = Readonly<{ manifest: VerifiedManifest }>;
type VerifiedManifestUploadProps = Readonly<{
  embedded?: boolean;
  onVerified?: (manifest: VerifiedManifest) => void;
}>;

async function jsonApi<T>(path: string, init?: RequestInit): Promise<T> {
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
      // Mantém o status HTTP.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function VerifiedManifestUpload({ embedded = false, onVerified }: VerifiedManifestUploadProps = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifiedManifest | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (file.size < 2 || file.size > MAX_BYTES) throw new Error("O manifesto precisa ter entre 2 bytes e 1 MiB.");
      const bytes = await file.arrayBuffer();
      const hash = await sha256Hex(bytes);
      const session = await jsonApi<UploadSession>("/v1/ugc/assets/manifests/uploads", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, sha256: hash })
      });
      const response = await fetch(`${API_URL}${session.upload.path}`, {
        method: session.upload.method,
        headers: { "content-type": session.upload.contentType },
        body: bytes
      });
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
      const verified = await response.json() as VerifiedResult;
      setResult(verified.manifest);
      onVerified?.(verified.manifest);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível verificar o manifesto.");
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <div className={styles.sectionHeader}>
        <div>
          {embedded ? <h4 id="verified-upload-title">Manifesto verificado pela plataforma</h4> : <h3 id="verified-upload-title">Upload verificado de manifesto</h3>}
          <p>A plataforma calcula o SHA-256 no navegador, recebe o arquivo por sessão temporária assinada, grava no storage privado e relê os bytes antes de confirmar.</p>
        </div>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.panel}>
        <div className={styles.formRow}>
          <label htmlFor={embedded ? "ugc-verified-manifest-file-inline" : "ugc-verified-manifest-file"}>Manifesto JSON</label>
          <input
            id={embedded ? "ugc-verified-manifest-file-inline" : "ugc-verified-manifest-file"}
            className={styles.input}
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p>Máximo 1 MiB. A raiz do arquivo precisa ser um objeto JSON.</p>
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy || !file} onClick={() => void upload()}>
              {busy ? "Verificando bytes..." : embedded ? "Verificar e vincular" : "Enviar e verificar"}
            </button>
          </div>
        </div>
      </section>

      {result ? (
        <section className={styles.panel} aria-labelledby={embedded ? "verified-result-title-inline" : "verified-result-title"}>
          <h4 id={embedded ? "verified-result-title-inline" : "verified-result-title"}>Bytes confirmados pelo storage</h4>
          <p><span className={styles.pill}>Verificado pela plataforma</span> · {result.sizeBytes} bytes</p>
          <p className={styles.code}>Upload {result.uploadId}</p>
          <p className={styles.code}>SHA-256 {result.sha256}</p>
          <p className={styles.code}>{result.assetManifestUri}</p>
          <p>{embedded ? "URI, SHA-256 e vínculo verificado foram aplicados ao blueprint atual." : "Este resultado pode ser vinculado atomicamente a um blueprint pelo contrato verifiedUploadId."}</p>
        </section>
      ) : null}
    </>
  );

  if (embedded) {
    return <div aria-labelledby="verified-upload-title">{content}</div>;
  }
  return <section className={styles.detail} aria-labelledby="verified-upload-title">{content}</section>;
}

// Tehkné Solutions

"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";
import { useAuth } from "../auth-provider";
import styles from "./trust.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type DocumentView = Readonly<{
  id: string;
  key: string;
  version: string;
  title: string;
  audience: string;
  publicUrl: string | null;
  effectiveAt: string | null;
  acceptedAt?: string | null;
}>;

type Readiness = Readonly<{
  launchReady: boolean;
  publishedRequiredDocuments: number;
  requiredDocuments: number;
  approvedReviews: number;
  requiredReviews: number;
  openCriticalIncidents: number;
  pendingGuardianReviews: number;
  blockers: readonly string[];
}>;

type PublicState = Readonly<{
  readiness: Readiness;
  documents: readonly DocumentView[];
  reviews: readonly Readonly<{
    id: string;
    reviewType: string;
    reviewerName: string;
    reviewerOrganization: string | null;
    status: string;
    reportUrl: string | null;
    summary: string | null;
    validUntil: string | null;
  }>[];
  incidents: readonly Readonly<{
    id: string;
    incidentKey: string;
    severity: string;
    status: string;
    title: string;
    summary: string;
    publicNoticeUrl: string | null;
    detectedAt: string;
  }>[];
  notices: Readonly<{
    minimumAge: number;
    externalTransfersEnabled: boolean;
    investmentReturnsPromised: boolean;
    legalConclusionAutomated: boolean;
  }>;
}>;

type UserState = Readonly<{
  enforcementMode: "report-only" | "required";
  ageAssurance: Readonly<{
    ageBand: string;
    method: string;
    guardianStatus: string;
  }> | null;
  documents: readonly DocumentView[];
  documentsComplete: boolean;
  ageReady: boolean;
  mutableAccessReady: boolean;
}>;

function disabledLabel(value: boolean): string {
  return value ? "Habilitado" : "Desabilitado";
}

export default function TrustPage() {
  const { identity } = useAuth();
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [userState, setUserState] = useState<UserState | null>(null);
  const [ageBand, setAgeBand] = useState("18-plus");
  const [message, setMessage] = useState("Carregando a Central de Confiança…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const publicResponse = await fetch(`${API_URL}/v1/trust/public`, {
        cache: "no-store"
      });
      const nextPublic = await publicResponse.json() as PublicState & { message?: string };
      if (!publicResponse.ok) {
        throw new Error(nextPublic.message ?? "Central de Confiança indisponível.");
      }
      setPublicState(nextPublic);

      if (identity) {
        const userResponse = await fetch(`${API_URL}/v1/trust/state`, {
          cache: "no-store"
        });
        const nextUser = await userResponse.json() as UserState & { message?: string };
        if (!userResponse.ok) {
          throw new Error(nextUser.message ?? "Estado de confiança indisponível.");
        }
        setUserState(nextUser);
        if (nextUser.ageAssurance) setAgeBand(nextUser.ageAssurance.ageBand);
      } else {
        setUserState(null);
      }

      setMessage(nextPublic.readiness.launchReady
        ? "Os critérios registrados para abertura pública estão atendidos."
        : "O beta público permanece bloqueado enquanto existirem critérios pendentes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar dados.");
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  const progress = useMemo(() => {
    if (!publicState) return 0;
    const readiness = publicState.readiness;
    const total = readiness.requiredDocuments + readiness.requiredReviews + 1;
    const complete = readiness.publishedRequiredDocuments
      + readiness.approvedReviews
      + (readiness.openCriticalIncidents === 0 ? 1 : 0);
    return Math.round((complete / total) * 100);
  }, [publicState]);

  async function saveAge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/trust/age-assurance`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `age-${crypto.randomUUID()}`
        },
        body: JSON.stringify({ ageBand, method: "self-declaration" })
      });
      const payload = await response.json() as UserState & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Faixa etária não registrada.");
      setUserState(payload);
      setMessage(ageBand === "under-14"
        ? "A Nova Aurora não está disponível para menores de 14 anos."
        : ageBand === "18-plus"
          ? "Faixa etária registrada."
          : "Faixa etária registrada. A revisão do responsável é obrigatória.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar faixa etária.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptCurrentDocuments() {
    if (!userState?.documents.length) {
      setMessage("Ainda não existem versões publicadas para aceite.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/trust/acceptances`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `accept-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          documents: userState.documents.map((document) => ({
            key: document.key,
            version: document.version
          }))
        })
      });
      const payload = await response.json() as UserState & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Aceite não registrado.");
      setUserState(payload);
      setMessage("Aceites registrados com versão, sessão e data.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar aceites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · TRUST CENTER 0.15</p>
          <h1>Confiança antes da abertura pública.</h1>
          <p>
            Documentos, revisões externas, proteção etária e incidentes são
            apresentados sem transformar controles internos em conclusão jurídica automática.
          </p>
        </div>
        <nav aria-label="Navegação da Central de Confiança">
          <Link href="/">Início</Link>
          {identity ? <Link href="/account">Conta</Link> : <Link href="/login">Entrar</Link>}
          <button type="button" onClick={() => void load()} disabled={busy}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.metrics} aria-label="Prontidão registrada">
        <article><span>Prontidão documental</span><strong>{progress}%</strong></article>
        <article>
          <span>Documentos publicados</span>
          <strong>
            {publicState?.readiness.publishedRequiredDocuments ?? 0}/
            {publicState?.readiness.requiredDocuments ?? 0}
          </strong>
        </article>
        <article>
          <span>Revisões aprovadas</span>
          <strong>
            {publicState?.readiness.approvedReviews ?? 0}/
            {publicState?.readiness.requiredReviews ?? 0}
          </strong>
        </article>
        <article>
          <span>Incidentes críticos</span>
          <strong>{publicState?.readiness.openCriticalIncidents ?? 0}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <p className={styles.eyebrow}>NATUREZA DOS ATIVOS</p>
          <h2>Economia interna por padrão</h2>
          <ul>
            <li>Transferência externa: {disabledLabel(Boolean(publicState?.notices.externalTransfersEnabled))}</li>
            <li>Promessa de rendimento: {disabledLabel(Boolean(publicState?.notices.investmentReturnsPromised))}</li>
            <li>Conclusão jurídica automática: {disabledLabel(Boolean(publicState?.notices.legalConclusionAutomated))}</li>
            <li>Idade mínima definida: {publicState?.notices.minimumAge ?? 14} anos</li>
          </ul>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>ABERTURA PÚBLICA</p>
          <h2>{publicState?.readiness.launchReady ? "Critérios atendidos" : "Beta ainda bloqueado"}</h2>
          <ul>
            {publicState?.readiness.blockers.length
              ? publicState.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)
              : <li>Nenhum bloqueador registrado.</li>}
          </ul>
        </article>
      </section>

      <section className={styles.panel}>
        <p className={styles.eyebrow}>DOCUMENTOS VIGENTES</p>
        <h2>Versões publicadas e verificáveis</h2>
        <div className={styles.list}>
          {publicState?.documents.length
            ? publicState.documents.map((document) => (
              <div className={styles.item} id={document.key} key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <span>Versão {document.version}</span>
                </div>
                {document.publicUrl
                  ? <a href={document.publicUrl}>Abrir documento</a>
                  : <span>URL pendente</span>}
              </div>
            ))
            : <p>Nenhum documento foi publicado. Os rascunhos não são apresentados como políticas vigentes.</p>}
        </div>
      </section>

      {identity ? (
        <section className={styles.grid}>
          <article className={styles.panel}>
            <p className={styles.eyebrow}>FAIXA ETÁRIA</p>
            <h2>Proteção proporcional à idade</h2>
            <form onSubmit={saveAge} className={styles.form}>
              <label>
                Faixa etária
                <select
                  value={ageBand}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => setAgeBand(event.target.value)}
                >
                  <option value="under-14">Menor de 14 anos</option>
                  <option value="14-15">14 a 15 anos</option>
                  <option value="16-17">16 a 17 anos</option>
                  <option value="18-plus">18 anos ou mais</option>
                </select>
              </label>
              <button type="submit" disabled={busy}>Registrar declaração</button>
            </form>
            <p>Responsável: {userState?.ageAssurance?.guardianStatus ?? "não informado"}.</p>
          </article>

          <article className={styles.panel}>
            <p className={styles.eyebrow}>ACEITES</p>
            <h2>Documentos da versão atual</h2>
            <p>
              Completos: {userState?.documentsComplete ? "sim" : "não"} ·
              acesso mutável: {userState?.mutableAccessReady ? "liberado" : "pendente"}.
            </p>
            <button
              type="button"
              disabled={busy || !userState?.documents.length}
              onClick={() => void acceptCurrentDocuments()}
            >
              Aceitar versões vigentes
            </button>
          </article>
        </section>
      ) : null}

      <section className={styles.grid}>
        <article className={styles.panel}>
          <p className={styles.eyebrow}>REVISÕES EXTERNAS PUBLICADAS</p>
          <div className={styles.list}>
            {publicState?.reviews.length
              ? publicState.reviews.map((review) => (
                <div className={styles.item} key={review.id}>
                  <div>
                    <strong>{review.reviewType}</strong>
                    <span>{review.reviewerOrganization ?? review.reviewerName}</span>
                  </div>
                  <span>{review.status}</span>
                </div>
              ))
              : <p>Nenhuma revisão externa foi publicada.</p>}
          </div>
        </article>

        <article className={styles.panel}>
          <p className={styles.eyebrow}>INCIDENTES PÚBLICOS</p>
          <div className={styles.list}>
            {publicState?.incidents.length
              ? publicState.incidents.map((incident) => (
                <div className={styles.item} key={incident.id}>
                  <div>
                    <strong>{incident.incidentKey} · {incident.title}</strong>
                    <span>{incident.summary}</span>
                  </div>
                  <span>{incident.status}</span>
                </div>
              ))
              : <p>Nenhum incidente público registrado.</p>}
          </div>
        </article>
      </section>

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

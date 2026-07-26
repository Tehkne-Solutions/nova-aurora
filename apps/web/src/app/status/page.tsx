"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type StatusState = Readonly<{
  overall: string;
  components: readonly Readonly<{
    key: string;
    label: string;
    status: string;
    description: string | null;
    publicMessage: string | null;
    updatedAt: string;
  }>[];
  incidents: readonly Readonly<{
    incidentKey: string;
    severity: string;
    status: string;
    title: string;
    summary: string;
    detectedAt: string;
    updatedAt: string;
  }>[];
  updatedAt: string;
}>;

function stateClass(status: string): string {
  if (status === "operational" || status === "resolved" || status === "postmortem") {
    return styles.good ?? "";
  }
  if (status === "major-outage" || status === "critical") {
    return styles.bad ?? "";
  }
  return styles.warn ?? "";
}

export default function PublicStatusPage() {
  const [state, setState] = useState<StatusState | null>(null);
  const [message, setMessage] = useState("Consultando os componentes públicos…");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/status/public`, { cache: "no-store" });
      const payload = await response.json() as StatusState & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Status indisponível.");
      setState(payload);
      setMessage(payload.overall === "operational"
        ? "Todos os componentes publicados estão operacionais."
        : "Há degradação, manutenção ou indisponibilidade registrada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível obter o status.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const operational = useMemo(
    () => state?.components.filter((component) => component.status === "operational").length ?? 0,
    [state]
  );

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · STATUS PÚBLICO</p>
          <h1>Transparência operacional.</h1>
          <p>Estado dos serviços e incidentes publicados pela operação da Tehkné Solutions.</p>
        </div>
        <nav>
          <Link href="/" className={styles.link}>Início</Link>
          <Link href="/trust" className={styles.link}>Confiança</Link>
          <Link href="/report" className={styles.link}>Denunciar</Link>
          <button type="button" onClick={() => void load()}>Atualizar</button>
        </nav>
      </header>
      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <section className={styles.metrics}>
        <article className={styles.metric}><span>Estado geral</span><strong className={stateClass(state?.overall ?? "unknown")}>{state?.overall ?? "—"}</strong></article>
        <article className={styles.metric}><span>Operacionais</span><strong>{operational}/{state?.components.length ?? 0}</strong></article>
        <article className={styles.metric}><span>Incidentes públicos</span><strong>{state?.incidents.length ?? 0}</strong></article>
        <article className={styles.metric}><span>Atualizado</span><strong>{state ? new Date(state.updatedAt).toLocaleTimeString("pt-BR") : "—"}</strong></article>
      </section>
      <section className={styles.section}>
        <p className={styles.eyebrow}>COMPONENTES</p><h2>Serviços monitorados</h2>
        <div className={styles.list}>{state?.components.map((component) => <div className={styles.item} key={component.key}><div><strong>{component.label}</strong><span>{component.publicMessage ?? component.description ?? "Sem observação pública."}</span></div><span className={`${styles.tag} ${stateClass(component.status)}`}>{component.status}</span></div>)}</div>
      </section>
      <section className={styles.section}>
        <p className={styles.eyebrow}>INCIDENTES</p><h2>Comunicações públicas</h2>
        <div className={styles.list}>{state?.incidents.length ? state.incidents.map((incident) => <div className={styles.item} key={incident.incidentKey}><div><strong>{incident.incidentKey} · {incident.title}</strong><span>{incident.summary}</span><span>Detectado em {new Date(incident.detectedAt).toLocaleString("pt-BR")}</span></div><span className={`${styles.tag} ${stateClass(incident.severity)}`}>{incident.status}</span></div>) : <p>Nenhum incidente público registrado.</p>}</div>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

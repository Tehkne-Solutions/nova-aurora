"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function ReportPage() {
  const [category, setCategory] = useState("other");
  const [subjectType, setSubjectType] = useState("other");
  const [subjectReference, setSubjectReference] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("O canal pode ser usado sem login.");
  const [busy, setBusy] = useState(false);
  const [protocol, setProtocol] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProtocol("");
    try {
      const response = await fetch(`${API_URL}/v1/trust/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `report-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          category,
          subjectType,
          ...(subjectReference.trim() ? { subjectReference: subjectReference.trim() } : {}),
          summary,
          details
        })
      });
      const payload = await response.json() as { reportKey?: string; message?: string };
      if (!response.ok || !payload.reportKey) {
        throw new Error(payload.message ?? "Denúncia não registrada.");
      }
      setProtocol(payload.reportKey);
      setSummary("");
      setDetails("");
      setSubjectReference("");
      setMessage("Denúncia registrada. Guarde o protocolo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar denúncia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · CANAL DE DENÚNCIAS</p>
          <h1>Segurança precisa de voz.</h1>
          <p>Relate abuso, fraude, risco a adolescentes, privacidade, segurança ou conteúdo impróprio.</p>
        </div>
        <nav>
          <Link href="/" className={styles.link}>Início</Link>
          <Link href="/status" className={styles.link}>Status</Link>
          <Link href="/trust" className={styles.link}>Confiança</Link>
        </nav>
      </header>
      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>ENVIO</p><h2>Descreva o ocorrido</h2>
          <form className={styles.form} onSubmit={submit}>
            <label>Categoria<select className={styles.select} value={category} onChange={(event) => setCategory(event.target.value)}><option value="minor-safety">Proteção de adolescente</option><option value="harassment">Assédio</option><option value="fraud">Fraude</option><option value="security">Segurança</option><option value="privacy">Privacidade</option><option value="content">Conteúdo</option><option value="abuse">Abuso</option><option value="other">Outro</option></select></label>
            <label>Objeto<select className={styles.select} value={subjectType} onChange={(event) => setSubjectType(event.target.value)}><option value="user">Usuário</option><option value="company">Empresa</option><option value="listing">Oferta</option><option value="message">Mensagem</option><option value="event">Evento</option><option value="system">Sistema</option><option value="other">Outro</option></select></label>
            <label>Referência opcional<input className={styles.input} value={subjectReference} onChange={(event) => setSubjectReference(event.target.value)} maxLength={240}/></label>
            <label>Resumo<input className={styles.input} value={summary} onChange={(event) => setSummary(event.target.value)} minLength={8} maxLength={500} required/></label>
            <label>Detalhes<textarea className={styles.textarea} value={details} onChange={(event) => setDetails(event.target.value)} minLength={16} maxLength={8000} required/></label>
            <button className={styles.button} disabled={busy} type="submit">Registrar denúncia</button>
          </form>
        </article>
        <article className={styles.section}>
          <p className={styles.eyebrow}>ORIENTAÇÃO</p><h2>Risco imediato</h2>
          <p>Este canal não substitui serviços públicos de emergência. Em risco imediato, procure as autoridades e responsáveis apropriados.</p>
          <ul><li>Não publique dados sensíveis desnecessários.</li><li>Preserve evidências sem compartilhar senhas.</li><li>Relatos de adolescentes recebem prioridade elevada.</li></ul>
          {protocol ? <><h3>Protocolo</h3><p className={styles.code}>{protocol}</p></> : null}
        </article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

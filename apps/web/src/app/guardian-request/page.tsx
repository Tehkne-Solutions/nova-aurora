"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function GuardianRequestPage() {
  const [guardianEmail, setGuardianEmail] = useState("");
  const [relationship, setRelationship] = useState("responsável legal");
  const [message, setMessage] = useState("Informe o e-mail do responsável para enviar uma autorização de uso único.");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/trust/guardian/request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `guardian-${crypto.randomUUID()}`
        },
        body: JSON.stringify({ guardianEmail, relationship })
      });
      const payload = await response.json() as { message?: string; deliveryAccepted?: boolean };
      if (!response.ok) throw new Error(payload.message ?? "Solicitação não enviada.");
      setMessage("Solicitação enviada. O link expira em sete dias e só pode ser usado uma vez.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao enviar solicitação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · AUTORIZAÇÃO</p>
          <h1>Convide seu responsável.</h1>
          <p>Disponível para usuários de 14 a 17 anos após a declaração da faixa etária.</p>
        </div>
        <nav>
          <Link href="/trust" className={styles.link}>Confiança</Link>
          <Link href="/account" className={styles.link}>Conta</Link>
        </nav>
      </header>
      <p className={styles.message} role="status">{message}</p>
      <section className={styles.grid}>
        <article className={styles.section}>
          <form className={styles.form} onSubmit={submit}>
            <label>E-mail do responsável<input className={styles.input} type="email" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} maxLength={254} required/></label>
            <label>Relação<input className={styles.input} value={relationship} onChange={(event) => setRelationship(event.target.value)} minLength={3} maxLength={80} required/></label>
            <button className={styles.button} disabled={busy}>Enviar solicitação</button>
          </form>
        </article>
        <article className={styles.section}>
          <h2>Como funciona</h2>
          <ol><li>O responsável recebe um link de uso único.</li><li>Ele revisa a declaração e decide.</li><li>O sistema registra somente evidências técnicas necessárias.</li><li>O acesso econômico permanece bloqueado até aprovação.</li></ol>
        </article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

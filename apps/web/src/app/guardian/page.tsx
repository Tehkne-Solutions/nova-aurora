"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function GuardianPage() {
  const search = useSearchParams();
  const [token, setToken] = useState(search.get("token") ?? "");
  const [guardianName, setGuardianName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("Revise a declaração antes de decidir.");
  const [busy, setBusy] = useState(false);

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision: "approved" | "rejected" = submitter?.value === "rejected"
      ? "rejected"
      : "approved";
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/trust/guardian/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, decision, guardianName, statementAccepted: accepted })
      });
      const payload = await response.json() as { status?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Decisão não registrada.");
      setMessage(decision === "approved"
        ? "Autorização registrada."
        : "Participação recusada e registrada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar decisão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · RESPONSÁVEL</p>
          <h1>Autorização verificável.</h1>
          <p>Este fluxo confirma a posse do e-mail do responsável e registra uma decisão de participação.</p>
        </div>
        <nav>
          <Link href="/trust" className={styles.link}>Central de Confiança</Link>
          <Link href="/report" className={styles.link}>Denunciar</Link>
        </nav>
      </header>
      <p className={styles.message} role="status">{message}</p>
      <section className={styles.grid}>
        <article className={styles.section}>
          <h2>Declaração</h2>
          <p>Confirmo que sou responsável pelo adolescente e compreendo que a Nova Aurora opera com ativos internos de jogo, sem saque, promessa de investimento ou transferência externa nesta fase.</p>
          <form className={styles.form} onSubmit={decide}>
            <label>Token<input className={styles.input} value={token} onChange={(event) => setToken(event.target.value)} minLength={32} required/></label>
            <label>Nome do responsável<input className={styles.input} value={guardianName} onChange={(event) => setGuardianName(event.target.value)} minLength={3} maxLength={120} required/></label>
            <label><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required/> Li e confirmo a declaração de responsabilidade.</label>
            <div className={styles.actions}>
              <button className={styles.button} type="submit" value="approved" disabled={busy || !accepted}>Autorizar</button>
              <button className={styles.button} type="submit" value="rejected" disabled={busy || !accepted}>Recusar</button>
            </div>
          </form>
        </article>
        <article className={styles.section}>
          <h2>Privacidade</h2>
          <p>O sistema armazena o hash do e-mail usado no convite, a decisão, horário e hashes técnicos para auditoria. O nome informado é armazenado somente como hash. Não são ativados saques ou investimentos.</p>
        </article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

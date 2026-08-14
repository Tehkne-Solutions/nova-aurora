"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AppealPage() {
  const [actionId, setActionId] = useState("");
  const [statement, setStatement] = useState("");
  const [message, setMessage] = useState("Informe a ação recebida e apresente sua justificativa.");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/moderation/actions/${actionId}/appeals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement })
      });
      const payload = await response.json() as { appealKey?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Recurso não registrado.");
      setMessage(`Recurso ${payload.appealKey ?? ""} registrado para revisão.`);
      setStatement("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao registrar recurso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · RECURSO</p>
          <h1>Revisão humana de decisões.</h1>
          <p>Uma pessoa diferente revisa a justificativa e registra a decisão auditável.</p>
        </div>
        <nav>
          <Link href="/community/social" className={styles.link}>Hub Social</Link>
          <Link href="/account" className={styles.link}>Conta</Link>
          <Link href="/trust" className={styles.link}>Confiança</Link>
          <Link href="/report" className={styles.link}>Denunciar</Link>
        </nav>
      </header>
      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>CREATOR ECONOMY</p>
          <h2>Conteúdo, comentários, mensagens e canais</h2>
          <p>
            Restrições da Creator Economy agora aparecem automaticamente no Hub Social, em
            <strong> Segurança</strong>. Lá o caso já vem ligado ao relatório correto, sem copiar IDs manualmente,
            e o status da apelação fica visível até a decisão.
          </p>
          <div className={styles.actions}>
            <Link href="/community/social" className={styles.link}>Abrir Segurança do Hub Social</Link>
          </div>
        </article>
        <article className={styles.section}>
          <p className={styles.eyebrow}>AÇÕES LEGADAS DA PLATAFORMA</p>
          <h2>Apresente sua justificativa</h2>
          <p>Use este formulário somente quando a decisão recebida informar explicitamente um ID de ação de moderação legado.</p>
          <form className={styles.form} onSubmit={submit}>
            <label>ID da ação<input className={styles.input} value={actionId} onChange={(event) => setActionId(event.target.value)} required/></label>
            <label>Justificativa<textarea className={styles.textarea} value={statement} onChange={(event) => setStatement(event.target.value)} minLength={16} maxLength={8000} required/></label>
            <button className={styles.button} type="submit" disabled={busy}>Enviar para revisão</button>
          </form>
        </article>
        <article className={styles.section}>
          <p className={styles.eyebrow}>GARANTIAS</p>
          <h2>Trilha de decisão</h2>
          <ul>
            <li>A revisão fica vinculada à decisão original.</li>
            <li>A decisão registra revisor, horário e fundamentação.</li>
            <li>Na Creator Economy, o moderador original e o apelante não podem julgar a própria apelação.</li>
          </ul>
        </article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState,type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function FeedbackPage() {
  const [category,setCategory] = useState("usability");
  const [sentiment,setSentiment] = useState("neutral");
  const [score,setScore] = useState(3);
  const [summary,setSummary] = useState("");
  const [details,setDetails] = useState("");
  const [message,setMessage] = useState("Compartilhe uma experiência concreta do beta.");
  const [busy,setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `feedback-${crypto.randomUUID()}`
        },
        body: JSON.stringify({ category,sentiment,score,summary,details })
      });
      const payload = await response.json() as { feedbackKey?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Feedback não enviado.");
      setSummary("");
      setDetails("");
      setMessage(`Feedback ${payload.feedbackKey ?? ""} registrado com segurança.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao enviar feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · FEEDBACK</p>
          <h1>Conte o que funcionou e o que precisa mudar.</h1>
          <p>
            Detalhes ficam criptografados em repouso. Feedback de segurança
            recebe prioridade proporcional ao risco.
          </p>
        </div>
        <nav>
          <Link href="/community">Comunicados</Link>
          <Link href="/beta-control">Meu beta</Link>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.section}>
        <form className={styles.form} onSubmit={submit}>
          <label>
            Categoria
            <select
              className={styles.select}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="bug">Bug</option>
              <option value="usability">Usabilidade</option>
              <option value="economy">Economia</option>
              <option value="performance">Desempenho</option>
              <option value="safety">Segurança</option>
              <option value="content">Conteúdo</option>
              <option value="suggestion">Sugestão</option>
              <option value="other">Outro</option>
            </select>
          </label>

          <label>
            Percepção
            <select
              className={styles.select}
              value={sentiment}
              onChange={(event) => setSentiment(event.target.value)}
            >
              <option value="negative">Negativa</option>
              <option value="neutral">Neutra</option>
              <option value="positive">Positiva</option>
            </select>
          </label>

          <label>
            Nota de 1 a 5
            <input
              className={styles.input}
              type="number"
              min={1}
              max={5}
              value={score}
              onChange={(event) => setScore(Number(event.target.value))}
            />
          </label>

          <label>
            Resumo
            <input
              className={styles.input}
              minLength={3}
              maxLength={500}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              required
            />
          </label>

          <label>
            Detalhes
            <textarea
              className={styles.textarea}
              minLength={10}
              maxLength={8000}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              required
            />
          </label>

          <button className={styles.button} disabled={busy}>Enviar feedback</button>
        </form>
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

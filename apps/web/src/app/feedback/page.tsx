"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type UserState = Readonly<{
  feedback: readonly Readonly<{
    feedbackKey: string;
    category: string;
    rating: number;
    summary: string;
    status: string;
    createdAt: string;
  }>[];
  tickets: readonly Readonly<{
    id: string;
    ticketKey: string;
    category: string;
    priority: string;
    subject: string;
    status: string;
    firstResponseDueAt: string;
    updates: readonly Readonly<{ id: string; message: string; status: string; createdAt: string }>[];
  }>[];
}>;

export default function FeedbackPage() {
  const { identity } = useAuth();
  const [state, setState] = useState<UserState | null>(null);
  const [message, setMessage] = useState("Carregando feedback e suporte…");
  const [busy, setBusy] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("gameplay");
  const [rating, setRating] = useState(4);
  const [feedbackSummary, setFeedbackSummary] = useState("");
  const [feedbackDetails, setFeedbackDetails] = useState("");
  const [supportCategory, setSupportCategory] = useState("technical");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [supportDetails, setSupportDetails] = useState("");

  async function load(): Promise<void> {
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/me`, { cache: "no-store" });
      const payload = await response.json() as UserState & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Dados indisponíveis.");
      setState(payload);
      setMessage("Feedback e suporte atualizados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar dados.");
    }
  }

  useEffect(() => {
    void load();
    void fetch(`${API_URL}/v1/beta-insights/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `feedback-view-${crypto.randomUUID()}`
      },
      body: JSON.stringify({
        events: [{
          clientEventId: crypto.randomUUID(),
          eventKey: "session.started",
          occurredAt: new Date().toISOString(),
          route: "/feedback",
          properties: { surface: "feedback-center" }
        }]
      })
    }).catch(() => undefined);
  }, []);

  async function submitFeedback(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `feedback-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          category: feedbackCategory,
          rating,
          summary: feedbackSummary,
          details: feedbackDetails
        })
      });
      const payload = await response.json() as { feedbackKey?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Feedback não enviado.");
      setFeedbackSummary("");
      setFeedbackDetails("");
      setMessage(`Feedback ${payload.feedbackKey ?? ""} registrado.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao enviar feedback.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSupport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/support`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `support-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          category: supportCategory,
          priority,
          subject,
          details: supportDetails
        })
      });
      const payload = await response.json() as { ticketKey?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Ticket não criado.");
      setSubject("");
      setSupportDetails("");
      setMessage(`Ticket ${payload.ticketKey ?? ""} criado.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao abrir suporte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · BETA FEEDBACK</p>
          <h1>Sua experiência melhora a cidade.</h1>
          <p>
            Feedback de produto e suporte são separados. Detalhes livres ficam
            criptografados no banco e a telemetria não aceita campos pessoais.
          </p>
        </div>
        <nav>
          <Link href="/game">Jogo</Link>
          <Link href="/account">Conta</Link>
          <button type="button" onClick={() => void load()} disabled={busy}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">
        {identity ? message : "Autenticação necessária."}
      </p>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>FEEDBACK DE PRODUTO</p>
          <h2>O que devemos melhorar?</h2>
          <form className={styles.form} onSubmit={submitFeedback}>
            <label>
              Categoria
              <select className={styles.select} value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value)}>
                <option value="gameplay">Gameplay</option>
                <option value="economy">Economia</option>
                <option value="usability">Usabilidade</option>
                <option value="performance">Desempenho</option>
                <option value="accessibility">Acessibilidade</option>
                <option value="trust">Confiança</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label>
              Nota
              <select className={styles.select} value={rating} onChange={(event) => setRating(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Resumo
              <input className={styles.input} value={feedbackSummary} onChange={(event) => setFeedbackSummary(event.target.value)} minLength={3} maxLength={500} required />
            </label>
            <label>
              Detalhes
              <textarea className={styles.textarea} value={feedbackDetails} onChange={(event) => setFeedbackDetails(event.target.value)} minLength={8} maxLength={8000} required />
            </label>
            <button className={styles.button} type="submit" disabled={busy}>Enviar feedback</button>
          </form>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>SUPORTE</p>
          <h2>Precisa de atendimento?</h2>
          <form className={styles.form} onSubmit={submitSupport}>
            <label>
              Categoria
              <select className={styles.select} value={supportCategory} onChange={(event) => setSupportCategory(event.target.value)}>
                <option value="account">Conta</option>
                <option value="billing-internal">Créditos internos</option>
                <option value="gameplay">Gameplay</option>
                <option value="economy">Economia</option>
                <option value="technical">Técnico</option>
                <option value="safety">Segurança</option>
                <option value="privacy">Privacidade</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label>
              Prioridade
              <select className={styles.select} value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </label>
            <label>
              Assunto
              <input className={styles.input} value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={240} required />
            </label>
            <label>
              Descrição
              <textarea className={styles.textarea} value={supportDetails} onChange={(event) => setSupportDetails(event.target.value)} minLength={8} maxLength={8000} required />
            </label>
            <button className={styles.button} type="submit" disabled={busy}>Abrir ticket</button>
          </form>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>MEUS FEEDBACKS</p>
          <div className={styles.list}>
            {state?.feedback.length
              ? state.feedback.map((item) => (
                <div className={styles.item} key={item.feedbackKey}>
                  <div><strong>{item.feedbackKey} · {item.summary}</strong><span>{item.category} · nota {item.rating}</span></div>
                  <span>{item.status}</span>
                </div>
              ))
              : <p>Nenhum feedback registrado.</p>}
          </div>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>MEUS TICKETS</p>
          <div className={styles.list}>
            {state?.tickets.length
              ? state.tickets.map((ticket) => (
                <div className={styles.item} key={ticket.id}>
                  <div>
                    <strong>{ticket.ticketKey} · {ticket.subject}</strong>
                    <span>{ticket.priority} · resposta até {new Date(ticket.firstResponseDueAt).toLocaleString("pt-BR")}</span>
                  </div>
                  <span>{ticket.status}</span>
                </div>
              ))
              : <p>Nenhum ticket registrado.</p>}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

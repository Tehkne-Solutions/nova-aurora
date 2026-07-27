"use client";

import Link from "next/link";
import { useCallback,useEffect,useState,type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type SupportUpdate = Readonly<{
  id: string;
  status: string;
  message: string;
  createdAt: string;
}>;

type SupportTicket = Readonly<{
  id: string;
  ticketKey: string;
  category: string;
  priority: string;
  subject: string;
  status: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  createdAt: string;
  updates: readonly SupportUpdate[];
}>;

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR",{
    dateStyle: "short",timeStyle: "short"
  }).format(new Date(value));
}

export default function FeedbackPage() {
  const [category,setCategory] = useState("usability");
  const [sentiment,setSentiment] = useState("neutral");
  const [score,setScore] = useState(3);
  const [summary,setSummary] = useState("");
  const [details,setDetails] = useState("");
  const [supportCategory,setSupportCategory] = useState("technical");
  const [supportPriority,setSupportPriority] = useState("normal");
  const [supportSubject,setSupportSubject] = useState("");
  const [supportDetails,setSupportDetails] = useState("");
  const [tickets,setTickets] = useState<readonly SupportTicket[]>([]);
  const [message,setMessage] = useState("Compartilhe uma experiência ou abra um atendimento.");
  const [busy,setBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/beta-support/tickets`,{
        cache: "no-store"
      });
      const payload = await response.json() as {
        tickets?: readonly SupportTicket[];
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "Atendimentos indisponíveis.");
      setTickets(payload.tickets ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar atendimentos.");
    }
  },[]);

  useEffect(() => { void loadTickets(); },[loadTickets]);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
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

  async function submitSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-support/tickets`,{
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `support-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          category: supportCategory,
          priority: supportPriority,
          subject: supportSubject,
          details: supportDetails
        })
      });
      const payload = await response.json() as {
        ticket?: SupportTicket;
        message?: string;
      };
      if (!response.ok || !payload.ticket) {
        throw new Error(payload.message ?? "Atendimento não aberto.");
      }
      setSupportSubject("");
      setSupportDetails("");
      setMessage(`Atendimento ${payload.ticket.ticketKey} aberto. Acompanhe o histórico abaixo.`);
      await loadTickets();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao abrir atendimento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · ESCUTA E SUPORTE</p>
          <h1>Feedback para aprender. Suporte para resolver.</h1>
          <p>
            Feedback alimenta o aprendizado do beta. Tickets possuem prioridade,
            prazos de primeira resposta e histórico público. Os detalhes ficam
            criptografados em repouso.
          </p>
        </div>
        <nav>
          <Link href="/community">Comunicados</Link>
          <Link href="/beta-control">Meu beta</Link>
          <button type="button" onClick={() => void loadTickets()} disabled={busy}>
            Atualizar atendimentos
          </button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>FEEDBACK DO PRODUTO</p>
          <h2>Conte o que funcionou e o que precisa mudar</h2>
          <form className={styles.form} onSubmit={submitFeedback}>
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
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>ATENDIMENTO</p>
          <h2>Abra um ticket com SLA explícito</h2>
          <form className={styles.form} onSubmit={submitSupport}>
            <label>
              Categoria
              <select
                className={styles.select}
                value={supportCategory}
                onChange={(event) => setSupportCategory(event.target.value)}
              >
                <option value="account">Conta</option>
                <option value="technical">Problema técnico</option>
                <option value="gameplay">Gameplay</option>
                <option value="economy">Economia</option>
                <option value="safety">Segurança</option>
                <option value="privacy">Privacidade</option>
                <option value="other">Outro</option>
              </select>
            </label>

            <label>
              Prioridade percebida
              <select
                className={styles.select}
                value={supportPriority}
                onChange={(event) => setSupportPriority(event.target.value)}
              >
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </label>

            <label>
              Assunto
              <input
                className={styles.input}
                minLength={3}
                maxLength={240}
                value={supportSubject}
                onChange={(event) => setSupportSubject(event.target.value)}
                required
              />
            </label>

            <label>
              O que aconteceu?
              <textarea
                className={styles.textarea}
                minLength={10}
                maxLength={12000}
                value={supportDetails}
                onChange={(event) => setSupportDetails(event.target.value)}
                required
              />
            </label>

            <button className={styles.button} disabled={busy}>Abrir atendimento</button>
          </form>
        </article>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>MEUS ATENDIMENTOS</p>
        <h2>Histórico e respostas da equipe</h2>
        <div className={styles.list}>
          {tickets.length ? tickets.map((ticket) => (
            <article className={styles.item} key={ticket.id}>
              <div>
                <strong>{ticket.ticketKey} · {ticket.subject}</strong>
                <span>
                  {ticket.category} · {ticket.priority} · {ticket.status}
                </span>
                <span>
                  Primeira resposta até {dateTime(ticket.firstResponseDueAt)} · resolução até {dateTime(ticket.resolutionDueAt)}
                </span>
                {ticket.updates.length ? ticket.updates.map((update) => (
                  <span key={update.id}>
                    {dateTime(update.createdAt)} · {update.status}: {update.message}
                  </span>
                )) : <span>Aguardando a primeira atualização da equipe.</span>}
              </div>
              <span className={styles.tag}>{dateTime(ticket.createdAt)}</span>
            </article>
          )) : <p>Nenhum atendimento aberto.</p>}
        </div>
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

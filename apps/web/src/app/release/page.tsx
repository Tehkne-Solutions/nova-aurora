"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "./release.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Summary = Readonly<{
  registrationMode: "open" | "invite-only" | "closed";
  transactionalProviderConfigured: boolean;
  launchReady: boolean;
  users: Readonly<{ total: number; activeBeta: number; pendingVerification: number; suspended: number }>;
  email: Readonly<{ queued: number; failed: number; dead: number; sent: number }>;
  integrity: Readonly<{ openFraudEvents: number; restrictedUsers: number }>;
  gates: Readonly<{ passing: number; pending: number; blocked: number; waived: number }>;
}>;

type Gate = Readonly<{
  key: string;
  label: string;
  status: "pending" | "passing" | "blocked" | "waived";
  evidence: unknown;
  notes: string | null;
  checkedAt: string | null;
  updatedAt: string;
}>;

type Invite = Readonly<{
  id: string;
  label: string;
  emailPattern: string | null;
  maxUses: number;
  useCount: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}>;

type Email = Readonly<{
  id: string;
  recipient: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}>;

type State = Readonly<{
  summary: Summary;
  gates: readonly Gate[];
  invites: readonly Invite[];
  emails: readonly Email[];
}>;

function statusClass(status: string): string {
  if (["passing", "sent", "active"].includes(status)) return styles.good;
  if (["blocked", "dead", "suspended", "revoked"].includes(status)) return styles.bad;
  return styles.warn;
}

export default function ReleasePage() {
  const { identity } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("Carregando gates do release candidate…");
  const [busy, setBusy] = useState(false);
  const [inviteLabel, setInviteLabel] = useState("Beta fechado");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUses, setInviteUses] = useState(1);
  const [inviteExpiry, setInviteExpiry] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [gateNotes, setGateNotes] = useState<Record<string, string>>({});

  const isAdmin = identity?.roles.includes("platform-admin") || identity?.roles.includes("municipal-admin");
  const isPlatformAdmin = identity?.roles.includes("platform-admin") ?? false;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/release/state`, { cache: "no-store" });
      const payload = await response.json() as State & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Central de release indisponível.");
      setState(payload);
      setMessage(payload.summary.launchReady
        ? "Todos os gates técnicos registrados estão liberados."
        : "Release candidate controlado: gates pendentes ou bloqueados impedem a abertura pública.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar a central.");
    }
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const readiness = useMemo(() => {
    if (!state) return 0;
    const total = state.summary.gates.passing + state.summary.gates.pending
      + state.summary.gates.blocked + state.summary.gates.waived;
    return total ? Math.round(((state.summary.gates.passing + state.summary.gates.waived) / total) * 100) : 0;
  }, [state]);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setGeneratedCode("");
    try {
      const response = await fetch(`${API_URL}/v1/release/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: inviteLabel,
          maxUses: inviteUses,
          ...(inviteEmail.trim() ? { emailPattern: inviteEmail.trim() } : {}),
          ...(inviteExpiry ? { expiresAt: new Date(inviteExpiry).toISOString() } : {})
        })
      });
      const payload = await response.json() as { code?: string; message?: string };
      if (!response.ok || !payload.code) throw new Error(payload.message ?? "Convite não pôde ser criado.");
      setGeneratedCode(payload.code);
      setMessage("Convite criado. O código abaixo não será exibido novamente.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar convite.");
    } finally {
      setBusy(false);
    }
  }

  async function updateGate(gate: Gate, status: Gate["status"]) {
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/release/gates/${encodeURIComponent(gate.key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          notes: gateNotes[gate.key] ?? gate.notes ?? "",
          evidence: {
            updatedFrom: "release-center",
            previousStatus: gate.status,
            checkedAt: new Date().toISOString()
          }
        })
      });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "Gate não pôde ser atualizado.");
      }
      setMessage(`Gate “${gate.label}” atualizado para ${status}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar gate.");
    } finally {
      setBusy(false);
    }
  }

  async function retryEmail(emailId: string) {
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/release/emails/${emailId}/retry`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "Entrega não pôde ser reenfileirada.");
      }
      setMessage("Mensagem reenfileirada para nova tentativa.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao reenfileirar mensagem.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className={styles.shell}>
        <section className={styles.panel}>
          <p className={styles.eyebrow}>NOVA AURORA · RELEASE CANDIDATE</p>
          <h1>Acesso administrativo necessário</h1>
          <p>Esta central controla convites, entrega transacional e gates de abertura pública.</p>
          <Link href="/account" className={styles.primary}>Voltar à conta</Link>
        </section>
        <footer className={styles.footer}>Tehkné Solutions</footer>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · RELEASE CANDIDATE 0.14</p>
          <h1>Centro de abertura do beta</h1>
          <p>Convites, e-mail transacional, integridade e evidências de lançamento em uma única operação.</p>
        </div>
        <nav aria-label="Navegação da operação">
          <Link href="/account">Conta</Link>
          <Link href="/integrity">Integridade</Link>
          <Link href="/dashboard">Economia</Link>
          <button type="button" className={styles.primary} onClick={() => void load()} disabled={busy}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.metrics} aria-label="Indicadores do release">
        <article className={styles.metric}><span>Prontidão</span><strong className={state?.summary.launchReady ? styles.good : styles.warn}>{readiness}%</strong></article>
        <article className={styles.metric}><span>Beta ativo</span><strong>{state?.summary.users.activeBeta ?? 0}</strong></article>
        <article className={styles.metric}><span>Aguardando e-mail</span><strong>{state?.summary.users.pendingVerification ?? 0}</strong></article>
        <article className={styles.metric}><span>E-mails mortos</span><strong className={(state?.summary.email.dead ?? 0) ? styles.bad : styles.good}>{state?.summary.email.dead ?? 0}</strong></article>
        <article className={styles.metric}><span>Fraudes abertas</span><strong className={(state?.summary.integrity.openFraudEvents ?? 0) ? styles.bad : styles.good}>{state?.summary.integrity.openFraudEvents ?? 0}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Estado de lançamento</h2>
          <div className={styles.list}>
            <div className={styles.item}><div><strong>Cadastro</strong><span>Modo aplicado ao ambiente</span></div><small className={styles.warn}>{state?.summary.registrationMode ?? "—"}</small></div>
            <div className={styles.item}><div><strong>Provedor transacional</strong><span>Endpoint e remetente configurados</span></div><small className={state?.summary.transactionalProviderConfigured ? styles.good : styles.bad}>{state?.summary.transactionalProviderConfigured ? "Configurado" : "Ausente"}</small></div>
            <div className={styles.item}><div><strong>Abertura pública</strong><span>Depende de gates, integridade e fila</span></div><small className={state?.summary.launchReady ? styles.good : styles.bad}>{state?.summary.launchReady ? "Liberada" : "Bloqueada"}</small></div>
          </div>
          <div className={styles.tags}>
            <span className={styles.tag}>{state?.summary.gates.passing ?? 0} passando</span>
            <span className={styles.tag}>{state?.summary.gates.pending ?? 0} pendentes</span>
            <span className={styles.tag}>{state?.summary.gates.blocked ?? 0} bloqueados</span>
            <span className={styles.tag}>{state?.summary.gates.waived ?? 0} dispensados</span>
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Novo convite</h2>
          <form className={styles.form} onSubmit={createInvite}>
            <label>Identificação<input className={styles.input} value={inviteLabel} onChange={(event) => setInviteLabel(event.target.value)} minLength={3} maxLength={160} required /></label>
            <label>E-mail ou domínio opcional<input className={styles.input} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="pessoa@empresa.com ou *@empresa.com" /></label>
            <label>Quantidade de usos<input className={styles.input} type="number" value={inviteUses} onChange={(event) => setInviteUses(Number(event.target.value))} min={1} max={10000} required /></label>
            <label>Expiração opcional<input className={styles.input} type="datetime-local" value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)} /></label>
            <button className={styles.primary} type="submit" disabled={busy || !isPlatformAdmin}>Gerar convite controlado</button>
          </form>
          {!isPlatformAdmin ? <p>Somente administradores da plataforma podem emitir convites.</p> : null}
          {generatedCode ? <div><h3>Código de exibição única</h3><p className={styles.code}>{generatedCode}</p></div> : null}
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Gates obrigatórios</h2>
        <div className={styles.list}>
          {state?.gates.map((gate) => (
            <div className={styles.item} key={gate.key}>
              <div>
                <strong>{gate.label}</strong>
                <span>{gate.key}</span>
                <small className={statusClass(gate.status)}>{gate.status}</small>
                {gate.checkedAt ? <small>Verificado em {new Date(gate.checkedAt).toLocaleString("pt-BR")}</small> : null}
              </div>
              <div className={styles.form}>
                <label>
                  Evidência ou observação
                  <textarea className={styles.textarea} value={gateNotes[gate.key] ?? gate.notes ?? ""} onChange={(event) => setGateNotes((current) => ({ ...current, [gate.key]: event.target.value }))} />
                </label>
                <div className={styles.actions}>
                  <button type="button" onClick={() => void updateGate(gate, "passing")} disabled={busy || !isPlatformAdmin}>Passando</button>
                  <button type="button" onClick={() => void updateGate(gate, "pending")} disabled={busy || !isPlatformAdmin}>Pendente</button>
                  <button type="button" className={styles.danger} onClick={() => void updateGate(gate, "blocked")} disabled={busy || !isPlatformAdmin}>Bloquear</button>
                  <button type="button" onClick={() => void updateGate(gate, "waived")} disabled={busy || !isPlatformAdmin}>Dispensar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Convites emitidos</h2>
          <div className={styles.list}>
            {state?.invites.map((invite) => (
              <div className={styles.item} key={invite.id}>
                <div><strong>{invite.label}</strong><span>{invite.emailPattern ?? "Qualquer e-mail"}</span><small>{invite.useCount}/{invite.maxUses} usos</small></div>
                <small className={statusClass(invite.status)}>{invite.status}</small>
              </div>
            ))}
            {!state?.invites.length ? <p>Nenhum convite emitido.</p> : null}
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Fila transacional</h2>
          <div className={styles.tags}>
            <span className={styles.tag}>{state?.summary.email.queued ?? 0} aguardando</span>
            <span className={styles.tag}>{state?.summary.email.failed ?? 0} falharam</span>
            <span className={styles.tag}>{state?.summary.email.dead ?? 0} dead-letter</span>
            <span className={styles.tag}>{state?.summary.email.sent ?? 0} enviadas</span>
          </div>
          <div className={styles.list}>
            {state?.emails.slice(0, 30).map((email) => (
              <div className={styles.item} key={email.id}>
                <div><strong>{email.subject}</strong><span>{email.recipient}</span><small>{email.template} · {email.attempts} tentativa(s)</small>{email.lastError ? <small className={styles.bad}>{email.lastError}</small> : null}</div>
                <div><small className={statusClass(email.status)}>{email.status}</small>{["failed", "dead"].includes(email.status) ? <button type="button" onClick={() => void retryEmail(email.id)} disabled={busy || !isPlatformAdmin}>Tentar novamente</button> : null}</div>
              </div>
            ))}
            {!state?.emails.length ? <p>Nenhuma mensagem transacional registrada.</p> : null}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

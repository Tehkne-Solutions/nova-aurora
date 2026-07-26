"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth-provider";
import styles from "./account.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Notification = Readonly<{
  id: string;
  title: string;
  body: string;
  severity: string;
  readAt: string | null;
  createdAt: string;
}>;

type Presence = Readonly<{
  userId: string;
  displayName: string;
  locationCode: string | null;
  status: string;
  lastHeartbeatAt: string;
}>;

type ComplianceState = Readonly<{
  privacy: Readonly<{
    mfaEnabled: boolean;
    deletionScheduledAt: string | null;
    consents: readonly Readonly<{
      purpose: string;
      version: string;
      status: string;
      updatedAt: string;
    }>[];
    requests: readonly Readonly<{
      id: string;
      requestType: string;
      status: string;
      requestedAt: string;
      scheduledFor: string | null;
    }>[];
    retention: readonly Readonly<{
      category: string;
      retentionDays: number;
      description: string;
    }>[];
  }>;
  integrity: Readonly<{
    risk: Readonly<{
      score: number;
      level: string;
      status: string;
      reviewReason: string | null;
    }>;
    fraudEvents: readonly Readonly<{
      id: string;
      eventType: string;
      severity: string;
      status: string;
      createdAt: string;
    }>[];
  }>;
  assetNotice: Readonly<{
    defaultClassification: string;
    externalTransferEnabled: boolean;
    statement: string;
  }>;
}>;

export default function AccountPage() {
  const { identity, token, setSession, logout } = useAuth();
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
  const [presence, setPresence] = useState<readonly Presence[]>([]);
  const [compliance, setCompliance] = useState<ComplianceState | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [message, setMessage] = useState("Carregando central de segurança…");

  const load = useCallback(async () => {
    try {
      const [notificationResponse, presenceResponse, complianceResponse] = await Promise.all([
        fetch(`${API_URL}/v1/auth/notifications`, { cache: "no-store" }),
        fetch(`${API_URL}/v1/live/presence`, { cache: "no-store" }),
        fetch(`${API_URL}/v1/compliance/state`, { cache: "no-store" })
      ]);
      if (notificationResponse.ok) {
        const payload = await notificationResponse.json() as { notifications: Notification[] };
        setNotifications(payload.notifications);
      }
      if (presenceResponse.ok) {
        const payload = await presenceResponse.json() as { presence: Presence[] };
        setPresence(payload.presence);
      }
      if (complianceResponse.ok) setCompliance(await complianceResponse.json() as ComplianceState);
      setMessage("Identidade, privacidade e integridade sincronizadas.");
    } catch {
      setMessage("Não foi possível sincronizar a central.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function rotateSession() {
    setMessage("Renovando sessão…");
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "x-device-name": "Nova Aurora Web" }
    });
    if (!response.ok) return setMessage("A sessão não pôde ser renovada.");
    const payload = await response.json() as {
      token: string;
      identity: NonNullable<typeof identity>;
    };
    setSession(payload.token, payload.identity);
    setMessage("Sessão rotacionada. O token anterior foi revogado.");
  }

  async function startMfa() {
    const response = await fetch(`${API_URL}/v1/auth/mfa/setup`, { method: "POST" });
    const payload = await response.json() as { secret?: string; otpauthUri?: string; message?: string };
    if (!response.ok || !payload.secret || !payload.otpauthUri) {
      return setMessage(payload.message ?? "Não foi possível iniciar o segundo fator.");
    }
    setMfaSetup({ secret: payload.secret, otpauthUri: payload.otpauthUri });
    setMessage("Adicione o segredo no autenticador e confirme o código atual.");
  }

  async function confirmMfa() {
    const response = await fetch(`${API_URL}/v1/auth/mfa/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: mfaCode })
    });
    const payload = await response.json() as { recoveryCodes?: string[]; message?: string };
    if (!response.ok || !payload.recoveryCodes) {
      return setMessage(payload.message ?? "Código TOTP inválido.");
    }
    setRecoveryCodes(payload.recoveryCodes);
    setMfaSetup(null);
    setMfaCode("");
    setMessage("Segundo fator ativado. Guarde os códigos de recuperação em local seguro.");
    await load();
  }

  async function disableMfa() {
    const response = await fetch(`${API_URL}/v1/auth/mfa/disable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: mfaPassword, code: mfaCode })
    });
    if (!response.ok) {
      const payload = await response.json() as { message?: string };
      return setMessage(payload.message ?? "Não foi possível desativar o segundo fator.");
    }
    setMfaCode("");
    setMfaPassword("");
    setRecoveryCodes([]);
    setMessage("Segundo fator desativado.");
    await load();
  }

  async function consent(purpose: string, status: "granted" | "denied" | "withdrawn") {
    const response = await fetch(`${API_URL}/v1/compliance/consents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, status, version: "2026-07" })
    });
    if (!response.ok) {
      const payload = await response.json() as { message?: string };
      return setMessage(payload.message ?? "Consentimento não pôde ser atualizado.");
    }
    setMessage("Preferência de privacidade atualizada.");
    await load();
  }

  async function exportData() {
    setMessage("Preparando exportação…");
    const response = await fetch(`${API_URL}/v1/compliance/export`, { method: "POST" });
    const payload = await response.json() as { data?: unknown; message?: string };
    if (!response.ok || !payload.data) return setMessage(payload.message ?? "Exportação indisponível.");
    const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nova-aurora-dados-${new Date().toISOString().slice(0,10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Exportação gerada localmente no navegador.");
    await load();
  }

  async function scheduleDeletion() {
    const response = await fetch(`${API_URL}/v1/compliance/deletion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Solicitação iniciada pelo titular da conta." })
    });
    const payload = await response.json() as { scheduledFor?: string; message?: string };
    if (!response.ok) return setMessage(payload.message ?? "Exclusão não pôde ser agendada.");
    setMessage(`Exclusão agendada para ${new Date(payload.scheduledFor!).toLocaleString("pt-BR")}.`);
    await load();
  }

  async function cancelDeletion() {
    const response = await fetch(`${API_URL}/v1/compliance/deletion/cancel`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json() as { message?: string };
      return setMessage(payload.message ?? "Não foi possível cancelar a exclusão.");
    }
    setMessage("Exclusão cancelada e operações econômicas liberadas.");
    await load();
  }

  async function markRead(notificationId: string) {
    const response = await fetch(`${API_URL}/v1/auth/notifications/${notificationId}/read`, { method: "POST" });
    if (!response.ok) return;
    setNotifications((current) => current.map((item) =>
      item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item
    ));
  }

  const isAdmin = identity?.roles.includes("platform-admin") || identity?.roles.includes("municipal-admin");

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · IDENTIDADE, PRIVACIDADE E INTEGRIDADE</p>
          <h1>{identity?.displayName ?? "Conta"}</h1>
          <p>{identity?.email}</p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/dashboard">Economia</Link>
          <Link href="/municipality">Prefeitura</Link>
          {isAdmin ? <Link href="/integrity">Integridade</Link> : null}
        </nav>
      </header>

      <p className={styles.message} aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article><span>Sessão</span><strong>{token ? "Ativa" : "Ausente"}</strong></article>
        <article><span>Segundo fator</span><strong>{compliance?.privacy.mfaEnabled ? "Ativo" : "Inativo"}</strong></article>
        <article><span>Risco econômico</span><strong>{compliance?.integrity.risk.level ?? "—"}</strong></article>
        <article><span>Jogadores online</span><strong>{presence.filter((item) => item.status !== "offline").length}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Identidade forte</h2>
          <div className={styles.roles}>{identity?.roles.map((role) => <span key={role}>{role}</span>)}</div>
          {!compliance?.privacy.mfaEnabled && !mfaSetup ? (
            <button type="button" onClick={() => void startMfa()}>Ativar segundo fator</button>
          ) : null}
          {mfaSetup ? (
            <div className={styles.list}>
              <div><div><strong>Segredo manual</strong><span>{mfaSetup.secret}</span></div></div>
              <div><div><strong>URI do autenticador</strong><span>{mfaSetup.otpauthUri}</span></div></div>
              <label>Código atual<input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" /></label>
              <button type="button" onClick={() => void confirmMfa()}>Confirmar ativação</button>
            </div>
          ) : null}
          {compliance?.privacy.mfaEnabled ? (
            <div className={styles.list}>
              <label>Senha atual<input type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} /></label>
              <label>Código TOTP ou recuperação<input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label>
              <button type="button" className={styles.danger} onClick={() => void disableMfa()}>Desativar segundo fator</button>
            </div>
          ) : null}
          {recoveryCodes.length ? (
            <div className={styles.list}>{recoveryCodes.map((code) => <div key={code}><strong>{code}</strong></div>)}</div>
          ) : null}
          <div className={styles.actions}>
            <button type="button" onClick={() => void rotateSession()}>Rotacionar sessão</button>
            <button type="button" className={styles.danger} onClick={() => void logout()}>Encerrar sessão</button>
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Integridade econômica</h2>
          <div className={styles.list}>
            <div><div><strong>Status</strong><span>{compliance?.integrity.risk.status ?? "normal"}</span></div><small>{compliance?.integrity.risk.score ?? 0} pontos</small></div>
            <div><div><strong>Classificação dos ativos</strong><span>{compliance?.assetNotice.defaultClassification}</span></div><small>{compliance?.assetNotice.externalTransferEnabled ? "Externa" : "Somente interna"}</small></div>
          </div>
          <p>{compliance?.assetNotice.statement}</p>
          {compliance?.integrity.fraudEvents.length ? (
            <div className={styles.list}>{compliance.integrity.fraudEvents.map((event) => (
              <div key={event.id}><div><strong>{event.eventType}</strong><span>{new Date(event.createdAt).toLocaleString("pt-BR")}</span></div><small>{event.status}</small></div>
            ))}</div>
          ) : <p>Nenhuma ocorrência de integridade vinculada à conta.</p>}
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Consentimentos</h2>
          <div className={styles.list}>
            {compliance?.privacy.consents.map((item) => (
              <div key={item.purpose}>
                <div><strong>{item.purpose}</strong><span>Versão {item.version}</span></div>
                <div className={styles.actions}>
                  <small>{item.status}</small>
                  {item.purpose !== "essential-processing" ? (
                    <button type="button" onClick={() => void consent(item.purpose, item.status === "granted" ? "withdrawn" : "granted")}>
                      {item.status === "granted" ? "Retirar" : "Conceder"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Direitos sobre os dados</h2>
          <p>O ledger e registros econômicos são preservados de forma pseudonimizada para manter o equilíbrio e a auditabilidade do mundo virtual.</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => void exportData()}>Exportar meus dados</button>
            {compliance?.privacy.deletionScheduledAt ? (
              <button type="button" onClick={() => void cancelDeletion()}>Cancelar exclusão</button>
            ) : (
              <button type="button" className={styles.danger} onClick={() => void scheduleDeletion()}>Agendar exclusão</button>
            )}
          </div>
          {compliance?.privacy.deletionScheduledAt ? <p>Agendada para {new Date(compliance.privacy.deletionScheduledAt).toLocaleString("pt-BR")}</p> : null}
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Notificações</h2>
        <div className={styles.list}>
          {notifications.map((notification) => (
            <div key={notification.id} data-unread={!notification.readAt}>
              <div><strong>{notification.title}</strong><span>{notification.body}</span><small>{new Date(notification.createdAt).toLocaleString("pt-BR")}</small></div>
              {!notification.readAt ? <button type="button" onClick={() => void markRead(notification.id)}>Marcar como lida</button> : <small>Lida</small>}
            </div>
          ))}
          {notifications.length === 0 ? <p>Nenhuma notificação.</p> : null}
        </div>
      </section>

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

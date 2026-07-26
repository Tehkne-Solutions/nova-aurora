"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import styles from "./login.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const PROTECTED_DESTINATIONS = [
  "/game",
  "/business",
  "/marketplace",
  "/management",
  "/governance",
  "/municipality",
  "/dashboard",
  "/account",
  "/integrity"
] as const;
type ProtectedDestination = typeof PROTECTED_DESTINATIONS[number];
type Mode = "login" | "register" | "recovery";

function safeDestination(value: string | null): ProtectedDestination {
  return value && PROTECTED_DESTINATIONS.includes(value as ProtectedDestination)
    ? value as ProtectedDestination
    : "/game";
}

type Identity = Readonly<{
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: readonly string[];
  expiresAt: string;
}>;

type AuthResult = Readonly<{ token: string; identity: Identity }>;
type MfaChallenge = Readonly<{
  requiresMfa: true;
  challenge: string;
  expiresAt: string;
}>;

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("alice@nova-aurora.local");
  const [password, setPassword] = useState("Aurora@2026");
  const [displayName, setDisplayName] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Entre para acessar sua cidade persistente.");

  function finishSession(payload: AuthResult) {
    setSession(payload.token, payload.identity);
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    router.replace(safeDestination(requested));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Validando identidade…");
    try {
      if (mfaChallenge) {
        const response = await fetch(`${API_URL}/v1/auth/mfa/complete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challenge: mfaChallenge,
            code: mfaCode,
            deviceName: "Nova Aurora Web"
          })
        });
        const payload = await response.json() as AuthResult | { message?: string };
        if (!response.ok || !("token" in payload)) {
          throw new Error("message" in payload && payload.message
            ? payload.message
            : "Segundo fator inválido.");
        }
        finishSession(payload);
        return;
      }

      if (mode === "recovery") {
        if (!recoveryToken) {
          const response = await fetch(`${API_URL}/v1/auth/recovery/request`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email })
          });
          const payload = await response.json() as {
            message?: string;
            token?: string | null;
          };
          if (!response.ok) throw new Error(payload.message ?? "Falha na recuperação.");
          if (payload.token) setRecoveryToken(payload.token);
          setMessage(payload.token
            ? "Token local recebido. Defina uma nova senha."
            : "Se a conta existir, as instruções de recuperação serão enviadas.");
          return;
        }
        const response = await fetch(`${API_URL}/v1/auth/recovery/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: recoveryToken, newPassword })
        });
        if (!response.ok) {
          const payload = await response.json() as { message?: string };
          throw new Error(payload.message ?? "Não foi possível trocar a senha.");
        }
        setMode("login");
        setPassword(newPassword);
        setRecoveryToken("");
        setNewPassword("");
        setMessage("Senha alterada. Todas as sessões anteriores foram revogadas.");
        return;
      }

      const endpoint = mode === "login" ? "/v1/auth/login" : "/v1/auth/register";
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(mode === "register"
            ? { "idempotency-key": `register:${crypto.randomUUID()}` }
            : {})
        },
        body: JSON.stringify({
          email,
          password,
          deviceName: "Nova Aurora Web",
          ...(mode === "register" ? { displayName } : {})
        })
      });
      const payload = await response.json() as AuthResult | MfaChallenge | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload && payload.message
          ? payload.message
          : "Não foi possível autenticar.");
      }
      if ("requiresMfa" in payload) {
        setMfaChallenge(payload.challenge);
        setMessage("Digite o código do autenticador ou um código de recuperação.");
        return;
      }
      if (!("token" in payload)) throw new Error("Resposta de autenticação inválida.");
      finishSession(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha de autenticação.");
    } finally {
      setBusy(false);
    }
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setMfaChallenge(null);
    setMfaCode("");
    setRecoveryToken("");
    setMessage(next === "recovery"
      ? "Informe o e-mail para iniciar a recuperação."
      : next === "register"
        ? "Crie sua identidade persistente."
        : "Entre para acessar sua cidade persistente.");
  }

  function demo(account: "alice" | "bob") {
    chooseMode("login");
    if (account === "alice") {
      setEmail("alice@nova-aurora.local");
      setPassword("Aurora@2026");
    } else {
      setEmail("bob@nova-aurora.local");
      setPassword("Horizonte@2026");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.brand}>
        <p className={styles.eyebrow}>NOVA AURORA · IDENTIDADE SEGURA</p>
        <h1>Sua cidade, seus negócios, sua história.</h1>
        <p>
          Sessões persistentes, segundo fator, auditoria e recuperação protegida
          preservam cada decisão econômica e cívica.
        </p>
        <div className={styles.securityList}>
          <span>Senha protegida com bcrypt</span>
          <span>TOTP e códigos de recuperação</span>
          <span>Tokens opacos armazenados como hash</span>
          <span>Recuperação revoga sessões antigas</span>
        </div>
      </section>

      <section className={styles.card}>
        {!mfaChallenge ? (
          <div className={styles.tabs}>
            <button type="button" aria-pressed={mode === "login"} onClick={() => chooseMode("login")}>Entrar</button>
            <button type="button" aria-pressed={mode === "register"} onClick={() => chooseMode("register")}>Criar conta</button>
          </div>
        ) : null}

        <form onSubmit={submit}>
          {mfaChallenge ? (
            <label>
              Código de autenticação
              <input
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                minLength={6}
                maxLength={32}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </label>
          ) : mode === "recovery" ? (
            <>
              <label>
                E-mail
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              {recoveryToken ? (
                <>
                  <label>
                    Token de recuperação
                    <input value={recoveryToken} onChange={(event) => setRecoveryToken(event.target.value)} minLength={32} required />
                  </label>
                  <label>
                    Nova senha
                    <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required />
                  </label>
                </>
              ) : null}
            </>
          ) : (
            <>
              {mode === "register" ? (
                <label>
                  Nome público
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required />
                </label>
              ) : null}
              <label>
                E-mail
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <label>
                Senha
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
              </label>
            </>
          )}
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy
              ? "Processando…"
              : mfaChallenge
                ? "Confirmar segundo fator"
                : mode === "login"
                  ? "Entrar em Nova Aurora"
                  : mode === "register"
                    ? "Criar identidade"
                    : recoveryToken
                      ? "Alterar senha"
                      : "Solicitar recuperação"}
          </button>
        </form>

        {!mfaChallenge && mode === "login" ? (
          <button type="button" onClick={() => chooseMode("recovery")}>Esqueci minha senha</button>
        ) : null}
        {mfaChallenge ? (
          <button type="button" onClick={() => chooseMode("login")}>Cancelar segundo fator</button>
        ) : mode === "recovery" ? (
          <button type="button" onClick={() => chooseMode("login")}>Voltar ao login</button>
        ) : null}

        {process.env.NODE_ENV !== "production" && !mfaChallenge ? (
          <div className={styles.demo}>
            <span>Contas locais de validação</span>
            <button type="button" onClick={() => demo("alice")}>Alice · administradora</button>
            <button type="button" onClick={() => demo("bob")}>Bob · cidadão</button>
          </div>
        ) : null}

        <p className={styles.message} aria-live="polite">{message}</p>
        <footer>Tehkné Solutions</footer>
      </section>
    </main>
  );
}

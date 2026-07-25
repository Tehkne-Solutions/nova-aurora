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
  "/account"
] as const;
type ProtectedDestination = typeof PROTECTED_DESTINATIONS[number];

function safeDestination(value: string | null): ProtectedDestination {
  return value && PROTECTED_DESTINATIONS.includes(value as ProtectedDestination)
    ? value as ProtectedDestination
    : "/game";
}

type AuthResult = Readonly<{
  token: string;
  identity: Readonly<{
    userId: string;
    email: string;
    displayName: string;
    sessionId: string;
    roles: readonly string[];
    expiresAt: string;
  }>;
}>;

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("alice@nova-aurora.local");
  const [password, setPassword] = useState("Aurora@2026");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Entre para acessar sua cidade persistente.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Validando identidade…");
    try {
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
      const payload = await response.json() as AuthResult | { message?: string };
      if (!response.ok || !("token" in payload)) {
        throw new Error("message" in payload && payload.message
          ? payload.message
          : "Não foi possível autenticar.");
      }
      setSession(payload.token, payload.identity);
      const requested = new URLSearchParams(window.location.search).get("returnTo");
      router.replace(safeDestination(requested));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha de autenticação.");
    } finally {
      setBusy(false);
    }
  }

  function demo(account: "alice" | "bob") {
    setMode("login");
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
          Sessões persistentes, papéis, auditoria e presença ao vivo protegem cada
          decisão econômica e cívica.
        </p>
        <div className={styles.securityList}>
          <span>Senha protegida com bcrypt</span>
          <span>Token opaco armazenado apenas como hash</span>
          <span>Operações mutáveis auditadas</span>
          <span>Tempo real com ticket de uso único</span>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.tabs}>
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
          >Entrar</button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => setMode("register")}
          >Criar conta</button>
        </div>

        <form onSubmit={submit}>
          {mode === "register" ? (
            <label>
              Nome público
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={120}
                autoComplete="name"
                required
              />
            </label>
          ) : null}
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              maxLength={256}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? "Processando…" : mode === "login" ? "Entrar em Nova Aurora" : "Criar identidade"}
          </button>
        </form>

        {process.env.NODE_ENV !== "production" ? (
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

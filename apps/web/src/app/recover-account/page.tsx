"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import styles from "../login/login.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function RecoverAccountPage() {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("Defina uma nova senha para sua identidade.");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return setMessage("O link de recuperação está incompleto.");
    if (newPassword !== confirmation) return setMessage("As senhas informadas são diferentes.");
    setBusy(true);
    setMessage("Atualizando credenciais e revogando sessões antigas…");
    try {
      const response = await fetch(`${API_URL}/v1/auth/recovery/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "O link expirou ou já foi utilizado.");
      }
      setCompleted(true);
      setMessage("Senha alterada. Todas as sessões anteriores foram revogadas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível recuperar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.brand} aria-labelledby="recovery-title">
        <p className={styles.eyebrow}>NOVA AURORA · RECUPERAÇÃO SEGURA</p>
        <h1 id="recovery-title">Retome sua identidade.</h1>
        <p>
          O link é válido por tempo limitado e, após a troca de senha, todas as
          sessões antigas deixam de funcionar imediatamente.
        </p>
        <div className={styles.securityList} aria-label="Proteções da recuperação">
          <span>Token de uso único</span>
          <span>Conteúdo entregue por e-mail</span>
          <span>Revogação global de sessões</span>
          <span>Auditoria de segurança</span>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="recovery-form-title">
        <h2 id="recovery-form-title">Nova senha</h2>
        {!completed ? (
          <form onSubmit={submit}>
            <label>
              Nova senha
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirmar nova senha
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                required
              />
            </label>
            <button className={styles.primary} type="submit" disabled={busy || !token}>
              {busy ? "Processando…" : "Alterar senha e revogar sessões"}
            </button>
          </form>
        ) : (
          <Link href="/login" className={styles.primary}>Entrar com a nova senha</Link>
        )}
        <p className={styles.message} role="status" aria-live="polite">{message}</p>
        <footer>Tehkné Solutions</footer>
      </section>
    </main>
  );
}

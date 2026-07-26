"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../login/login.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State = "checking" | "verified" | "failed";

export default function VerifyEmailPage() {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState("Confirmando seu endereço de e-mail…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("failed");
      setMessage("O link de verificação está incompleto.");
      return;
    }
    void fetch(`${API_URL}/v1/auth/email-verification/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "O link expirou ou já foi utilizado.");
      }
      setState("verified");
      setMessage("E-mail confirmado. Sua conta está liberada para o beta da Nova Aurora.");
    }).catch((error: unknown) => {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "Não foi possível confirmar o e-mail.");
    });
  }, []);

  return (
    <main className={styles.shell}>
      <section className={styles.brand} aria-labelledby="verification-title">
        <p className={styles.eyebrow}>NOVA AURORA · VERIFICAÇÃO DE CONTA</p>
        <h1 id="verification-title">Confirme sua entrada na cidade.</h1>
        <p>
          A verificação protege o beta contra cadastros automatizados, abuso de
          convites e recuperação indevida de identidade.
        </p>
        <div className={styles.securityList} aria-label="Resultado da verificação">
          <span>Link de uso único</span>
          <span>Validade limitada</span>
          <span>Token armazenado apenas como hash</span>
          <span>Liberação auditada</span>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="verification-status">
        <h2 id="verification-status">
          {state === "checking" ? "Verificando…" : state === "verified" ? "Conta liberada" : "Verificação não concluída"}
        </h2>
        <p className={styles.message} role="status" aria-live="polite">{message}</p>
        <Link href={state === "verified" ? "/login" : "/account"} className={styles.primary}>
          {state === "verified" ? "Entrar em Nova Aurora" : "Abrir central da conta"}
        </Link>
        <footer>Tehkné Solutions</footer>
      </section>
    </main>
  );
}

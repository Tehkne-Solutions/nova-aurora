"use client";

import Link from "next/link";
import { CreatorStudio } from "../creator-studio";
import styles from "../social.module.css";

export default function CreatorStudioPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Nova Aurora · Economia criativa</p>
            <h1>Creator Studio</h1>
            <p className={styles.headerLead}>
              Abra seu canal, prepare conteúdo, publique quando estiver pronto e acompanhe o ciclo editorial sem sair da plataforma.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.link} href="/community/social">Hub Social</Link>
            <Link className={styles.link} href="/community">Comunicados</Link>
          </div>
        </header>

        <CreatorStudio />

        <footer className={styles.footer}>Tehkné Solutions</footer>
      </div>
    </main>
  );
}

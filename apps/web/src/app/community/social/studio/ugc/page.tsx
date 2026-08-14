"use client";

import Link from "next/link";
import { UgcCreatorStudio } from "./ugc-studio";
import styles from "../../social.module.css";

export default function UgcCreatorStudioPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Nova Aurora · Objetos criados por usuários</p>
            <h1>UGC Creator Studio</h1>
            <p className={styles.headerLead}>
              Versione objetos virtuais, publique manifests verificáveis e configure edições comerciais com proveniência e royalties persistentes.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.link} href="/community/social/studio">Creator Studio</Link>
            <Link className={styles.link} href="/community/social">Hub Social</Link>
          </div>
        </header>

        <UgcCreatorStudio />

        <footer className={styles.footer}>Tehkné Solutions</footer>
      </div>
    </main>
  );
}

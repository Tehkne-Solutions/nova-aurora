"use client";

import Link from "next/link";
import { VerifiedManifestUpload } from "./verified-upload";
import styles from "../../../social.module.css";

export default function VerifiedManifestUploadPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Nova Aurora · Object storage privado</p>
            <h1>Manifesto verificado</h1>
            <p className={styles.headerLead}>
              Envie um manifesto JSON e confirme que os mesmos bytes foram persistidos antes de usá-los como evidência de um blueprint UGC.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.link} href="/community/social/studio/ugc">UGC Creator Studio</Link>
            <Link className={styles.link} href="/community/social">Hub Social</Link>
          </div>
        </header>

        <VerifiedManifestUpload />

        <footer className={styles.footer}>Tehkné Solutions</footer>
      </div>
    </main>
  );
}

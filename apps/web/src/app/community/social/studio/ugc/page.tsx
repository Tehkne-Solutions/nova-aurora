"use client";

import Link from "next/link";
import { BinaryAssetLibrary } from "./asset-library";
import { ManagedManifestComposer } from "./managed-manifest-composer";
import { UgcCreatorStudio } from "./ugc-studio";
import { UgcManifestIntegrityGate } from "./ugc-manifest-integrity";
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
              Envie assets binários verificados, versione objetos virtuais, componha manifests HTTPS com integridade SHA-256 e configure edições comerciais com proveniência e royalties persistentes.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.link} href="/community/social/studio/ugc/upload">Verificar manifesto</Link>
            <Link className={styles.link} href="/community/social/studio">Creator Studio</Link>
            <Link className={styles.link} href="/community/social">Hub Social</Link>
          </div>
        </header>

        <UgcManifestIntegrityGate>
          <UgcCreatorStudio />
        </UgcManifestIntegrityGate>

        <BinaryAssetLibrary />
        <ManagedManifestComposer />

        <footer className={styles.footer}>Tehkné Solutions</footer>
      </div>
    </main>
  );
}

// Tehkné Solutions

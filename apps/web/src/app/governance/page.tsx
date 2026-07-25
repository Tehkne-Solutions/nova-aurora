import Link from "next/link";
import { GovernanceGame } from "./governance-game";
import styles from "./governance.module.css";

export const dynamic = "force-dynamic";

export default function GovernancePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · CITY GOVERNANCE</p>
          <h1>Expanda a cidade com decisões públicas auditáveis.</h1>
          <p>
            Licenças, propostas, votos, licitações e investimentos urbanos
            conectados ao mesmo ledger da economia.
          </p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/business">Propriedades</Link>
          <Link href="/marketplace">Mercado público</Link>
          <Link href="/management">Gestão regional</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <GovernanceGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

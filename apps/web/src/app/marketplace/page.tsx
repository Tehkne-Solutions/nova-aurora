import Link from "next/link";
import { MarketplaceGame } from "./marketplace-game";
import styles from "./marketplace.module.css";

export const dynamic = "force-dynamic";

export default function MarketplacePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · PUBLIC MARKETPLACE</p>
          <h1>Empresas abertas para clientes, talentos e participantes.</h1>
          <p>
            Demanda regional, reputação, trabalho e participações internas
            conectados ao mesmo ledger persistente da cidade.
          </p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/business">Minha empresa</Link>
          <Link href="/management">Gestão regional</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <MarketplaceGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

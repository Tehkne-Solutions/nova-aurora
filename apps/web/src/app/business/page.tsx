import Link from "next/link";
import { BusinessGame } from "./business-game";
import styles from "./business.module.css";

export const dynamic = "force-dynamic";

export default function BusinessPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · PROPERTY & BUSINESS</p>
          <h1>Transforme um endereço em uma empresa viva.</h1>
          <p>
            Terrenos, construções, operação, visitas e participações virtuais
            liquidadas no mesmo ledger da cidade.
          </p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/marketplace">Mercado público</Link>
          <Link href="/management">Gestão regional</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <BusinessGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

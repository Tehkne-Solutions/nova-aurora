import Link from "next/link";
import { RegionalManagementGame } from "./regional-management-game";
import styles from "./management.module.css";

export const dynamic = "force-dynamic";

export default function ManagementPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · REGIONAL ECONOMY</p>
          <h1>Administre a empresa como parte viva do distrito.</h1>
          <p>
            Estoque, fornecedores, campanhas, equipe, metas e indicadores
            regionais conectados ao mesmo ledger da cidade.
          </p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/business">Propriedades</Link>
          <Link href="/marketplace">Mercado público</Link>
          <Link href="/governance">Governança</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <RegionalManagementGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

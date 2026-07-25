import Link from "next/link";
import { MunicipalOperationsGame } from "./municipal-operations-game";
import styles from "./municipality.module.css";

export const dynamic = "force-dynamic";

export default function MunicipalityPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · OPERAÇÕES MUNICIPAIS</p>
          <h1>Administre serviços, eleições e respostas urbanas.</h1>
          <p>
            Orçamento recorrente, conselho eleito, políticas públicas e emergências
            conectados ao ledger persistente da cidade.
          </p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/business">Empresas</Link>
          <Link href="/management">Gestão</Link>
          <Link href="/governance">Governança</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <MunicipalOperationsGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

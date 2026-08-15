import Link from "next/link";
import { CityGame } from "./city-game";
import baseStyles from "./game.module.css";
import shellStyles from "./game-shell-v2.module.css";

const styles = { ...baseStyles, ...shellStyles };

export const dynamic = "force-dynamic";

export default function GamePage() {
  return (
    <main className={styles.gameShell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · MUNDO VIVO</p>
          <h1>Construa sua primeira cadeia de valor.</h1>
        </div>
        <nav aria-label="Sistemas de Nova Aurora">
          <Link href="/">Início</Link>
          <Link href="/business">Empresas</Link>
          <Link href="/management">Gestão</Link>
          <Link href="/governance">Governança</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <CityGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

// Tehkné Solutions

import Link from "next/link";
import { CityGame } from "./city-game";
import styles from "./game.module.css";

export const dynamic = "force-dynamic";

export default function GamePage() {
  return (
    <main className={styles.gameShell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · CITY GAMEPLAY</p>
          <h1>Construa sua primeira cadeia de valor.</h1>
        </div>
        <nav>
          <Link href="/">Início</Link>
          <Link href="/dashboard">Economia</Link>
        </nav>
      </header>
      <CityGame />
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}

import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="tag">NOVA AURORA · MVP</p>
      <h1>Construa. Produza. Negocie. Expanda.</h1>
      <p className="lead">
        Um mundo econômico virtual persistente, estruturado sobre produção,
        especialização e colaboração.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link className="button" href="/game">Entrar em Nova Aurora</Link>
        <Link className="button" href="/dashboard">Abrir economia</Link>
      </div>
      <footer>Tehkné Solutions</footer>
    </main>
  );
}

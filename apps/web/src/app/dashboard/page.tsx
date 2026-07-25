"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RealtimeStatus } from "./realtime-status";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type DashboardData = Readonly<{
  state: null | { balances: readonly { code: string; value: string }[] };
  book: null | {
    buys: readonly { id: string; remainingMinor: number; unitPriceMinor: number }[];
    sells: readonly { id: string; remainingMinor: number; unitPriceMinor: number }[];
  };
  trades: readonly { id: string; quantityMinor: number; unitPriceMinor: number }[];
  production: readonly { id: string; recipeCode: string; batches: number; status: string }[];
}>;

async function fetchJson(path: string, headers: HeadersInit = {}) {
  try {
    const response = await fetch(`${apiUrl}${path}`, { cache: "no-store", headers });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function aurora(value: string | number): string {
  return `${(Number(value) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    void Promise.all([
      fetchJson("/v1/economy/snapshot"),
      fetchJson("/v1/market/order-book/bread"),
      fetchJson("/v1/market/trades/bread?limit=8"),
      fetchJson("/v1/production/orders", { "x-actor-email": "alice@nova-aurora.local" })
    ]).then(([state, book, trades, production]) => {
      setData({
        state,
        book,
        trades: Array.isArray(trades) ? trades : [],
        production: Array.isArray(production) ? production : []
      } as DashboardData);
    });
  }, []);

  const state = data?.state ?? null;
  const book = data?.book ?? null;
  const trades = data?.trades ?? [];
  const production = data?.production ?? [];

  return (
    <main>
      <p className="tag">MARKET & PRODUCTION CORE</p>
      <h1>Nova Aurora em movimento.</h1>
      <p className="lead">
        Ordens são cruzadas por preço e prioridade temporal. Produções avançam em filas
        temporizadas e publicam eventos econômicos em tempo real autenticado.
      </p>
      <nav className="rows">
        <Link href="/game">Cidade</Link>
        <Link href="/municipality">Prefeitura</Link>
        <Link href="/account">Identidade e segurança</Link>
      </nav>

      {!data ? (
        <section>
          <h2>Carregando economia autenticada…</h2>
        </section>
      ) : !state ? (
        <section>
          <h2>Infraestrutura indisponível</h2>
          <p>Suba PostgreSQL, Redis, API e worker para acompanhar a economia.</p>
        </section>
      ) : (
        <>
          <section className="grid">
            {state.balances.map((balance) => (
              <article key={balance.code}>
                <span>{balance.code}</span>
                <strong>{aurora(balance.value)}</strong>
              </article>
            ))}
            <RealtimeStatus />
          </section>

          <section className="split">
            <div>
              <p className="tag">LIVRO DE OFERTAS · PÃO</p>
              <h2>Compra</h2>
              <div className="rows">
                {(book?.buys ?? []).slice(0, 6).map((order) => (
                  <div className="row" key={order.id}>
                    <span>{order.remainingMinor / 100} un.</span>
                    <strong>{aurora(order.unitPriceMinor)}</strong>
                  </div>
                ))}
                {(book?.buys ?? []).length === 0 && <p className="muted">Nenhuma ordem de compra.</p>}
              </div>
            </div>
            <div>
              <p className="tag">PRIORIDADE PREÇO/TEMPO</p>
              <h2>Venda</h2>
              <div className="rows">
                {(book?.sells ?? []).slice(0, 6).map((order) => (
                  <div className="row" key={order.id}>
                    <span>{order.remainingMinor / 100} un.</span>
                    <strong>{aurora(order.unitPriceMinor)}</strong>
                  </div>
                ))}
                {(book?.sells ?? []).length === 0 && <p className="muted">Nenhuma ordem de venda.</p>}
              </div>
            </div>
          </section>

          <section className="split">
            <div>
              <p className="tag">NEGOCIAÇÕES</p>
              <h2>Últimos trades</h2>
              <div className="rows">
                {trades.map((trade) => (
                  <div className="row" key={trade.id}>
                    <span>{trade.quantityMinor / 100} un.</span>
                    <strong>{aurora(trade.unitPriceMinor)}</strong>
                  </div>
                ))}
                {trades.length === 0 && <p className="muted">Nenhuma negociação concluída.</p>}
              </div>
            </div>
            <div>
              <p className="tag">PRODUÇÃO TEMPORIZADA</p>
              <h2>Ordens da sessão atual</h2>
              <div className="rows">
                {production.slice(0, 8).map((order) => (
                  <div className="row" key={order.id}>
                    <span>{order.recipeCode} · {order.batches} lote(s)</span>
                    <strong>{order.status}</strong>
                  </div>
                ))}
                {production.length === 0 && <p className="muted">Nenhuma produção na fila.</p>}
              </div>
            </div>
          </section>
        </>
      )}

      <footer>Tehkné Solutions</footer>
    </main>
  );
}

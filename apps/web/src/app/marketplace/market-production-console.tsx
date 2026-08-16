"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./market-production-console.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type MarketItem = Readonly<{
  code: string;
  name: string;
  basePriceMinor: number;
}>;

type RecipeInput = Readonly<{
  itemCode: string;
  itemName: string;
  quantityMinor: number;
}>;

type ProductionRecipe = Readonly<{
  code: string;
  name: string;
  outputItemCode: string;
  outputItemName: string;
  outputQuantityMinor: number;
  durationSeconds: number;
  energyCostMinor: number;
  inputs: readonly RecipeInput[];
}>;

type MarketOrder = Readonly<{
  id: string;
  ownerId?: string;
  side: "buy" | "sell";
  itemCode?: string;
  item?: string;
  quantityMinor?: number;
  remainingMinor?: number;
  filledMinor?: number;
  unitPriceMinor?: number;
  remaining_minor?: string | number;
  unit_price_minor?: string | number;
  status: string;
}>;

type MarketTrade = Readonly<{
  id: string;
  quantityMinor: number;
  unitPriceMinor: number;
  createdAt: string;
}>;

type ProductionOrder = Readonly<{
  id: string;
  recipeCode: string;
  batches: number;
  status: "queued" | "processing" | "completed" | "cancelled" | "failed";
  startsAt: string;
  completesAt: string;
  completedAt: string | null;
}>;

type EconomySnapshot = Readonly<{
  balances: readonly Readonly<{ code: string; value: string | number }>[];
  inventory: readonly Readonly<{ code: string; quantity: string | number }>[];
  orders: readonly MarketOrder[];
}>;

type MarketBook = Readonly<{
  buys: readonly MarketOrder[];
  sells: readonly MarketOrder[];
}>;

type RequestOptions = Readonly<{
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
}>;

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function money(minor: number | string): string {
  return `${(Number(minor) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

function units(minor: number | string | undefined): string {
  return (Number(minor ?? 0) / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2
  });
}

function decimal(value: string): number {
  return Number(value.trim().replace(",", "."));
}

function orderRemaining(order: MarketOrder): number {
  return Number(order.remainingMinor ?? order.remaining_minor ?? 0);
}

function orderPrice(order: MarketOrder): number {
  return Number(order.unitPriceMinor ?? order.unit_price_minor ?? 0);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Operação econômica falhou (${response.status}).`);
  return payload;
}

export function MarketProductionConsole() {
  const [items, setItems] = useState<readonly MarketItem[]>([]);
  const [recipes, setRecipes] = useState<readonly ProductionRecipe[]>([]);
  const [snapshot, setSnapshot] = useState<EconomySnapshot | null>(null);
  const [production, setProduction] = useState<readonly ProductionOrder[]>([]);
  const [book, setBook] = useState<MarketBook>({ buys: [], sells: [] });
  const [trades, setTrades] = useState<readonly MarketTrade[]>([]);
  const [selectedItemCode, setSelectedItemCode] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [selectedRecipeCode, setSelectedRecipeCode] = useState("");
  const [batches, setBatches] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Sincronizando mercado de bens e produção...");

  const selectedItem = useMemo(
    () => items.find((item) => item.code === selectedItemCode) ?? null,
    [items, selectedItemCode]
  );
  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.code === selectedRecipeCode) ?? null,
    [recipes, selectedRecipeCode]
  );
  const inventory = useMemo(
    () => new Map((snapshot?.inventory ?? []).map((item) => [item.code, Number(item.quantity)])),
    [snapshot]
  );

  const refreshPrivate = useCallback(async () => {
    const [snapshotPayload, productionPayload] = await Promise.all([
      request<EconomySnapshot>("/v1/economy/snapshot"),
      request<readonly ProductionOrder[]>("/v1/production/orders")
    ]);
    setSnapshot(snapshotPayload);
    setProduction(productionPayload);
  }, []);

  const refreshMarket = useCallback(async (itemCode: string) => {
    if (!itemCode) return;
    const [bookPayload, tradePayload] = await Promise.all([
      request<MarketBook>(`/v1/market/order-book/${encodeURIComponent(itemCode)}`),
      request<readonly MarketTrade[]>(`/v1/market/trades/${encodeURIComponent(itemCode)}?limit=12`)
    ]);
    setBook(bookPayload);
    setTrades(tradePayload);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [catalogPayload, recipePayload] = await Promise.all([
        request<{ items: MarketItem[] }>("/v1/market/catalog"),
        request<{ recipes: ProductionRecipe[] }>("/v1/production/recipes")
      ]);
      setItems(catalogPayload.items);
      setRecipes(recipePayload.recipes);
      const nextItem = selectedItemCode || catalogPayload.items[0]?.code || "";
      const nextRecipe = selectedRecipeCode || recipePayload.recipes[0]?.code || "";
      if (!selectedItemCode && nextItem) setSelectedItemCode(nextItem);
      if (!selectedRecipeCode && nextRecipe) setSelectedRecipeCode(nextRecipe);
      await Promise.all([
        refreshPrivate(),
        nextItem ? refreshMarket(nextItem) : Promise.resolve()
      ]);
      setMessage("Mercado, inventário e produção sincronizados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível sincronizar a economia.");
    }
  }, [refreshMarket, refreshPrivate, selectedItemCode, selectedRecipeCode]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedItem) return;
    setPrice((selectedItem.basePriceMinor / 100).toFixed(2).replace(".", ","));
    void refreshMarket(selectedItem.code);
  }, [refreshMarket, selectedItem]);

  async function run(label: string, operation: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setMessage(label);
    try {
      await operation();
      await refreshPrivate();
      if (selectedItemCode) await refreshMarket(selectedItemCode);
      setMessage("Operação concluída e economia sincronizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operação econômica não concluída.");
    } finally {
      setBusy(false);
    }
  }

  function submitOrder(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedPrice = decimal(price);
    if (!selectedItemCode || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setMessage("Informe item, quantidade inteira positiva e preço válido.");
      return;
    }
    void run("Enviando ordem ao livro público...", () => request("/v1/market/orders", {
      method: "POST",
      idempotencyKey: key("market-order"),
      body: {
        side,
        itemCode: selectedItemCode,
        quantity: parsedQuantity,
        unitPriceMinor: Math.round(parsedPrice * 100)
      }
    }));
  }

  function submitProduction(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedBatches = Number(batches);
    if (!selectedRecipeCode || !Number.isInteger(parsedBatches) || parsedBatches < 1 || parsedBatches > 20) {
      setMessage("Selecione uma receita e informe entre 1 e 20 lotes.");
      return;
    }
    void run("Reservando insumos e iniciando produção...", () => request("/v1/production/orders", {
      method: "POST",
      idempotencyKey: key("production-order"),
      body: { recipeCode: selectedRecipeCode, batches: parsedBatches }
    }));
  }

  const openOrders = (snapshot?.orders ?? []).filter((order) => ["open", "partial"].includes(order.status));
  const wallet = snapshot?.balances[0]?.value ?? 0;

  return (
    <section aria-label="Console autenticada de mercado e produção de Nova Aurora" className={styles.console} data-authenticated="true">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MERCADO DE BENS · PRODUÇÃO REAL</p>
          <h2>Produza, negocie e responda à oferta e demanda da cidade.</h2>
          <p>
            Ordens usam prioridade preço/tempo, reservas reais do inventário e da carteira,
            liquidação no ledger e produção temporizada pela mesma economia persistente.
          </p>
        </div>
        <div className={styles.wallet}>
          <span>Carteira disponível no snapshot</span>
          <strong>{money(wallet)}</strong>
        </div>
      </header>

      <p aria-live="polite" className={styles.message}>{message}</p>

      <div className={styles.marketGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span>Livro de ofertas</span>
              <h3>{selectedItem?.name ?? "Mercado"}</h3>
            </div>
            <label>
              Bem
              <select disabled={busy} onChange={(event) => setSelectedItemCode(event.target.value)} value={selectedItemCode}>
                {items.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
              </select>
            </label>
          </div>

          <div className={styles.bookGrid}>
            <div>
              <h4>Compras</h4>
              {book.buys.slice(0, 8).map((order) => (
                <div className={styles.bookRow} key={order.id}>
                  <span>{units(order.remainingMinor)} un.</span>
                  <strong>{money(order.unitPriceMinor ?? 0)}</strong>
                </div>
              ))}
              {book.buys.length === 0 && <p className={styles.muted}>Sem ofertas de compra.</p>}
            </div>
            <div>
              <h4>Vendas</h4>
              {book.sells.slice(0, 8).map((order) => (
                <div className={styles.bookRow} key={order.id}>
                  <span>{units(order.remainingMinor)} un.</span>
                  <strong>{money(order.unitPriceMinor ?? 0)}</strong>
                </div>
              ))}
              {book.sells.length === 0 && <p className={styles.muted}>Sem ofertas de venda.</p>}
            </div>
          </div>

          <form className={styles.form} onSubmit={submitOrder}>
            <h4>Nova ordem</h4>
            <div className={styles.formGrid}>
              <label>
                Operação
                <select disabled={busy} onChange={(event) => setSide(event.target.value as "buy" | "sell")} value={side}>
                  <option value="buy">Comprar</option>
                  <option value="sell">Vender</option>
                </select>
              </label>
              <label>
                Quantidade (unidades)
                <input disabled={busy} inputMode="numeric" min="1" onChange={(event) => setQuantity(event.target.value)} step="1" type="number" value={quantity} />
              </label>
              <label>
                Preço por unidade (CA)
                <input disabled={busy} inputMode="decimal" min="0.01" onChange={(event) => setPrice(event.target.value)} step="0.01" type="text" value={price} />
              </label>
            </div>
            <button disabled={busy || !selectedItemCode} type="submit">Enviar ordem</button>
          </form>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span>Produção temporizada</span>
              <h3>{selectedRecipe?.name ?? "Receitas"}</h3>
            </div>
            <label>
              Receita
              <select disabled={busy} onChange={(event) => setSelectedRecipeCode(event.target.value)} value={selectedRecipeCode}>
                {recipes.map((recipe) => <option key={recipe.code} value={recipe.code}>{recipe.name}</option>)}
              </select>
            </label>
          </div>

          {selectedRecipe ? (
            <div className={styles.recipe}>
              <div><span>Saída</span><strong>{units(selectedRecipe.outputQuantityMinor)} un. de {selectedRecipe.outputItemName}</strong></div>
              <div><span>Duração por lote</span><strong>{selectedRecipe.durationSeconds}s</strong></div>
              <div><span>Energia por lote</span><strong>{money(selectedRecipe.energyCostMinor)}</strong></div>
              <div>
                <span>Insumos por lote</span>
                <strong>{selectedRecipe.inputs.map((input) => `${units(input.quantityMinor)} ${input.itemName}`).join(" + ")}</strong>
              </div>
            </div>
          ) : null}

          <form className={styles.form} onSubmit={submitProduction}>
            <h4>Iniciar produção</h4>
            <label>
              Lotes
              <input disabled={busy} inputMode="numeric" max="20" min="1" onChange={(event) => setBatches(event.target.value)} step="1" type="number" value={batches} />
            </label>
            <button disabled={busy || !selectedRecipeCode} type="submit">Produzir</button>
          </form>

          <div className={styles.productionList}>
            <h4>Fila do jogador</h4>
            {production.slice(0, 8).map((order) => (
              <div className={styles.productionRow} key={order.id}>
                <div>
                  <strong>{order.recipeCode} · {order.batches} lote(s)</strong>
                  <span>{order.status} · conclui {new Date(order.completesAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
                {order.status === "queued" ? (
                  <button disabled={busy} onClick={() => void run("Cancelando produção e liberando reservas...", () => request(`/v1/production/orders/${order.id}`, { method: "DELETE", idempotencyKey: key("cancel-production") }))} type="button">Cancelar</button>
                ) : null}
              </div>
            ))}
            {production.length === 0 && <p className={styles.muted}>Nenhuma produção registrada.</p>}
          </div>
        </article>
      </div>

      <div className={styles.lowerGrid}>
        <article className={styles.panel}>
          <h3>Seu inventário</h3>
          <div className={styles.inventoryGrid}>
            {items.map((item) => (
              <div key={item.code}>
                <span>{item.name}</span>
                <strong>{units(inventory.get(item.code))} un.</strong>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <h3>Suas ordens abertas</h3>
          {openOrders.slice(0, 8).map((order) => (
            <div className={styles.openOrder} key={order.id}>
              <div>
                <strong>{order.side === "buy" ? "Compra" : "Venda"} · {order.item ?? order.itemCode}</strong>
                <span>{units(orderRemaining(order))} un. · {money(orderPrice(order))}</span>
              </div>
              <button disabled={busy} onClick={() => void run("Cancelando ordem e liberando reservas...", () => request(`/v1/market/orders/${order.id}`, { method: "DELETE", idempotencyKey: key("cancel-market") }))} type="button">Cancelar</button>
            </div>
          ))}
          {openOrders.length === 0 && <p className={styles.muted}>Nenhuma ordem aberta.</p>}
        </article>

        <article className={styles.panel}>
          <h3>Últimos negócios · {selectedItem?.name ?? "bem"}</h3>
          {trades.slice(0, 8).map((trade) => (
            <div className={styles.tradeRow} key={trade.id}>
              <span>{units(trade.quantityMinor)} un.</span>
              <strong>{money(trade.unitPriceMinor)}</strong>
            </div>
          ))}
          {trades.length === 0 && <p className={styles.muted}>Ainda não há negócios concluídos para este bem.</p>}
        </article>
      </div>

      <footer className={styles.signature}>Tehkné Solutions</footer>
    </section>
  );
}

// Tehkné Solutions

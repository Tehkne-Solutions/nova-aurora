export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "partial" | "filled" | "cancelled";

export type MarketOrderView = Readonly<{
  id: string;
  ownerId: string;
  side: OrderSide;
  itemCode: string;
  quantityMinor: number;
  remainingMinor: number;
  filledMinor: number;
  unitPriceMinor: number;
  status: OrderStatus;
  createdAt: string;
}>;

export type MarketTradeView = Readonly<{
  id: string;
  buyOrderId: string;
  sellOrderId: string;
  itemCode: string;
  buyerId: string;
  sellerId: string;
  quantityMinor: number;
  unitPriceMinor: number;
  grossMinor: number;
  taxMinor: number;
  sellerNetMinor: number;
  createdAt: string;
}>;

export type ProductionOrderView = Readonly<{
  id: string;
  ownerId: string;
  recipeCode: string;
  batches: number;
  status: "queued" | "processing" | "completed" | "cancelled" | "failed";
  startsAt: string;
  completesAt: string;
  completedAt: string | null;
}>;

const SCALE = 100;
const TAX_RATE = 0.02;

export function tradeGrossMinor(quantityMinor: number, unitPriceMinor: number): number {
  if (!Number.isSafeInteger(quantityMinor) || quantityMinor <= 0 || quantityMinor % SCALE !== 0) {
    throw new Error("A quantidade deve usar unidades inteiras do item.");
  }
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) {
    throw new Error("Preço unitário inválido.");
  }
  return Math.round((quantityMinor * unitPriceMinor) / SCALE);
}

export function tradeTaxMinor(grossMinor: number): number {
  return Math.max(1, Math.round(grossMinor * TAX_RATE));
}

export function orderStatus(remainingMinor: number, quantityMinor: number): OrderStatus {
  if (remainingMinor === 0) return "filled";
  if (remainingMinor < quantityMinor) return "partial";
  return "open";
}

export function toItemMinor(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100_000) {
    throw new Error("Quantidade inválida.");
  }
  return quantity * SCALE;
}

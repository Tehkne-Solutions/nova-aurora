export type Entry = Readonly<{ accountId: string; amountMinor: bigint; memo: string }>;
export type Transaction = Readonly<{
  id: string;
  idempotencyKey: string;
  type: string;
  entries: readonly Entry[];
}>;

export function assertBalanced(entries: readonly Entry[]): void {
  if (entries.length < 2) throw new Error("A transação exige dois lançamentos.");
  if (entries.some((entry) => entry.amountMinor === 0n)) throw new Error("Lançamento zero não é permitido.");
  const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  if (total !== 0n) throw new Error(`Transação desequilibrada: ${total}.`);
}

export function transfer(input: {
  id: string;
  idempotencyKey: string;
  from: string;
  to: string;
  amountMinor: bigint;
  memo: string;
}): Transaction {
  if (input.amountMinor <= 0n) throw new Error("Valor inválido.");
  const transaction: Transaction = {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    type: "transfer",
    entries: [
      { accountId: input.from, amountMinor: -input.amountMinor, memo: input.memo },
      { accountId: input.to, amountMinor: input.amountMinor, memo: input.memo }
    ]
  };
  assertBalanced(transaction.entries);
  return transaction;
}

export type MonetaryReconciliation = Readonly<{
  ledgerTotalMinor:number;
  snapshotTotalMinor:number;
  differenceMinor:number;
  toleranceMinor:number;
  isBalanced:boolean;
}>;

export type EconomySnapshotMetrics = Readonly<{
  moneySupplyMinor:number;
  transactionVolumeMinor:number;
  previousPriceIndex:number|null;
  currentPriceIndex:number|null;
}>;

function finiteNonNegative(value:number,label:string):number{
  if(!Number.isFinite(value)||value<0) throw new Error(`${label} deve ser finito e não negativo.`);
  return value;
}

export function calculateMoneyVelocity(transactionVolumeMinor:number,moneySupplyMinor:number):number{
  finiteNonNegative(transactionVolumeMinor,"Volume transacionado");
  finiteNonNegative(moneySupplyMinor,"Estoque monetário");
  if(moneySupplyMinor===0) return 0;
  return Number((transactionVolumeMinor/moneySupplyMinor).toFixed(8));
}

export function calculateInflationRate(previousPriceIndex:number|null,currentPriceIndex:number|null):number|null{
  if(previousPriceIndex===null||currentPriceIndex===null) return null;
  if(!Number.isFinite(previousPriceIndex)||previousPriceIndex<=0) throw new Error("Índice de preços anterior deve ser positivo.");
  if(!Number.isFinite(currentPriceIndex)||currentPriceIndex<0) throw new Error("Índice de preços atual deve ser não negativo.");
  return Number((((currentPriceIndex-previousPriceIndex)/previousPriceIndex)*100).toFixed(8));
}

export function reconcileMoneySupply(ledgerTotalMinor:number,snapshotTotalMinor:number,toleranceMinor=0):MonetaryReconciliation{
  if(!Number.isSafeInteger(ledgerTotalMinor)||ledgerTotalMinor<0) throw new Error("Total do ledger inválido.");
  if(!Number.isSafeInteger(snapshotTotalMinor)||snapshotTotalMinor<0) throw new Error("Total do snapshot inválido.");
  if(!Number.isSafeInteger(toleranceMinor)||toleranceMinor<0) throw new Error("Tolerância inválida.");
  const differenceMinor=snapshotTotalMinor-ledgerTotalMinor;
  return {ledgerTotalMinor,snapshotTotalMinor,differenceMinor,toleranceMinor,isBalanced:Math.abs(differenceMinor)<=toleranceMinor};
}

export function deriveSnapshotMetrics(input:EconomySnapshotMetrics):Readonly<{
  moneyVelocity:number;
  inflationRatePercent:number|null;
}>{
  return {
    moneyVelocity:calculateMoneyVelocity(input.transactionVolumeMinor,input.moneySupplyMinor),
    inflationRatePercent:calculateInflationRate(input.previousPriceIndex,input.currentPriceIndex)
  };
}

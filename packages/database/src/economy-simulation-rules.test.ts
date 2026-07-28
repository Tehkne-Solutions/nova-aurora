import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateInflationRate,
  calculateMoneyVelocity,
  deriveSnapshotMetrics,
  reconcileMoneySupply
} from "./economy-simulation-rules.js";

test("calcula velocidade monetária com oito casas",()=>{
  assert.equal(calculateMoneyVelocity(250000,100000),2.5);
});

test("retorna velocidade zero sem estoque monetário",()=>{
  assert.equal(calculateMoneyVelocity(0,0),0);
});

test("calcula inflação positiva e deflação",()=>{
  assert.equal(calculateInflationRate(100,105),5);
  assert.equal(calculateInflationRate(100,95),-5);
});

test("não inventa inflação quando uma janela não possui índice",()=>{
  assert.equal(calculateInflationRate(null,100),null);
  assert.equal(calculateInflationRate(100,null),null);
});

test("reconciliação detecta diferença monetária fora da tolerância",()=>{
  const result=reconcileMoneySupply(100000,100025,10);
  assert.equal(result.differenceMinor,25);
  assert.equal(result.isBalanced,false);
});

test("reconciliação aceita diferença dentro da tolerância explícita",()=>{
  const result=reconcileMoneySupply(100000,99995,5);
  assert.equal(result.differenceMinor,-5);
  assert.equal(result.isBalanced,true);
});

test("deriva métricas sem alterar os valores de origem",()=>{
  const input={moneySupplyMinor:200000,transactionVolumeMinor:50000,previousPriceIndex:120,currentPriceIndex:123};
  assert.deepEqual(deriveSnapshotMetrics(input),{moneyVelocity:0.25,inflationRatePercent:2.5});
  assert.deepEqual(input,{moneySupplyMinor:200000,transactionVolumeMinor:50000,previousPriceIndex:120,currentPriceIndex:123});
});

test("rejeita totais monetários negativos",()=>{
  assert.throws(()=>reconcileMoneySupply(-1,0),/ledger inválido/i);
  assert.throws(()=>calculateMoneyVelocity(1,-1),/estoque monetário/i);
});

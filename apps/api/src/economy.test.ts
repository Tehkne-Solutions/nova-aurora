import assert from "node:assert/strict";
import test from "node:test";
import { transfer } from "@nova-aurora/ledger";
test("liquidação exemplo fecha em zero",()=>{
 const transaction=transfer({id:"t",idempotencyKey:"k",from:"bob",to:"alice",amountMinor:4400n,memo:"Compra"});
 assert.equal(transaction.entries.reduce((sum,e)=>sum+e.amountMinor,0n),0n);
});

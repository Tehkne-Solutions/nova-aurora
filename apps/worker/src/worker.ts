import { db } from "@nova-aurora/database";
const sql=db();
const seconds=Number(process.env.ECONOMY_TICK_SECONDS??60);
async function tick(){
 const events=await sql.begin(async tx=>{
  const rows=await tx`SELECT id,event_type,payload FROM outbox_events WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`;
  for(const row of rows){ console.log(JSON.stringify(row)); await tx`UPDATE outbox_events SET published_at=now() WHERE id=${String(row.id)}::uuid`; }
  await tx`UPDATE reservations SET status='expired' WHERE status='active' AND expires_at<=now()`;
  return rows.length;
 });
 console.log(JSON.stringify({event:"world.tick.completed",publishedEvents:events,signature:"Tehkné Solutions"}));
}
await tick(); setInterval(()=>void tick(),seconds*1000);

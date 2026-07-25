import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { snapshot, verticalSlice } from "./economy.js";
const app=Fastify({logger:true});
await app.register(cors,{origin:true});
await app.register(sensible);
app.get("/health",async()=>({status:"ok",service:"nova-aurora-api",signature:"Tehkné Solutions"}));
app.get("/v1/economy/snapshot",async()=>snapshot());
app.post("/v1/tutorial/run",async(request)=>{
  const key=request.headers["idempotency-key"];
  if(typeof key!=="string"||key.length<8) throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  return verticalSlice(key);
});
await app.listen({host:"0.0.0.0",port:Number(process.env.API_PORT??4000)});

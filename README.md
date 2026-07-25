# Nova Aurora

Mundo econômico virtual persistente da **Tehkné Solutions**.

Este repositório contém o primeiro vertical slice técnico:

`trabalho público → trigo → farinha → pão → oferta → compra → ledger → inventário`

## Stack

- Next.js 16 + React 19
- Fastify 5
- PostgreSQL 17
- Redis 8
- TypeScript 5.9
- pnpm + Turborepo

## Execução local

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
corepack enable
pnpm install
pnpm db:migrate
pnpm dev
```

Acesse:

- Web: `http://localhost:3000`
- API: `http://localhost:4000/health`
- Dashboard: `http://localhost:3000/dashboard`

## Princípios econômicos

- dupla entrada;
- valores monetários inteiros em centésimos de CA;
- idempotência em comandos;
- reservas de saldo e estoque;
- liquidação serializável;
- transactional outbox;
- blockchain fora do caminho crítico do MVP.

**Tehkné Solutions**


## Sprint 2 — Market & Production Core

- matching de ordens por preço e prioridade temporal;
- preenchimento parcial;
- reservas de saldo e inventário;
- cancelamento com liberação atômica;
- produção temporizada por BullMQ;
- recuperação por varredura do worker;
- eventos em tempo real via Redis Pub/Sub e WebSocket;
- histórico de trades e preços.

Consulte `docs/SPRINT_2_MARKET_PRODUCTION_CORE.md`.

**Tehkné Solutions**

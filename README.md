# Nova Aurora

Mundo econômico virtual persistente da **Tehkné Solutions**.

O projeto combina gameplay de cidade, profissões, produção, empresas, mercado entre
jogadores e uma camada econômica auditável.

## Vertical slice atual

`Centro de Empregos → minijogo de colheita → farinha → pão → oferta → compra → ledger`

## Stack

- Next.js 16 + React 19;
- Fastify 5;
- PostgreSQL 17;
- Redis 8 + BullMQ;
- WebSocket;
- TypeScript 5.9;
- pnpm + Turborepo.

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

- jogo: `http://localhost:3000/game`;
- dashboard: `http://localhost:3000/dashboard`;
- API: `http://localhost:4000/health`.

## Sistemas implementados

- ledger de dupla entrada;
- reservas de saldo e estoque;
- matching por preço e prioridade temporal;
- preenchimento parcial e cancelamento;
- produção temporizada;
- transactional outbox;
- eventos em tempo real;
- quatro distritos persistentes;
- personagem e deslocamento animado;
- NPCs e diálogos contextuais;
- trabalhos públicos;
- minijogo agrícola validado no servidor;
- onboarding baseado em fatos econômicos.

## Documentação

- `docs/ARCHITECTURE.md`;
- `docs/SPRINT_1_PERSISTENT_ECONOMY.md`;
- `docs/SPRINT_2_MARKET_PRODUCTION_CORE.md`;
- `docs/SPRINT_3_CITY_GAMEPLAY.md`;
- `docs/SPRINT_4_GAMEPLAY_EXPERIENCE.md`.

**Tehkné Solutions**

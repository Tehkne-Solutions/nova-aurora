# Nova Aurora

Mundo econômico virtual persistente da **Tehkné Solutions**.

O projeto combina gameplay de cidade, profissões, produção, empresas, mercado entre
jogadores, governança municipal e uma camada econômica auditável.

## Vertical slice atual

`identidade forte → cidade → trabalho → produção → empresa → mercado protegido → governança → compliance → ledger`

## Stack

- Next.js 16 + React 19;
- Fastify 5;
- PostgreSQL 17;
- Redis 8 + BullMQ;
- WebSocket autenticado;
- Prometheus + Grafana;
- Caddy com HTTPS automático;
- Docker Compose;
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

- login: `http://localhost:3000/login`;
- jogo: `http://localhost:3000/game`;
- propriedades e empresas: `http://localhost:3000/business`;
- mercado público: `http://localhost:3000/marketplace`;
- gestão regional: `http://localhost:3000/management`;
- governança: `http://localhost:3000/governance`;
- prefeitura: `http://localhost:3000/municipality`;
- identidade e privacidade: `http://localhost:3000/account`;
- integridade econômica: `http://localhost:3000/integrity`;
- dashboard econômico: `http://localhost:3000/dashboard`;
- API: `http://localhost:4000/health`.

## Identidade local

As contas demonstrativas existem somente para validação local:

- Alice: `alice@nova-aurora.local` / `Aurora@2026`;
- Bob: `bob@nova-aurora.local` / `Horizonte@2026`.

A API bloqueia a inicialização em `NODE_ENV=production` enquanto essas senhas
continuarem ativas. O bootstrap de produção exige nova senha administrativa,
revoga sessões antigas e desativa Bob por padrão.

## Produção

Arquivos principais:

- `Dockerfile.api`;
- `Dockerfile.worker`;
- `Dockerfile.web`;
- `infra/docker-compose.prod.yml`;
- `.env.production.example`;
- `infra/secrets/README.md`;
- `docs/RUNBOOK_PRODUCTION.md`.

O stack público expõe somente o Caddy. PostgreSQL, Redis, API, worker,
Prometheus e Grafana permanecem na rede interna.

Endpoints operacionais:

```text
GET /health/live
GET /health/ready
GET /metrics
```

O endpoint `/metrics` exige Bearer token interno.

## Publicação

- tags `v*` publicam API, worker e web no GHCR;
- as imagens recebem tags semânticas, SBOM e proveniência;
- deploys usam o ambiente protegido `production`;
- o runner de produção mantém secrets fora do checkout;
- cada deploy cria backup antes da atualização;
- readiness público decide sucesso ou rollback;
- a última tag saudável permanece registrada no servidor.

## Backups

O serviço de backup gera dump custom do PostgreSQL, checksum SHA-256 e metadados
JSON. A verificação restaura em banco temporário e confirma as invariantes do
ledger antes de considerar o backup válido.

## Natureza dos ativos

Por padrão, itens, Créditos Aurora, terrenos e participações são ativos virtuais
internos de jogo. Eles não representam automaticamente NFT, valor mobiliário,
direito de saque, participação societária externa ou promessa de rentabilidade.

Transferência externa começa desabilitada. Qualquer preparação para blockchain
exige classificação explícita, revisão jurídica e mudança auditada com segunda
aprovação administrativa.

## Sistemas implementados

- autenticação por senha com bcrypt;
- recuperação de conta com token opaco;
- TOTP e códigos de recuperação;
- cifragem separada dos segredos MFA;
- sessões opacas persistidas somente como hash;
- rotação e revogação de sessão;
- papéis e autorização;
- consentimentos e histórico;
- exportação de dados;
- exclusão com carência e pseudonimização;
- retenções legais;
- trilha de auditoria;
- rate limiting persistente;
- antifraude e perfis de risco;
- limites por ordem, dia, velocidade e ordens abertas;
- circuit breakers por preço;
- governança de mudanças com dupla aprovação;
- classificação de ativos e barreira de tokenização;
- tickets WebSocket de uso único;
- presença e notificações ao vivo;
- liveness e readiness reais;
- logs estruturados e request IDs;
- métricas Prometheus e dashboard Grafana;
- regras de alerta operacional;
- deploy controlado e rollback;
- backup, restore e verificação automatizada;
- ledger de dupla entrada;
- reservas de saldo e estoque;
- matching por preço e prioridade temporal;
- preenchimento parcial e cancelamento;
- produção temporizada;
- transactional outbox;
- personagens, NPCs, diálogos e minijogos;
- terrenos, construções e empresas;
- participação fracionada interna;
- consumidores NPC, empregos e folha salarial;
- estoque comercial, fornecedores e contratos B2B;
- campanhas, metas e indicadores regionais;
- licenças, licitações e orçamento participativo;
- ciclos fiscais, serviços urbanos e emergências;
- eleições, conselho e políticas públicas.

## Documentação

- `docs/ARCHITECTURE.md`;
- `docs/RUNBOOK_PRODUCTION.md`;
- `docs/SPRINT_1_PERSISTENT_ECONOMY.md`;
- `docs/SPRINT_2_MARKET_PRODUCTION_CORE.md`;
- `docs/SPRINT_3_CITY_GAMEPLAY.md`;
- `docs/SPRINT_4_GAMEPLAY_EXPERIENCE.md`;
- `docs/SPRINT_6_PROPERTY_BUSINESS_GAMEPLAY.md`;
- `docs/SPRINT_7_BUSINESS_OPERATIONS_MARKETPLACE.md`;
- `docs/SPRINT_8_REGIONAL_ECONOMY_BUSINESS_MANAGEMENT.md`;
- `docs/SPRINT_9_CITY_EXPANSION_GOVERNANCE.md`;
- `docs/SPRINT_10_MUNICIPAL_OPERATIONS_CIVIC_ELECTIONS.md`;
- `docs/SPRINT_11_IDENTITY_SECURITY_LIVE_CITY.md`;
- `docs/SPRINT_12_PUBLIC_DEPLOYMENT_OBSERVABILITY.md`;
- `docs/SPRINT_13_ECONOMY_INTEGRITY_COMPLIANCE.md`.

**Tehkné Solutions**

# Nova Aurora

Mundo econômico virtual persistente da **Tehkné Solutions**.

O projeto combina gameplay de cidade, profissões, produção, empresas, mercado entre
jogadores, governança municipal, integridade econômica e abertura pública controlada.

## Vertical slice atual

`identidade verificada → beta controlado → cidade → trabalho → produção → empresa → mercado protegido → governança → compliance → ledger`

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

- login e cadastro: `http://localhost:3000/login`;
- confirmação de e-mail: `http://localhost:3000/verify-email`;
- recuperação: `http://localhost:3000/recover-account`;
- jogo: `http://localhost:3000/game`;
- propriedades e empresas: `http://localhost:3000/business`;
- mercado público: `http://localhost:3000/marketplace`;
- gestão regional: `http://localhost:3000/management`;
- governança: `http://localhost:3000/governance`;
- prefeitura: `http://localhost:3000/municipality`;
- identidade e privacidade: `http://localhost:3000/account`;
- integridade econômica: `http://localhost:3000/integrity`;
- release candidate: `http://localhost:3000/release`;
- dashboard econômico: `http://localhost:3000/dashboard`;
- API: `http://localhost:4000/health`.

## Identidade local

As contas demonstrativas existem somente para validação local:

- Alice: `alice@nova-aurora.local` / `Aurora@2026`;
- Bob: `bob@nova-aurora.local` / `Horizonte@2026`.

A API bloqueia a inicialização em `NODE_ENV=production` enquanto essas senhas
continuarem ativas. O bootstrap de produção exige nova senha administrativa,
revoga sessões antigas e desativa Bob por padrão.

## Cadastro do beta

O ambiente aceita três modos:

```text
PUBLIC_REGISTRATION_MODE=open
PUBLIC_REGISTRATION_MODE=invite-only
PUBLIC_REGISTRATION_MODE=closed
```

Em produção, o padrão recomendado é `invite-only`. Novas contas precisam confirmar
o e-mail antes de executar operações mutáveis. Convites podem ser limitados a um
e-mail ou domínio, expiram e possuem quantidade máxima de resgates.

## E-mail transacional

Verificação e recuperação usam uma outbox persistente. O conteúdo da mensagem fica
cifrado no PostgreSQL e o worker entrega por um endpoint HTTPS autenticado. Falhas
recebem retry exponencial e seguem para dead-letter após cinco tentativas.

A API não retorna tokens de recuperação em produção.

## Produção

Arquivos principais:

- `Dockerfile.api`;
- `Dockerfile.worker`;
- `Dockerfile.web`;
- `infra/docker-compose.prod.yml`;
- `.env.production.example`;
- `infra/secrets/README.md`;
- `docs/RUNBOOK_PRODUCTION.md`;
- `docs/RUNBOOK_PUBLIC_BETA.md`.

O stack público expõe somente o Caddy. PostgreSQL, Redis, API, worker,
Prometheus e Grafana permanecem na rede interna.

Endpoints operacionais:

```text
GET /health/live
GET /health/ready
GET /metrics
```

O endpoint `/metrics` exige Bearer token interno.

## Qualidade do release

O CI valida:

- migrations e TypeScript estrito;
- testes transacionais e regressão;
- build integral;
- Chrome headless real com login pela interface;
- acessibilidade estrutural e exceções JavaScript;
- carga concorrente e p95;
- Compose, Caddy e Prometheus;
- imagens de produção;
- backup e restauração.

As evidências do navegador e da carga são publicadas no artifact
`release-qa-evidence`.

## Publicação

- tags `v*` publicam API, worker e web no GHCR;
- as imagens recebem tags semânticas, SBOM e proveniência;
- deploys usam o ambiente protegido `production`;
- o runner de produção mantém secrets fora do checkout;
- cada deploy cria backup antes da atualização;
- readiness público decide sucesso ou rollback;
- a última tag saudável permanece registrada no servidor;
- a abertura pública continua condicionada aos gates da central `/release`.

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
- verificação de e-mail de uso único;
- cadastro aberto, por convite ou fechado;
- convites com expiração, escopo e limite de usos;
- gate de operações para contas não verificadas;
- outbox de e-mail com conteúdo cifrado;
- retry exponencial e dead-letter;
- central de release e evidências;
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
- transactional outbox econômico;
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
- `docs/RUNBOOK_PUBLIC_BETA.md`;
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
- `docs/SPRINT_13_ECONOMY_INTEGRITY_COMPLIANCE.md`;
- `docs/SPRINT_14_RELEASE_CANDIDATE_PUBLIC_BETA.md`.

**Tehkné Solutions**

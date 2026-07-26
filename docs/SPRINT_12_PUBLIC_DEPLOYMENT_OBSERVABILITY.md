# Sprint 12 — Public Deployment & Observability

## Objetivo

Preparar a Nova Aurora para publicação pública controlada, com imagens
reproduzíveis, proxy TLS, redes privadas, métricas, alertas, backups, restauração
verificada e rollback de deploy.

## Imagens de produção

Foram criadas imagens independentes:

- `nova-aurora-api`;
- `nova-aurora-worker`;
- `nova-aurora-web`.

As imagens usam:

- Node.js 22 Alpine;
- pnpm 10.13.1;
- build em estágio separado;
- usuário `node` no runtime;
- `tini` como PID 1 na API e no worker;
- encerramento gracioso por `SIGTERM` e `SIGINT`.

## Proxy e TLS

O Caddy atende apenas as portas públicas 80 e 443:

- `https://<domínio>` → web;
- `https://api.<domínio>` → API e WebSocket;
- `https://ops.<domínio>` → Grafana.

Banco, Redis, API, worker, Prometheus e Grafana permanecem em rede Docker
interna. O Caddy administra certificados e redirecionamento HTTPS.

## Segredos

Credenciais são montadas por arquivos Docker secrets:

- PostgreSQL;
- Redis;
- token interno de métricas;
- senha inicial administrativa;
- senha opcional de Bob;
- senha do Grafana.

O bootstrap monta `DATABASE_URL` e `REDIS_URL` em memória, sem inserir o
conteúdo dos arquivos no Compose.

## Migração segura

O serviço `migrate`:

1. aguarda PostgreSQL e Redis;
2. executa todas as migrations;
3. exige nova senha administrativa;
4. troca a senha de Alice;
5. troca ou randomiza a senha de Bob;
6. desativa Bob por padrão;
7. revoga sessões antigas;
8. grava auditoria de implantação;
9. libera API e worker somente após sucesso.

## Liveness e readiness

API:

```text
/health/live
/health/ready
/metrics
```

Worker:

```text
:4010/health/live
:4010/health/ready
:4010/metrics
```

Liveness confirma que o processo está executando. Readiness consulta PostgreSQL
e Redis com timeout. O endpoint de métricas exige o token interno.

## Logs e correlação

A API registra logs JSON com:

- request ID;
- método;
- rota;
- código HTTP;
- erros estruturados;
- versão;
- commit;
- credenciais e cookies redigidos.

O worker registra:

- ticks;
- jobs;
- duração;
- ordens concluídas;
- eventos publicados;
- falhas;
- versão e commit.

## Prometheus e Grafana

O Prometheus coleta métricas autenticadas da API e do worker. O Grafana recebe
provisionamento automático de datasource e dashboard.

O dashboard apresenta:

- prontidão das dependências;
- requisições por segundo;
- latência média;
- requisições ativas;
- status HTTP;
- memória;
- atividade do worker;
- idade do último tick.

## Alertas

Foram definidas regras para:

- API ou worker indisponível;
- PostgreSQL ou Redis indisponível;
- tick econômico atrasado;
- taxa de HTTP 5xx acima de 5%;
- falhas recentes no worker.

As regras ficam prontas no Prometheus. O receptor externo do Alertmanager pode
ser conectado na etapa de operação do ambiente.

## Backups

O serviço de backup executa `pg_dump` no formato custom:

- grava primeiro em arquivo temporário;
- valida o catálogo com `pg_restore --list`;
- move atomicamente para o nome final;
- gera SHA-256;
- gera metadados JSON;
- aplica retenção configurável;
- registra logs JSON.

O script `verify.sh`:

1. confere checksum;
2. cria banco temporário;
3. restaura o dump;
4. confirma usuários e contas;
5. verifica que não existem transações desequilibradas;
6. remove o banco temporário.

## Entrega contínua

### Publicação de imagens

Tags `v*` publicam as três imagens no GHCR com:

- tags semânticas;
- tag por SHA;
- cache BuildKit;
- metadados OCI;
- SBOM;
- proveniência de build.

### Deploy

O workflow manual de produção:

- requer aprovação do ambiente `production`;
- executa em runner dedicado;
- lê ambiente e segredos fora do checkout;
- cria backup pré-deploy;
- puxa a tag solicitada;
- executa migrations;
- publica os serviços;
- aguarda readiness pela URL pública;
- salva a última tag saudável;
- realiza rollback automático em falha.

## CI

Além de migrations, typecheck, testes e build, o CI valida:

- sintaxe dos scripts;
- JSON do dashboard;
- Compose resolvido;
- Caddyfile;
- Prometheus e regras;
- três imagens Docker;
- criação real de backup;
- restauração em banco temporário;
- invariantes do ledger restaurado.

## Próxima sprint

Sprint 13 — Economy Integrity & Compliance:

- administração de identidades;
- recuperação de conta;
- 2FA;
- políticas de privacidade e consentimento;
- retenção e exportação de dados;
- controles antifraude;
- limites econômicos;
- circuit breakers do mercado;
- trilha de governança de alterações;
- preparação regulatória de ativos tokenizados.

**Tehkné Solutions**

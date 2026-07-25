# Sprint 11 — Identity, Security & Live City

## Objetivo

Substituir a identidade de desenvolvimento baseada em cabeçalho por autenticação
real, sessões persistentes, papéis, auditoria, proteção contra abuso e presença em
tempo real.

## Autenticação

- senhas protegidas com bcrypt pelo `pgcrypto`;
- tokens opacos de 256 bits;
- apenas o SHA-256 do token é persistido;
- sessões com validade de sete dias;
- rotação revoga imediatamente a sessão anterior;
- logout revoga a sessão e encerra a presença;
- cadastro idempotente sem persistir token bruto;
- mensagem genérica para falhas de login.

## Papéis

Papéis suportados:

- `citizen`;
- `company-owner`;
- `employee`;
- `council-member`;
- `municipal-admin`;
- `platform-admin`.

A alternância entre Alice e Bob nas telas de validação deixa de ser autenticação.
O frontend remove `x-actor-email` e envia `x-actor-context` somente quando a sessão
possui `platform-admin`. A API registra a delegação na trilha de auditoria.

## Auditoria

A tabela `security_audit_log` registra:

- usuário autenticado;
- usuário afetado;
- sessão;
- ação;
- recurso;
- resultado;
- risco;
- hashes de IP e user agent;
- metadados;
- horário.

Comandos mutáveis autenticados são auditados automaticamente pelo runtime.

## Rate limiting

Os limites são persistidos no PostgreSQL e protegidos por advisory lock.
Bloqueios permanecem gravados mesmo quando a requisição é recusada.

- login: cinco tentativas por quinze minutos;
- cadastro: quatro tentativas por minuto, com bloqueio prolongado;
- API autenticada: 180 requisições por minuto por escopo.

## Tempo real

O WebSocket não recebe o token principal na URL. O fluxo é:

1. sessão Bearer solicita `/v1/auth/realtime-ticket`;
2. API cria ticket aleatório válido por 60 segundos;
3. somente o hash é armazenado;
4. o WebSocket consome o ticket uma única vez;
5. a presença é registrada;
6. heartbeats atualizam estado e localização;
7. desconexão marca o usuário como offline.

## Notificações

Usuários possuem caixa persistente de notificações com severidade, payload,
horário e estado de leitura.

## Proteção de produção

A API recusa inicialização em `NODE_ENV=production` enquanto as senhas
demonstrativas de Alice ou Bob ainda estiverem ativas.

Credenciais locais:

- Alice: `alice@nova-aurora.local` / `Aurora@2026`;
- Bob: `bob@nova-aurora.local` / `Horizonte@2026`.

Elas não podem ser usadas em deploy público.

## Experiência

Novas rotas:

```text
/login
/account
```

Rotas protegidas redirecionam para `/login` sem sessão válida. O provedor global
injeta o Bearer token em todas as chamadas da API.

## Validação

O teste de integração cobre:

- login e papéis;
- autenticação por token;
- contexto administrativo;
- ticket de uso único;
- rotação;
- revogação;
- cadastro idempotente;
- ausência de token em `idempotency_records`;
- bloqueio persistente do rate limit;
- regressão econômica e cívica;
- build do frontend, API, worker e pacotes.

## Próxima sprint

Sprint 12 — Public Deployment & Observability:

- containers de produção;
- proxy TLS;
- variáveis e segredos por ambiente;
- health/readiness aprofundados;
- métricas;
- traces;
- logs estruturados;
- política de backup;
- restauração testada;
- deploy público controlado.

**Tehkné Solutions**

# Sprint 18 — Beta Insights, Support & Feature Rollouts

## Objetivo

Transformar o beta controlado em um ciclo de aprendizado mensurável, com telemetria
minimizada, feedback protegido, suporte com SLA e funcionalidades liberadas de forma
gradual e reversível.

## Escopo entregue

### Telemetria de produto

- catálogo fechado de eventos;
- ingestão autenticada em lotes de até 50 eventos;
- idempotência por evento e lote;
- propriedades limitadas a valores primitivos;
- rejeição de campos potencialmente pessoais ou secretos;
- janela máxima de sete dias para eventos atrasados;
- retenção configurável entre 30 e 365 dias;
- funil por evento e usuários únicos.

A telemetria não aceita e-mail, nome, mensagem livre, token, senha, telefone,
endereço ou documento.

### Feedback e suporte

- feedback com nota e categoria;
- conteúdo livre criptografado em repouso;
- tickets com prioridades e SLA;
- fila administrativa;
- respostas públicas ou internas;
- histórico visível ao usuário;
- gates para violações de SLA e tickets críticos.

### Feature flags

- rascunho, pronta, ativa, pausada ou retirada;
- variantes explícitas;
- percentual gradual de exposição;
- segmentação opcional por onda do beta;
- decisão determinística por usuário;
- registro persistente de exposição;
- duas aprovações independentes;
- criador impedido de aprovar ou executar a ativação final;
- pausa imediata e reversível.

### Interfaces

- `/feedback` — feedback, suporte e histórico do usuário;
- `/beta-insights` — métricas, funil, SLA e flags da operação.

## Gates adicionados

- `product-telemetry-operational`;
- `beta-support-sla-operational`;
- `feature-rollout-prepared`.

## Segurança e privacidade

- detalhes de feedback, suporte e respostas usam AES-256 via `pgcrypto`;
- eventos de produto possuem allowlist;
- campos livres não entram na telemetria;
- acesso administrativo exige papel explícito;
- feature flags exigem dupla aprovação;
- exposições são estáveis e auditáveis.

## Validação

```bash
pnpm validate:sprint18
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

## Próxima etapa

Sprint 19 — Beta Learning Loops & Economy Tuning:

- análise de coortes por onda;
- retenção D1, D7 e D30;
- experimentos com hipótese e critério de sucesso;
- ajuste econômico versionado;
- comparação de preços, empregos e falências por coorte;
- decisão formal de promover, pausar ou retirar mudanças.

**Tehkné Solutions**

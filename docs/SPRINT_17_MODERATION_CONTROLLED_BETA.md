# Sprint 17 — Moderation Operations & Controlled Beta Activation

## Objetivo

Transformar os canais e ensaios das Sprints 15 e 16 em uma operação diária capaz de atender denúncias dentro de SLA, aplicar ações auditáveis, oferecer recurso humano e ativar usuários em ondas limitadas com pausa e rollback.

## Escopo entregue

### Moderação operacional

- políticas de SLA por prioridade;
- prazos automáticos de primeiro atendimento e resolução;
- atribuição explícita e reconhecimento de atendimento;
- turnos de cobertura;
- advertência, restrição econômica, suspensão, remoção ou ausência de ação;
- recursos criptografados e decisão humana registrada;
- restauração controlada quando o recurso é acolhido;
- gate `moderation-sla-coverage`.

### Beta controlado

- controle global de rollout e kill switch;
- ondas planejadas, ativas, pausadas, concluídas ou revertidas;
- percentual alvo e limite absoluto de ativações;
- inscrição explícita de usuários verificados;
- métricas de erro, latência, denúncias críticas e usuários ativos;
- pausa automática por degradação;
- rollback automático por denúncia crítica acima do limite;
- gate `controlled-beta-wave-prepared`;
- enforcement global quando `BETA_ROLLOUT_MODE=controlled`.

### Interfaces

- `/moderation` — fila, SLA, ações, recursos e cobertura;
- `/beta-control` — ondas, membros, métricas, transições e kill switch;
- `/appeal` — recurso autenticado de ação moderativa.

## Critérios de segurança

Uma onda não inicia quando há gate pendente, componente não operacional, cobertura inválida, SLA vencido ou kill switch ativo. Durante a onda, erro ou latência acima do limite causam pausa; denúncia crítica acima do limite provoca rollback e revogação dos membros.

## Validação

```bash
pnpm validate:sprint17
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

A implementação não automatiza conclusão jurídica, contato com autoridades, validação de identidade civil ou aprovação externa.

**Tehkné Solutions**

# Sprint 19 — Suporte Operacional e Rollouts por Feature Flag

## Objetivo

Transformar os sinais consolidados pela Sprint 18 em operações rastreáveis de suporte, resposta ao usuário e liberação gradual de funcionalidades.

Versão-alvo: `0.19.0`.

## Princípio de arquitetura

A Sprint 19 **não recria telemetria nem feedback**.

Ela utiliza como fonte canônica:

- `beta_telemetry_events` e `beta_daily_metrics` para evidências de produto;
- `beta_feedback` e `beta_feedback_updates` para classificação e acompanhamento;
- `beta_learning_reports` para decisões de expansão, manutenção ou redução;
- `beta_rollout_waves` e `beta_wave_members` para segmentação por onda.

As novas estruturas devem ficar limitadas a:

- tickets e atualizações de suporte;
- feature flags, aprovações e exposições;
- gates operacionais de suporte e rollout.

## Entrega 1 — Suporte operacional

### Modelo

Criar migration `026_beta_support_feature_rollouts.sql` com:

- `beta_support_tickets`;
- `beta_support_updates`;
- índices de fila, SLA e usuário;
- gate `beta-support-sla-operational`.

### Capacidades

- abertura idempotente por usuário;
- categorias de conta, técnica, gameplay, economia, segurança e privacidade;
- prioridades `low`, `normal`, `high` e `critical`;
- prazos de primeira resposta e resolução calculados pela prioridade;
- recálculo dos prazos quando a prioridade mudar;
- atribuição somente a usuários ativos com papel administrativo compatível;
- histórico público e interno;
- atualizações públicas renderizadas para o usuário;
- estados `open`, `acknowledged`, `in-progress`, `waiting-user`, `resolved` e `closed`;
- gate bloqueado por ticket crítico aberto ou SLA vencido.

### SLA inicial

| Prioridade | Primeira resposta | Resolução |
|---|---:|---:|
| critical | 15 minutos | 4 horas |
| high | 1 hora | 24 horas |
| normal | 8 horas | 72 horas |
| low | 24 horas | 7 dias |

## Entrega 2 — Feature flags auditáveis

### Modelo

Na mesma migration:

- `beta_feature_flags`;
- `beta_feature_flag_approvals`;
- `beta_feature_exposures`;
- gate `feature-rollout-prepared`.

### Capacidades

- variantes e fallback explícitos;
- rollout percentual determinístico por usuário;
- segmentação opcional por onda;
- duas aprovações independentes;
- criador não pode completar sozinho a aprovação;
- ativação, pausa e aposentadoria auditadas;
- atualização de aprovação não pode desativar silenciosamente uma flag ativa;
- primeira exposição preservada, sem sobrescrever `exposed_at` em avaliações posteriores;
- kill switch por flag;
- exposição somente quando status, aprovação, audiência e percentual permitirem;
- integração com relatórios de aprendizado da Sprint 18.

## Entrega 3 — API e experiência

### Usuário

- criar e acompanhar tickets em `/feedback` ou `/support`;
- visualizar respostas públicas, mudanças de status e prazos;
- receber contexto claro quando estiver aguardando o suporte.

### Administração

- fila operacional em `/beta-insights`;
- classificação, prioridade, responsável e resposta;
- criação e aprovação de flags;
- ativação e pausa separadas da aprovação;
- métricas de SLA e exposição;
- ações exclusivas de plataforma ocultas de administradores municipais quando a API não autorizar a operação.

## Entrega 4 — Operação automática

O worker deve:

- atualizar gates de suporte e rollout periodicamente;
- identificar violações de SLA;
- executar retenção automática dos eventos brutos conforme a política vigente da Sprint 18;
- nunca depender exclusivamente de uma chamada HTTP administrativa para retenção ou reconciliação de gates.

## Requisitos de segurança e privacidade

- detalhes livres de tickets e respostas cifrados em repouso;
- idempotência sempre escopada ao usuário autenticado;
- nenhum token, senha, documento, telefone, endereço ou dado pessoal deve ser armazenado como propriedade livre de telemetria;
- RBAC aplicado na API e refletido na interface;
- toda alteração operacional relevante deve atualizar autoria e horário do gate correspondente.

## Regressões obrigatórias

A implementação deve incluir testes que comprovem:

1. mudança de prioridade recalcula SLA;
2. usuário comum não pode ser responsável por ticket;
3. respostas públicas aparecem no histórico do usuário;
4. idempotency keys iguais de usuários diferentes não colidem;
5. aprovação posterior não desativa flag ativa;
6. primeira exposição não é sobrescrita;
7. flag sem duas aprovações não ativa;
8. administrador municipal não recebe controles exclusivos de plataforma;
9. retenção e gates são processados automaticamente pelo worker;
10. queries não usam aliases que conflitem com palavras reservadas do PostgreSQL.

## Critérios de conclusão

- migrations PostgreSQL aplicadas e reversíveis por backup/restauração;
- TypeScript estrito sem erros;
- testes unitários e de integração aprovados;
- build integral aprovado;
- navegador, acessibilidade e carga aprovados;
- imagens de produção construídas;
- runbook operacional publicado;
- PR sem implementação concorrente ou duplicação da Sprint 18;
- assinatura exclusiva **Tehkné Solutions**.

**Tehkné Solutions**

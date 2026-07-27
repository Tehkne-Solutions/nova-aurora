# Sprint 20 — Experimentação, Análise de Coortes e LiveOps

## Objetivo

Transformar feature flags, exposições, telemetria, feedback e suporte em experimentos controlados, decisões humanas auditáveis e operações LiveOps rastreáveis.

Versão-alvo: `0.20.0`.

## Estado

**Implementação concluída no PR #22 e validada pelo CI.**

A Sprint 20 reutiliza, sem duplicar:

- `beta_telemetry_events` e `beta_daily_metrics` da Sprint 18;
- `beta_feedback` e `beta_learning_reports` da Sprint 18;
- `beta_support_tickets` e seus SLAs da Sprint 19;
- `beta_feature_flags` e `beta_feature_exposures` da Sprint 19;
- ondas e membros do beta controlado.

## Entregas implementadas

### 1. Experimentos vinculados a feature flags

- chave, hipótese e pergunta decisória;
- flag vinculada e variantes observadas;
- métricas primárias e secundárias;
- guardrails de erro, feedback crítico, SLA e estabilidade econômica;
- janela de início e término;
- amostra mínima, maturidade temporal e lift mínimo;
- duas aprovações independentes;
- criador impedido de aprovar o próprio experimento;
- estados `draft`, `approved`, `running`, `paused`, `completed` e `cancelled`.

### 2. Coortes e resultados

- exposição persistente e determinística por feature flag;
- agregação por variante e período;
- usuários expostos e ativos;
- conversão;
- retenção D1 e D7 elegível;
- taxa de erro;
- duração média de sessão;
- feedback médio e crítico;
- tickets e violações de SLA;
- estabilidade econômica;
- recomendação `expand`, `hold`, `reduce` ou `stop`.

Coortes imaturas geram `hold`. Guardrails violados registram evidência e nunca alteram rollout automaticamente.

### 3. Worker de agregação

O worker reconcilia resultados por experimento e variante, preservando:

- limites temporais do período;
- elegibilidade de retenção;
- exposições históricas;
- evidências de rollback;
- resultados concluídos.

### 4. Decision Center

A central administrativa apresenta:

- experimentos aguardando decisão;
- recomendação calculada mais recente;
- guardrails acionados;
- experimentos expirados;
- quantidade de resultados disponíveis;
- decisões humanas `expand`, `hold`, `reduce`, `stop` ou `reject`;
- justificativa, evidências e resultados utilizados;
- acesso somente leitura para administrador municipal;
- ações críticas exclusivas de administrador da plataforma.

### 5. Relatório final e base de aprendizado

Após uma decisão humana, o sistema gera relatório persistente com:

- hipótese e pergunta decisória;
- feature flag e métricas;
- guardrails;
- resultados por variante;
- decisão e justificativa;
- aprendizado consolidado;
- recomendações futuras;
- hash SHA-256 do conteúdo canônico para auditoria.

Os relatórios formam a base histórica consultável do programa de experimentação.

### 6. LiveOps

- calendário operacional;
- eventos de início, revisão, pausa e conclusão;
- comunicação, manutenção e incidentes;
- transições auditáveis de status;
- timeline consolidada por experimento;
- integração ao estado geral de release;
- gate `beta-experimentation-ready`.

## Superfícies entregues

### Banco

- `027_beta_experimentation_liveops.sql`;
- `028_beta_decision_center.sql`.

### API

- `/v1/beta-experiments/*`;
- `/v1/beta-liveops/*`;
- `/v1/beta-decisions/*`;
- integração em `/v1/release/state`.

### Interface

- `/experiments-liveops`;
- resultados por variante;
- timeline auditável;
- calendário LiveOps;
- fila do Decision Center;
- registro de decisão;
- geração e consulta de relatórios finais.

## Regressões obrigatórias cobertas

1. exposição futura não entra em resultado histórico;
2. variante permanece estável;
3. retenção imatura mantém `hold`;
4. feedback ou suporte crítico impede expansão;
5. violação econômica vira guardrail explícito;
6. experimento sem duas aprovações não inicia;
7. criador não aprova o próprio experimento;
8. administrador municipal possui leitura, não mutação crítica;
9. resultados preservam evidências de rollback;
10. relatório final mantém métricas e decisão publicadas;
11. recomendação automatizada não substitui decisão humana;
12. relatório final exige decisão registrada.

## Critérios de conclusão

- [x] migrations PostgreSQL 027 e 028;
- [x] regras puras e testes de regressão;
- [x] serviços transacionais e rotas autenticadas;
- [x] worker de agregação e reconciliação;
- [x] calendário e timeline LiveOps;
- [x] Decision Center;
- [x] relatório final com hash de auditoria;
- [x] central administrativa integrada;
- [x] documentação operacional;
- [x] TypeScript, testes e build aprovados no CI;
- [x] assinatura exclusiva **Tehkné Solutions**.

## Resultado

A Sprint 20 fecha o ciclo:

`exposição → coorte → medição → guardrail → recomendação → decisão humana → operação LiveOps → relatório final → aprendizado reutilizável`

**Tehkné Solutions**

# Sprint 18 — Beta Telemetry & Community Operations

## Objetivo

Transformar a ativação controlada em um ciclo verificável de aprendizado, comunicação e decisão humana.

## Entregas

### Telemetria por onda

- eventos idempotentes vinculados ao usuário e à onda ativa;
- sessões, uso de funcionalidades, tarefas, erros, desempenho e conversões;
- janela temporal limitada a sete dias no passado e cinco minutos no futuro;
- metadados limitados a 16 KB;
- métricas diárias persistidas por onda e coorte.

### Retenção e health score

A retenção D1 e D7 considera apenas membros que já alcançaram a idade necessária da coorte. O health score combina:

- confiabilidade: 30%;
- retenção: 25%;
- avaliação da comunidade: 20%;
- conversão: 10%;
- estabilidade econômica: 15%.

O resultado produz uma recomendação `expand`, `hold` ou `reduce`. A recomendação não altera percentuais, limites ou estado da onda automaticamente.

### Feedback

- categoria, sentimento, nota e resumo estruturados;
- detalhes criptografados em repouso;
- prioridade automática para segurança, bugs e desempenho;
- triagem administrativa e histórico de atualizações;
- feedback crítico pendente bloqueia a prontidão comunitária.

### Comunicação

- anúncios gerais, para beta, para uma onda ou para administradores;
- publicação imediata ou agendada;
- expiração;
- severidade;
- confirmação de leitura;
- processamento recorrente pelo worker.

### Relatórios de aprendizado

Cada relatório preserva:

- período;
- métricas utilizadas;
- recomendação vigente;
- resumo;
- achados;
- estado de rascunho ou publicação.

## Páginas

- `/community`: comunicados vigentes;
- `/feedback`: envio estruturado;
- `/beta-insights`: painel administrativo de métricas, feedback e comunicação.

## Gate

`beta-community-operations-ready` exige:

1. pelo menos um anúncio operacional vigente;
2. nenhum feedback crítico em estado novo ou em revisão.

## Automação

O worker:

- publica anúncios agendados e expira anúncios vencidos em cada tick;
- calcula métricas uma vez por dia;
- expõe contadores Prometheus.

## Segurança da decisão

- telemetria e feedback continuam disponíveis durante uma pausa da onda;
- detalhes livres de feedback são criptografados;
- eventos fora da janela são rejeitados;
- recomendações não expandem a onda;
- somente administradores publicam comunicação e relatórios.

## Próxima sprint

Sprint 19 — Beta Experimentation & Product Learning:

- experimentos controlados;
- variantes e feature flags;
- objetivos e guardrails;
- análise de impacto por coorte;
- decisão e encerramento auditáveis.

**Tehkné Solutions**

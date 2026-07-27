# Sprint 20 — Experimentação, Análise de Coortes e LiveOps

## Objetivo

Transformar feature flags, exposições, telemetria, feedback e suporte em experimentos controlados e decisões operacionais rastreáveis.

Versão-alvo: `0.20.0`.

## Base consolidada

A Sprint 20 reutiliza, sem duplicar:

- `beta_telemetry_events` e `beta_daily_metrics` da Sprint 18;
- `beta_feedback` e `beta_learning_reports` da Sprint 18;
- `beta_support_tickets` e seus SLAs da Sprint 19;
- `beta_feature_flags` e `beta_feature_exposures` da Sprint 19;
- ondas e membros do beta controlado.

## Entrega 1 — Experimentos vinculados a feature flags

Criar experimentos com:

- chave, hipótese e decisão esperada;
- flag e variantes participantes;
- métricas primárias e secundárias;
- guardrails de erro, desempenho, economia, segurança e suporte;
- janela de início e término;
- amostra mínima e maturidade temporal;
- criador, aprovadores e trilha de auditoria;
- estados `draft`, `approved`, `running`, `paused`, `completed` e `cancelled`.

## Entrega 2 — Coortes determinísticas

- grupo controle e grupos candidatos derivados da exposição registrada;
- usuário não pode alternar de variante durante o mesmo experimento;
- primeira exposição permanece como fonte canônica;
- recomputações históricas não incluem exposições futuras;
- ondas pausadas ou revertidas continuam analisáveis;
- coortes imaturas produzem `hold`, não conclusões negativas prematuras.

## Entrega 3 — Resultados e guardrails

Calcular por variante:

- usuários expostos e ativos;
- conversão;
- retenção D1 e D7 elegível;
- taxa de erro;
- duração média de sessão;
- feedback médio e feedback crítico;
- tickets de suporte e violações de SLA;
- estabilidade econômica observada.

Guardrails violados devem recomendar pausa ou redução, registrar evidências e atualizar o gate operacional, sem alterar o rollout automaticamente.

## Entrega 4 — Decisão assistida

A central deve apresentar:

- `expand`, `hold`, `reduce` ou `stop`;
- razões e evidências por métrica;
- maturidade da amostra;
- comparação entre controle e candidatas;
- impacto por onda;
- incidentes e tickets correlacionados;
- decisão humana registrada com justificativa.

## Entrega 5 — LiveOps

- calendário operacional de experimentos e eventos do beta;
- comunicados vinculados a mudanças relevantes;
- histórico de pausas, retomadas e encerramentos;
- relatório final de aprendizado;
- promoção de descobertas para backlog, suporte ou documentação;
- gate `beta-experimentation-ready`.

## Segurança estatística e de produto

- não declarar causalidade com amostra insuficiente;
- não tratar ausência de retenção madura como retenção zero;
- não reescrever resultados históricos com usuários expostos depois do período;
- não armazenar dados pessoais livres nas propriedades do experimento;
- resultados orientam decisões, mas não representam promessa de rentabilidade financeira.

## Regressões obrigatórias

1. exposição futura é excluída de resultados históricos;
2. variante do usuário permanece estável;
3. coorte D7 imatura mantém recomendação `hold`;
4. ticket crítico bloqueia recomendação de expansão;
5. violação econômica vira guardrail explícito;
6. experimento sem duas aprovações não inicia;
7. criador não aprova sozinho o experimento;
8. administrador municipal recebe leitura, não ações exclusivas de plataforma;
9. recomputação de experimento concluído preserva evidências de rollback;
10. relatório final mantém métricas e decisão registradas no momento da publicação.

## Critérios de conclusão

- migration PostgreSQL 027;
- regras puras e testes de regressão;
- serviços transacionais e rotas autenticadas;
- worker para agregação e reconciliação;
- central administrativa e calendário LiveOps;
- documentação operacional;
- TypeScript, testes, build, Chrome, acessibilidade, carga, imagens e backup aprovados;
- assinatura exclusiva **Tehkné Solutions**.

**Tehkné Solutions**

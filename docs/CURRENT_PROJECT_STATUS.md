# Estado atual do projeto — Nova Aurora

Atualizado em 27 de julho de 2026.

## Marco consolidado na `main`

A `main` contém as entregas até a **Sprint 19 — Suporte Operacional e Rollouts por Feature Flag**.

O vertical slice consolidado cobre:

`identidade verificada → beta controlado → cidade → trabalho → produção → empresa → mercado protegido → governança → compliance → ledger → telemetria → comunidade → suporte → rollout gradual`

## Sprint 18 consolidada

A versão `0.18.0` estabeleceu o ciclo persistente de aprendizado do beta:

- telemetria vinculada ao usuário e à onda;
- métricas diárias, conversão, erro e retenção D1/D7;
- health score e recomendação `expand`, `hold` ou `reduce`;
- feedback estruturado e cifrado;
- anúncios imediatos ou agendados;
- relatórios de aprendizado;
- gate comunitário;
- preservação de evidências em pausas e rollbacks.

## Sprint 19 consolidada

A versão `0.19.0` transformou os sinais da Sprint 18 em operações:

- tickets de suporte com prioridade e SLA;
- histórico público e interno;
- detalhes e respostas cifrados em repouso;
- responsáveis validados por RBAC;
- gates de suporte reconciliados pelo worker;
- feature flags com variantes e fallback;
- duas aprovações independentes;
- exposição determinística e persistente;
- pausa e redução segura de rollout;
- ampliação condicionada a pausa e novas aprovações;
- retenção automática da telemetria;
- centrais `/feedback` e `/beta-insights`;
- 43 testes, validador arquitetural e E2E em nove rotas.

## Etapa atual

A **Sprint 20 — Experimentação, Análise de Coortes e LiveOps** está iniciada na versão-alvo `0.20.0`.

Escopo:

1. experimentos vinculados às feature flags;
2. coortes controle e candidatas determinísticas;
3. resultados por variante usando telemetria, feedback e suporte existentes;
4. guardrails de confiabilidade, economia, segurança e SLA;
5. recomendações `expand`, `hold`, `reduce` ou `stop`;
6. decisão humana registrada e auditável;
7. calendário LiveOps e relatórios finais de aprendizado;
8. gate `beta-experimentation-ready`.

O escopo completo está em `docs/SPRINT_20_EXPERIMENTATION_COHORTS_LIVEOPS.md`.

## Regra de produto

Créditos Aurora, itens, terrenos e participações continuam sendo ativos virtuais internos do jogo. Não existe promessa automática de saque, rentabilidade, tokenização, NFT ou participação societária externa. Qualquer mudança dessa natureza exige classificação explícita, revisão jurídica e aprovação administrativa auditada.

**Tehkné Solutions**

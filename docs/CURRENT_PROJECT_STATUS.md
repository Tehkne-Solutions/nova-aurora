# Estado atual do projeto — Nova Aurora

Atualizado em 27 de julho de 2026.

## Marco consolidado na `main`

A `main` contém as entregas até a **Sprint 19 — Suporte Operacional e Rollouts por Feature Flag**.

O vertical slice consolidado cobre:

`identidade verificada → beta controlado → cidade → trabalho → produção → empresa → mercado protegido → governança → compliance → ledger → telemetria → comunidade → suporte → rollout gradual`

## Sprint 20 pronta para merge

A **Sprint 20 — Experimentação, Análise de Coortes e LiveOps**, versão-alvo `0.20.0`, está implementada no PR #22 e validada pelo CI.

A entrega adiciona:

- experimentos vinculados a feature flags;
- coortes e resultados por variante;
- conversão, retenção D1/D7, erro, sessão, feedback, suporte e estabilidade econômica;
- guardrails operacionais;
- recomendações `expand`, `hold`, `reduce` ou `stop`;
- duas aprovações independentes para início;
- worker de agregação e reconciliação;
- calendário e timeline LiveOps;
- Decision Center com fila de revisão;
- decisão humana auditável, incluindo `reject`;
- relatórios finais persistentes com hash SHA-256;
- base histórica de aprendizado;
- painel `/experiments-liveops`;
- integração em `/v1/release/state`;
- gate `beta-experimentation-ready`.

O ciclo operacional passa a ser:

`exposição → coorte → medição → guardrail → recomendação → decisão humana → operação LiveOps → relatório final → aprendizado reutilizável`

Detalhes completos: `docs/SPRINT_20_EXPERIMENTATION_COHORTS_LIVEOPS.md`.

## Próxima etapa recomendada

Após o merge do PR #22, iniciar a **Sprint 21 — Economia Viva e Simulação Sistêmica**, priorizando:

1. indicadores econômicos globais e regionais;
2. oferta e demanda por categoria;
3. cadeias produtivas e gargalos;
4. agentes NPC produtores e consumidores;
5. inflação, deflação e estabilidade de preços;
6. eventos macroeconômicos e respostas administrativas;
7. observabilidade e guardrails econômicos;
8. integração dos experimentos da Sprint 20 com intervenções econômicas controladas.

## Regra de produto

Créditos Aurora, itens, terrenos e participações continuam sendo ativos virtuais internos do jogo. Não existe promessa automática de saque, rentabilidade, tokenização, NFT ou participação societária externa. Qualquer mudança dessa natureza exige classificação explícita, revisão jurídica e aprovação administrativa auditada.

**Tehkné Solutions**

# Estado atual do projeto — Nova Aurora

Atualizado em 27 de julho de 2026.

## Marco consolidado na `main`

A `main` contém as entregas até a **Sprint 17 — Operações de Moderação e Ativação Controlada do Beta**.

O vertical slice consolidado cobre:

`identidade verificada → beta controlado → cidade → trabalho → produção → empresa → mercado protegido → governança → compliance → ledger`

## Etapa em conclusão

A **Sprint 18 — Telemetria do Beta e Operações de Comunidade** está concentrada no PR canônico da versão `0.18.0`.

Entregas principais:

- telemetria persistente vinculada ao usuário e à onda;
- agregados diários de sessões, atividade, conversão, erro e retenção D1/D7;
- health score com decisão assistida `expand`, `hold` ou `reduce`;
- proteção contra decisão prematura enquanto as coortes de retenção não amadurecem;
- preservação de evidências em ondas pausadas e revertidas;
- feedback estruturado, priorizado e cifrado em repouso;
- anúncios gerais, do beta e de onda, imediatos ou agendados;
- eventos em tempo real também para publicações agendadas;
- central administrativa de aprendizado do beta;
- gate operacional de prontidão comunitária;
- validação integral por migrations, tipagem, testes, build, navegador, acessibilidade, carga, imagens de produção e backup/restauração.

## Correções de revisão incorporadas

- eventos ocorridos durante pausas permanecem associados à onda correta;
- ondas revertidas continuam disponíveis para recomputação e relatórios de incidente;
- métricas históricas desconsideram ativações futuras;
- o worker agrega o último dia UTC concluído;
- amostras sem maturidade D1/D7 permanecem em `hold`;
- anúncios do beta exigem participação válida;
- anúncios vencidos chegam ao estado terminal correto;
- publicações agendadas emitem o mesmo evento de outbox das publicações manuais;
- o gate comunitário é reconciliado em todas as passagens do worker;
- administradores municipais mantêm leitura, sem receber ações exclusivas da administração da plataforma.

## Próxima etapa recomendada

A **Sprint 19 — Suporte Operacional e Rollouts por Feature Flag** deve construir sobre a telemetria consolidada, sem duplicar a Sprint 18.

Escopo recomendado:

1. tickets de suporte com SLA, prioridade, responsáveis e histórico visível ao usuário;
2. classificação e encaminhamento operacional do feedback recebido;
3. feature flags auditáveis, com aprovação independente, exposição estável e pausa segura;
4. retenção automática dos eventos de produto;
5. gates de release para cobertura de suporte e segurança de rollout;
6. integração das decisões de rollout com os relatórios de aprendizado da Sprint 18.

## Regra de produto

Créditos Aurora, itens, terrenos e participações continuam sendo ativos virtuais internos do jogo. Não existe promessa automática de saque, rentabilidade, tokenização, NFT ou participação societária externa. Qualquer mudança dessa natureza exige classificação explícita, revisão jurídica e aprovação administrativa auditada.

**Tehkné Solutions**

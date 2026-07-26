# Playbook de Aprendizado do Beta

## Cadência diária

1. confirmar saúde dos componentes;
2. revisar erros e latência;
3. verificar feedback crítico;
4. recalcular a onda;
5. publicar comunicação quando houver mudança material;
6. preservar evidências da decisão.

## Expandir

Considere expansão apenas quando:

- existirem pelo menos 25 usuários ativados;
- health score for igual ou superior a 80;
- erro for igual ou inferior a 2%;
- retenção D7 for igual ou superior a 25%;
- avaliação média for igual ou superior a 3;
- não houver feedback crítico pendente;
- os demais gates de lançamento estiverem aprovados.

A expansão exige alteração deliberada da onda pelo fluxo da Sprint 17.

## Manter

Mantenha a onda quando:

- a amostra ainda for pequena;
- os indicadores forem inconclusivos;
- não houver risco crítico;
- correções estiverem sendo observadas.

## Reduzir

Pause ou reduza quando:

- existir feedback crítico;
- erro exceder 5%;
- health score ficar abaixo de 55;
- estabilidade econômica ou operacional se degradar.

A recomendação automática não executa rollback. O operador deve avaliar o incidente, usar o kill switch quando necessário e registrar a razão.

## Relatório de aprendizado

O relatório precisa responder:

- o que pretendíamos aprender;
- qual coorte foi observada;
- quais métricas foram usadas;
- quais limitações existem;
- o que mudou no produto;
- por que a decisão foi expandir, manter ou reduzir.

## Comunicação

Comunique:

- início, pausa e encerramento de onda;
- indisponibilidade relevante;
- mudanças econômicas que afetem decisões do jogador;
- correções de segurança e proteção;
- conclusão de experimentos.

Não comunique dados pessoais, detalhes internos exploráveis ou conclusões jurídicas não aprovadas.

**Tehkné Solutions**

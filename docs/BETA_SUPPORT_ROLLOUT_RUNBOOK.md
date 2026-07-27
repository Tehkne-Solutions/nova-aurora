# Runbook — Suporte do Beta e Rollouts de Funcionalidades

## Objetivo

Operar tickets do beta e liberações graduais de funcionalidades sem perder SLA, rastreabilidade ou capacidade de pausa.

## Rotina de suporte

1. Abrir a central administrativa de suporte.
2. Priorizar tickets `critical` e `high`.
3. Confirmar categoria, prioridade e responsável.
4. Registrar a primeira resposta como atualização visível ao usuário.
5. Manter notas internas com `visibleToUser=false`.
6. Usar `waiting-user` somente quando uma ação do usuário for realmente necessária.
7. Encerrar como `resolved` antes de `closed` quando houver solução entregue.

### SLA

| Prioridade | Primeira resposta | Resolução |
|---|---:|---:|
| critical | 15 minutos | 4 horas |
| high | 1 hora | 24 horas |
| normal | 8 horas | 72 horas |
| low | 24 horas | 7 dias |

Toda alteração de prioridade recalcula os dois prazos a partir da criação original do ticket.

## Responsáveis

Um ticket só pode ser atribuído a uma conta:

- ativa;
- com papel `platform-admin` ou `municipal-admin`;
- capaz de acessar a fila administrativa correspondente.

## Gate de suporte

O gate `beta-support-sla-operational` fica bloqueado quando existir:

- ticket crítico ainda aberto;
- primeira resposta vencida sem confirmação;
- prazo de resolução vencido.

O worker reconcilia o gate em cada ciclo. A operação não depende de uma chamada manual à API.

## Rotina de feature flags

1. Criar a flag com fallback, variantes e percentual explícitos.
2. Definir ondas-alvo quando a funcionalidade não for global.
3. Coletar duas aprovações de administradores distintos do criador.
4. Verificar ausência de rejeições.
5. Ativar somente quando o status estiver `ready` ou `paused`.
6. Acompanhar exposições e sinais da Sprint 18.
7. Pausar imediatamente diante de risco operacional.

## Regras de segurança

- o criador não aprova a própria flag;
- uma nova aprovação não altera silenciosamente uma flag ativa;
- a primeira exposição de cada usuário é preservada;
- avaliações repetidas mantêm bucket e variante determinísticos;
- flags direcionadas a ondas não são entregues fora da audiência;
- apenas `platform-admin` cria, aprova, ativa ou pausa flags.

## Gate de rollout

O gate `feature-rollout-prepared` passa quando existe ao menos uma flag `ready` ou `active` com:

- duas aprovações;
- nenhuma rejeição.

## Incidente de rollout

Ao detectar erro, degradação ou impacto econômico:

1. pausar a flag;
2. registrar o motivo;
3. preservar exposições existentes;
4. correlacionar usuários expostos com telemetria e feedback da Sprint 18;
5. gerar ou atualizar o relatório de aprendizado;
6. só reativar após nova avaliação operacional.

## Privacidade

Detalhes de tickets e respostas são cifrados em repouso. Não registrar senhas, tokens, documentos, dados bancários ou segredos em tickets ou notas internas.

**Tehkné Solutions**

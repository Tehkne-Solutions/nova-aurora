# Runbook — Operação de Moderação

## Prioridades e SLA

| Prioridade | Primeiro atendimento | Resolução alvo | Escalonamento |
|---|---:|---:|---:|
| Crítica | 15 minutos | 4 horas | 10 minutos |
| Alta | 1 hora | 24 horas | 30 minutos |
| Normal | 8 horas | 72 horas | 4 horas |
| Baixa | 24 horas | 7 dias | 12 horas |

## Fluxo do caso

1. Receber e priorizar a denúncia.
2. Atribuir moderador e registrar início do atendimento.
3. Preservar evidências e investigar contexto e histórico.
4. Aplicar ação proporcional ou registrar ausência de ação.
5. Comunicar quando apropriado e encerrar o caso.
6. Manter recurso disponível para ações sobre conta.

## Ações disponíveis

- `warning`: advertência;
- `restrict-economy`: restrição de operações econômicas;
- `suspend-account`: suspensão da conta e revogação da ativação;
- `remove-content`: remoção de conteúdo ou referência;
- `no-action`: encerramento fundamentado sem sanção.

## Recursos e cobertura

Somente o usuário sujeito à ação pode recorrer. O texto é criptografado, o revisor registra decisão e nota, e recurso acolhido revoga a ação. A conta restaurada retorna a `pending` e exige nova onda válida.

O gate operacional exige ao menos um moderador cobrindo o período atual ou as próximas 24 horas e nenhuma denúncia crítica ou alta fora do primeiro SLA.

A equipe deve acionar assessoria jurídica, segurança, privacidade ou autoridades quando aplicável. O sistema não decide automaticamente obrigação legal ou comunicação externa.

**Tehkné Solutions**

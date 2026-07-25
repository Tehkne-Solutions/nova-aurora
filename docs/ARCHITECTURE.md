# Arquitetura do MVP

Nova Aurora começa como monólito modular em três processos: `web`, `api` e `worker`.

## Fonte de verdade

PostgreSQL mantém ledger, inventário, mercado, reservas, idempotência e outbox. Redis será usado somente para filas, presença, locks curtos e cache efêmero.

## Consistência

Operações econômicas críticas usam transações serializáveis e bloqueios `FOR UPDATE`. O saldo é derivado dos lançamentos; correções são novas transações, nunca edição direta.

## Evolução

Blockchain será um adaptador externo para ativos elegíveis. O ledger interno continua governando a operação do jogo.

**Tehkné Solutions**

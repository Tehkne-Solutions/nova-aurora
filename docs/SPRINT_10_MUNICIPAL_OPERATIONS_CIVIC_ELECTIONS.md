# Sprint 10 — Municipal Operations & Civic Elections

## Objetivo

Transformar a governança de Nova Aurora em uma operação municipal recorrente,
com orçamento, manutenção de serviços, eleições, conselho, políticas públicas e
respostas a emergências conectados ao ledger persistente.

## Ciclos orçamentários

Cada ciclo registra:

- receita tributária agregada;
- receita de licenças empresariais;
- custos dos serviços urbanos;
- custos emergenciais;
- saldo de fechamento;
- responsável pela liquidação;
- transação balanceada no ledger;
- índice de aprovação pública.

O fechamento cria automaticamente o ciclo seguinte.

## Serviços urbanos

Cada distrito possui operações para:

- energia;
- transporte;
- segurança;
- educação;
- ambiente.

Os serviços possuem custo, condição, capacidade, degradação e situação
operacional. O ciclo mensal aplica degradação, manutenção e sincronização com os
indicadores urbanos da Sprint 9.

## Eleições e conselho

O sistema implementa:

- registro de candidatura;
- reputação mínima;
- abertura da votação;
- voto único por cidadão;
- contagem persistente;
- certificação do resultado;
- mandatos com prazo;
- conselho municipal ativo.

Eleições não usam peso financeiro nem quantidade de participação empresarial.
Cada cidadão possui um voto.

## Políticas públicas

Conselheiros podem:

- apresentar políticas;
- definir distrito, área e impacto orçamentário;
- votar a favor ou contra;
- aprovar por maioria;
- financiar a execução;
- melhorar serviços urbanos;
- registrar eventos na outbox.

## Emergências

Eventos suportados:

- falha de energia;
- colapso de transporte;
- incidente de segurança;
- alagamento;
- onda de calor.

A emergência reduz indicadores e condição operacional. A resposta consome a
reserva emergencial, restaura parte dos serviços e aumenta a reputação cívica do
responsável.

## Contas municipais

- `city.treasury`;
- `city.public-investment`;
- `city.service-operations`;
- `city.emergency-reserve`.

Todas as entradas e saídas usam lançamentos de dupla entrada.

## Experiência

Nova rota:

```text
/municipality
```

A tela permite alternar entre Alice e Bob e executar o fluxo completo de
operação municipal.

## Validação

O teste de integração cobre:

1. registro de duas candidaturas;
2. abertura da votação;
3. votos de Alice e Bob;
4. certificação de dois mandatos;
5. criação de política;
6. aprovação pelos conselheiros;
7. promulgação e financiamento;
8. criação de emergência;
9. resposta emergencial;
10. fechamento orçamentário;
11. cálculo de aprovação;
12. idempotência do ciclo.

## Próxima sprint

Sprint 11 — Identity, Security & Live City:

- autenticação real;
- sessões persistentes;
- papéis e autorização;
- trilha de auditoria;
- rate limiting;
- proteção contra abuso;
- notificações em tempo real;
- preparação para deploy público.

**Tehkné Solutions**

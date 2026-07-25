# Sprint 2 — Market & Production Core

## Objetivo

Transformar o mercado e a produção em sistemas assíncronos, concorrentes e auditáveis.

## Mercado

### Prioridade

O matching segue:

1. melhor preço;
2. ordem mais antiga;
3. UUID como desempate determinístico.

Ordens de compra cruzam vendas com preço menor ou igual ao limite. Ordens de venda
cruzam compras com preço maior ou igual ao limite. A negociação usa o preço da ordem
que já estava em repouso no livro.

### Preenchimento parcial

Uma ordem pode permanecer em estado `partial`. Cada trade:

- reduz `remaining_minor`;
- aumenta `filled_minor`;
- captura somente a reserva necessária;
- transfere o inventário liquidado;
- registra preço, quantidade, taxa e transação do ledger.

### Cancelamento

O cancelamento bloqueia a ordem e suas reservas. O sistema libera:

- saldo não utilizado em ordens de compra;
- estoque restante em ordens de venda.

Ordens preenchidas ou já canceladas não podem ser canceladas novamente.

## Produção temporizada

Ao iniciar uma produção:

1. a ordem é persistida;
2. insumos são reservados;
3. energia é reservada;
4. um job BullMQ é criado com atraso até `completes_at`;
5. o worker captura os recursos e gera a saída no vencimento.

Se Redis falhar, a ordem continua persistida e a varredura periódica do worker recupera
produções vencidas.

## Eventos em tempo real

O transactional outbox é publicado pelo worker no canal Redis
`nova-aurora.events`. A API assina o canal e distribui eventos pelo endpoint WebSocket:

```text
/v1/realtime
```

## APIs

```text
POST   /v1/market/orders
DELETE /v1/market/orders/:orderId
GET    /v1/market/order-book/:itemCode
GET    /v1/market/trades/:itemCode

POST   /v1/production/orders
DELETE /v1/production/orders/:orderId
GET    /v1/production/orders
```

No runtime de desenvolvimento, as rotas privadas usam:

```text
x-actor-email: alice@nova-aurora.local
Idempotency-Key: chave-unica-da-operacao
```

## Invariantes

- nenhuma ordem vende estoque não reservado;
- nenhuma ordem compra sem saldo reservado;
- uma unidade reservada não pode ser vendida duas vezes;
- trades sempre geram transação balanceada;
- eventos são gravados na mesma transação do domínio;
- conclusão de produção é idempotente;
- jobs perdidos são recuperados pela varredura persistente.

## Próxima sprint

Sprint 3 — City Gameplay Vertical Slice:

- mapa isométrico inicial;
- navegação entre distritos;
- centro de empregos;
- ações de coleta e produção;
- loja e livro de ofertas dentro do jogo;
- onboarding da Cesta de Boas-Vindas.

**Tehkné Solutions**

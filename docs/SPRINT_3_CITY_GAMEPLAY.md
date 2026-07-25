# Sprint 3 — City Gameplay Vertical Slice

## Objetivo

Transformar os sistemas econômicos persistentes em uma primeira experiência jogável
na cidade de Nova Aurora.

## Entregas

- mapa visual 2,5D responsivo;
- quatro distritos com identidade e localizações próprias;
- viagem persistente entre locais;
- Centro de Empregos;
- trabalho público Apoio à Colheita;
- recompensa balanceada no ledger e no inventário;
- missão Cesta de Boas-Vindas;
- ações de produção conectadas ao BullMQ;
- oferta e compra conectadas ao matching engine;
- atualização do progresso por fatos persistidos.

## Distritos

- Centro Cívico;
- Cinturão Industrial;
- Vale Verde;
- Distrito Criativo.

## Jornada jogável

1. visitar o Centro de Empregos;
2. aceitar Apoio à Colheita;
3. viajar aos Campos de Colheita;
4. receber 30,00 CA e quatro unidades de trigo;
5. produzir farinha;
6. assar pão;
7. publicar seis pães por 22,00 CA cada;
8. simular a compra de dois pães por Bob;
9. concluir a primeira cadeia de valor.

## Persistência da missão

O progresso não é um contador isolado. Cada etapa deriva de fatos reais:

- localização e log de movimento;
- atribuição de trabalho;
- conclusão e transação do ledger;
- ordens de produção concluídas;
- oferta publicada;
- trade liquidado.

## APIs

```text
GET  /v1/city/state
POST /v1/city/move
POST /v1/jobs/:jobCode/accept
POST /v1/jobs/:jobCode/complete
```

As ações econômicas seguintes reutilizam as APIs da Sprint 2.

## Próxima sprint

Sprint 4 — Gameplay Experience:

- personagem no mapa;
- pathfinding e deslocamento animado;
- minijogo de colheita;
- interiores do Centro de Empregos e Mercado Municipal;
- diálogos e NPCs;
- feedback sonoro e visual;
- tutorial contextual.

**Tehkné Solutions**

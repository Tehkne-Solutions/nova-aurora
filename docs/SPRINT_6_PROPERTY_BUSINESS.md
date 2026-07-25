# Sprint 6 — Property & Business Gameplay

## Objetivo

Transformar a proposta central de Nova Aurora em uma experiência executável:

- adquirir um endereço virtual;
- construir um estabelecimento;
- receber visitantes;
- operar a empresa;
- melhorar a propriedade;
- captar participação fracionada interna;
- distribuir parte de resultados positivos.

Toda movimentação utiliza o ledger persistente já existente.

## Fluxo jogável

```text
viajar ao endereço
→ adquirir terreno
→ construir estabelecimento
→ receber visitas
→ executar ciclo operacional
→ publicar participação simulada
→ receber investimento interno
→ melhorar a construção
→ distribuir parte do resultado
```

## Propriedades

Quatro propriedades iniciais foram adicionadas:

1. Unidade do Mercado Aurora;
2. Moinho Cooperativo;
3. Oficina Industrial Modular;
4. Estúdio do Campus Criativo.

Cada propriedade possui:

- localização;
- atividade permitida;
- preço de aquisição;
- custo de construção;
- manutenção;
- nível máximo;
- metadados econômicos.

A compra e a construção exigem que o jogador esteja fisicamente na localização.

## Construções

As construções possuem:

- empresa operadora;
- tipo;
- nome;
- nível;
- condição;
- capacidade;
- estado operacional.

Ciclos de operação reduzem a condição. Melhorias aumentam nível, capacidade e
restauram parte da condição.

## Operação empresarial

O resultado de um ciclo considera:

- nível;
- capacidade;
- visitas recentes;
- custo operacional;
- manutenção;
- tributos virtuais.

A receita vem do orçamento econômico simulado da cidade. Custos e tributos
retornam ao tesouro municipal. O resultado líquido permanece na conta empresarial.

## Participações virtuais

Cada empresa começa com 10.000 unidades internas.

Regras do MVP:

- limite máximo de 40% para participação externa;
- oferta criada apenas pelo proprietário;
- liquidação imediata pelo ledger;
- transferência das unidades do proprietário ao investidor;
- preço médio registrado;
- distribuição proporcional ao número de unidades.

Essas unidades:

- não são convertíveis;
- não representam valores mobiliários;
- não prometem rendimento;
- não são NFTs;
- não utilizam blockchain;
- existem somente na simulação de Nova Aurora.

## Distribuição de resultados

O proprietário pode distribuir 40% de um ciclo positivo ainda não distribuído.

A liquidação:

1. bloqueia o ciclo;
2. verifica posições;
3. calcula os valores proporcionais;
4. verifica o caixa empresarial;
5. cria uma transação balanceada;
6. paga as carteiras dos participantes;
7. registra os pagamentos;
8. marca o ciclo como distribuído;
9. publica evento na outbox.

## Concorrência e segurança

- operações idempotentes;
- isolamento serializável;
- bloqueio das ofertas;
- bloqueio das posições;
- aquisição exclusiva por terreno;
- uma construção por terreno;
- um pagamento por participante e distribuição;
- lançamentos balanceados;
- trilha de eventos.

## Interface

Nova rota:

```text
/business
```

A tela permite alternar entre Alice e Bob para demonstrar:

- fundadora;
- investidor;
- aquisição;
- construção;
- visita;
- operação;
- oferta;
- investimento;
- melhoria;
- distribuição.

## API

- `GET /v1/business/state`
- `POST /v1/properties/:plotCode/acquire`
- `POST /v1/properties/:plotCode/buildings`
- `POST /v1/properties/:plotCode/visit`
- `POST /v1/business/buildings/:buildingId/operate`
- `POST /v1/business/buildings/:buildingId/upgrade`
- `POST /v1/business/share-offerings`
- `POST /v1/business/share-offerings/:offeringId/invest`
- `POST /v1/business/cycles/:cycleId/distribute`

## Próxima sprint

Sprint 7 — Business Simulation & Governance:

- contratos de fornecimento;
- funcionários;
- salários;
- permissões empresariais;
- propostas e votações;
- demonstração de resultados;
- valorização baseada em fundamentos;
- prevenção de concentração;
- mercado secundário interno controlado.

**Tehkné Solutions**

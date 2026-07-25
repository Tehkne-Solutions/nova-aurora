# Sprint 7 — Business Operations & Public Marketplace

## Objetivo

Transformar empresas privadas em participantes visíveis da economia pública de Nova Aurora.

## Catálogo público

Cada estabelecimento pode publicar produtos ou serviços com:

- categoria;
- descrição;
- preço em Créditos Aurora;
- capacidade por ciclo;
- estado operacional.

O catálogo é apresentado no mercado público e alimenta a simulação de demanda regional.

## Demanda por distrito

Cada distrito possui perfis por categoria com:

- fluxo-base de visitantes;
- preço de referência;
- sensibilidade a preço;
- peso de qualidade;
- sazonalidade.

O ciclo considera ainda:

- nível e condição do estabelecimento;
- capacidade;
- empregados ativos;
- reputação;
- preço publicado.

O resultado gera visitantes, clientes, receita, tributo, satisfação e avaliação.

## Consumidores NPC

O consumo NPC é liquidado no ledger por uma conta sistêmica. A receita líquida entra no caixa empresarial e o tributo é transferido ao tesouro municipal.

Nenhum saldo é alterado diretamente.

## Reputação e risco

A reputação empresarial varia conforme a satisfação dos ciclos de demanda.

O indicador de risco usa:

- condição do imóvel;
- resultado operacional recente;
- presença de empregados;
- existência de catálogo;
- reputação.

Classificações:

- baixo;
- médio;
- alto.

## Trabalho entre jogadores

Empresas podem:

- publicar vagas;
- definir função e salário;
- contratar outro jogador;
- executar folha salarial;
- recolher tributo sobre a folha.

O proprietário não pode aceitar a própria vaga.

## Mercado secundário interno

Participantes podem listar unidades internas que já possuem. Outro jogador pode comprá-las com Créditos Aurora.

A operação:

1. bloqueia a oferta;
2. bloqueia posições;
3. verifica o limite externo;
4. verifica saldo;
5. liquida comprador e vendedor;
6. transfere unidades;
7. atualiza custo médio;
8. registra o trade e a outbox.

As unidades permanecem internas, não conversíveis e sem representação em blockchain.

## Rotas

- `GET /v1/marketplace/state`
- `POST /v1/marketplace/buildings/:buildingId/catalog`
- `POST /v1/marketplace/buildings/:buildingId/demand-cycle`
- `POST /v1/marketplace/companies/:companyId/jobs`
- `POST /v1/marketplace/jobs/:openingId/accept`
- `POST /v1/marketplace/companies/:companyId/payroll`
- `POST /v1/marketplace/shares/listings`
- `POST /v1/marketplace/shares/listings/:listingId/buy`

## Interface

Nova rota:

```text
/marketplace
```

A interface permite alternar entre Alice e Bob para testar publicação, contratação e negociação interna.

## Próxima sprint

Sprint 8 — Economy Governance & Risk:

- crédito empresarial;
- contratos B2B;
- inadimplência;
- seguros internos;
- governança de participantes;
- limites antifraude;
- auditoria econômica avançada.

**Tehkné Solutions**

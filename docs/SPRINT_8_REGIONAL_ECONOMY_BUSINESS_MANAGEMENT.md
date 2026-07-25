# Sprint 8 — Regional Economy & Business Management

## Objetivo

Transformar a operação empresarial de Nova Aurora em um sistema regional
administrável, conectando estoque, fornecedores, marketing, equipe, metas e
indicadores ao mesmo PostgreSQL e ledger das sprints anteriores.

## Estoque comercial

Cada item de catálogo possui:

- quantidade disponível;
- ponto de reposição;
- custo médio;
- estabelecimento responsável;
- atualização transacional.

O ciclo regional não gera vendas sem estoque.

## Fornecedores e contratos B2B

Empresas podem publicar ofertas de fornecimento com:

- código e categoria;
- quantidade mínima;
- quantidade disponível;
- custo unitário.

A empresa compradora escolhe um catálogo e estabelecimento. O contrato:

1. bloqueia a oferta;
2. valida disponibilidade;
3. valida caixa empresarial;
4. transfere Créditos Aurora entre empresas;
5. atualiza custo médio;
6. adiciona estoque;
7. reduz a oferta;
8. registra contrato e evento.

## Campanhas

Campanhas possuem orçamento, canal, duração e aumento percentual de visitantes.
O orçamento é debitado do caixa empresarial e liquidado no ledger.

O ciclo comercial atualiza:

- conversões;
- receita atribuída;
- situação da campanha.

## Gestão de equipe

Empregados contratados no Mercado Público recebem perfis de gestão:

- produtividade;
- satisfação;
- nível de treinamento.

Treinamentos custam Créditos Aurora e melhoram os indicadores da equipe.

## Metas

Métricas suportadas:

- receita;
- clientes;
- reputação;
- estoque;
- satisfação da equipe.

O progresso é atualizado automaticamente durante os ciclos regionais.

## Indicadores por distrito

Cada ciclo consolida por distrito e dia:

- visitantes;
- clientes;
- receita bruta;
- empregados ativos;
- reputação média.

## Alertas

A central operacional identifica:

- estoque baixo ou esgotado;
- condição ruim do estabelecimento;
- satisfação baixa da equipe.

Alertas podem ser reconhecidos sem apagar o histórico.

## Nova interface

Rota:

```text
/management
```

A tela permite alternar entre Alice e Bob para testar:

- publicação de oferta de fornecedor;
- contratação B2B;
- reposição de estoque;
- campanha;
- meta;
- treinamento;
- ciclo regional;
- indicadores;
- alertas.

## Validação

O pipeline deve executar:

- migration `009_regional_economy_business_management.sql`;
- typecheck integral;
- teste de contrato B2B e custo médio;
- teste de idempotência;
- teste de campanha;
- teste de treinamento;
- teste de ciclo regional;
- teste de metas e alertas;
- regressão completa;
- build de web, API, worker e pacotes.

## Próxima sprint

Sprint 9 — Finance, Credit & Governance:

- crédito empresarial interno;
- garantias e risco;
- fundo de estabilização;
- conselho e votação simulada;
- orçamento municipal;
- auditoria econômica avançada;
- cenários de crise;
- preparação de compliance para futura tokenização.

**Tehkné Solutions**

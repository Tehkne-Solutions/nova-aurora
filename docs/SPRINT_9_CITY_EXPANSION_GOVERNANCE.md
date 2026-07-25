# Sprint 9 — City Expansion & Governance

## Objetivo

Transformar Nova Aurora em uma cidade governável, com expansão territorial,
serviços urbanos, licenciamento empresarial, orçamento participativo e contratos
públicos conectados ao ledger.

## Expansão territorial

Foram adicionados:

- Bairro Horizonte;
- Parque Tecnológico;
- Centro Comunitário;
- Praça Horizonte;
- Universidade de Nova Aurora;
- Laboratório de Inovação;
- novos terrenos comerciais e criativos.

Distritos planejados só podem receber licenciamento após ativação por investimento
público aprovado.

## Licenciamento

Empresas podem solicitar licenças para:

- comércio local;
- operação industrial;
- serviços criativos;
- produção agrícola.

A emissão:

1. valida o distrito;
2. verifica o caixa empresarial;
3. transfere a taxa ao Tesouro Municipal;
4. registra a licença e validade;
5. publica evento na outbox;
6. melhora a reputação cívica.

## Orçamento participativo

Cidadãos podem:

- apresentar propostas por distrito;
- definir categoria e orçamento;
- votar a favor ou contra;
- exercer peso de voto baseado em reputação cívica;
- financiar propostas com apoio suficiente.

O financiamento utiliza a conta segregada `city.public-investment`.

Projetos de expansão ativam distritos planejados, aumentam população inicial e
melhoram qualidade de vida.

## Serviços urbanos

Cada distrito possui indicadores de:

- energia;
- transporte;
- segurança;
- educação;
- ambiente;
- qualidade de vida.

Investimentos e contratos concluídos alteram esses indicadores de forma
persistente.

## Licitações

O fluxo de contrato público é:

1. publicação do contrato;
2. envio de propostas empresariais;
3. validação do orçamento máximo;
4. adjudicação por menor preço, prazo e ordem de envio;
5. execução pela empresa vencedora;
6. pagamento pelo fundo público;
7. melhoria dos serviços urbanos;
8. aumento da reputação cívica.

## Reputação cívica

A reputação registra:

- propostas apresentadas;
- votos realizados;
- contratos concluídos;
- pontuação total.

Decisões de financiamento e adjudicação exigem reputação mínima.

## Interface

A rota `/governance` permite:

- alternar entre Alice e Bob;
- consultar o Tesouro;
- acompanhar o fundo público;
- solicitar licença;
- propor expansão;
- votar;
- financiar proposta;
- participar de licitação;
- adjudicar proposta;
- concluir contrato;
- acompanhar indicadores distritais;
- consultar ranking cívico.

## Segurança econômica

- valores em unidades inteiras de Créditos Aurora;
- comandos idempotentes;
- transações serializáveis;
- dupla entrada;
- contas públicas segregadas;
- bloqueio de saldos insuficientes;
- auditoria por outbox;
- nenhuma conversão para moeda real;
- nenhuma promessa de rendimento.

## Validação esperada

- migrations completas;
- typecheck do monorepo;
- teste de licença;
- teste de proposta e voto;
- teste de ativação de distrito;
- teste de licitação;
- teste de pagamento público;
- regressão das sprints anteriores;
- build integral.

**Tehkné Solutions**

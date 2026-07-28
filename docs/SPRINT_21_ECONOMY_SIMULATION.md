# Sprint 21 — Simulação Econômica Sistêmica

## Objetivo

Transformar a economia da Nova Aurora em um sistema vivo, observável e administrável, com oferta, demanda, produção, circulação monetária, comportamento de NPCs, eventos macroeconômicos e mecanismos de intervenção auditáveis.

Versão-alvo: `0.21.0`.

## Princípios

- a economia é virtual e interna ao jogo;
- não existe promessa de rentabilidade, saque ou equivalência automática com moeda real;
- toda intervenção administrativa deve ser auditável;
- simulações não podem reescrever transações históricas;
- indicadores devem distinguir sinal real, ruído e ausência de dados;
- NPCs não podem criar recursos sem origem econômica registrada;
- inflação e deflação devem emergir de fluxos mensuráveis, não de números arbitrários ocultos.

## Entrega 1 — Contas macroeconômicas

Criar snapshots periódicos por cidade e região com:

- estoque monetário circulante;
- saldo de contas de usuários, empresas, governo e NPCs;
- produção total por categoria;
- consumo total por categoria;
- volume e velocidade de circulação;
- índice de preços;
- inflação e deflação por janela;
- desemprego e ocupação produtiva;
- concentração econômica;
- arrecadação, gastos públicos e saldo fiscal.

## Entrega 2 — Oferta, demanda e preços

- curvas de oferta e demanda por item e serviço;
- preço de referência calculado por mercado;
- elasticidade observada;
- estoque disponível e cobertura em dias;
- detecção de escassez e excesso;
- limites contra manipulação e preços extremos;
- histórico imutável de índices e preços observados.

## Entrega 3 — Cadeias de produção e logística

- insumos, etapas, capacidade e rendimento por receita;
- dependências entre setores;
- custos de transporte e armazenamento;
- perdas, atrasos e gargalos;
- capacidade regional;
- impacto de infraestrutura e distância;
- reconciliação entre produção física, inventário e ordens de mercado.

## Entrega 4 — Economia de NPCs

NPCs econômicos devem possuir:

- orçamento e reservas;
- necessidades e preferências;
- função produtiva ou comercial;
- tolerância a preço;
- memória econômica limitada;
- regras de compra, venda, contratação e poupança;
- falência, recuperação e substituição controlada;
- origem e destino auditáveis para todos os recursos.

## Entrega 5 — Eventos macroeconômicos

Modelar eventos como:

- choque de oferta;
- aumento súbito de demanda;
- quebra logística;
- desastre local;
- expansão de infraestrutura;
- incentivo fiscal;
- aumento de imposto;
- crise de confiança;
- descoberta de recurso;
- crescimento populacional.

Cada evento deve registrar escopo, duração, severidade, métricas afetadas, hipótese, resultado observado e encerramento.

## Entrega 6 — Central de intervenção econômica

A administração poderá:

- alterar impostos dentro de limites;
- criar subsídios temporários;
- comprar ou vender estoques reguladores;
- liberar reservas estratégicas;
- financiar infraestrutura;
- limitar temporariamente operações abusivas;
- pausar eventos econômicos anômalos;
- simular impacto antes da aplicação.

Toda ação exige justificativa, evidências, ator, horário, prazo, rollback e hash de auditoria.

## Entrega 7 — Simulador de cenários

Executar cenários isolados sem alterar produção real:

- baseline;
- inflação de demanda;
- choque de oferta;
- expansão monetária;
- aumento de impostos;
- subsídio setorial;
- quebra logística;
- crescimento populacional.

Saídas mínimas:

- preços;
- produção;
- consumo;
- emprego;
- arrecadação;
- concentração;
- estabilidade;
- ganhadores e perdedores por segmento.

## Entrega 8 — Painel econômico

Criar central administrativa com:

- visão macro;
- mapa de calor regional;
- inflação por categoria;
- oferta e demanda;
- cadeias em risco;
- comportamento de NPCs;
- eventos ativos;
- intervenções pendentes;
- cenários simulados;
- alertas e recomendações explicáveis.

## Segurança econômica

- proibir saldo negativo sem produto financeiro explícito;
- impedir criação silenciosa de moeda e itens;
- usar ledger como fonte canônica financeira;
- preservar idempotência e serialização em operações críticas;
- limitar intervenções por RBAC e dupla aprovação quando sistêmicas;
- nunca apresentar créditos Aurora como reais brasileiros ou investimento financeiro.

## Regressões obrigatórias

1. soma dos saldos reconciliados corresponde ao ledger;
2. NPC não compra sem orçamento;
3. produção não gera item sem consumo de insumos;
4. estoque não fica negativo;
5. snapshot passado não muda após novas transações;
6. choque de oferta eleva escassez antes de afetar preço;
7. coorte regional não mistura cidades;
8. intervenção expirada deixa de afetar a simulação;
9. cenário isolado não altera dados reais;
10. rollback restaura regras futuras sem apagar fatos históricos;
11. administrador municipal não executa intervenção sistêmica exclusiva da plataforma;
12. toda recomendação informa métricas e premissas usadas.

## Fases de implementação

### 21.1 — Fundamentos e snapshots

- migration 029;
- catálogo de indicadores;
- snapshots macroeconômicos;
- reconciliação monetária;
- regras puras e testes.

### 21.2 — Mercado e cadeias

- oferta, demanda, preços e elasticidade;
- receitas e dependências produtivas;
- logística e gargalos.

### 21.3 — NPCs econômicos

- agentes, orçamento, necessidades e decisões;
- worker de simulação;
- controles contra criação de recursos.

### 21.4 — Eventos e intervenção

- eventos macroeconômicos;
- workflow administrativo;
- simulação prévia e rollback.

### 21.5 — Painel e validação

- central econômica;
- cenários comparáveis;
- E2E, acessibilidade, carga, backup e documentação.

## Critérios de conclusão

- migrations versionadas;
- cálculos determinísticos testados;
- serviços transacionais e worker reconciliável;
- APIs autenticadas e RBAC;
- painel administrativo funcional;
- simulações isoladas dos dados reais;
- trilha de auditoria completa;
- TypeScript, testes, build, E2E, acessibilidade, carga e backup aprovados;
- assinatura exclusiva **Tehkné Solutions**.

**Tehkné Solutions**
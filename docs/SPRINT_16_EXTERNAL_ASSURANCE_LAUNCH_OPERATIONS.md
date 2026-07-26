# Sprint 16 — External Assurance & Launch Operations

## Objetivo

Transformar os controles da Sprint 15 em uma operação verificável de lançamento,
sem confundir implementação técnica com aprovação jurídica ou auditoria externa.

## Entregas

### Consentimento verificável de responsável

- solicitação autenticada para usuários de 14 a 17 anos;
- e-mail do responsável armazenado somente como hash;
- token aleatório de uso único com expiração em sete dias;
- decisão pública de autorização ou recusa;
- hashes técnicos de resposta para auditoria;
- nome do responsável armazenado somente como hash;
- nenhuma ativação de saque, investimento ou transferência externa.

### Canal de denúncias e moderação

- envio público ou autenticado;
- idempotência por chave e hash do conteúdo;
- detalhes criptografados em repouso;
- categorias de abuso, segurança, privacidade, fraude e proteção de adolescentes;
- prioridade inicial elevada para segurança e adolescentes;
- fila administrativa com triagem, investigação, ação, encerramento e descarte;
- trilha de atualizações.

### Exercícios de resposta

- cenários, objetivos, evidências e achados;
- ações corretivas com responsáveis e prazo;
- aprovação ou falha explícita;
- validade operacional de 180 dias.

### Ensaios de lançamento

- abertura do beta;
- rollback;
- entrega de provedor;
- backup e restauração;
- checklist, ambiente, commit, evidências e conclusão;
- abertura e rollback precisam ter aprovação nos últimos 30 dias.

### Status público

- componentes web, API, mercado, e-mail e banco;
- estado operacional, degradação, manutenção ou indisponibilidade;
- histórico de atualizações;
- incidentes públicos;
- estado inicial em manutenção até validação explícita do ambiente.

## Correções incorporadas da Sprint 15

- enforcement de confiança aplicado no hook global de mutações;
- rotas de regularização continuam acessíveis a contas bloqueadas;
- declaração etária acidental pode ser corrigida com restauração segura do acesso anterior;
- somente a versão documental vigente é exigida;
- documento futuro não retira a versão atual antes da vigência;
- o aceite precisa cobrir todas as chaves documentais obrigatórias.

## Gates operacionais

A prontidão exige simultaneamente:

1. todos os componentes obrigatórios operacionais;
2. exercício de incidente aprovado e vigente;
3. ensaio de abertura aprovado e vigente;
4. ensaio de rollback aprovado e vigente;
5. nenhuma denúncia crítica aberta.

Esses critérios complementam — e não substituem — documentos, revisões externas,
integridade econômica, e-mail e demais gates do release candidate.

## Rotas públicas

```text
GET  /v1/status/public
POST /v1/trust/reports
POST /v1/trust/guardian/decision
```

## Rotas autenticadas

```text
POST /v1/trust/guardian/request
```

## Rotas administrativas

```text
GET  /v1/launch-operations/state
POST /v1/launch-operations/reports/:reportId
POST /v1/launch-operations/exercises
POST /v1/launch-operations/exercises/:exerciseId/complete
POST /v1/launch-operations/rehearsals
POST /v1/launch-operations/rehearsals/:rehearsalId/complete
POST /v1/launch-operations/components/:componentKey
```

## Superfícies web

- `/status` — status público;
- `/report` — canal de denúncias;
- `/guardian` — decisão do responsável;
- `/guardian-request` — solicitação autenticada;
- `/operations` — operação administrativa.

## Critério de conclusão

A sprint termina com código e controles operacionais prontos. O beta público continua
bloqueado enquanto auditorias, pareceres e exercícios reais não forem concluídos.

**Tehkné Solutions**

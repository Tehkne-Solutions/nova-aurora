# Sprint 15 — Trust, Legal & Launch Readiness

## Objetivo

Converter os bloqueadores externos do release candidate em controles verificáveis,
sem declarar automaticamente que o produto está juridicamente aprovado.

## Princípio

Código, documentação e evidência operacional ajudam a demonstrar controles, mas não
substituem parecer jurídico, auditoria independente, avaliação de privacidade ou
aprovação dos responsáveis pelo lançamento.

## Sistemas implementados

### Documentos legais versionados

Cada documento possui:

- chave;
- versão;
- idioma;
- público;
- hash SHA-256;
- URL pública;
- referência de revisão externa;
- vigência;
- estado de rascunho, publicado ou retirado.

Rascunhos não são apresentados como políticas vigentes.

### Aceite auditável

O aceite registra:

- usuário;
- documento e versão;
- sessão;
- data;
- hashes de IP e user agent;
- origem da ação.

Uma nova versão exige novo aceite quando o modo de enforcement está ativo.

### Proteção etária

A idade é armazenada por faixa, evitando guardar data de nascimento quando ela não é
necessária.

- menores de 14 anos não podem acessar o produto;
- pessoas de 14 a 17 anos exigem revisão do responsável;
- maiores de idade não exigem responsável;
- login, recuperação e acesso à Central de Confiança continuam possíveis enquanto a
  regularização está pendente.

### Revisões externas

O sistema registra avaliações de:

- segurança independente;
- privacidade e LGPD;
- termos e defesa do consumidor;
- classificação dos ativos;
- proteção de adolescentes;
- resposta a incidentes;
- tributação.

Aprovações exigem referência e relatório. Validade expirada volta a bloquear a
prontidão.

### Incidentes

Incidentes podem ser classificados por categoria, severidade e estado. Incidentes
críticos abertos ou apenas contidos bloqueiam a abertura pública.

Atualizações públicas são separadas das evidências internas.

### Trust Center

A rota `/trust` apresenta:

- prontidão documental;
- documentos efetivamente publicados;
- revisões externas marcadas como públicas;
- incidentes públicos;
- natureza interna dos ativos;
- idade mínima;
- estado de aceite do usuário autenticado.

## Enforcement

```text
TRUST_ENFORCEMENT_MODE=report-only
TRUST_ENFORCEMENT_MODE=required
```

Em produção, a ausência da variável equivale a `required`.

No modo obrigatório, operações que usam o contexto de ator exigem:

1. faixa etária registrada;
2. idade mínima;
3. aprovação do responsável quando aplicável;
4. aceite das versões vigentes.

## Gates adicionados

- documentos legais publicados;
- segurança independente;
- privacidade e LGPD;
- termos e consumidor;
- classificação dos ativos;
- proteção de adolescentes;
- plano de incidentes.

## Limites

Esta sprint não fornece parecer jurídico e não libera o beta por si só. Os rascunhos
precisam ser revisados e publicados por profissionais responsáveis.

## Próxima sprint

Sprint 16 — External Assurance & Launch Operations:

- integração com fornecedor real de e-mail;
- anexação de relatórios externos;
- exercícios de incident response;
- moderação e canal de denúncias;
- consentimento de responsável com fluxo verificável;
- status page pública;
- teste completo de abertura e rollback.

**Tehkné Solutions**

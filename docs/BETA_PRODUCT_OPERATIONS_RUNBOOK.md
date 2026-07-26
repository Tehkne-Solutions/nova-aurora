# Runbook — Operação de Produto do Beta

## Rotina diária

1. Atualizar os gates na central `/beta-insights`.
2. Verificar eventos válidos nas últimas 24 horas.
3. Revisar tickets críticos e violações de SLA.
4. Classificar feedback aberto.
5. Conferir flags ativas e percentual de exposição.
6. Comparar métricas com as ondas em `/beta-control`.
7. Pausar qualquer flag associada a degradação relevante.

## Incidente em feature flag

1. Pausar a flag.
2. Registrar o motivo na ação administrativa.
3. Verificar exposições e ondas afetadas.
4. Abrir incidente quando houver segurança, privacidade ou indisponibilidade.
5. Comunicar usuários afetados quando necessário.
6. Não reativar sem nova análise e aprovações válidas.

## Violação de SLA

1. Atribuir o ticket.
2. Registrar reconhecimento.
3. Informar o usuário quando a atualização puder ser pública.
4. Repriorizar somente com justificativa.
5. Atualizar o gate após a regularização.

## Retenção

Eventos brutos são retidos por `PRODUCT_EVENT_RETENTION_DAYS`, limitado entre 30 e
365 dias. Feedback, suporte e auditoria seguem as políticas de privacidade e
retenção do produto.

## Critério de promoção

Uma mudança não é promovida apenas por volume de uso. A decisão deve considerar:

- resultado esperado;
- segurança;
- acessibilidade;
- suporte;
- estabilidade;
- economia;
- feedback qualitativo;
- impacto em adolescentes e grupos vulneráveis.

**Tehkné Solutions**

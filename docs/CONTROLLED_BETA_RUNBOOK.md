# Runbook — Ativação Controlada do Beta

## Preparação

1. Manter `PUBLIC_REGISTRATION_MODE=invite-only`.
2. Configurar `BETA_ROLLOUT_MODE=controlled`.
3. Confirmar todos os componentes como `operational`.
4. Confirmar gates técnicos, jurídicos e operacionais.
5. Agendar cobertura de moderação para as próximas 24 horas.
6. Criar uma onda com percentual e limite absoluto.
7. Inscrever apenas usuários verificados e adequados à faixa etária.
8. Executar ensaio de abertura e rollback vigentes.

## Início

1. Conferir branch e commit em produção.
2. Registrar o motivo da ativação.
3. Iniciar uma única onda.
4. Confirmar que somente membros inscritos ficaram `active`.
5. Verificar autenticação, mutações e página de status.

## Observação

Registrar taxa de erro, latência p95, usuários ativos, denúncias críticas, incidentes públicos, e-mail transacional e integridade econômica.

## Pausa e rollback

A onda deve ser pausada quando erro ou latência ultrapassarem o limite, houver incerteza operacional ou a cobertura de moderação for interrompida. O rollback é obrigatório diante de denúncia crítica acima do limite, corrupção de dados, risco de segurança ou privacidade, ou comportamento econômico fora das salvaguardas.

O rollback revoga os membros, ativa o kill switch, remove a onda ativa e preserva eventos e observações.

## Retomada

Resolver a causa raiz, registrar post-mortem, executar ações corretivas, repetir testes e ensaios e rearmar o kill switch explicitamente antes de uma nova onda.

**Tehkné Solutions**

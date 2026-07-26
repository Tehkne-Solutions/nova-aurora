# Runbook de Produção — Nova Aurora

## Pré-requisitos

- servidor Linux com Docker Engine e Docker Compose v2;
- portas 80/TCP, 443/TCP e 443/UDP liberadas;
- registros DNS para domínio principal, `api` e `ops`;
- runner GitHub dedicado com label `nova-aurora-production`;
- diretório `/etc/nova-aurora` acessível somente à operação;
- armazenamento persistente e cópia externa dos backups.

## Arquivo de ambiente

Crie `/etc/nova-aurora/nova-aurora.env` a partir de
`.env.production.example`.

O valor de `SECRETS_DIR` deve ser absoluto:

```text
SECRETS_DIR=/etc/nova-aurora/secrets
```

## DNS

Aponte para o servidor:

```text
nova-aurora.example.com
api.nova-aurora.example.com
ops.nova-aurora.example.com
```

## Primeiro deploy

1. Configure `PRODUCTION_DOMAIN` nas variables do repositório.
2. Crie o ambiente protegido `production` no GitHub.
3. Exija aprovadores para esse ambiente.
4. Gere os secrets conforme `infra/secrets/README.md`.
5. Publique uma tag, por exemplo `v0.12.0`.
6. Aguarde o workflow `Publish production images`.
7. Execute `Deploy production` com `image_tag=0.12.0`.
8. Aprove manualmente o ambiente.
9. Confirme os três endpoints públicos.

## Verificação pós-deploy

```bash
curl --fail https://api.example.com/health/live
curl --fail https://api.example.com/health/ready
curl --fail https://example.com/login
```

Acesse `https://ops.example.com` e confirme:

- targets da API e worker ativos;
- dependências prontas;
- tick recente;
- ausência de alertas críticos.

## Operação Docker

```bash
cd /caminho/do/repositório
export IMAGE_TAG=0.12.0
docker compose \
  --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml ps
```

Logs:

```bash
docker compose \
  --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml \
  logs --tail=200 -f api worker caddy
```

## Backup manual

```bash
docker compose \
  --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml \
  run --rm -e BACKUP_ONCE=true backup
```

## Verificação do backup mais recente

```bash
docker compose \
  --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml \
  exec backup sh -lc '
    latest=$(find /backups -name "*.dump" -type f | sort | tail -n 1)
    /opt/nova-aurora/verify.sh "$latest"
  '
```

A verificação deve ser executada periodicamente em janela operacional. Além do
volume local, copie os dumps para armazenamento externo criptografado.

## Restauração

1. Interrompa API e worker.
2. Faça cópia do estado atual.
3. Verifique o dump com `verify.sh`.
4. Execute o restore com confirmação explícita.
5. Inicie API e worker.
6. Confirme readiness, ledger e login.

Exemplo:

```bash
docker compose --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml stop api worker

docker compose --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml exec backup sh -lc '
    CONFIRM_RESTORE=RESTORE_NOVA_AURORA \
    /opt/nova-aurora/restore.sh /backups/nova-aurora-ARQUIVO.dump
  '
docker compose --env-file /etc/nova-aurora/nova-aurora.env \
  -f infra/docker-compose.prod.yml up -d api worker
```

## Rollback de aplicação

O workflow mantém a tag saudável anterior em:

```text
/var/lib/nova-aurora/deployment/current-image-tag
```

Em falha de readiness, o rollback automático reutiliza essa tag. Um rollback
manual pode ser feito executando novamente o workflow com a tag anterior.

## Incidentes

### API indisponível

1. consulte `/health/live`;
2. consulte `/health/ready`;
3. verifique PostgreSQL e Redis no dashboard;
4. consulte logs com request ID;
5. reverta a tag quando a falha tiver começado após deploy.

### Worker sem tick

1. confirme o container do worker;
2. consulte `:4010/health/ready` dentro da rede;
3. verifique Redis e PostgreSQL;
4. procure `world.tick.failed` e `production.worker.error`;
5. evite iniciar múltiplos stacks com o mesmo banco e fila.

### Banco indisponível

1. não force novas migrations;
2. confirme volume e espaço em disco;
3. preserve logs;
4. recupere o serviço;
5. restaure somente após verificar backup e causa raiz.

## Assinatura

Todos os componentes, dashboards, eventos e relatórios operacionais pertencem à
**Tehkné Solutions**.

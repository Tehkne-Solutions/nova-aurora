# Segredos de produção

Este diretório contém somente esta documentação. Os arquivos reais são ignorados
pelo Git e nunca devem ser enviados ao repositório.

Crie os segredos na máquina de deploy:

```bash
mkdir -p infra/secrets
openssl rand -base64 48 > infra/secrets/postgres_password.txt
openssl rand -base64 48 > infra/secrets/redis_password.txt
openssl rand -base64 48 > infra/secrets/internal_api_token.txt
openssl rand -base64 64 > infra/secrets/data_encryption_key.txt
openssl rand -base64 48 > infra/secrets/transactional_email_token.txt
openssl rand -base64 48 > infra/secrets/bootstrap_admin_password.txt
openssl rand -base64 48 > infra/secrets/bootstrap_bob_password.txt
openssl rand -base64 48 > infra/secrets/grafana_admin_password.txt
chmod 600 infra/secrets/*.txt
```

## Arquivos obrigatórios

- `postgres_password.txt`: senha do PostgreSQL;
- `redis_password.txt`: senha do Redis;
- `internal_api_token.txt`: acesso do Prometheus aos endpoints `/metrics`;
- `data_encryption_key.txt`: chave exclusiva para cifrar segredos MFA e mensagens pendentes;
- `transactional_email_token.txt`: credencial Bearer do provedor transacional;
- `bootstrap_admin_password.txt`: nova senha de Alice no primeiro deploy;
- `bootstrap_bob_password.txt`: senha de Bob, usada somente quando ele for habilitado;
- `grafana_admin_password.txt`: senha administrativa do Grafana.

A chave de cifragem não deve ser igual à senha do PostgreSQL, ao token interno ou
às credenciais do Grafana. Mantenha uma cópia protegida fora do servidor: perder
essa chave impede a recuperação dos segredos TOTP e do conteúdo cifrado na fila de
e-mail. Não substitua a chave diretamente; uma rotação exige recifrar os dados
antes do próximo deploy.

O token do provedor transacional deve ter escopo exclusivo de envio, sem acesso à
administração da conta do fornecedor. Rotacione-o por procedimento controlado e
nunca grave seu valor em logs, issues ou artefatos de CI.

O serviço `migrate` troca as credenciais demonstrativas antes de iniciar API e
worker. Bob permanece desativado em produção por padrão.

Não reutilize os exemplos locais `Aurora@2026` ou `Horizonte@2026`.

**Tehkné Solutions**

# Runbook — Beta Público Controlado

## 1. Pré-requisitos obrigatórios

Antes de alterar o cadastro para `invite-only` ou `open`, confirme:

- domínio e TLS válidos;
- remetente transacional autenticado;
- `transactional_email_token.txt` criado e protegido;
- backup verificado no mesmo dia;
- dashboards e alertas respondendo;
- nenhum gate com estado `blocked`;
- nenhuma mensagem em `dead`;
- nenhum evento antifraude crítico aberto;
- responsáveis de produto, infraestrutura, segurança e suporte disponíveis.

## 2. Ordem de abertura

1. mantenha `PUBLIC_REGISTRATION_MODE=closed`;
2. publique a versão candidata;
3. valide health, readiness e métricas;
4. envie uma verificação e uma recuperação para contas de teste;
5. confirme entrega, links e revogação de sessões;
6. abra `invite-only` para a equipe interna;
7. acompanhe pelo menos um ciclo operacional;
8. emita poucos convites externos;
9. aumente o limite gradualmente;
10. use `open` somente após aprovação explícita de todos os gates.

## 3. Indicadores mínimos

Acompanhe continuamente:

- taxa de HTTP 5xx;
- latência da API;
- tick do worker;
- falhas e dead-letter de e-mail;
- verificações pendentes;
- recuperação de contas;
- usuários restritos ou congelados;
- eventos antifraude;
- falhas de login e rate limiting;
- equilíbrio do ledger;
- capacidade de backup e restauração.

## 4. Interrupção de cadastro

Diante de abuso, falha de provedor ou indisponibilidade de suporte:

```text
PUBLIC_REGISTRATION_MODE=closed
```

Republique apenas a configuração necessária. Contas existentes continuam podendo
entrar, mas novos cadastros são recusados.

## 5. Falha de e-mail transacional

### Sintomas

- aumento de `result="failed"`;
- mensagem em `dead`;
- usuários aguardando verificação;
- reclamações de recuperação não recebida.

### Ações

1. confirme status e credenciais do fornecedor;
2. valide DNS do remetente;
3. verifique bloqueios e reputação do domínio;
4. mantenha o cadastro fechado se a recuperação estiver indisponível;
5. corrija o fornecedor ou endpoint;
6. use a central `/release` para reenfileirar somente após a correção;
7. registre evidência no gate `transactional-email`.

Nunca envie tokens por chat, issue, log ou atendimento não autenticado.

## 6. Evento de segurança

Em suspeita de comprometimento:

1. feche novos cadastros;
2. preserve logs e evidências;
3. restrinja ou congele contas afetadas;
4. revogue sessões quando aplicável;
5. rotacione secrets comprometidos;
6. interrompa mercado ou ativo afetado;
7. abra registro interno do incidente;
8. acione responsáveis jurídicos e de privacidade;
9. avalie comunicação aos titulares e autoridades;
10. só reabra após revisão e registro do gate.

## 7. Rollback

O deploy já mantém a última tag saudável. Em falha:

- o workflow tenta rollback automático;
- preserve o backup anterior ao deploy;
- não restaure banco automaticamente quando a migration for compatível e aditiva;
- restaure banco apenas após confirmar corrupção ou incompatibilidade de dados;
- documente o motivo e o commit revertido.

## 8. Encerramento do beta

Para interromper o beta sem apagar dados:

1. defina cadastro como `closed`;
2. pause novas campanhas e convites;
3. suspenda convites ainda ativos;
4. mantenha recuperação, exportação e exclusão disponíveis;
5. comunique usuários pelos canais aprovados;
6. preserve ledger, auditoria e retenções obrigatórias.

## 9. Responsáveis

Cada ambiente deve registrar nominalmente:

- responsável de produto;
- responsável de infraestrutura;
- responsável de segurança;
- encarregado de privacidade;
- suporte de primeiro nível;
- contato do provedor transacional;
- autoridade para fechar cadastro e mercado.

## Assinatura

**Tehkné Solutions**

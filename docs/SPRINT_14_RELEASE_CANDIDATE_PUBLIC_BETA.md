# Sprint 14 — Release Candidate & Public Beta

## Objetivo

Converter a infraestrutura publicada e a economia protegida da Nova Aurora em um
release candidate operável, mantendo o cadastro público bloqueado até que as
evidências técnicas, operacionais, jurídicas e de privacidade estejam registradas.

## Princípio de lançamento

O software estar implantável não significa que o beta esteja liberado. A abertura
pública depende simultaneamente de:

- provedor transacional funcional;
- verificação de e-mail;
- testes E2E em navegador;
- acessibilidade;
- carga mínima;
- ausência de mensagens em dead-letter;
- ausência de eventos críticos de integridade;
- revisão independente de segurança;
- revisão de privacidade e LGPD;
- termos e política publicados;
- runbook de incidentes aprovado.

## Cadastro controlado

`PUBLIC_REGISTRATION_MODE` aceita:

- `open`: qualquer e-mail pode iniciar cadastro;
- `invite-only`: exige convite válido;
- `closed`: novos cadastros ficam suspensos.

Convites possuem hash persistido, identificação, padrão opcional de e-mail ou
domínio, limite de usos, validade e trilha de resgate. O código em texto aberto é
exibido somente na resposta de criação.

## Verificação de e-mail

Novas contas recebem:

- `email_verification_required=true`;
- `public_beta_access=invited` ou `pending`;
- token aleatório de uso único;
- validade de 24 horas;
- conteúdo entregue pela fila transacional.

Enquanto o endereço não for confirmado, a conta pode entrar, consultar a central
de conta, administrar privacidade e reenviar o link. Operações mutáveis do mundo,
mercado e produção permanecem bloqueadas no middleware da API.

## Entrega transacional

A tabela `transactional_email_outbox` mantém:

- chave idempotente de entrega;
- destinatário;
- template;
- assunto;
- payload cifrado com AES-256;
- estado;
- tentativas;
- próxima tentativa;
- identificador do provedor;
- erro mais recente;
- data de envio.

O worker recupera entregas interrompidas, aplica espera exponencial e envia para
dead-letter após cinco tentativas. O endpoint do fornecedor é desacoplado e recebe
um contrato JSON assinado pela Tehkné Solutions.

## Recuperação de conta

A API pública não devolve o token em produção. O token continua persistido somente
como hash e o link é incluído no payload cifrado da fila. Após a troca de senha:

- todas as sessões ativas são revogadas;
- tokens de recuperação anteriores são consumidos;
- a ação fica registrada como evento de alto risco.

## Centro de release

A rota `/release` permite a administradores:

- consultar prontidão;
- acompanhar usuários ativos e pendentes;
- criar convites;
- consultar fila transacional;
- reenfileirar mensagens falhas;
- registrar evidências dos gates;
- bloquear explicitamente a abertura.

Administradores municipais têm leitura. Somente administradores da plataforma
podem criar convites, alterar gates ou reenfileirar mensagens.

## Qualidade automatizada

O CI executa:

1. migrations;
2. TypeScript estrito;
3. testes transacionais;
4. build integral;
5. inicialização real de API e web;
6. Chrome headless via protocolo DevTools;
7. login pela interface;
8. navegação autenticada;
9. auditoria de landmarks, títulos, rótulos e nomes acessíveis;
10. detecção de exceções JavaScript;
11. carga concorrente em web, health e snapshot autenticado;
12. validação de p95 e taxa de erro;
13. Compose, Caddy e Prometheus;
14. imagens de produção;
15. backup e restauração.

Os relatórios `release-browser-report.json` e `release-load-report.json` são
publicados no artifact `release-qa-evidence`.

## Limites desta sprint

Esta sprint não declara que o produto já pode ser aberto ao público. Permanecem
necessárias evidências externas para:

- segurança independente;
- LGPD e política de privacidade;
- termos de uso e defesa do consumidor;
- classificação jurídica dos ativos;
- tributação;
- proteção de menores;
- resposta a incidentes;
- domínio e remetente autenticados no provedor de e-mail.

## Assinatura

**Tehkné Solutions**

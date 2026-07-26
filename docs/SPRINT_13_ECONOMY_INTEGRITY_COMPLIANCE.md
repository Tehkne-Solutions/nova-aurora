# Sprint 13 — Economy Integrity & Compliance

## Objetivo

Adicionar controles técnicos para identidade forte, direitos de privacidade,
prevenção a fraude, limites econômicos, circuit breakers e classificação explícita
dos ativos virtuais.

Esta sprint cria infraestrutura técnica e registros auditáveis. Ela não substitui
análise jurídica, regulatória, tributária ou de proteção de dados aplicável à
operação real.

## Identidade forte

A autenticação passa a suportar:

- recuperação de senha com token opaco;
- armazenamento exclusivo do hash do token;
- validade de 30 minutos;
- revogação de todas as sessões após a troca;
- TOTP de seis dígitos e período de 30 segundos;
- tolerância de uma janela anterior e posterior;
- dez códigos de recuperação de uso único;
- desafio MFA separado da sessão;
- ausência de sessão parcial antes do segundo fator.

O segredo TOTP é cifrado com AES-256 pelo `pgcrypto`. A chave de cifragem é
independente do banco, Redis e token de métricas.

## Privacidade

A central `/account` permite:

- consultar consentimentos;
- conceder ou retirar finalidades opcionais;
- exportar os próprios dados em JSON;
- agendar exclusão;
- cancelar durante a carência de sete dias;
- consultar políticas de retenção;
- acompanhar solicitações anteriores.

O processamento essencial não pode ser retirado enquanto a conta permanece
ativa.

## Exclusão e pseudonimização

Ao agendar a exclusão:

- ordens abertas são canceladas;
- reservas de saldo e estoque são liberadas;
- produções pendentes são canceladas;
- o perfil econômico é congelado;
- a conta continua acessível durante a carência.

Após sete dias, o worker:

- remove sessões, MFA, recuperação, presença e notificações;
- substitui e-mail e nome por identificadores anônimos;
- randomiza a senha;
- desabilita a conta;
- encerra empresas em nome do usuário;
- preserva ledger, trades e registros necessários à integridade econômica;
- marca a solicitação como concluída.

Retenções legais ativas impedem a conclusão da exclusão.

## Classificação de ativos

Cada item possui:

- classe do ativo;
- status de tokenização;
- classificação jurídica declarada;
- rede blockchain opcional;
- permissão de transferência externa.

Classes disponíveis:

```text
internal-consumable
internal-equity
collectible
tokenized-collectible
regulated-instrument
```

O padrão é:

```text
asset_class = internal-consumable
tokenization_status = not-tokenized
external_transfer_enabled = false
legal_classification = virtual-game-asset
```

Nenhuma participação, terreno, moeda ou item interno representa automaticamente
NFT, valor mobiliário, investimento externo, direito de saque ou promessa de
rentabilidade.

## Integridade do mercado

Cada ativo possui controles para:

- valor máximo por ordem;
- valor máximo diário;
- quantidade máxima de ordens abertas;
- quantidade máxima de ordens por minuto;
- desvio máximo do preço de referência;
- período de cooldown;
- pausa manual;
- interrupção automática.

A validação ocorre em duas camadas:

1. serviço de pré-análise, que registra a decisão;
2. trigger `market_order_integrity_guard`, executado dentro da transação de
   criação da ordem.

Assim, uma nova rota, serviço ou cliente não pode ignorar os limites apenas por
não usar a interface atual.

## Circuit breaker

O preço de referência usa atualização ponderada após trades válidos.

Quando um trade ultrapassa o desvio permitido:

- o ativo entra em `tripped`;
- novas ordens são recusadas;
- o motivo é persistido;
- um evento crítico é criado;
- o ativo pode reabrir após cooldown ou aprovação administrativa.

## Antifraude

A vigilância inicial detecta:

- velocidade excessiva de ordens;
- preços fora da faixa;
- repetição de negociações recíprocas entre duas contas;
- perfil econômico restrito ou congelado.

Eventos aumentam a pontuação de risco. O perfil pode evoluir entre:

```text
normal
monitored
restricted
frozen
```

## Governança de mudanças

Alterações sensíveis geram uma proposta persistente.

Mudanças cobertas:

- limites;
- pausa;
- reabertura;
- redefinição de referência;
- classificação do ativo.

A pessoa que propõe não pode aprovar a própria mudança. A aplicação exige uma
segunda identidade administrativa e registra proponente, aprovador, payload,
justificativa e horários.

## Interfaces

### `/account`

- MFA;
- sessões;
- consentimentos;
- exportação;
- exclusão;
- risco da própria conta;
- aviso sobre natureza dos ativos.

### `/integrity`

- controles por ativo;
- circuit breakers;
- eventos antifraude;
- revisão de perfis;
- propostas;
- segunda aprovação;
- classificação de ativos.

## Produção

Novo secret obrigatório:

```text
data_encryption_key.txt
```

Requisitos:

- mínimo de 32 caracteres;
- armazenamento fora do repositório;
- acesso somente por API, worker e migration runtime;
- rotação planejada antes de qualquer troca;
- backup separado e protegido.

A produção mantém `ALLOW_RECOVERY_TOKEN_RESPONSE=false`. A entrega do token de
recuperação deve ser conectada a um provedor transacional antes do lançamento
público.

## Validação

Os testes cobrem:

1. ativação de TOTP;
2. desafio obrigatório no login;
3. código TOTP válido;
4. códigos de recuperação;
5. recuperação de senha;
6. revogação das sessões;
7. consentimento;
8. exportação;
9. exclusão com carência;
10. cancelamento pelo titular;
11. limite por ordem;
12. impossibilidade de autoaprovação;
13. aprovação por segunda identidade;
14. regressão econômica e cívica;
15. Compose com secret dedicado;
16. build das imagens;
17. backup e restauração.

## Próxima sprint

Sprint 14 — Release Candidate & Public Beta:

- provedor de e-mail transacional;
- verificação real de e-mail;
- recuperação entregue fora da API;
- testes E2E de navegador;
- acessibilidade;
- testes de carga;
- simulação econômica prolongada;
- revisão de segurança;
- revisão jurídica e LGPD;
- termos e política de privacidade finais;
- onboarding público;
- release candidate e beta controlado.

**Tehkné Solutions**

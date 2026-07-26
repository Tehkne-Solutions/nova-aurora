# Validação da Sprint 15

## Verificações executadas antes da publicação

- sintaxe TypeScript dos serviços e rotas;
- smoke de TypeScript/TSX da página `/trust`;
- três testes puros do cálculo de prontidão;
- comparação da branch com a `main` sem commits divergentes;
- conferência de migrations, exports, rotas e configuração de ambiente;
- validação de que rascunhos não são tratados como documentos vigentes.

## Comando incluído

```bash
pnpm validate:sprint15
```

## Validação completa esperada no CI

```bash
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
pnpm validate:sprint15
```

A aprovação de segurança, privacidade, termos, ativos, tributação e proteção de
adolescentes continua dependendo de evidências externas.

**Tehkné Solutions**

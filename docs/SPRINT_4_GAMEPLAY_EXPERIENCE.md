# Sprint 4 — Gameplay Experience

## Objetivo

Substituir interações instantâneas por uma experiência visual, narrativa e orientada a habilidade.

## Entregas

- personagem visível no mapa;
- deslocamento animado entre localizações;
- mapa urbano com posições espaciais reais;
- NPCs contextuais;
- diálogos em etapas;
- minijogo Ritmo da Colheita;
- desafio gerado e validado no servidor;
- sons sintéticos de interação;
- bloqueio da recompensa até aprovação do minijogo;
- retomada de sessão de colheita ativa.

## Minijogo

O servidor gera uma sequência de sete direções e a armazena no PostgreSQL. O jogador:

1. observa a sequência;
2. reproduz com setas, WASD ou botões;
3. recebe pontuação por precisão e velocidade;
4. precisa atingir 70 pontos;
5. somente então pode concluir Apoio à Colheita.

O cliente não decide se a sessão foi aprovada.

## NPCs

- Mara — Centro de Empregos;
- João — Campos de Colheita;
- Lina — Mercado Municipal.

Os diálogos contextualizam profissão, qualidade e mercado.

## Persistência

- `game_npcs`;
- `player_avatar_state`;
- `harvest_sessions`;
- trigger que exige sessão aprovada antes da recompensa do trabalho.

## Próxima sprint

Sprint 5 — Character & World Polish:

- sprites 2,5D;
- animações direcionais;
- interiores jogáveis;
- clima e ciclo de tempo;
- minijogo industrial;
- acessibilidade e controles mobile refinados.

**Tehkné Solutions**

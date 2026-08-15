import { CharacterSprite } from "./character-sprite";
import { InteriorSceneArt } from "./interior-scene-art";
import styles from "./interior-art.module.css";
import type { Location, Npc } from "./types";

type Props = Readonly<{
  location: Location;
  npc: Npc | null;
  onClose(): void;
  onTalk(npc: Npc): void;
}>;

function npcVariant(avatar: string): "mara" | "joao" | "lina" {
  if (avatar === "joao") return "joao";
  if (avatar === "lina") return "lina";
  return "mara";
}

export function InteriorScene({ location, npc, onClose, onTalk }: Props) {
  const theme = location.code === "municipal-market" ? "market" : "office";
  const role = theme === "market" ? "Mercado Municipal" : "Centro de Empregos";

  return (
    <div className={styles.overlay}>
      <section aria-label={`Interior de ${location.name}`} aria-modal="true" className={styles.scene} role="dialog">
        <header className={styles.header}>
          <div>
            <span className={styles.label}>{role.toUpperCase()} · INTERIOR VISITÁVEL</span>
            <h2>{location.name}</h2>
            <p>{location.description}</p>
          </div>
          <button aria-label="Sair do interior" className={styles.closeButton} onClick={onClose}>×</button>
        </header>

        <div className={styles.canvas}>
          <div className={styles.art}><InteriorSceneArt theme={theme} /></div>
          <div className={styles.vignette} aria-hidden="true" />

          <div className={styles.player}>
            <CharacterSprite compact facing="north" label="Seu personagem no interior" moving={false} />
          </div>

          {npc && (
            <button
              aria-label={`Conversar com ${npc.name}, ${npc.roleTitle}`}
              className={styles.npc}
              onClick={() => onTalk(npc)}
              title={`Conversar com ${npc.name}`}
            >
              <CharacterSprite compact facing="south" label={npc.name} moving={false} variant={npcVariant(npc.avatar)} />
              <span className={styles.npcMeta}>
                <strong>{npc.name}</strong>
                <small>{npc.roleTitle}</small>
              </span>
              <span className={styles.npcHint}>CONVERSAR</span>
            </button>
          )}

          <div className={styles.floorPrompt} aria-hidden="true">
            Explore o ambiente · encontre pessoas · execute ações no local
          </div>
        </div>

        <footer className={styles.footer}>
          <span>O interior preserva as mesmas ações, economia e estado persistente do mundo.</span>
          <button onClick={onClose}>Voltar ao mapa</button>
        </footer>
      </section>
    </div>
  );
}

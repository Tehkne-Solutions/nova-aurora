import { CharacterSprite } from "./character-sprite";
import baseStyles from "./game.module.css";
import polishStyles from "./polish.module.css";
import type { Location, Npc } from "./types";

const styles = { ...baseStyles, ...polishStyles };

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
  const market = location.code === "municipal-market";
  return (
    <div className={styles.interiorOverlay}>
      <section aria-label={`Interior de ${location.name}`} aria-modal="true" className={`${styles.interiorScene} ${market ? styles.marketInterior : styles.officeInterior}`} role="dialog">
        <header className={styles.interiorHeader}>
          <div><span className={styles.actionLabel}>INTERIOR VISITÁVEL</span><h2>{location.name}</h2><p>{location.description}</p></div>
          <button aria-label="Sair do interior" className={styles.iconButton} onClick={onClose}>×</button>
        </header>
        <div className={styles.interiorCanvas}>
          <div className={styles.interiorWindow} aria-hidden="true"><span /><span /><span /></div>
          <div className={styles.interiorCounter}><div /><strong>{market ? "BALCÃO DE NEGÓCIOS" : "ATENDIMENTO CIDADÃO"}</strong></div>
          <div className={styles.interiorPlayer}><CharacterSprite compact facing="north" label="Seu personagem no interior" moving={false} /></div>
          {npc && <button className={styles.interiorNpc} onClick={() => onTalk(npc)} title={`Conversar com ${npc.name}`}><CharacterSprite compact facing="south" label={npc.name} moving={false} variant={npcVariant(npc.avatar)} /><span><strong>{npc.name}</strong><small>{npc.roleTitle}</small></span></button>}
          <div className={styles.interiorProps} aria-hidden="true"><span>{market ? "▥" : "▤"}</span><span>{market ? "◇" : "⌂"}</span><span>{market ? "▦" : "◫"}</span></div>
        </div>
        <footer className={styles.interiorFooter}><span>As ações econômicas continuam no painel principal.</span><button onClick={onClose}>Voltar ao mapa</button></footer>
      </section>
    </div>
  );
}

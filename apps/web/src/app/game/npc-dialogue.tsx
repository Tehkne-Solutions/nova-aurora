"use client";

import { useState } from "react";
import { CharacterSprite } from "./character-sprite";
import styles from "./dialogue-art.module.css";
import type { Npc } from "./types";

type Props = Readonly<{
  npc: Npc;
  onClose(): void;
}>;

function npcVariant(avatar: string): "mara" | "joao" | "lina" {
  if (avatar === "joao") return "joao";
  if (avatar === "lina") return "lina";
  return "mara";
}

export function NpcDialogue({ npc, onClose }: Props) {
  const [line, setLine] = useState(0);
  const text = npc.dialogue[line] ?? "...";
  const isLast = line >= npc.dialogue.length - 1;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Conversa com ${npc.name}`}>
      <section className={styles.card}>
        <div className={styles.portrait}>
          <div className={styles.portraitArt}>
            <CharacterSprite
              facing="south"
              label={`Retrato de ${npc.name}`}
              moving={false}
              portrait
              variant={npcVariant(npc.avatar)}
            />
          </div>
          <div className={styles.identity}>
            <strong>{npc.name}</strong>
            <span>{npc.roleTitle}</span>
          </div>
        </div>

        <div className={styles.content}>
          <p className={styles.role}>CONVERSA · NOVA AURORA</p>
          <h2>{npc.name}</h2>
          <p className={styles.line}>{text}</p>
          <div className={styles.progress}>{line + 1} / {Math.max(1, npc.dialogue.length)}</div>
          <div className={styles.actions}>
            <button className={styles.secondary} onClick={onClose}>Encerrar</button>
            <button
              onClick={() => {
                if (isLast) onClose();
                else setLine((current) => current + 1);
              }}
            >
              {isLast ? "Entendi" : "Continuar"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

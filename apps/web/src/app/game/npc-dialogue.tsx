"use client";

import { useState } from "react";
import styles from "./game.module.css";
import type { Npc } from "./types";

type Props = Readonly<{
  npc: Npc;
  onClose(): void;
}>;

export function NpcDialogue({ npc, onClose }: Props) {
  const [line, setLine] = useState(0);
  const text = npc.dialogue[line] ?? "...";
  const isLast = line >= npc.dialogue.length - 1;

  return (
    <div className={styles.dialogueOverlay} role="dialog" aria-modal="true">
      <section className={styles.dialogueCard}>
        <div className={`${styles.npcPortrait} ${styles[`npc_${npc.avatar}`] ?? ""}`}>
          <span>{npc.name.slice(0, 1)}</span>
        </div>
        <div className={styles.dialogueContent}>
          <p className={styles.actionLabel}>{npc.roleTitle}</p>
          <h2>{npc.name}</h2>
          <p className={styles.dialogueText}>{text}</p>
          <div className={styles.dialogueActions}>
            <button className={styles.secondaryButton} onClick={onClose}>Encerrar</button>
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

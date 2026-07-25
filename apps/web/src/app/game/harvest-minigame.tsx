"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./game.module.css";
import type { HarvestAction, HarvestSession } from "./types";

const ICONS: Readonly<Record<HarvestAction, string>> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓"
};

const KEY_ACTIONS: Readonly<Record<string, HarvestAction | undefined>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down"
};

type Props = Readonly<{
  session: HarvestSession;
  busy: boolean;
  onCancel(): void;
  onSubmit(sequence: readonly HarvestAction[]): Promise<void>;
}>;

function tone(frequency: number, duration = 0.08): void {
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.06, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
  oscillator.addEventListener("ended", () => void context.close());
}

export function HarvestMinigame({
  session,
  busy,
  onCancel,
  onSubmit
}: Props) {
  const [phase, setPhase] = useState<"preview" | "input" | "submitting">("preview");
  const [sequence, setSequence] = useState<HarvestAction[]>([]);
  const [seconds, setSeconds] = useState(15);

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase("input"), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = useCallback(async (next: readonly HarvestAction[]) => {
    setPhase("submitting");
    tone(660, 0.14);
    await onSubmit(next);
  }, [onSubmit]);

  const addAction = useCallback((action: HarvestAction) => {
    if (phase !== "input" || busy) return;
    tone(320 + sequence.length * 35);
    const next = [...sequence, action];
    setSequence(next);
    if (next.length === session.challenge.length) {
      void submit(next);
    }
  }, [busy, phase, sequence, session.challenge.length, submit]);

  useEffect(() => {
    if (phase !== "input") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = KEY_ACTIONS[event.key];
      if (action) {
        event.preventDefault();
        addAction(action);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addAction, phase]);

  useEffect(() => {
    if (phase !== "input") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          const padded = [
            ...sequence,
            ...Array.from(
              { length: session.challenge.length - sequence.length },
              () => "up" as const
            )
          ];
          void submit(padded);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, sequence, session.challenge.length, submit]);

  const progress = useMemo(
    () => sequence.length / session.challenge.length * 100,
    [sequence.length, session.challenge.length]
  );

  return (
    <div className={styles.minigameOverlay} role="dialog" aria-modal="true">
      <section className={styles.minigameCard}>
        <header className={styles.minigameHeader}>
          <div>
            <p className={styles.actionLabel}>MINIJOGO DE PROFISSÃO</p>
            <h2>Ritmo da Colheita</h2>
          </div>
          <strong>{phase === "input" ? `${seconds}s` : "Observe"}</strong>
        </header>

        <p className={styles.minigameInstruction}>
          {phase === "preview"
            ? "Memorize a sequência de movimentos."
            : phase === "input"
              ? "Repita usando as setas, WASD ou os controles abaixo."
              : "Validando sua precisão no servidor..."}
        </p>

        <div className={styles.sequenceTrack}>
          {session.challenge.map((action, index) => {
            const entered = sequence[index];
            const revealed = phase === "preview";
            return (
              <div
                className={`${styles.sequenceTile} ${
                  index < sequence.length ? styles.sequenceEntered : ""
                }`}
                key={`${action}-${index}`}
              >
                {revealed ? ICONS[action] : entered ? ICONS[entered] : "?"}
              </div>
            );
          })}
        </div>

        <div className={styles.minigameProgress}>
          <span style={{ width: `${phase === "preview" ? 100 : progress}%` }} />
        </div>

        <div className={styles.harvestControls}>
          {(Object.keys(ICONS) as HarvestAction[]).map((action) => (
            <button
              disabled={phase !== "input" || busy}
              key={action}
              onClick={() => addAction(action)}
            >
              {ICONS[action]}
            </button>
          ))}
        </div>

        <button className={styles.secondaryButton} disabled={busy} onClick={onCancel}>
          Fechar e retomar depois
        </button>
      </section>
    </div>
  );
}

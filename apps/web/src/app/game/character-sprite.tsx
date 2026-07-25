import baseStyles from "./game.module.css";
import polishStyles from "./polish.module.css";
import type { Facing } from "./world-presentation";

const styles = { ...baseStyles, ...polishStyles };

type Props = Readonly<{
  facing: Facing;
  moving: boolean;
  label?: string;
  compact?: boolean;
  variant?: "founder" | "mara" | "joao" | "lina";
}>;

const palettes = {
  founder: { coat: "#54d6b0", coatDark: "#237f72", hair: "#182334", accent: "#d7f78f" },
  mara: { coat: "#db7d66", coatDark: "#70406b", hair: "#251d31", accent: "#ffd19a" },
  joao: { coat: "#c7b14d", coatDark: "#39734d", hair: "#4b3524", accent: "#e6ef9d" },
  lina: { coat: "#9870df", coatDark: "#354a87", hair: "#1c1d42", accent: "#a9edff" }
} as const;

export function CharacterSprite({
  facing,
  moving,
  label = "Personagem",
  compact = false,
  variant = "founder"
}: Props) {
  const palette = palettes[variant];
  const faceVisible = facing !== "north";
  const side = facing === "east" ? 1 : facing === "west" ? -1 : 0;

  return (
    <svg
      aria-label={label}
      className={`${styles.characterSprite} ${moving ? styles.characterMoving : ""} ${compact ? styles.characterCompact : ""}`}
      role="img"
      viewBox="0 0 82 112"
    >
      <ellipse className={styles.characterShadow} cx="41" cy="102" rx="24" ry="7" />
      <g className={styles.characterLegs}>
        <path d="M28 75 L39 75 L37 101 L24 101 Z" fill={palette.coatDark} />
        <path d="M43 75 L54 75 L58 101 L45 101 Z" fill={palette.coatDark} />
        <path d="M22 99 H39 V106 H20 Q18 102 22 99" fill="#111827" />
        <path d="M44 99 H61 Q65 102 62 106 H45 Z" fill="#111827" />
      </g>
      <g className={styles.characterBody}>
        <path d="M22 42 Q41 32 60 42 L57 80 Q41 89 25 80 Z" fill={palette.coat} stroke="#152034" strokeWidth="4" />
        <path d="M41 39 V82" stroke={palette.accent} strokeLinecap="round" strokeWidth="3" opacity=".75" />
        <path d="M22 48 L10 68 L18 74 L29 57" fill={palette.coatDark} stroke="#152034" strokeWidth="4" />
        <path d="M60 48 L72 68 L64 74 L53 57" fill={palette.coatDark} stroke="#152034" strokeWidth="4" />
      </g>
      <g className={styles.characterHead} transform={`translate(${side * 2} 0)`}>
        <ellipse cx="41" cy="29" rx="17" ry="19" fill="#d8a17d" stroke="#152034" strokeWidth="4" />
        <path d="M24 29 Q23 8 42 8 Q61 8 59 31 Q51 19 28 22 Z" fill={palette.hair} />
        {faceVisible && (
          <>
            <circle cx={side > 0 ? "45" : side < 0 ? "34" : "35"} cy="30" r="2" fill="#172033" />
            {side === 0 && <circle cx="47" cy="30" r="2" fill="#172033" />}
            <path d={side === 0 ? "M36 39 Q41 42 46 39" : "M38 39 Q42 41 46 38"} fill="none" stroke="#8a4f42" strokeLinecap="round" strokeWidth="2" />
          </>
        )}
      </g>
      <path className={styles.characterGlow} d="M18 88 Q41 102 64 88" fill="none" stroke={palette.accent} strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

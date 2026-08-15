import styles from "./character-art.module.css";
import type { Facing } from "./world-presentation";

type CharacterVariant = "founder" | "mara" | "joao" | "lina";

type Props = Readonly<{
  facing: Facing;
  moving: boolean;
  label?: string;
  compact?: boolean;
  portrait?: boolean;
  variant?: CharacterVariant;
}>;

type Palette = Readonly<{
  skin: string;
  skinShadow: string;
  hair: string;
  hairLight: string;
  coat: string;
  coatDark: string;
  trim: string;
  trousers: string;
  shoes: string;
  accessory: string;
}>;

const palettes: Record<CharacterVariant, Palette> = {
  founder: {
    skin: "#d8a17d",
    skinShadow: "#b9775d",
    hair: "#172333",
    hairLight: "#31465d",
    coat: "#4db596",
    coatDark: "#266f66",
    trim: "#d4d88c",
    trousers: "#27394b",
    shoes: "#101821",
    accessory: "#d7a95b"
  },
  mara: {
    skin: "#bd7d62",
    skinShadow: "#925947",
    hair: "#261a2c",
    hairLight: "#5c3b56",
    coat: "#c96f5d",
    coatDark: "#70405c",
    trim: "#e6b47e",
    trousers: "#3a2f46",
    shoes: "#18131d",
    accessory: "#79b6a1"
  },
  joao: {
    skin: "#a96f4e",
    skinShadow: "#7a4936",
    hair: "#3b2b20",
    hairLight: "#6d4b34",
    coat: "#b9a442",
    coatDark: "#37634b",
    trim: "#e5dc8a",
    trousers: "#293e38",
    shoes: "#171c19",
    accessory: "#b76545"
  },
  lina: {
    skin: "#d2a184",
    skinShadow: "#aa725e",
    hair: "#1b1f3c",
    hairLight: "#3f4e7a",
    coat: "#8667ca",
    coatDark: "#354a78",
    trim: "#9fd6df",
    trousers: "#293250",
    shoes: "#14182a",
    accessory: "#dfaa61"
  }
};

function eyeX(facing: Facing, side: "left" | "right"): number {
  if (facing === "east") return side === "left" ? 64 : 68;
  if (facing === "west") return side === "left" ? 50 : 54;
  return side === "left" ? 53 : 67;
}

function badgePath(variant: CharacterVariant): string {
  if (variant === "mara") return "M57 76 l6 -5 6 5 -6 8 z";
  if (variant === "joao") return "M57 73 h12 v9 h-12 z";
  if (variant === "lina") return "M63 70 l7 7 -7 7 -7 -7 z";
  return "M57 75 q6 -8 12 0 q-6 9 -12 0";
}

export function CharacterSprite({
  facing,
  moving,
  label = "Personagem",
  compact = false,
  portrait = false,
  variant = "founder"
}: Props) {
  const palette = palettes[variant];
  const faceVisible = facing !== "north";
  const profile = facing === "east" || facing === "west";
  const mirror = facing === "west" ? -1 : 1;
  const headShift = facing === "east" ? 4 : facing === "west" ? -4 : 0;
  const viewBox = portrait ? "20 2 80 105" : "0 0 120 160";

  return (
    <svg
      aria-label={label}
      className={`${styles.characterSprite} ${moving ? styles.characterMoving : ""} ${compact ? styles.characterCompact : ""} ${portrait ? styles.characterPortrait : ""}`}
      role="img"
      viewBox={viewBox}
    >
      {!portrait && <ellipse className={styles.characterShadow} cx="60" cy="148" rx="34" ry="8" />}

      <g className={styles.characterLegs}>
        <g className={styles.characterLegLeft}>
          <path d="M39 108 L57 108 L54 142 L36 142 Z" fill={palette.trousers} stroke="#152030" strokeWidth="3.5" />
          <path d="M34 139 H55 V148 H31 Q29 143 34 139" fill={palette.shoes} />
          <path d="M39 112 H55" stroke={palette.trim} strokeWidth="2" opacity=".42" />
        </g>
        <g className={styles.characterLegRight}>
          <path d="M63 108 L81 108 L85 142 L66 142 Z" fill={palette.trousers} stroke="#152030" strokeWidth="3.5" />
          <path d="M65 139 H87 Q92 143 88 148 H66 Z" fill={palette.shoes} />
          <path d="M65 112 H81" stroke={palette.trim} strokeWidth="2" opacity=".42" />
        </g>
      </g>

      <g className={`${styles.characterBody} ${styles.characterBreath}`}>
        <path d="M34 62 Q60 49 86 62 L83 111 Q60 124 37 111 Z" fill={palette.coatDark} stroke="#152030" strokeWidth="4" />
        <path d="M39 62 Q60 54 81 62 L77 104 Q60 113 43 104 Z" fill={palette.coat} />
        <path d="M59 59 L61 108" stroke={palette.trim} strokeLinecap="round" strokeWidth="3" opacity=".82" />
        <path d="M44 68 Q60 76 76 68" fill="none" stroke="#ffffff2e" strokeWidth="2" />
        <path d="M49 101 Q60 106 71 101" fill="none" stroke="#10182766" strokeWidth="2" />
        <path d={badgePath(variant)} fill={palette.accessory} stroke="#172233" strokeWidth="1.6" />
      </g>

      <g className={styles.characterArms}>
        <g className={styles.characterArmLeft}>
          <path d="M36 67 Q25 75 20 94 L29 100 L45 77" fill={palette.coatDark} stroke="#152030" strokeWidth="4" />
          <path d="M20 92 Q18 102 27 106 Q34 103 30 97" fill={palette.skin} stroke="#152030" strokeWidth="3" />
        </g>
        <g className={styles.characterArmRight}>
          <path d="M84 67 Q95 75 100 94 L91 100 L75 77" fill={palette.coatDark} stroke="#152030" strokeWidth="4" />
          <path d="M100 92 Q102 102 93 106 Q86 103 90 97" fill={palette.skin} stroke="#152030" strokeWidth="3" />
        </g>
      </g>

      <g className={styles.characterHead} transform={`translate(${headShift} 0)`}>
        <path d="M43 49 Q60 57 77 49 L74 65 Q60 72 46 65 Z" fill={palette.skinShadow} opacity=".35" />
        <ellipse cx="60" cy="43" rx={profile ? "18" : "20"} ry="23" fill={palette.skin} stroke="#152030" strokeWidth="4" />
        <path
          d={
            facing === "north"
              ? "M39 47 Q37 14 61 14 Q84 14 81 50 Q70 33 42 37 Z"
              : profile
                ? mirror > 0
                  ? "M40 45 Q40 16 62 14 Q80 15 82 36 Q73 25 54 26 Q48 33 40 45 Z"
                  : "M80 45 Q80 16 58 14 Q40 15 38 36 Q47 25 66 26 Q72 33 80 45 Z"
                : "M39 45 Q37 15 60 13 Q84 14 81 47 Q72 27 45 28 Z"
          }
          fill={palette.hair}
        />
        <path d="M44 25 Q58 14 76 25" fill="none" stroke={palette.hairLight} strokeLinecap="round" strokeWidth="4" opacity=".75" />
        {variant === "mara" && <path d="M77 27 Q91 42 79 62" fill="none" stroke={palette.hair} strokeLinecap="round" strokeWidth="8" />}
        {variant === "lina" && <path d="M42 29 Q30 45 41 61 M78 29 Q90 45 79 61" fill="none" stroke={palette.hair} strokeLinecap="round" strokeWidth="7" />}
        {variant === "joao" && <path d="M47 22 Q60 8 75 22" fill="none" stroke={palette.hairLight} strokeLinecap="round" strokeWidth="5" />}

        {faceVisible && (
          <>
            <path d={`M${eyeX(facing, "left") - 4} 41 Q${eyeX(facing, "left")} 38 ${eyeX(facing, "left") + 4} 41`} fill="none" stroke="#422e2d" strokeWidth="2" />
            {!profile && <path d={`M${eyeX(facing, "right") - 4} 41 Q${eyeX(facing, "right")} 38 ${eyeX(facing, "right") + 4} 41`} fill="none" stroke="#422e2d" strokeWidth="2" />}
            <circle cx={eyeX(facing, "left")} cy="42" r="2.1" fill="#182130" />
            {!profile && <circle cx={eyeX(facing, "right")} cy="42" r="2.1" fill="#182130" />}
            <path d={profile ? "M59 45 L65 49 L60 50" : "M60 44 L58 50 L62 50"} fill="none" stroke={palette.skinShadow} strokeLinecap="round" strokeWidth="1.8" />
            <path d={profile ? "M58 56 Q63 59 68 55" : "M53 56 Q60 61 67 56"} fill="none" stroke="#874d45" strokeLinecap="round" strokeWidth="2" />
          </>
        )}
      </g>

      <g className={styles.characterAccessories}>
        {variant === "founder" && <path d="M79 73 Q92 78 91 93" fill="none" stroke={palette.accessory} strokeWidth="3" strokeLinecap="round" />}
        {variant === "mara" && <><circle cx="46" cy="50" r="2.4" fill={palette.accessory} /><circle cx="75" cy="50" r="2.4" fill={palette.accessory} /></>}
        {variant === "joao" && <path d="M42 63 Q60 70 78 63" fill="none" stroke={palette.accessory} strokeWidth="3" />}
        {variant === "lina" && <path d="M47 65 H73" stroke={palette.accessory} strokeWidth="3" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

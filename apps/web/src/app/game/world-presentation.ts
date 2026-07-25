import type { Location } from "./types";

export type Facing = "north" | "south" | "east" | "west";
export type TimePhase = "dawn" | "day" | "dusk" | "night";
export type TimePreference = "auto" | TimePhase;
export type Weather = "clear" | "rain" | "mist";

export type WorldSettings = Readonly<{
  time: TimePreference;
  weather: Weather;
  reducedMotion: boolean;
  highContrast: boolean;
  largeText: boolean;
}>;

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  time: "auto",
  weather: "clear",
  reducedMotion: false,
  highContrast: false,
  largeText: false
};

export function getTimePhase(hour: number): TimePhase {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 8) return "dawn";
  if (normalized >= 8 && normalized < 17) return "day";
  if (normalized >= 17 && normalized < 20) return "dusk";
  return "night";
}

export function resolveTimePhase(
  preference: TimePreference,
  date = new Date()
): TimePhase {
  return preference === "auto" ? getTimePhase(date.getHours()) : preference;
}

export function resolveFacing(from: Location, to: Location): Facing {
  const dx = to.mapX - from.mapX;
  const dy = to.mapY - from.mapY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

export function nextLocationByDirection(
  locations: readonly Location[],
  currentCode: string,
  direction: Facing
): Location | null {
  const current = locations.find((location) => location.code === currentCode);
  if (!current) return null;

  const candidates = locations
    .filter((location) => location.code !== current.code)
    .map((location) => {
      const dx = location.mapX - current.mapX;
      const dy = location.mapY - current.mapY;
      const inDirection =
        direction === "east" ? dx > 0 :
        direction === "west" ? dx < 0 :
        direction === "south" ? dy > 0 :
        dy < 0;
      const primary = direction === "east" || direction === "west"
        ? Math.abs(dx)
        : Math.abs(dy);
      const orthogonal = direction === "east" || direction === "west"
        ? Math.abs(dy)
        : Math.abs(dx);
      return { location, inDirection, score: primary + orthogonal * 1.85 };
    })
    .filter((candidate) => candidate.inDirection)
    .sort((left, right) => left.score - right.score);

  return candidates[0]?.location ?? null;
}

export function supportsInterior(locationCode: string): boolean {
  return locationCode === "employment-center" ||
    locationCode === "municipal-market";
}

export function weatherLabel(weather: Weather): string {
  if (weather === "rain") return "Chuva urbana";
  if (weather === "mist") return "Névoa leve";
  return "Céu limpo";
}

export function timeLabel(phase: TimePhase): string {
  if (phase === "dawn") return "Amanhecer";
  if (phase === "dusk") return "Entardecer";
  if (phase === "night") return "Noite";
  return "Dia";
}

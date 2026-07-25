import type { CSSProperties } from "react";
import { CharacterSprite } from "./character-sprite";
import baseStyles from "./game.module.css";
import polishStyles from "./polish.module.css";
import type { District, Location } from "./types";
import type { Facing, TimePhase, Weather } from "./world-presentation";

const styles = { ...baseStyles, ...polishStyles };

type Props = Readonly<{
  districts: readonly District[];
  currentLocationCode: string;
  visualLocationCode: string;
  busy: boolean;
  facing: Facing;
  timePhase: TimePhase;
  weather: Weather;
  reducedMotion: boolean;
  onMove(locationCode: string): void;
}>;

function position(location: Location): Readonly<{ left: string; top: string }> {
  return { left: `${10 + location.mapX * 18}%`, top: `${12 + location.mapY * 22}%` };
}

function locationGlyph(type: string): string {
  if (type === "resource") return "⌁";
  if (type === "market") return "▥";
  if (type === "production") return "⚙";
  if (type === "event") return "✦";
  if (type === "education") return "◇";
  if (type === "logistics") return "⇄";
  return "▣";
}

export function CityWorld({ districts, currentLocationCode, visualLocationCode, busy, facing, timePhase, weather, reducedMotion, onMove }: Props) {
  const locations = districts.flatMap((district) => district.locations);
  const avatarLocation = locations.find((location) => location.code === visualLocationCode) ?? locations[0];

  return (
    <div aria-label="Mapa interativo de Nova Aurora" className={`${styles.cityStage} ${styles[`time_${timePhase}`]} ${styles[`weather_${weather}`]} ${reducedMotion ? styles.reducedMotion : ""}`} data-time={timePhase} data-weather={weather}>
      <div className={styles.skyGlow} aria-hidden="true" />
      <div className={styles.cityHorizon} aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
      <div className={styles.weatherLayer} aria-hidden="true">
        {Array.from({ length: weather === "rain" ? 28 : 10 }, (_, index) => <i key={index} style={{ "--particle": index } as CSSProperties} />)}
      </div>
      <div className={`${styles.zone} ${styles.zoneNorth}`}><span>VALE VERDE</span></div>
      <div className={`${styles.zone} ${styles.zoneWest}`}><span>CENTRO CÍVICO</span></div>
      <div className={`${styles.zone} ${styles.zoneEast}`}><span>CINTURÃO INDUSTRIAL</span></div>
      <div className={`${styles.zone} ${styles.zoneSouth}`}><span>DISTRITO CRIATIVO</span></div>
      <div className={styles.roads} aria-hidden="true" />
      <div className={styles.roadLights} aria-hidden="true" />
      <div className={styles.mobilityHub}><span>NA</span><small>Nó Central</small></div>

      {districts.flatMap((district) => district.locations.map((location) => (
        <button aria-current={location.code === currentLocationCode ? "location" : undefined} className={`${styles.mapLocation} ${styles[`location_${district.theme}`] ?? ""} ${location.code === currentLocationCode ? styles.currentLocation : ""}`} disabled={busy} key={location.code} onClick={() => onMove(location.code)} style={position(location)} title={location.description}>
          <span className={styles.buildingTop} aria-hidden="true" />
          <span className={styles.locationIcon} aria-hidden="true">{locationGlyph(location.locationType)}</span>
          <strong>{location.name}</strong><small>{district.name}</small>
        </button>
      )))}

      {avatarLocation && (
        <div aria-label={visualLocationCode === currentLocationCode ? "Seu personagem" : "Seu personagem viajando"} className={styles.avatarToken} style={position(avatarLocation)}>
          <CharacterSprite facing={facing} moving={visualLocationCode !== currentLocationCode} />
          <span>{visualLocationCode === currentLocationCode ? "Você" : "Viajando"}</span>
        </div>
      )}

      <div className={styles.mapLegend}><span><kbd>WASD</kbd> ou setas para explorar</span><span><i className={styles.legendCurrent} /> Local atual</span></div>
    </div>
  );
}

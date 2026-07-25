import styles from "./game.module.css";
import type { District, Location } from "./types";

type Props = Readonly<{
  districts: readonly District[];
  currentLocationCode: string;
  visualLocationCode: string;
  busy: boolean;
  onMove(locationCode: string): void;
}>;

function position(location: Location): Readonly<{ left: string; top: string }> {
  return {
    left: `${10 + location.mapX * 18}%`,
    top: `${12 + location.mapY * 22}%`
  };
}

export function CityWorld({
  districts,
  currentLocationCode,
  visualLocationCode,
  busy,
  onMove
}: Props) {
  const locations = districts.flatMap((district) => district.locations);
  const avatarLocation = locations.find(
    (location) => location.code === visualLocationCode
  ) ?? locations[0];

  return (
    <div className={styles.cityStage} aria-label="Mapa interativo de Nova Aurora">
      <div className={`${styles.zone} ${styles.zoneNorth}`}>
        <span>VALE VERDE</span>
      </div>
      <div className={`${styles.zone} ${styles.zoneWest}`}>
        <span>CENTRO CÍVICO</span>
      </div>
      <div className={`${styles.zone} ${styles.zoneEast}`}>
        <span>CINTURÃO INDUSTRIAL</span>
      </div>
      <div className={`${styles.zone} ${styles.zoneSouth}`}>
        <span>DISTRITO CRIATIVO</span>
      </div>
      <div className={styles.roads} aria-hidden="true" />
      <div className={styles.mobilityHub}>
        <span>NA</span>
        <small>Nó Central</small>
      </div>

      {districts.flatMap((district) => district.locations.map((location) => (
        <button
          aria-current={location.code === currentLocationCode ? "location" : undefined}
          className={`${styles.mapLocation} ${styles[`location_${district.theme}`] ?? ""} ${
            location.code === currentLocationCode ? styles.currentLocation : ""
          }`}
          disabled={busy}
          key={location.code}
          onClick={() => onMove(location.code)}
          style={position(location)}
          title={location.description}
        >
          <span className={styles.locationIcon} aria-hidden="true">
            {location.locationType === "resource" ? "🌾" :
              location.locationType === "market" ? "◫" :
              location.locationType === "production" ? "⚙" :
              location.locationType === "event" ? "✦" :
              location.locationType === "education" ? "◆" :
              location.locationType === "logistics" ? "⇄" : "▣"}
          </span>
          <strong>{location.name}</strong>
          <small>{district.name}</small>
        </button>
      ))) }

      {avatarLocation && (
        <div
          className={styles.avatarToken}
          style={position(avatarLocation)}
          aria-label="Seu personagem"
        >
          <div className={styles.avatarHead} />
          <div className={styles.avatarBody}>T</div>
          <span>{visualLocationCode === currentLocationCode ? "Você" : "Viajando"}</span>
        </div>
      )}
    </div>
  );
}

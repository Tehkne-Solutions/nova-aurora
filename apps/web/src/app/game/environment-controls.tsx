import baseStyles from "./game.module.css";
import polishStyles from "./polish.module.css";
import type { TimePreference, Weather, WorldSettings } from "./world-presentation";

const styles = { ...baseStyles, ...polishStyles };

type Props = Readonly<{
  settings: WorldSettings;
  onChange(settings: WorldSettings): void;
}>;

export function EnvironmentControls({ settings, onChange }: Props) {
  const update = <Key extends keyof WorldSettings>(
    key: Key,
    value: WorldSettings[Key]
  ) => onChange({ ...settings, [key]: value });

  return (
    <section className={styles.environmentCard}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.actionLabel}>MUNDO E ACESSIBILIDADE</span>
          <h2>Atmosfera</h2>
        </div>
        <span className={styles.settingsGlyph} aria-hidden="true">◐</span>
      </div>
      <label className={styles.controlField}>
        <span>Horário visual</span>
        <select onChange={(event) => update("time", event.target.value as TimePreference)} value={settings.time}>
          <option value="auto">Automático</option><option value="dawn">Amanhecer</option><option value="day">Dia</option><option value="dusk">Entardecer</option><option value="night">Noite</option>
        </select>
      </label>
      <label className={styles.controlField}>
        <span>Clima</span>
        <select onChange={(event) => update("weather", event.target.value as Weather)} value={settings.weather}>
          <option value="clear">Céu limpo</option><option value="rain">Chuva urbana</option><option value="mist">Névoa leve</option>
        </select>
      </label>
      <div className={styles.toggleGrid}>
        <label><input checked={settings.reducedMotion} onChange={(event) => update("reducedMotion", event.target.checked)} type="checkbox" /><span>Reduzir movimento</span></label>
        <label><input checked={settings.highContrast} onChange={(event) => update("highContrast", event.target.checked)} type="checkbox" /><span>Alto contraste</span></label>
        <label><input checked={settings.largeText} onChange={(event) => update("largeText", event.target.checked)} type="checkbox" /><span>Texto ampliado</span></label>
      </div>
    </section>
  );
}

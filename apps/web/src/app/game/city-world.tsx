"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CharacterSprite } from "./character-sprite";
import { CitySceneArt } from "./city-scene-art";
import { GlbPlacement } from "./glb-placement";
import baseStyles from "./game.module.css";
import polishStyles from "./polish.module.css";
import ugcStyles from "./ugc-world.module.css";
import visualStyles from "./world-visual.module.css";
import type { District, Location } from "./types";
import type { Facing, TimePhase, Weather } from "./world-presentation";

const styles = { ...baseStyles, ...polishStyles, ...ugcStyles, ...visualStyles };
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ANIMATION_STATES = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;
type AnimationState = typeof ANIMATION_STATES[number];

type WorldPlacement = Readonly<{
  id: string;
  assetId: string;
  locationCode: string;
  label: string;
  offsetX: number;
  offsetY: number;
  scalePercent: number;
  rotationYDegrees: number;
  animationState?: AnimationState;
  interactionScope?: "owner_only" | "authenticated";
  contentType: string;
  renderMode: "image-billboard-v1" | "glb-model-v1";
  assetPath: string | null;
  assetUri: string | null;
}>;

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

function LocationIcon({ type }: Readonly<{ type: string }>): ReactNode {
  if (type === "resource") return <svg viewBox="0 0 28 28"><path d="M5 21c4-8 7-12 16-15-1 9-5 14-13 16" /><path d="M8 20c4-4 7-7 12-10" /></svg>;
  if (type === "market") return <svg viewBox="0 0 28 28"><path d="M5 11h18l-2-6H7z" /><path d="M7 11v12h14V11" /><path d="M11 23v-7h6v7" /></svg>;
  if (type === "production") return <svg viewBox="0 0 28 28"><path d="M4 22h20V10l-6 4V9l-6 5V8l-8 5z" /><path d="M9 22v-4M14 22v-4M19 22v-4" /></svg>;
  if (type === "event") return <svg viewBox="0 0 28 28"><path d="M14 3l2.6 7.4L24 13l-7.4 2.6L14 23l-2.6-7.4L4 13l7.4-2.6z" /></svg>;
  if (type === "education") return <svg viewBox="0 0 28 28"><path d="M3 10l11-5 11 5-11 5z" /><path d="M7 12v6c5 3 9 3 14 0v-6" /><path d="M25 10v8" /></svg>;
  if (type === "logistics") return <svg viewBox="0 0 28 28"><path d="M3 9h15v11H3z" /><path d="M18 13h4l3 3v4h-7z" /><circle cx="8" cy="21" r="2" /><circle cx="21" cy="21" r="2" /></svg>;
  return <svg viewBox="0 0 28 28"><path d="M5 23V9l9-5 9 5v14z" /><path d="M10 23v-7h8v7M9 11h2M17 11h2" /></svg>;
}

function placementAssetUrl(placement: WorldPlacement): string | null {
  if (placement.assetPath) return `${API_URL}${placement.assetPath}`;
  return placement.assetUri;
}

function nextInteractiveState(current: AnimationState): AnimationState {
  if (current === "open") return "close";
  if (current === "close") return "open";
  if (current === "activate") return "deactivate";
  if (current === "deactivate") return "activate";
  if (current === "spin") return "idle";
  return "activate";
}

export function CityWorld({ districts, currentLocationCode, visualLocationCode, busy, facing, timePhase, weather, reducedMotion, onMove }: Props) {
  const [placements, setPlacements] = useState<readonly WorldPlacement[]>([]);
  const [interactionBusyId, setInteractionBusyId] = useState<string | null>(null);
  const [interactionMessage, setInteractionMessage] = useState<string | null>(null);
  const locations = districts.flatMap((district) => district.locations);
  const avatarLocation = locations.find((location) => location.code === visualLocationCode) ?? locations[0];

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_URL}/v1/ugc/world/placements?limit=200`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`UGC world ${response.status}`);
        return response.json() as Promise<{ placements?: WorldPlacement[] }>;
      })
      .then((payload) => setPlacements(Array.isArray(payload.placements) ? payload.placements : []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPlacements([]);
      });
    return () => controller.abort();
  }, []);

  async function interact(placement: WorldPlacement): Promise<void> {
    if (busy || interactionBusyId || placement.locationCode !== currentLocationCode || placement.interactionScope !== "authenticated") return;
    const current = placement.animationState ?? "idle";
    const next = nextInteractiveState(current);
    setInteractionBusyId(placement.id);
    setInteractionMessage(`Interagindo com ${placement.label}…`);
    try {
      const response = await fetch(`${API_URL}/v1/ugc/world/placements/${placement.id}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ animationState: next })
      });
      const payload = await response.json() as { animationState?: AnimationState; message?: string };
      const returnedState = payload.animationState;
      if (!response.ok || !returnedState) throw new Error(payload.message ?? `Interação UGC ${response.status}`);
      setPlacements((currentPlacements) => currentPlacements.map((item) => item.id === placement.id ? { ...item, animationState: returnedState } : item));
      setInteractionMessage(`${placement.label}: interação concluída.`);
    } catch (error) {
      setInteractionMessage(error instanceof Error ? error.message : "Não foi possível interagir com este objeto.");
    } finally {
      setInteractionBusyId(null);
    }
  }

  return (
    <div aria-label="Mapa interativo de Nova Aurora" className={`${styles.cityStage} ${styles[`time_${timePhase}`]} ${styles[`weather_${weather}`]} ${reducedMotion ? styles.reducedMotion : ""}`} data-time={timePhase} data-weather={weather}>
      <CitySceneArt timePhase={timePhase} />
      <div className={styles.weatherLayer} aria-hidden="true">{Array.from({ length: weather === "rain" ? 28 : 10 }, (_, index) => <i key={index} style={{ "--particle": index } as CSSProperties} />)}</div>

      {districts.flatMap((district) => district.locations.map((location) => (
        <button aria-current={location.code === currentLocationCode ? "location" : undefined} aria-label={`${location.name}, ${district.name}. ${location.description}`} className={`${styles.mapLocation} ${styles[`location_${district.theme}`] ?? ""} ${location.code === currentLocationCode ? styles.currentLocation : ""}`} disabled={busy} key={location.code} onClick={() => onMove(location.code)} style={position(location)} title={location.description}>
          <span className={styles.locationIcon} aria-hidden="true"><LocationIcon type={location.locationType} /></span><strong>{location.name}</strong><small>{district.name}</small>
        </button>
      )))}

      {placements.map((placement) => {
        const location = locations.find((item) => item.code === placement.locationCode);
        const assetUrl = placementAssetUrl(placement);
        if (!location || !assetUrl) return null;
        const isImage = placement.renderMode === "image-billboard-v1" && placement.contentType.startsWith("image/");
        const isGlb = placement.renderMode === "glb-model-v1" && placement.contentType === "model/gltf-binary";
        if (!isImage && !isGlb) return null;
        const placementStyle: CSSProperties = { ...position(location), transform: `translate(calc(-50% + ${placement.offsetX}px), calc(-50% + ${placement.offsetY}px)) scale(${placement.scalePercent / 100})` };
        const current = placement.locationCode === currentLocationCode;
        const interactive = current && isGlb && placement.interactionScope === "authenticated";
        return (
          <figure aria-label={`Objeto criado por usuário: ${placement.label}`} className={`${styles.ugcWorldPlacement} ${isGlb ? styles.ugcWorldModel : ""} ${interactive ? styles.ugcWorldInteractive : ""}`} data-animation-state={placement.animationState ?? "idle"} data-current={current ? "true" : "false"} data-interaction-scope={placement.interactionScope ?? "owner_only"} data-render-mode={placement.renderMode} key={placement.id} style={placementStyle}>
            {isImage ? <img alt="" src={assetUrl} /> : <GlbPlacement animationState={placement.animationState} assetUrl={assetUrl} current={current} label={placement.label} rotationYDegrees={placement.rotationYDegrees} />}
            <figcaption>{placement.label}</figcaption>
            {interactive ? <button className={styles.ugcInteractionButton} disabled={busy || interactionBusyId !== null} onClick={() => void interact(placement)} type="button">{interactionBusyId === placement.id ? "Interagindo…" : "Interagir"}</button> : null}
          </figure>
        );
      })}

      {avatarLocation && <div aria-label={visualLocationCode === currentLocationCode ? "Seu personagem" : "Seu personagem viajando"} className={styles.avatarToken} style={position(avatarLocation)}><CharacterSprite facing={facing} moving={visualLocationCode !== currentLocationCode} /><span>{visualLocationCode === currentLocationCode ? "Você" : "Viajando"}</span></div>}
      {interactionMessage ? <p aria-live="polite" className={styles.ugcInteractionStatus}>{interactionMessage}</p> : null}
      <div className={styles.mapLegend}><span><kbd>WASD</kbd> ou setas para explorar</span><span><i className={styles.legendCurrent} /> Local atual</span></div>
    </div>
  );
}

// Tehkné Solutions

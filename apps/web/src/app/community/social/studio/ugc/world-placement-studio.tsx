"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlbPlacement } from "../../../../game/glb-placement";
import styles from "../../social.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type RenderableAsset = Readonly<{
  id: string;
  fileName: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "model/gltf-binary";
  status: "clean";
  assetPath: string | null;
  assetUri: string | null;
}>;

type LocationOption = Readonly<{
  code: string;
  name: string;
  locationType: string;
  districtCode: string;
  districtName: string;
}>;

type Placement = Readonly<{
  id: string;
  assetId: string;
  locationCode: string;
  locationName?: string;
  label: string;
  offsetX: number;
  offsetY: number;
  scalePercent: number;
  rotationYDegrees: number;
  contentType: string;
  renderMode: "image-billboard-v1" | "glb-model-v1";
  assetPath: string | null;
  assetUri: string | null;
  fileName?: string;
}>;

type ApiError = { message?: string; error?: string };

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Preserva o status quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function assetReference(asset: { assetUri: string | null; assetPath: string | null }): string | null {
  if (asset.assetUri) return asset.assetUri;
  return asset.assetPath ? `${API_URL}${asset.assetPath}` : null;
}

function renderable(asset: RenderableAsset): boolean {
  return asset.status === "clean"
    && (asset.contentType.startsWith("image/") || asset.contentType === "model/gltf-binary")
    && Boolean(asset.assetUri || asset.assetPath);
}

export function WorldPlacementStudio() {
  const [assets, setAssets] = useState<RenderableAsset[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [assetId, setAssetId] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [label, setLabel] = useState("");
  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("-70");
  const [scalePercent, setScalePercent] = useState("100");
  const [rotationYDegrees, setRotationYDegrees] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [assetResponse, locationResponse, placementResponse] = await Promise.all([
        apiJson<{ assets: RenderableAsset[] }>("/v1/ugc/assets/library/me?status=clean&limit=100"),
        apiJson<{ locations: LocationOption[] }>("/v1/ugc/world/locations"),
        apiJson<{ placements: Placement[] }>("/v1/ugc/world/placements/me")
      ]);
      const renderableAssets = assetResponse.assets.filter(renderable);
      setAssets(renderableAssets);
      setLocations(locationResponse.locations);
      setPlacements(placementResponse.placements);
      setAssetId((current) => current && renderableAssets.some((asset) => asset.id === current) ? current : renderableAssets[0]?.id ?? "");
      setLocationCode((current) => current && locationResponse.locations.some((location) => location.code === current) ? current : locationResponse.locations[0]?.code ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o editor de placement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId) ?? null, [assetId, assets]);
  const selectedAssetReference = selectedAsset ? assetReference(selectedAsset) : null;
  const selectedIsGlb = selectedAsset?.contentType === "model/gltf-binary";
  const parsedOffsetX = Number(offsetX);
  const parsedOffsetY = Number(offsetY);
  const parsedScale = Number(scalePercent);
  const parsedRotation = Number(rotationYDegrees);
  const ready = Boolean(
    assetId
    && locationCode
    && label.trim()
    && Number.isInteger(parsedOffsetX) && parsedOffsetX >= -120 && parsedOffsetX <= 120
    && Number.isInteger(parsedOffsetY) && parsedOffsetY >= -140 && parsedOffsetY <= 80
    && Number.isInteger(parsedScale) && parsedScale >= 50 && parsedScale <= 180
    && Number.isInteger(parsedRotation) && parsedRotation >= 0 && parsedRotation <= 359
  );

  async function createPlacement() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setNotice(selectedIsGlb ? "Instalando o modelo GLB clean no mundo..." : "Instalando a imagem clean no mundo...");
    try {
      await apiJson<{ placement: Placement }>("/v1/ugc/world/placements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId,
          locationCode,
          label: label.trim(),
          offsetX: parsedOffsetX,
          offsetY: parsedOffsetY,
          scalePercent: parsedScale,
          rotationYDegrees: selectedIsGlb ? parsedRotation : 0
        })
      });
      setNotice(selectedIsGlb
        ? "Modelo 3D instalado. O /game já pode renderizá-lo via GLB WebGL v1."
        : "Objeto instalado. O /game já pode renderizá-lo como billboard.");
      setLabel("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível instalar o objeto.");
    } finally {
      setBusy(false);
    }
  }

  async function removePlacement(placementId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/v1/ugc/world/placements/${placementId}`, { method: "DELETE" });
      setNotice("Objeto retirado do mundo.");
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível retirar o objeto.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className={styles.detail}><div className={styles.empty}>Carregando editor de mundo UGC...</div></section>;
  }

  return (
    <section className={styles.detail} aria-labelledby="ugc-world-placement-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="ugc-world-placement-title">Objetos UGC no mundo</h3>
          <p>Instale imagens ou modelos GLB verificados nos locais da cidade. O banco e a leitura pública continuam fail-closed: somente assets `clean` do próprio criador entram no runtime.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void load()}>Atualizar</button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.creatorGrid}>
        <section className={styles.panel} aria-labelledby="ugc-world-install-title">
          <h4 id="ugc-world-install-title">Instalar no mapa</h4>
          {assets.length === 0 ? <div className={styles.empty}>Nenhum asset renderizável disponível. Envie PNG, JPEG, WebP ou GLB na biblioteca primeiro.</div> : (
            <div className={styles.formRow}>
              <label htmlFor="ugc-world-asset">Asset</label>
              <select id="ugc-world-asset" className={styles.select} value={assetId} onChange={(event) => {
                const next = assets.find((asset) => asset.id === event.target.value);
                setAssetId(event.target.value);
                setLabel(next?.fileName ?? "");
                if (next?.contentType !== "model/gltf-binary") setRotationYDegrees("0");
              }}>
                {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.contentType === "model/gltf-binary" ? "3D · " : "IMG · "}{asset.fileName}</option>)}
              </select>

              {selectedAssetReference && selectedAsset ? (
                selectedIsGlb
                  ? <GlbPlacement assetUrl={selectedAssetReference} label={`Preview de ${selectedAsset.fileName}`} rotationYDegrees={parsedRotation || 0} />
                  : <img src={selectedAssetReference} alt={`Preview de ${selectedAsset.fileName}`} style={{ width: 120, height: 90, objectFit: "contain", borderRadius: 12 }} />
              ) : null}

              <label htmlFor="ugc-world-location">Local</label>
              <select id="ugc-world-location" className={styles.select} value={locationCode} onChange={(event) => setLocationCode(event.target.value)}>
                {locations.map((location) => <option key={location.code} value={location.code}>{location.districtName} · {location.name}</option>)}
              </select>

              <label htmlFor="ugc-world-label">Nome visual</label>
              <input id="ugc-world-label" className={styles.input} maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={selectedIsGlb ? "Ex.: Totem 3D da minha loja" : "Ex.: Placa da minha loja"} />

              <label htmlFor="ugc-world-offset-x">Deslocamento horizontal · -120 a 120 px</label>
              <input id="ugc-world-offset-x" className={styles.input} type="number" min="-120" max="120" step="1" value={offsetX} onChange={(event) => setOffsetX(event.target.value)} />

              <label htmlFor="ugc-world-offset-y">Deslocamento vertical · -140 a 80 px</label>
              <input id="ugc-world-offset-y" className={styles.input} type="number" min="-140" max="80" step="1" value={offsetY} onChange={(event) => setOffsetY(event.target.value)} />

              <label htmlFor="ugc-world-scale">Escala · 50% a 180%</label>
              <input id="ugc-world-scale" className={styles.input} type="number" min="50" max="180" step="1" value={scalePercent} onChange={(event) => setScalePercent(event.target.value)} />

              {selectedIsGlb ? (
                <>
                  <label htmlFor="ugc-world-rotation">Rotação horizontal 3D · 0° a 359°</label>
                  <input id="ugc-world-rotation" className={styles.input} type="number" min="0" max="359" step="1" value={rotationYDegrees} onChange={(event) => setRotationYDegrees(event.target.value)} />
                </>
              ) : null}

              <button className={styles.button} type="button" disabled={busy || !ready} onClick={() => void createPlacement()}>
                {busy ? "Instalando..." : selectedIsGlb ? "Colocar modelo 3D" : "Colocar no mundo"}
              </button>
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="ugc-world-active-title">
          <div className={styles.sectionHeader}>
            <div><h4 id="ugc-world-active-title">Objetos ativos</h4><p>Limite inicial: 12 objetos por criador em cada local.</p></div>
            <span className={styles.pill}>{placements.length} ativos</span>
          </div>
          {placements.length === 0 ? <div className={styles.empty}>Você ainda não instalou objetos UGC no mundo.</div> : (
            <div className={styles.activityList}>
              {placements.map((placement) => {
                const reference = assetReference(placement);
                const isGlb = placement.renderMode === "glb-model-v1";
                return (
                  <article className={styles.activity} key={placement.id}>
                    <div>
                      <h4>{placement.label}</h4>
                      <p>{placement.locationName ?? placement.locationCode} · {isGlb ? "GLB 3D" : "billboard"} · x {placement.offsetX}px · y {placement.offsetY}px · escala {placement.scalePercent}%{isGlb ? ` · rotação ${placement.rotationYDegrees}°` : ""}</p>
                      {reference ? (
                        isGlb
                          ? <GlbPlacement assetUrl={reference} label={placement.label} rotationYDegrees={placement.rotationYDegrees} />
                          : <img src={reference} alt="" style={{ width: 90, height: 64, objectFit: "contain", borderRadius: 10 }} />
                      ) : null}
                    </div>
                    <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void removePlacement(placement.id)}>Retirar</button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

// Tehkné Solutions

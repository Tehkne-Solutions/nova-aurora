"use client";

import { useEffect, useState } from "react";
import { prepareGlbForAnimationState } from "./glb-animation-state-asset";
import { normalizeObjectAnimationState } from "./glb-object-animation-state";
import { GlbPlacement as CertifiedGlbPlacement } from "./glb-node-animation-placement";
import styles from "./glb-placement.module.css";

type Props = Readonly<{
  assetUrl: string;
  label: string;
  rotationYDegrees?: number;
  current?: boolean;
  animationState?: unknown;
}>;

type Prepared = Readonly<{
  url: string;
  state: ReturnType<typeof normalizeObjectAnimationState>;
  selectedClipName: string | null;
  reordered: boolean;
}>;

export function GlbPlacement({
  assetUrl,
  label,
  rotationYDegrees = 0,
  current = false,
  animationState = "idle"
}: Props) {
  const normalizedState = normalizeObjectAnimationState(animationState);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPrepared(null);
    setError(null);

    void fetch(assetUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GLB ${response.status}`);
        const type = response.headers.get("content-type")?.split(";", 1)[0];
        if (type && type !== "model/gltf-binary" && type !== "application/octet-stream") {
          throw new Error("Content-Type GLB inesperado para seleção de estado.");
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
        const result = prepareGlbForAnimationState(buffer, normalizedState);
        objectUrl = URL.createObjectURL(new Blob([result.buffer], { type: "model/gltf-binary" }));
        setPrepared({
          url: objectUrl,
          state: normalizedState,
          selectedClipName: result.selectedClipName,
          reordered: result.reordered
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Estado de animação GLB indisponível.");
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetUrl, normalizedState]);

  if (error) {
    return (
      <div
        aria-label={`Modelo 3D criado por usuário: ${label}`}
        className={styles.viewport}
        data-animation-state={normalizedState}
        data-current={current ? "true" : "false"}
        data-glb-state-adapter="persisted-state-clip-v1"
        role="img"
        title={`${label}: ${error}`}
      >
        <span className={styles.fallback}>3D seguro<br />estado indisponível</span>
      </div>
    );
  }

  if (!prepared) {
    return (
      <div
        aria-label={`Preparando modelo 3D criado por usuário: ${label}`}
        className={styles.viewport}
        data-animation-state={normalizedState}
        data-current={current ? "true" : "false"}
        data-glb-state-adapter="persisted-state-clip-v1"
        role="img"
      >
        <span className={styles.loading}>preparando estado 3D…</span>
      </div>
    );
  }

  return (
    <div
      data-animation-state={prepared.state}
      data-selected-clip={prepared.selectedClipName ?? "fallback-clip-0"}
      data-state-reordered={prepared.reordered ? "true" : "false"}
      data-glb-state-adapter="persisted-state-clip-v1"
    >
      <CertifiedGlbPlacement
        assetUrl={prepared.url}
        current={current}
        label={label}
        rotationYDegrees={rotationYDegrees}
      />
    </div>
  );
}

// Tehkné Solutions

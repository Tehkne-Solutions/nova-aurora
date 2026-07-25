"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CityWorld } from "./city-world";
import styles from "./game.module.css";
import { HarvestMinigame } from "./harvest-minigame";
import { NpcDialogue } from "./npc-dialogue";
import type {
  CityState,
  ExperienceState,
  HarvestAction,
  HarvestSession,
  Npc
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ALICE = "alice@nova-aurora.local";
const BOB = "bob@nova-aurora.local";

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function aurora(minor: number): string {
  return `${(minor / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function request<T>(
  path: string,
  options: Readonly<{
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    actor?: string;
    idempotencyKey?: string;
  }> = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-actor-email": options.actor ?? ALICE,
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {})
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "A operação não pôde ser concluída.");
  }
  return payload;
}

export function CityGame() {
  const [state, setState] = useState<CityState | null>(null);
  const [experience, setExperience] = useState<ExperienceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando Nova Aurora...");
  const [travelTarget, setTravelTarget] = useState<string | null>(null);
  const [dialogueNpc, setDialogueNpc] = useState<Npc | null>(null);
  const [harvest, setHarvest] = useState<HarvestSession | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextExperience] = await Promise.all([
        request<CityState>("/v1/city/state"),
        request<ExperienceState>("/v1/gameplay/state")
      ]);
      setState(nextState);
      setExperience(nextExperience);
      setHarvest((current) => current ?? nextExperience.activeHarvest);
      setMessage("Cidade sincronizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API indisponível.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (
    label: string,
    operation: () => Promise<unknown>,
    refreshDelay = 0
  ) => {
    setBusy(true);
    setMessage(label);
    try {
      await operation();
      if (refreshDelay > 0) {
        setMessage(`${label} Aguardando o ciclo econômico...`);
        await wait(refreshDelay);
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na ação.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const currentLocation = useMemo(() => state?.districts
    .flatMap((district) => district.locations)
    .find((location) => location.code === state.player.currentLocationCode), [state]);

  if (!state || !experience) {
    return <section className={styles.loading}>{message}</section>;
  }

  const job = state.jobs.find((item) => item.code === "harvest-support");
  const step = (code: string) => state.onboarding.steps
    .find((item) => item.code === code)?.completed ?? false;

  const move = async (locationCode: string) => {
    if (locationCode === state.player.currentLocationCode || busy) return;
    setBusy(true);
    setTravelTarget(locationCode);
    setMessage("Cruzando as rotas de Nova Aurora...");
    try {
      await wait(700);
      await request("/v1/city/move", {
        method: "POST",
        body: { locationCode },
        idempotencyKey: key("move")
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A viagem falhou.");
    } finally {
      setTravelTarget(null);
      setBusy(false);
    }
  };

  const acceptJob = () => run(
    "Aceitando trabalho público...",
    () => request("/v1/jobs/harvest-support/accept", {
      method: "POST",
      idempotencyKey: key("accept-job")
    })
  );

  const startHarvest = () => run(
    "Preparando o campo...",
    async () => {
      const session = await request<HarvestSession>(
        "/v1/gameplay/harvest/start",
        {
          method: "POST",
          idempotencyKey: key("harvest-start")
        }
      );
      setHarvest(session);
    }
  );

  const finishHarvest = async (sequence: readonly HarvestAction[]) => {
    if (!harvest) return;
    setBusy(true);
    setMessage("Validando precisão da colheita...");
    try {
      const result = await request<HarvestSession>(
        `/v1/gameplay/harvest/${harvest.id}/complete`,
        {
          method: "POST",
          body: { sequence },
          idempotencyKey: key("harvest-complete")
        }
      );
      setHarvest(null);
      if (result.status !== "completed") {
        setMessage(`Colheita insuficiente: ${result.score}/100. Tente novamente.`);
        await refresh();
        return;
      }
      setMessage(`Colheita aprovada: ${result.score}/100. Liquidando recompensa...`);
      await request("/v1/jobs/harvest-support/complete", {
        method: "POST",
        idempotencyKey: key("complete-job")
      });
      await refresh();
      setMessage(`Colheita concluída com ${result.score}/100.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A colheita falhou.");
    } finally {
      setBusy(false);
    }
  };

  const produce = (recipeCode: "flour" | "bread", delay: number) => run(
    recipeCode === "flour" ? "Moendo farinha..." : "Assando pão...",
    () => request("/v1/production/orders", {
      method: "POST",
      body: { recipeCode, batches: 1 },
      idempotencyKey: key(`production-${recipeCode}`)
    }),
    delay
  );

  const listBread = () => run(
    "Publicando pão no Mercado Municipal...",
    () => request("/v1/market/orders", {
      method: "POST",
      body: {
        side: "sell",
        itemCode: "bread",
        quantity: 6,
        unitPriceMinor: 2200
      },
      idempotencyKey: key("sell-bread")
    })
  );

  const simulateBuyer = () => run(
    "Bob está comprando dois pães...",
    () => request("/v1/market/orders", {
      method: "POST",
      actor: BOB,
      body: {
        side: "buy",
        itemCode: "bread",
        quantity: 2,
        unitPriceMinor: 2300
      },
      idempotencyKey: key("bob-buy-bread")
    })
  );

  const visibleNpc = experience.npcs[0] ?? null;

  return (
    <div className={styles.layout}>
      <section className={styles.worldPanel}>
        <div className={styles.hud}>
          <div>
            <span>Jogador</span>
            <strong>{state.player.displayName}</strong>
          </div>
          <div>
            <span>Saldo</span>
            <strong>{aurora(state.player.balanceMinor)}</strong>
          </div>
          <div>
            <span>Local</span>
            <strong>{currentLocation?.name ?? state.player.currentLocationCode}</strong>
          </div>
          <button disabled={busy} onClick={() => void refresh()}>Atualizar</button>
        </div>

        <CityWorld
          busy={busy}
          currentLocationCode={state.player.currentLocationCode}
          districts={state.districts}
          onMove={(locationCode) => void move(locationCode)}
          visualLocationCode={travelTarget ?? state.player.currentLocationCode}
        />
        <p className={styles.statusLine}>{message}</p>
      </section>

      <aside className={styles.sidePanel}>
        <section className={styles.questCard}>
          <div className={styles.questTitle}>
            <div>
              <span>MISSÃO PRINCIPAL</span>
              <h2>{state.onboarding.title}</h2>
            </div>
            <strong>
              {state.onboarding.completedSteps}/{state.onboarding.totalSteps}
            </strong>
          </div>
          <div className={styles.progress}>
            <span style={{
              width: `${state.onboarding.completedSteps / state.onboarding.totalSteps * 100}%`
            }} />
          </div>
          <ol className={styles.steps}>
            {state.onboarding.steps.map((item) => (
              <li className={item.completed ? styles.done : ""} key={item.code}>
                <span>{item.completed ? "✓" : "○"}</span>
                {item.title}
              </li>
            ))}
          </ol>
        </section>

        {visibleNpc && (
          <section className={styles.npcCard}>
            <div className={`${styles.npcMiniPortrait} ${styles[`npc_${visibleNpc.avatar}`] ?? ""}`}>
              {visibleNpc.name.slice(0, 1)}
            </div>
            <div>
              <span className={styles.actionLabel}>NPC PRÓXIMO</span>
              <h2>{visibleNpc.name}</h2>
              <p>{visibleNpc.roleTitle}</p>
              <button disabled={busy} onClick={() => setDialogueNpc(visibleNpc)}>
                Conversar
              </button>
            </div>
          </section>
        )}

        <section className={styles.actionCard}>
          <span className={styles.actionLabel}>AÇÃO DISPONÍVEL</span>
          <h2>{currentLocation?.name}</h2>
          <p>{currentLocation?.description}</p>

          {state.player.currentLocationCode === "employment-center" && !job?.assignmentStatus && (
            <button disabled={busy} onClick={() => void acceptJob()}>
              Aceitar Apoio à Colheita
            </button>
          )}
          {job?.assignmentStatus === "accepted" && state.player.currentLocationCode !== "harvest-fields" && (
            <button disabled={busy} onClick={() => void move("harvest-fields")}>
              Viajar aos Campos de Colheita
            </button>
          )}
          {job?.assignmentStatus === "accepted" && state.player.currentLocationCode === "harvest-fields" && !step("complete-harvest-job") && (
            <button disabled={busy} onClick={() => void startHarvest()}>
              {experience.activeHarvest ? "Retomar colheita" : "Iniciar Ritmo da Colheita"}
            </button>
          )}
          {step("complete-harvest-job") && !step("produce-flour") && (
            <button disabled={busy} onClick={() => void produce("flour", 6500)}>
              Produzir farinha
            </button>
          )}
          {step("produce-flour") && !step("produce-bread") && (
            <button disabled={busy} onClick={() => void produce("bread", 9500)}>
              Assar pão
            </button>
          )}
          {step("produce-bread") && !step("list-bread") && (
            <button disabled={busy} onClick={() => void listBread()}>
              Publicar 6 pães · 22,00 CA
            </button>
          )}
          {step("list-bread") && !step("sell-bread") && (
            <button disabled={busy} onClick={() => void simulateBuyer()}>
              Simular compra de Bob
            </button>
          )}
          {step("sell-bread") && (
            <div className={styles.successBox}>
              <strong>Cadeia concluída!</strong>
              <span>Você produziu valor e realizou sua primeira venda.</span>
            </div>
          )}
        </section>

        <section className={styles.inventoryCard}>
          <span>INVENTÁRIO</span>
          <div>
            {Object.entries(state.player.inventory).map(([item, quantity]) => (
              <p key={item}><strong>{item}</strong><span>{quantity / 100}</span></p>
            ))}
          </div>
        </section>
      </aside>

      {dialogueNpc && (
        <NpcDialogue npc={dialogueNpc} onClose={() => setDialogueNpc(null)} />
      )}
      {harvest && (
        <HarvestMinigame
          busy={busy}
          onCancel={() => setHarvest(null)}
          onSubmit={finishHarvest}
          session={harvest}
        />
      )}
    </div>
  );
}

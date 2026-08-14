"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Channel = Readonly<{
  id: string;
  handle: string;
  name: string;
  description: string;
  status: "active" | "paused" | "retired";
  created_at: string;
}>;

type CreatorContent = Readonly<{
  id: string;
  channel_id: string;
  creator_user_id: string;
  content_type: ContentType;
  title: string;
  body: string;
  media_uri: string | null;
  access_model: AccessModel;
  price_minor: number | string;
  status: "draft" | "published" | "archived" | "rejected";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  channel_handle: string;
  channel_name: string;
}>;

type ContentType = "post" | "video" | "audio" | "live" | "magazine" | "course" | "gallery" | "event";
type AccessModel = "free" | "purchase" | "subscription" | "ticket";
type ApiError = { message?: string; error?: string };

type ComposerState = Readonly<{
  channelId: string;
  contentType: ContentType;
  title: string;
  body: string;
  mediaUri: string;
  accessModel: AccessModel;
  priceMinor: string;
}>;

const emptyComposer = (channelId = ""): ComposerState => ({
  channelId,
  contentType: "post",
  title: "",
  body: "",
  mediaUri: "",
  accessModel: "free",
  priceMinor: "0"
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      // Mantém o status HTTP quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: CreatorContent["status"]): string {
  if (status === "draft") return "Rascunho";
  if (status === "published") return "Publicado";
  if (status === "archived") return "Arquivado";
  return "Rejeitado pela moderação";
}

function pricingPayload(state: ComposerState): { accessModel: AccessModel; priceMinor: number } {
  const parsed = Number(state.priceMinor || 0);
  return {
    accessModel: state.accessModel,
    priceMinor: state.accessModel === "free" ? 0 : parsed
  };
}

export function CreatorStudio() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [content, setContent] = useState<CreatorContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [channelHandle, setChannelHandle] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(() => emptyComposer());

  const activeChannels = useMemo(() => channels.filter((channel) => channel.status === "active"), [channels]);

  const loadStudio = useCallback(async () => {
    setError(null);
    try {
      const [channelResult, contentResult] = await Promise.all([
        api<{ channels: Channel[] }>("/v1/creator/channels/me"),
        api<{ content: CreatorContent[] }>("/v1/creator/content/me?limit=100")
      ]);
      setChannels(channelResult.channels);
      setContent(contentResult.content);
      setComposer((current) => current.channelId || channelResult.channels[0]?.id
        ? { ...current, channelId: current.channelId || channelResult.channels[0]?.id || "" }
        : current);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o Creator Studio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "A operação editorial não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await api("/v1/creator/channels", {
        method: "POST",
        body: JSON.stringify({
          handle: channelHandle.trim().toLowerCase(),
          name: channelName.trim(),
          description: channelDescription.trim()
        })
      });
      setChannelHandle("");
      setChannelName("");
      setChannelDescription("");
      await loadStudio();
    }, "Canal criado e pronto para receber conteúdo.");
  }

  function contentPayload(publish: boolean) {
    const pricing = pricingPayload(composer);
    return {
      channelId: composer.channelId,
      contentType: composer.contentType,
      title: composer.title.trim(),
      body: composer.body,
      mediaUri: composer.mediaUri.trim() || null,
      accessModel: pricing.accessModel,
      priceMinor: pricing.priceMinor,
      publish
    };
  }

  async function saveNewContent(publish: boolean) {
    await run(async () => {
      await api("/v1/creator/content", {
        method: "POST",
        body: JSON.stringify(contentPayload(publish))
      });
      setComposer(emptyComposer(activeChannels[0]?.id ?? ""));
      await loadStudio();
    }, publish ? "Conteúdo publicado." : "Rascunho salvo.");
  }

  async function saveEdit() {
    if (!editingId) return;
    const pricing = pricingPayload(composer);
    await run(async () => {
      await api(`/v1/creator/content/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          channelId: composer.channelId,
          contentType: composer.contentType,
          title: composer.title.trim(),
          body: composer.body,
          mediaUri: composer.mediaUri.trim() || null,
          accessModel: pricing.accessModel,
          priceMinor: pricing.priceMinor
        })
      });
      setEditingId(null);
      setComposer(emptyComposer(activeChannels[0]?.id ?? ""));
      await loadStudio();
    }, "Alterações editoriais salvas.");
  }

  function beginEdit(item: CreatorContent) {
    setEditingId(item.id);
    setComposer({
      channelId: item.channel_id,
      contentType: item.content_type,
      title: item.title,
      body: item.body,
      mediaUri: item.media_uri ?? "",
      accessModel: item.access_model,
      priceMinor: String(item.price_minor)
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setComposer(emptyComposer(activeChannels[0]?.id ?? ""));
  }

  async function transition(item: CreatorContent, action: "publish" | "archive") {
    await run(async () => {
      await api(`/v1/creator/content/${item.id}/${action}`, { method: "POST" });
      if (editingId === item.id) cancelEdit();
      await loadStudio();
    }, action === "publish" ? "Conteúdo publicado." : "Conteúdo arquivado.");
  }

  const validPrice = composer.accessModel === "free" || Number(composer.priceMinor) > 0;
  const composerReady = Boolean(composer.channelId && composer.title.trim() && validPrice);

  if (loading) return <div className={styles.empty}>Carregando Creator Studio...</div>;

  return (
    <section className={styles.detail} aria-labelledby="creator-studio-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="creator-studio-title">Creator Studio</h3>
          <p>Crie seu canal, prepare rascunhos e publique conteúdo na economia criativa de Nova Aurora.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void loadStudio()}>Atualizar</button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.creatorGrid}>
        <section className={styles.panel} aria-labelledby="channel-create-title">
          <h4 id="channel-create-title">Novo canal</h4>
          <form className={styles.formRow} onSubmit={createChannel}>
            <label htmlFor="creator-channel-handle">Handle</label>
            <input
              id="creator-channel-handle"
              className={styles.input}
              value={channelHandle}
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9._-]{2,39}"
              placeholder="meu.estudio"
              onChange={(event) => setChannelHandle(event.target.value.toLowerCase())}
              required
            />
            <label htmlFor="creator-channel-name">Nome</label>
            <input id="creator-channel-name" className={styles.input} value={channelName} maxLength={120} onChange={(event) => setChannelName(event.target.value)} required />
            <label htmlFor="creator-channel-description">Descrição</label>
            <textarea id="creator-channel-description" className={styles.textarea} value={channelDescription} maxLength={2000} onChange={(event) => setChannelDescription(event.target.value)} />
            <div className={styles.actions}>
              <button className={styles.button} type="submit" disabled={busy || !channelHandle.trim() || !channelName.trim()}>Criar canal</button>
            </div>
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="composer-title">
          <h4 id="composer-title">{editingId ? "Editar rascunho/arquivo" : "Novo conteúdo"}</h4>
          {activeChannels.length === 0 ? (
            <div className={styles.empty}>Crie um canal ativo antes de publicar conteúdo.</div>
          ) : (
            <div className={styles.formRow}>
              <label htmlFor="creator-content-channel">Canal</label>
              <select id="creator-content-channel" className={styles.select} value={composer.channelId} onChange={(event) => setComposer((current) => ({ ...current, channelId: event.target.value }))}>
                {activeChannels.map((channel) => <option value={channel.id} key={channel.id}>@{channel.handle} · {channel.name}</option>)}
              </select>
              <label htmlFor="creator-content-type">Formato</label>
              <select id="creator-content-type" className={styles.select} value={composer.contentType} onChange={(event) => setComposer((current) => ({ ...current, contentType: event.target.value as ContentType }))}>
                {(["post", "video", "audio", "live", "magazine", "course", "gallery", "event"] as ContentType[]).map((type) => <option value={type} key={type}>{type}</option>)}
              </select>
              <label htmlFor="creator-content-title">Título</label>
              <input id="creator-content-title" className={styles.input} value={composer.title} maxLength={180} onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))} />
              <label htmlFor="creator-content-body">Conteúdo / descrição</label>
              <textarea id="creator-content-body" className={styles.textarea} value={composer.body} maxLength={100000} onChange={(event) => setComposer((current) => ({ ...current, body: event.target.value }))} />
              <label htmlFor="creator-content-media">URI de mídia opcional</label>
              <input id="creator-content-media" className={styles.input} value={composer.mediaUri} maxLength={2000} placeholder="https://..." onChange={(event) => setComposer((current) => ({ ...current, mediaUri: event.target.value }))} />
              <label htmlFor="creator-content-access">Acesso</label>
              <select id="creator-content-access" className={styles.select} value={composer.accessModel} onChange={(event) => setComposer((current) => ({ ...current, accessModel: event.target.value as AccessModel, priceMinor: event.target.value === "free" ? "0" : current.priceMinor }))}>
                <option value="free">Gratuito</option>
                <option value="purchase">Compra</option>
                <option value="subscription">Assinatura</option>
                <option value="ticket">Ingresso</option>
              </select>
              {composer.accessModel !== "free" ? (
                <>
                  <label htmlFor="creator-content-price">Preço em unidades mínimas</label>
                  <input id="creator-content-price" className={styles.input} type="number" min="1" step="1" value={composer.priceMinor} onChange={(event) => setComposer((current) => ({ ...current, priceMinor: event.target.value }))} />
                </>
              ) : null}
              <div className={styles.actions}>
                {editingId ? (
                  <>
                    <button className={styles.button} type="button" disabled={busy || !composerReady} onClick={() => void saveEdit()}>Salvar alterações</button>
                    <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={cancelEdit}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <button className={styles.buttonQuiet} type="button" disabled={busy || !composerReady} onClick={() => void saveNewContent(false)}>Salvar rascunho</button>
                    <button className={styles.button} type="button" disabled={busy || !composerReady} onClick={() => void saveNewContent(true)}>Publicar agora</button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="editorial-list-title">
        <div className={styles.sectionHeader}>
          <div>
            <h4 id="editorial-list-title">Minha produção</h4>
            <p>Publicações ativas, rascunhos, arquivos e decisões de moderação.</p>
          </div>
          <span className={styles.pill}>{content.length} itens</span>
        </div>
        {content.length === 0 ? <div className={styles.empty}>Nenhum conteúdo criado ainda.</div> : (
          <div className={styles.activityList}>
            {content.map((item) => (
              <article className={styles.activity} key={item.id}>
                <div>
                  <h4>{item.title}</h4>
                  <p>@{item.channel_handle} · {item.content_type} · {statusLabel(item.status)} · atualizado em {dateTime(item.updated_at)}</p>
                  {item.access_model !== "free" ? <p>{item.access_model} · {Number(item.price_minor)} unidades mínimas</p> : <p>Gratuito</p>}
                </div>
                <div className={styles.inlineActions}>
                  {(item.status === "draft" || item.status === "archived") ? (
                    <>
                      <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => beginEdit(item)}>Editar</button>
                      <button className={styles.button} type="button" disabled={busy} onClick={() => void transition(item, "publish")}>Publicar</button>
                    </>
                  ) : null}
                  {item.status === "published" ? <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void transition(item, "archive")}>Arquivar para editar</button> : null}
                  {item.status === "rejected" ? <span className={styles.pill}>Use Segurança para acompanhar/apelar</span> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

// Tehkné Solutions

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth-provider";
import { SocialSafetyAction, SocialSafetyPanel } from "./social-safety";
import styles from "./social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Tab = "discover" | "activity" | "messages" | "creator" | "safety";
type Category = "social" | "messages" | "economy" | "safety";

type ActivitySummary = {
  unreadTotal: number;
  byCategory: Record<Category, number>;
};

type ActivityItem = {
  id: string;
  type: string;
  category: Category;
  title: string;
  actor: { userId: string; displayName: string | null } | null;
  entity: { type: string; id: string | null };
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

type DiscoverItem = {
  id: string;
  channel_id: string;
  creator_user_id: string;
  content_type: string;
  title: string;
  body: string;
  access_model: string;
  price_minor: number | string;
  published_at: string | null;
  handle: string;
  display_name: string;
  views_7d: number | string;
  likes: number | string;
  purchases_30d: number | string;
  followers: number | string;
};

type CommentItem = {
  id: string;
  contentId: string;
  author: { userId: string; displayName: string; ownedByRequester: boolean };
  body: string;
  createdAt: string;
  updatedAt: string;
};

type DmThread = {
  id: string;
  status: "pending" | "active" | "declined" | "closed";
  requestedByRequester: boolean;
  otherUser: { userId: string; displayName: string };
  unreadCount: number;
  lastReadAt: string | null;
  latestMessage: {
    id: string;
    senderUserId: string;
    kind: string;
    body: string | null;
    removedReason: string | null;
    createdAt: string;
  } | null;
  updatedAt: string;
};

type DmMessage = {
  id: string;
  sender: { userId: string; displayName: string };
  kind: string;
  body: string | null;
  removedReason: "sender_deleted" | "moderation" | null;
  createdAt: string;
  updatedAt: string;
};

type CreatorDashboard = {
  windowDays: number;
  audience: { channels: number; followers: number };
  content: { published: number; views: number; likes: number; purchases: number };
  revenue: {
    contentMinor: number;
    ugcPrimaryMinor: number;
    ugcRoyaltiesMinor: number;
    advertisingMinor: number;
    totalMinor: number;
  };
};

type ApiError = { message?: string; error?: string };

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
      const body = await response.json() as ApiError;
      detail = body.message ?? body.error ?? detail;
    } catch {
      // Mantém o status HTTP quando a resposta não for JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function count(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function minor(value: number): string {
  return `${new Intl.NumberFormat("pt-BR").format(value)} unidades mínimas`;
}

function categoryLabel(category: Category): string {
  return ({ social: "Social", messages: "Mensagens", economy: "Economia", safety: "Segurança" })[category];
}

function threadStatus(thread: DmThread): string {
  if (thread.status === "active") return "Conversa ativa";
  if (thread.status === "pending") return thread.requestedByRequester ? "Pedido enviado" : "Pedido recebido";
  if (thread.status === "declined") return "Pedido recusado";
  return "Conversa encerrada";
}

export default function CreatorSocialHubPage() {
  const { identity } = useAuth();
  const [tab, setTab] = useState<Tab>("discover");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ActivitySummary>({
    unreadTotal: 0,
    byCategory: { social: 0, messages: 0, economy: 0, safety: 0 }
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [discover, setDiscover] = useState<DiscoverItem[]>([]);
  const [dashboard, setDashboard] = useState<CreatorDashboard | null>(null);
  const [threads, setThreads] = useState<DmThread[]>([]);

  const [selectedContent, setSelectedContent] = useState<DiscoverItem | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentDraft, setCommentDraft] = useState("");

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [dmDraft, setDmDraft] = useState("");

  const [requestTarget, setRequestTarget] = useState<DiscoverItem | null>(null);
  const [requestText, setRequestText] = useState("");

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const refreshThreads = useCallback(async () => {
    const result = await api<{ threads: DmThread[] }>("/v1/creator/dm/threads?limit=40");
    setThreads(result.threads);
  }, []);

  const loadHub = useCallback(async () => {
    setError(null);
    try {
      const [summaryResult, activityResult, discoverResult, dashboardResult, threadResult] = await Promise.all([
        api<ActivitySummary>("/v1/creator/activity/summary"),
        api<{ items: ActivityItem[] }>("/v1/creator/activity?limit=40"),
        api<{ items: DiscoverItem[] }>("/v1/creator/discover?limit=24"),
        api<CreatorDashboard>("/v1/creator/dashboard/me?days=30"),
        api<{ threads: DmThread[] }>("/v1/creator/dm/threads?limit=40")
      ]);
      setSummary(summaryResult);
      setActivities(activityResult.items);
      setDiscover(discoverResult.items);
      setDashboard(dashboardResult);
      setThreads(threadResult.threads);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o hub social.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "A operação não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshActivity() {
    const [summaryResult, activityResult] = await Promise.all([
      api<ActivitySummary>("/v1/creator/activity/summary"),
      api<{ items: ActivityItem[] }>("/v1/creator/activity?limit=40")
    ]);
    setSummary(summaryResult);
    setActivities(activityResult.items);
  }

  async function refreshComments(contentId: string) {
    const result = await api<{ comments: CommentItem[] }>(`/v1/creator/content/${contentId}/comments?limit=40`);
    setComments(result.comments);
  }

  async function markActivityRead(item: ActivityItem) {
    if (item.readAt) return;
    await run(async () => {
      await api(`/v1/creator/activity/${item.id}/read`, { method: "POST" });
      await refreshActivity();
    });
  }

  async function markAllRead(category?: Category) {
    await run(async () => {
      await api("/v1/creator/activity/read-all", {
        method: "POST",
        body: JSON.stringify(category ? { category } : {})
      });
      await refreshActivity();
    }, category ? `${categoryLabel(category)} marcada como lida.` : "Atividades marcadas como lidas.");
  }

  async function openContent(item: DiscoverItem) {
    setSelectedContent(item);
    setComments([]);
    setRequestTarget(null);
    await run(async () => {
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `view-${Date.now()}-${Math.random()}`;
      await Promise.all([
        api(`/v1/creator/content/${item.id}/view`, {
          method: "POST",
          headers: { "idempotency-key": key }
        }),
        refreshComments(item.id)
      ]);
    });
  }

  async function likeContent(item: DiscoverItem) {
    await run(async () => {
      await api(`/v1/creator/content/${item.id}/like`, { method: "POST" });
      setDiscover((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, likes: count(candidate.likes) + 1 }
        : candidate));
    }, "Curtida registrada.");
  }

  async function followCreator(item: DiscoverItem) {
    await run(async () => {
      await api(`/v1/creator/channels/${item.channel_id}/follow`, { method: "POST" });
      setDiscover((current) => current.map((candidate) => candidate.channel_id === item.channel_id
        ? { ...candidate, followers: count(candidate.followers) + 1 }
        : candidate));
    }, `Agora você segue @${item.handle}.`);
  }

  async function submitComment() {
    if (!selectedContent || !commentDraft.trim()) return;
    const body = commentDraft.trim();
    await run(async () => {
      await api(`/v1/creator/content/${selectedContent.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      setCommentDraft("");
      await refreshComments(selectedContent.id);
    }, "Comentário publicado.");
  }

  async function sendDmRequest() {
    if (!requestTarget || !requestText.trim()) return;
    const message = requestText.trim();
    await run(async () => {
      await api("/v1/creator/dm/requests", {
        method: "POST",
        body: JSON.stringify({ userId: requestTarget.creator_user_id, message })
      });
      setRequestText("");
      setRequestTarget(null);
      await refreshThreads();
      setTab("messages");
    }, "Pedido de conversa enviado.");
  }

  async function openThread(thread: DmThread) {
    setSelectedThreadId(thread.id);
    await run(async () => {
      const result = await api<{ messages: DmMessage[] }>(`/v1/creator/dm/threads/${thread.id}/messages?limit=100`);
      setMessages([...result.messages].reverse());
      await api(`/v1/creator/dm/threads/${thread.id}/read`, { method: "POST" });
      await refreshThreads();
    });
  }

  async function mutateThread(action: "accept" | "decline" | "close") {
    if (!selectedThread) return;
    await run(async () => {
      await api(`/v1/creator/dm/threads/${selectedThread.id}/${action}`, { method: "POST" });
      await refreshThreads();
    }, action === "accept" ? "Conversa aceita." : action === "decline" ? "Pedido recusado." : "Conversa encerrada.");
  }

  async function sendMessage() {
    if (!selectedThread || !dmDraft.trim()) return;
    const body = dmDraft.trim();
    await run(async () => {
      await api(`/v1/creator/dm/threads/${selectedThread.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      setDmDraft("");
      const result = await api<{ messages: DmMessage[] }>(`/v1/creator/dm/threads/${selectedThread.id}/messages?limit=100`);
      setMessages([...result.messages].reverse());
      await refreshThreads();
    });
  }

  async function afterContentBlock() {
    setSelectedContent(null);
    setRequestTarget(null);
    setComments([]);
    await loadHub();
  }

  async function afterCommentBlock(contentId: string) {
    await refreshComments(contentId);
  }

  async function afterMessageBlock() {
    setSelectedThreadId(null);
    setMessages([]);
    setDmDraft("");
    await refreshThreads();
  }

  if (loading) {
    return <main className={styles.shell}><div className={styles.frame}><p className={styles.notice}>Carregando comunidade...</p></div></main>;
  }

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Nova Aurora · Comunidade viva</p>
            <h1>Hub Social</h1>
            <p className={styles.headerLead}>
              Descubra criadores, acompanhe sua atividade, converse com consentimento e visualize o pulso econômico da sua produção.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.link} href="/community">Comunicados</Link>
            <Link className={styles.link} href="/dashboard">Painel principal</Link>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Resumo de atividades não lidas">
          {(["social", "messages", "economy", "safety"] as Category[]).map((category) => (
            <button
              className={styles.metric}
              key={category}
              type="button"
              onClick={() => { setTab(category === "safety" ? "safety" : "activity"); }}
              aria-label={`${categoryLabel(category)}: ${summary.byCategory[category]} não lidas`}
            >
              <span>{categoryLabel(category)}</span>
              <strong>{summary.byCategory[category]}</strong>
            </button>
          ))}
        </section>

        <nav className={styles.tabRow} aria-label="Áreas do hub social">
          <button className={`${styles.tab} ${tab === "discover" ? styles.tabActive : ""}`} type="button" onClick={() => setTab("discover")}>Descobrir</button>
          <button className={`${styles.tab} ${tab === "activity" ? styles.tabActive : ""}`} type="button" onClick={() => setTab("activity")}>Atividade {summary.unreadTotal > 0 ? `(${summary.unreadTotal})` : ""}</button>
          <button className={`${styles.tab} ${tab === "messages" ? styles.tabActive : ""}`} type="button" onClick={() => setTab("messages")}>Mensagens</button>
          <button className={`${styles.tab} ${tab === "creator" ? styles.tabActive : ""}`} type="button" onClick={() => setTab("creator")}>Meu impacto</button>
          <button className={`${styles.tab} ${tab === "safety" ? styles.tabActive : ""}`} type="button" onClick={() => setTab("safety")}>Segurança</button>
        </nav>

        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {tab === "discover" ? (
          <section aria-labelledby="discover-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="discover-title">Descobrir a cidade criativa</h2>
                <p>Conteúdo ordenado por atividade, interesse, compras, audiência e frescor.</p>
              </div>
              <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void loadHub()}>Atualizar</button>
            </div>

            {discover.length === 0 ? <div className={styles.empty}>Ainda não há conteúdo publicado no discovery.</div> : (
              <div className={styles.grid}>
                {discover.map((item) => {
                  const own = identity?.id === item.creator_user_id;
                  return (
                    <article className={styles.card} key={item.id}>
                      <div className={styles.cardTop}>
                        <span className={styles.creator}>@{item.handle} · {item.display_name}</span>
                        <span className={styles.pill}>{item.content_type}</span>
                      </div>
                      <h3>{item.title}</h3>
                      <p className={styles.cardBody}>{item.body || "Conteúdo sem descrição textual."}</p>
                      <div className={styles.cardMeta}>
                        <span className={styles.pill}>{count(item.views_7d)} views/7d</span>
                        <span className={styles.pill}>{count(item.likes)} curtidas</span>
                        <span className={styles.pill}>{count(item.followers)} seguidores</span>
                        {item.access_model !== "free" ? <span className={styles.pill}>{count(item.price_minor)} unidades mínimas</span> : null}
                      </div>
                      <div className={styles.cardActions}>
                        <button className={styles.button} type="button" disabled={busy} onClick={() => void openContent(item)}>Abrir</button>
                        <button className={styles.buttonQuiet} type="button" disabled={busy || own} onClick={() => void likeContent(item)}>Curtir</button>
                        <button className={styles.buttonQuiet} type="button" disabled={busy || own} onClick={() => void followCreator(item)}>Seguir</button>
                        <button className={styles.buttonQuiet} type="button" disabled={busy || own} onClick={() => { setRequestTarget(item); setSelectedContent(null); }}>Mensagem</button>
                        {!own ? (
                          <SocialSafetyAction
                            disabled={busy}
                            target={{
                              resourceType: "creator_content",
                              resourceId: item.id,
                              userId: item.creator_user_id,
                              label: item.title
                            }}
                            onChanged={afterContentBlock}
                          />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {requestTarget ? (
              <section className={styles.detail} aria-labelledby="dm-request-title">
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 id="dm-request-title">Conversar com @{requestTarget.handle}</h2>
                    <p>O primeiro contato é um pedido. A conversa só é aberta se a outra pessoa aceitar.</p>
                  </div>
                  <button className={styles.buttonQuiet} type="button" onClick={() => setRequestTarget(null)}>Fechar</button>
                </div>
                <div className={styles.formRow}>
                  <label htmlFor="dm-request">Mensagem do pedido</label>
                  <textarea id="dm-request" className={styles.textarea} maxLength={1000} value={requestText} onChange={(event) => setRequestText(event.target.value)} />
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} type="button" disabled={busy || !requestText.trim()} onClick={() => void sendDmRequest()}>Enviar pedido</button>
                </div>
              </section>
            ) : null}

            {selectedContent ? (
              <section className={styles.detail} aria-labelledby="content-detail-title">
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.eyebrow}>@{selectedContent.handle}</p>
                    <h2 id="content-detail-title">{selectedContent.title}</h2>
                  </div>
                  <button className={styles.buttonQuiet} type="button" onClick={() => setSelectedContent(null)}>Fechar</button>
                </div>
                <p className={styles.detailBody}>{selectedContent.body || "Conteúdo sem texto."}</p>
                <div className={styles.formRow}>
                  <label htmlFor="comment-draft">Comentar</label>
                  <textarea id="comment-draft" className={styles.textarea} maxLength={2000} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} type="button" disabled={busy || !commentDraft.trim()} onClick={() => void submitComment()}>Publicar comentário</button>
                </div>
                <div className={styles.comments} aria-label="Comentários">
                  {comments.length === 0 ? <p className={styles.notice}>Ainda não há comentários visíveis.</p> : comments.map((comment) => (
                    <article className={styles.comment} key={comment.id}>
                      <strong>{comment.author.displayName}</strong>
                      <time dateTime={comment.createdAt}>{dateTime(comment.createdAt)}</time>
                      <p>{comment.body}</p>
                      {!comment.author.ownedByRequester ? (
                        <SocialSafetyAction
                          target={{
                            resourceType: "creator_comment",
                            resourceId: comment.id,
                            userId: comment.author.userId,
                            label: `Comentário de ${comment.author.displayName}`
                          }}
                          onChanged={() => afterCommentBlock(comment.contentId)}
                        />
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {tab === "activity" ? (
          <section aria-labelledby="activity-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="activity-title">Activity Inbox</h2>
                <p>Eventos sociais, mensagens, economia e segurança em uma fonte durável.</p>
              </div>
              <button className={styles.buttonQuiet} type="button" disabled={busy || summary.unreadTotal === 0} onClick={() => void markAllRead()}>Marcar tudo como lido</button>
            </div>
            <div className={styles.inlineActions}>
              {(["social", "messages", "economy", "safety"] as Category[]).map((category) => (
                <button className={styles.buttonQuiet} key={category} type="button" disabled={busy || summary.byCategory[category] === 0} onClick={() => void markAllRead(category)}>
                  {categoryLabel(category)} · {summary.byCategory[category]}
                </button>
              ))}
            </div>
            <div className={styles.activityList}>
              {activities.length === 0 ? <div className={styles.empty}>Nenhuma atividade registrada ainda.</div> : activities.map((item) => (
                <article className={`${styles.activity} ${item.readAt ? "" : styles.activityUnread}`} key={item.id}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{categoryLabel(item.category)} · {item.actor?.displayName ?? "Sistema"} · {dateTime(item.createdAt)}</p>
                  </div>
                  {!item.readAt ? <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void markActivityRead(item)}>Marcar lida</button> : <span className={styles.pill}>Lida</span>}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "messages" ? (
          <section aria-labelledby="messages-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="messages-title">Mensagens privadas</h2>
                <p>Conversas 1:1 textuais, abertas somente após aceite explícito.</p>
              </div>
            </div>
            <div className={styles.messagesLayout}>
              <div className={styles.threadList}>
                {threads.length === 0 ? <div className={styles.empty}>Nenhuma conversa ainda. Inicie pelo discovery.</div> : threads.map((thread) => (
                  <button className={`${styles.thread} ${selectedThreadId === thread.id ? styles.threadSelected : ""}`} key={thread.id} type="button" onClick={() => void openThread(thread)}>
                    <div className={styles.threadTop}>
                      <strong>{thread.otherUser.displayName}</strong>
                      {thread.unreadCount > 0 ? <span className={styles.unreadPill}>{thread.unreadCount}</span> : null}
                    </div>
                    <p>{threadStatus(thread)}</p>
                    <p>{thread.latestMessage?.body ?? (thread.latestMessage?.removedReason ? "Mensagem removida" : "Sem mensagem")}</p>
                  </button>
                ))}
              </div>

              <div className={`${styles.panel} ${styles.messagePanel}`}>
                {!selectedThread ? <div className={styles.empty}>Selecione uma conversa para abrir o histórico.</div> : (
                  <>
                    <div className={styles.sectionHeader}>
                      <div>
                        <h3>{selectedThread.otherUser.displayName}</h3>
                        <p>{threadStatus(selectedThread)}</p>
                      </div>
                      <div className={styles.inlineActions}>
                        {selectedThread.status === "pending" && !selectedThread.requestedByRequester ? (
                          <>
                            <button className={styles.button} type="button" disabled={busy} onClick={() => void mutateThread("accept")}>Aceitar</button>
                            <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void mutateThread("decline")}>Recusar</button>
                          </>
                        ) : null}
                        {selectedThread.status !== "closed" ? <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void mutateThread("close")}>Encerrar</button> : null}
                      </div>
                    </div>
                    <div className={styles.messageList} aria-label="Histórico de mensagens">
                      {messages.map((message) => {
                        const own = identity?.id === message.sender.userId;
                        return (
                          <article className={`${styles.message} ${own ? styles.messageOwn : ""}`} key={message.id}>
                            <div className={styles.messageMeta}>
                              <span>{message.sender.displayName}</span>
                              <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>
                            </div>
                            <div>{message.body ?? (message.removedReason === "moderation" ? "Mensagem removida pela moderação." : "Mensagem removida pelo remetente.")}</div>
                            {!own && message.removedReason !== "moderation" ? (
                              <SocialSafetyAction
                                target={{
                                  resourceType: "creator_message",
                                  resourceId: message.id,
                                  userId: message.sender.userId,
                                  label: `Mensagem de ${message.sender.displayName}`
                                }}
                                onChanged={afterMessageBlock}
                              />
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                    {selectedThread.status === "active" ? (
                      <div className={styles.formRow}>
                        <label htmlFor="dm-draft">Nova mensagem</label>
                        <textarea id="dm-draft" className={styles.textarea} maxLength={2000} value={dmDraft} onChange={(event) => setDmDraft(event.target.value)} />
                        <div className={styles.actions}>
                          <button className={styles.button} type="button" disabled={busy || !dmDraft.trim()} onClick={() => void sendMessage()}>Enviar</button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "creator" ? (
          <section aria-labelledby="creator-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="creator-title">Meu impacto em 30 dias</h2>
                <p>Audiência, consumo e receitas internas da Creator Economy.</p>
              </div>
            </div>
            {!dashboard ? <div className={styles.empty}>Painel do criador indisponível.</div> : (
              <div className={styles.creatorGrid}>
                <section className={styles.panel} aria-labelledby="audience-title">
                  <h3 id="audience-title">Audiência e conteúdo</h3>
                  <div className={styles.revenueList}>
                    <div className={styles.revenueRow}><span>Canais</span><strong>{dashboard.audience.channels}</strong></div>
                    <div className={styles.revenueRow}><span>Seguidores</span><strong>{dashboard.audience.followers}</strong></div>
                    <div className={styles.revenueRow}><span>Conteúdos publicados</span><strong>{dashboard.content.published}</strong></div>
                    <div className={styles.revenueRow}><span>Visualizações</span><strong>{dashboard.content.views}</strong></div>
                    <div className={styles.revenueRow}><span>Curtidas</span><strong>{dashboard.content.likes}</strong></div>
                    <div className={styles.revenueRow}><span>Compras</span><strong>{dashboard.content.purchases}</strong></div>
                  </div>
                </section>
                <section className={styles.panel} aria-labelledby="revenue-title">
                  <h3 id="revenue-title">Receitas internas</h3>
                  <div className={styles.revenueList}>
                    <div className={styles.revenueRow}><span>Conteúdo</span><strong>{minor(dashboard.revenue.contentMinor)}</strong></div>
                    <div className={styles.revenueRow}><span>UGC primário</span><strong>{minor(dashboard.revenue.ugcPrimaryMinor)}</strong></div>
                    <div className={styles.revenueRow}><span>Royalties UGC</span><strong>{minor(dashboard.revenue.ugcRoyaltiesMinor)}</strong></div>
                    <div className={styles.revenueRow}><span>Publicidade</span><strong>{minor(dashboard.revenue.advertisingMinor)}</strong></div>
                    <div className={styles.revenueRow}><span>Total</span><strong>{minor(dashboard.revenue.totalMinor)}</strong></div>
                  </div>
                  <p className={styles.notice}>Valores exibidos em unidades mínimas do ledger interno; esta tela não converte nem representa dinheiro externo.</p>
                </section>
              </div>
            )}
          </section>
        ) : null}

        {tab === "safety" ? <SocialSafetyPanel /> : null}

        <footer className={styles.footer}>Tehkné Solutions</footer>
      </div>
    </main>
  );
}

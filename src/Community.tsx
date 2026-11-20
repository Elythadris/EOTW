import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Flag, Hash, Link2, MessageCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import "./community.css";

type Room = { id: string; name: string; description: string };
type Message = {
  id: string; text: string; source: string; author: string; at: string;
  own: boolean; canRemove: boolean; reported: boolean; flags: number;
};
type Discussion = {
  topic: string; topics: Room[];
  account: { enabled: boolean; unavailable: boolean; alias: string | null };
  messages: Message[];
};
type Draft = { text: string; source: string; nonce: string };
type Action = ({ action: "post" } & Draft) | { action: "report" | "remove" | "dismiss"; id: string };
const blank = (): Draft => ({ text: "", source: "", nonce: crypto.randomUUID() });
const activeTopic = () => new URLSearchParams(window.location.search).get("topic") || "maui";
const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function fetchRoom(topic: string, signal: AbortSignal, action?: Action) {
  const response = await fetch("/api/community?" + new URLSearchParams({ topic }), {
    method: action ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal,
    ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "Discussion could not be reached.");
    throw Object.assign(error, { status: response.status });
  }
  if (data.topic !== topic || !Array.isArray(data.topics) || !Array.isArray(data.messages) || !data.account)
    throw Error("Discussion could not be read.");
  return data as Discussion;
}

function Thread({ topic, onRooms, drafts }: {
  topic: string; onRooms: (rooms: Room[]) => void; drafts: Map<string, Draft>;
}) {
  const [room, setRoom] = useState<Discussion | null>(null);
  const [draft, setDraft] = useState<Draft>(() => drafts.get(topic) ?? blank());
  const [reading, setReading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState("");
  const pendingWrite = useRef(false);
  const readVersion = useRef(0);
  const alive = useRef(false);
  const reader = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (pendingWrite.current) return;
    const revision = ++readVersion.current;
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setReading(true);
    try {
      const next = await fetchRoom(topic, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      if (!alive.current || revision !== readVersion.current) return;
      setRoom(next); onRooms(next.topics); setLoadError("");
    } catch {
      if (alive.current && revision === readVersion.current) setLoadError("Messages could not be refreshed. Try again.");
    } finally {
      if (alive.current && revision === readVersion.current) setReading(false);
    }
  }, [topic, onRooms]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(onVisible, 30_000);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false; readVersion.current++; reader.current?.abort();
      clearInterval(timer); window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  function edit(key: "text" | "source", value: string) {
    const next = { ...draft, [key]: value, nonce: crypto.randomUUID() };
    drafts.set(topic, next); setDraft(next); setNotice("");
  }

  async function change(action: Action) {
    if (pendingWrite.current) return;
    pendingWrite.current = true; readVersion.current++; reader.current?.abort();
    setReading(false); setBusy(true); setNotice("");
    try {
      const next = await fetchRoom(topic, AbortSignal.timeout(15_000), action);
      if (action.action === "post" && drafts.get(topic)?.nonce === action.nonce) drafts.delete(topic);
      if (!alive.current) return;
      setRoom(next); setLoadError(""); setConfirmRemove("");
      if (action.action === "post") setDraft(blank());
      setNotice({ post: "Message posted.", report: "Message flagged for review.", remove: "Message removed.", dismiss: "Reports reviewed." }[action.action]);
    } catch (error) {
      if (!alive.current) return;
      setNotice(error instanceof Error && "status" in error ? error.message : "The change could not be confirmed. Refresh or try again.");
      if (error instanceof Error && "status" in error && error.status === 401) setRoom(previous => previous && ({
        ...previous, account: { ...previous.account, alias: null },
      }));
    } finally {
      pendingWrite.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const selected = room?.topics.find(item => item.id === topic);
  const account = room?.account;
  const post = (event: FormEvent) => {
    event.preventDefault();
    if (draft.text.trim().length >= 2) void change({ action: "post", ...draft });
  };
  return <section className="panel community-thread" aria-label="Topic discussion">
    <header className="community-header">
      <div><h2><Hash size={19} aria-hidden="true" />{selected?.name || "Discussion"}</h2>
        {selected && <p>{selected.description}</p>}</div>
      <button className="secondary community-refresh" onClick={() => void refresh()} disabled={busy || reading} aria-label="Refresh discussion">
        <RefreshCw size={16} aria-hidden="true" /><span>Refresh</span>
      </button>
    </header>
    {loadError && <p role="alert" className="community-warning">{loadError}</p>}
    {!room && reading && <p role="status" className="community-empty">Loading discussion…</p>}
    {room && <>
      {account?.alias ? <form className="community-compose" onSubmit={post}>
        <label htmlFor="community-message">Post as {account.alias}</label>
        <textarea id="community-message" value={draft.text} onChange={event => edit("text", event.target.value)}
          placeholder="What did you observe, or what does the source say?" minLength={2} maxLength={800} rows={3} required disabled={busy} />
        <div className="community-compose-bottom">
          <label className="community-source" htmlFor="community-source"><span><Link2 size={14} />Source link (optional)</span>
            <input id="community-source" type="url" inputMode="url" placeholder="https://" maxLength={600}
              value={draft.source} disabled={busy} onChange={event => edit("source", event.target.value)} /></label>
          <button type="submit" className="primary" disabled={busy || draft.text.trim().length < 2}><Send size={15} />Post message</button>
        </div>
      </form> : <div className="community-signin"><MessageCircle size={18} aria-hidden="true" />
        {account?.enabled && !account.unavailable
          ? <p><a href="/watchlist#account">Sign in to post</a> under a public reader alias.</p>
          : <p>Messages are open for reading. Account posting is currently unavailable.</p>}
      </div>}
      <p className="community-notice" role="status">{notice}</p>
      {room.messages.length ? <ol className="community-messages" aria-label="Messages, newest first">
        {room.messages.map(message => <li key={message.id}>
          <div className="community-byline"><strong>{message.author}{message.own && " (you)"}</strong>
            <time dateTime={message.at}>{date.format(new Date(message.at))}</time></div>
          <p className="community-body">{message.text}</p>
          {message.source && <a className="community-citation" href={message.source} target="_blank" rel="ugc nofollow noopener noreferrer">
            <Link2 size={14}/>{new URL(message.source).hostname}<ArrowUpRight size={13}/></a>}
          {account?.alias && <div className="community-actions">
            {message.flags > 0 && <><span><Flag size={13}/>{message.flags} flagged for review</span>
              <button className="link-button" disabled={busy} onClick={() => void change({ action: "dismiss", id: message.id })}>Dismiss reports</button></>}
            {!message.own && <button className="link-button" disabled={busy || message.reported} onClick={() => void change({ action: "report", id: message.id })}>
              {message.reported ? "Reported" : "Report message"}</button>}
            {message.canRemove && (confirmRemove === message.id ? <>
              <span>Remove this public message?</span>
              <button className="link-button" disabled={busy} onClick={() => void change({ action: "remove", id: message.id })}>Confirm removal</button>
              <button className="link-button" disabled={busy} onClick={() => setConfirmRemove("")}>Cancel</button>
            </> : <button className="link-button" disabled={busy} onClick={() => setConfirmRemove(message.id)}>Remove</button>)}
          </div>}
        </li>)}
      </ol> : <p className="community-empty">No messages in this topic yet.</p>}
    </>}
  </section>;
}

export default function Community() {
  const [topic, setTopic] = useState(activeTopic);
  const [rooms, setRooms] = useState<Room[]>([]);
  const drafts = useRef(new Map<string, Draft>());
  useEffect(() => {
    const update = () => setTopic(activeTopic());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function select(id: string) {
    if (id === topic) return;
    const url = new URL(window.location.href);
    url.searchParams.set("topic", id);
    window.history.pushState({}, "", url); setTopic(id);
  }
  return <div className="community-layout">
    <aside>
      <nav className="panel community-topics" aria-label="Discussion topics">
        <h2>Topics</h2>
        {rooms.length ? rooms.map(item => <a key={item.id} href={"?topic=" + item.id} aria-current={item.id === topic ? "page" : undefined}
          onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
            event.preventDefault(); select(item.id);
          }}><Hash size={15} aria-hidden="true"/>{item.name}</a>)
          : <a href="?topic=maui" onClick={event => { event.preventDefault(); select("maui"); }}><Hash size={15}/>Maui &amp; Hawaiʻi</a>}
      </nav>
      <details className="panel community-rules" open>
        <summary><ShieldCheck size={17} aria-hidden="true"/>Discussion rules</summary>
        <p>Share public sources. Label firsthand observations, questions, and speculation. Keep personal details private. Harassment, threats, and spam can be reported.</p>
        <p>Reader posts are public. Each topic shows up to 50 messages from the past 30 days.</p>
      </details>
    </aside>
    <Thread key={topic} topic={topic} onRooms={setRooms} drafts={drafts.current}/>
  </div>;
}

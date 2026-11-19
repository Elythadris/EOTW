import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CornerDownLeft,
  Radio,
  Send,
  Sparkles,
} from "lucide-react";
import { Modal } from "./components";
import { type PrefsState } from "./data";
import {
  messageText,
  sourceURL,
  type Citation,
  type IntelEvent,
  type Message,
} from "./types";

function AnswerText({
  body,
  citations,
}: {
  body: string;
  citations: Citation[];
}) {
  return (
    <>
      {body.split(/(\[\d+\])/g).map((part, i) => {
        const id = /^\[(\d+)\]$/.exec(part)?.[1];
        const cite = id
          ? citations.find((c) => String(c.id) === id)
          : undefined;
        return cite && sourceURL(cite.url) ? (
          <a
            className="inline-cite"
            key={i}
            href={sourceURL(cite.url)}
            target="_blank"
            rel="noreferrer"
            title={cite.title}
          >
            {part}
          </a>
        ) : (
          part
        );
      })}
    </>
  );
}
function packAnswer(body: string, citations: Citation[], mode: string) {
  const compact = citations.slice(0, 10);
  let answer = body;
  while (
    JSON.stringify({ body: answer, citations: compact, mode }).length > 3000
  ) {
    if (compact.length > 1) compact.pop();
    else if (answer.length > 100)
      answer =
        answer.slice(0, Math.max(75, answer.length - 180)).trimEnd() + "…";
    else {
      compact.pop();
      break;
    }
  }
  return JSON.stringify({ body: answer, citations: compact, mode });
}
export default function Assistant({
  open,
  onClose,
  state,
  story,
  page,
  category,
  scope,
  query,
}: {
  open: boolean;
  onClose: () => void;
  state: PrefsState;
  story?: IntelEvent;
  page: string;
  category: string;
  scope: string;
  query: string;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<{
    stored: string;
    full: ReturnType<typeof messageText>;
  } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const history = state.prefs.history;
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [open, busy, history.length]);
  const send = async (raw: string) => {
    const input = raw.trim();
    if (!input || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setQuestion("");
    const previous = history
      .slice(-6)
      .map((m) => ({ ...m, text: messageText(m).body.slice(0, 3000) }));
    state.change((p) => ({
      ...p,
      history: [...p.history, { role: "user", text: input }].slice(
        -24,
      ) as Message[],
    }));
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          question: input,
          location: state.prefs.location,
          storyId: story?.id,
          filters: { view: page, scope, ...(category ? { category } : {}), ...(query ? { q: query } : {}) },
          history: previous,
        }),
      });
      if (!response.ok) {
        if (response.status === 429)
          throw Error("The request limit has been reached. Try again later.");
        throw Error(
          "The assistant is unavailable. Your question is here to retry.",
        );
      }
      const answer = await response.json();
      if (
        typeof answer.answer !== "string" ||
        !answer.answer.trim() ||
        !Array.isArray(answer.citations)
      )
        throw Error("The assistant returned an unreadable answer.");
      const citations: Citation[] = answer.citations
        .filter(
          (c: Citation) => c && typeof c.title === "string" && sourceURL(c.url),
        )
        .map((c: Citation) => ({ ...c, id: String(c.id) }));
      const mode = answer.mode === "ai" ? "ai" : "sources";
      const stored = packAnswer(answer.answer, citations, mode);
      setLatest({ stored, full: { body: answer.answer, citations, mode } });
      state.change((p) => ({
        ...p,
        history: [...p.history, { role: "assistant", text: stored }].slice(
          -24,
        ) as Message[],
      }));
    } catch (err) {
      setError(
        err instanceof Error && err.name !== "TimeoutError"
          ? err.message
          : "The request timed out. Try again.",
      );
      setQuestion(input);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  };
  if (!open) return null;
  const start = story
    ? "What evidence supports this report?"
    : query
      ? "What does the archive report about " + query + "?"
      : page === "signals" ? "What changed in the priority signals near " + state.prefs.location + "?" : "What are the latest reports near " + state.prefs.location + "?";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };
  return (
    <Modal title="Ask EOTW" onClose={onClose} className="assistant">
      <div className="assistant-context">
        <Radio size={14} />
        {story
          ? "Analyst · Selected story"
          : query
            ? "Analyst · Investigating " + query
            : (page === "map" ? "Analyst · Map" + (category ? " · " + category : "") : "Intelligence analyst") + " · " + state.prefs.location}
      </div>
      <div className="chat-log" role="log" aria-label="Conversation">
        {!history.length && (
          <div className="chat-start">
            <span className="chat-emblem">
              <BookOpen size={26} />
            </span>
            <h3>Ask the intelligence analyst</h3>
            <p>
              Investigate priority signals, compare source accounts, or trace a claim through the archive. Answers link back to the available evidence.
            </p>
            <button className="prompt" onClick={() => void send(start)}>
              {start}
              <CornerDownLeft size={16} />
            </button>
            {page === "signals" && <button className="prompt" onClick={()=>void send("What should I monitor next?")}>What should I monitor next?<CornerDownLeft size={16}/></button>}
          </div>
        )}
        {history.map((m, i) => {
          const { body, citations, mode } =
            m.role === "assistant" && m.text === latest?.stored
              ? latest.full
              : messageText(m);
          return (
            <div className={"message " + m.role} key={i}>
              <strong>
                {m.role === "user"
                  ? "You"
                  : mode === "sources"
                    ? "Source results"
                    : "Ask EOTW"}
              </strong>
              <p>
                <AnswerText body={body} citations={citations} />
              </p>
              {!!citations.length && (
                <ul className="citations">
                  {citations.map((c, i) => (
                    <li key={i}>
                      <a
                        href={sourceURL(c.url)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <b>[{c.id}]</b>
                        {c.title}
                        <ArrowUpRight size={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="chat-busy" role="status">
            <Sparkles size={15} />
            Searching the source archive…
          </div>
        )}
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="ask-question">
          Your question
        </label>
        <textarea
          id="ask-question"
          name="question"
          rows={2}
          maxLength={800}
          value={question}
          placeholder="Ask about the evidence…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send(question);
            }
          }}
        />
        <button
          className="primary"
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="Send question"
        >
          <Send size={17} />
        </button>
      </form>
    </Modal>
  );
}

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Globe2,
  MapPin,
  Radio,
  Search,
  X,
} from "lucide-react";
import {
  dateTime,
  relative,
  sourceURL,
  type IntelEvent,
  type Scope,
} from "./types";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const before = document.activeElement as HTMLElement | null;
    node?.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = prev;
      before?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={"modal " + (wide ? "wide " : "") + className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="icon-button"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Status({ value }: { value: IntelEvent["status"] }) {
  return (
    <span className={"status " + value}>
      <i aria-hidden="true" />
      {value === "speculation" ? "Unverified claim" : value}
    </span>
  );
}
export function SaveButton({
  saved,
  toggle,
}: {
  saved: boolean;
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"icon-button save " + (saved ? "active" : "")}
      aria-label={saved ? "Remove saved story" : "Save story"}
      aria-pressed={saved}
      onClick={toggle}
    >
      {saved ? (
        <Bookmark size={17} fill="currentColor" />
      ) : (
        <Bookmark size={17} />
      )}
    </button>
  );
}
export function StoryRow({
  e,
  open,
  saved,
  save,
  index,
}: {
  e: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
  index?: number;
}) {
  return (
    <article className="story-row">
      {index != null && (
        <span className="rank">{String(index + 1).padStart(2, "0")}</span>
      )}
      <div className="story-copy">
        <div className="story-meta">
          <span className="category">{e.category}</span>
          <span className="dot-separator">·</span>
          <time dateTime={e.publishedAt} title={dateTime(e.publishedAt)}>
            {relative(e.publishedAt)}
          </time>
        </div>
        <h3>
          <a
            href={"/story/" + encodeURIComponent(e.id)}
            onClick={(ev) => {
              if (!ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
                ev.preventDefault();
                open(e);
              }
            }}
          >
            {e.title}
          </a>
        </h3>
        {e.summary && e.summary !== e.title && (
          <p className="summary clamp">{e.summary}</p>
        )}
        <div className="byline">
          <span>{e.source}</span>
          {e.location && (
            <span>
              <MapPin size={12} />
              {e.location}
            </span>
          )}
          <Status value={e.status} />
        </div>
      </div>
      <SaveButton saved={saved} toggle={save} />
    </article>
  );
}
export function NoItems({
  title,
  detail,
  icon = "radio",
}: {
  title: string;
  detail?: string;
  icon?: "radio" | "search" | "saved" | "globe";
}) {
  const Icon = { radio: Radio, search: Search, saved: Bookmark, globe: Globe2 }[
    icon
  ];
  return (
    <div className="empty">
      <Icon size={24} strokeWidth={1.45} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeletons" role="status" aria-label="Loading reports">
      {[0, 1, 2].map((x) => (
        <div className="skeleton" key={x}>
          <i />
          <b />
          <span />
        </div>
      ))}
    </div>
  );
}
export function PanelHeading({
  icon,
  children,
  action,
  actionLabel,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="panel-heading">
      <h2>
        {icon}
        {children}
      </h2>
      {action && (
        <button className="link-button" onClick={action}>
          {actionLabel}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
export function FilterBar({
  scope,
  set,
  conspiracy = false,
}: {
  scope: string;
  set: (s: Scope | "conspiracy") => void;
  conspiracy?: boolean;
}) {
  const choices: [Scope | "conspiracy", string][] = [
    ["all", "All"],
    ["local", "Local"],
    ["us", "U.S."],
    ["global", "Global"],
  ];
  if (conspiracy) choices.push(["conspiracy", "Conspiracy"]);
  return (
    <div className="filter-bar" role="group" aria-label="Filter by coverage">
      {choices.map(([id, label]) => (
        <button
          key={id}
          className={scope === id ? "selected" : ""}
          aria-pressed={scope === id}
          onClick={() => set(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function SearchBox({
  defaultValue = "",
  submit,
  label,
  placeholder = "Search events, people, or topics",
  button = "Search",
}: {
  defaultValue?: string;
  submit: (q: string) => void;
  label: string;
  placeholder?: string;
  button?: string;
}) {
  const onSubmit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    submit(String(new FormData(ev.currentTarget).get("q") || "").trim());
  };
  return (
    <form
      className="search-box"
      role="search"
      aria-label={label}
      onSubmit={onSubmit}
    >
      <Search size={19} />
      <input
        name="q"
        key={defaultValue}
        aria-label={label}
        placeholder={placeholder}
        defaultValue={defaultValue}
        maxLength={180}
      />
      <button className="primary" type="submit">
        {button}
      </button>
    </form>
  );
}
export function ArticleDetail({
  e,
  saved,
  save,
  ask,
  investigate,
}: {
  e: IntelEvent;
  saved: boolean;
  save: () => void;
  ask: () => void;
  investigate: (q: string) => void;
}) {
  const sources = [
    ...new Map(
      [{ name: e.source, url: e.url }, ...e.sources]
        .filter((s) => sourceURL(s.url))
        .map((s) => [s.url, s]),
    ).values(),
  ];
  return (
    <article className="detail-page">
      <div className="story-meta">
        <span className="category">{e.category}</span>
        <Status value={e.status} />
      </div>
      <h1>{e.title}</h1>
      <div className="detail-meta">
        <span>
          <MapPin size={15} />
          {e.location || "Location unspecified"}
        </span>
        <time dateTime={e.publishedAt}>
          <Clock3 size={15} />
          {dateTime(e.publishedAt)}
        </time>
      </div>
      <div className="detail-actions">
        <button className="primary" onClick={ask}>
          <Activity size={16} />
          Ask about this story
        </button>
        <button className="secondary" onClick={save}>
          {saved ? <Check size={16} /> : <Bookmark size={16} />}{" "}
          {saved ? "Saved to watchlist" : "Save story"}
        </button>
      </div>
      <div className="detail-grid">
        <div>
          {e.intelligence && <section className="panel section-pad signal-dossier">
            <h2>Signal assessment <span className={"level level-"+e.intelligence.level}>{e.intelligence.level}</span></h2>
            <dl><dt>Why it matters</dt><dd>{e.intelligence.why}</dd><dt>Monitor next</dt><dd>{e.intelligence.monitor}</dd></dl>
            <details className="baseline"><summary>Priority score · {e.intelligence.score}</summary>
              <ul>{e.intelligence.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul>
              {e.intelligence.axes && <div className="axes">{Object.entries(e.intelligence.axes).filter(([,v])=>typeof v==="number").map(([label,v])=><span key={label}>{label} <b>{v}</b></span>)}</div>}
            </details>
          </section>}
          <section className="panel section-pad">
            <h2>Report summary</h2>
            <p>
              {e.summary ||
                "The publisher provides the full report at the source link."}
            </p>
            {e.status === "speculation" && (
              <p className="claim-note">
                This source documents a claim. Its inclusion does not establish
                that the underlying allegation is true.
              </p>
            )}
          </section>
          <section className="panel section-pad">
            <h2>Timeline</h2>
            <ol className="timeline">
              {(e.timeline.length
                ? e.timeline
                : [
                    {
                      at: e.publishedAt,
                      text: "First published by " + e.source,
                    },
                  ]
              ).map((t, i) => (
                <li key={t.at + i}>
                  <time dateTime={t.at}>{dateTime(t.at)}</time>
                  <p>{t.text}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div>
          <section className="panel section-pad">
            <h2>Sources &amp; evidence</h2>
            {e.editorialType === "correction" && e.supersedes && sourceURL(e.supersedes.url) && (
              <a className="source-link" href={sourceURL(e.supersedes.url)} target="_blank" rel="noreferrer">
                <span>
                  <small>Report being corrected</small>
                  {e.supersedes.name}
                </span>
                <ArrowUpRight size={16} />
              </a>
            )}
            {sources.length ? (
              sources.map((s, i) => (
                <a
                  key={s.url}
                  className="source-link"
                  href={sourceURL(s.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    <small>Source {i + 1}</small>
                    {s.name || new URL(s.url).hostname}
                  </span>
                  <ArrowUpRight size={16} />
                </a>
              ))
            ) : (
              <p>Source link unavailable.</p>
            )}
          </section>
          {[["Supporting evidence", e.evidence], ["Counterevidence", e.counterevidence]].map(([title, records]) =>
            Array.isArray(records) && records.length ? <section className="panel section-pad" key={String(title)}>
              <h2>{String(title)}</h2>{records.filter(r=>sourceURL(r.url)).map((r,i)=><div className="documented-finding" key={i}>
                <p>{r.finding}</p><a className="brief-source" href={sourceURL(r.url)} target="_blank" rel="noreferrer">{r.name}<ArrowUpRight size={13}/></a>
              </div>)}
            </section> : null)}
          <section className="panel section-pad">
            <h2>Reporting context</h2>
            <p>Latest recorded update</p>
            <time dateTime={e.updatedAt}>{dateTime(e.updatedAt)}</time>
            {e.severityReason && (
              <p className="detail-fact">
                <strong>Severity</strong> {e.severityReason}
              </p>
            )}
            {e.expiresAt && (
              <p className="detail-fact">
                <strong>Expires</strong> {dateTime(e.expiresAt)}
              </p>
            )}
            {e.mapNote && (
              <p className="detail-fact">
                <strong>Map location</strong> {e.mapNote}
              </p>
            )}
            {!!e.rankReasons.length && (
              <ul>
                {e.rankReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <button
              className="link-button"
              onClick={() => investigate(e.title)}
            >
              Search the archive
              <ChevronRight size={16} />
            </button>
          </section>
        </div>
      </div>
    </article>
  );
}

import { useState } from "react";
import { BookOpen, Layers, ListTree, Network, Search } from "lucide-react";
import { NoItems, PanelHeading, SearchBox, StoryRow } from "./components";
import { dateTime, sourceURL, type IntelEvent } from "./types";

export default function Research({
  query,
  events,
  busy,
  submit,
  open,
  saved,
  save,
  ask,
}: {
  query: string;
  events: IntelEvent[];
  busy: boolean;
  submit: (q: string) => void;
  open: (e: IntelEvent) => void;
  saved: string[];
  save: (e: IntelEvent) => void;
  ask: () => void;
}) {
  const [tab, setTab] = useState<
    "reports" | "timeline" | "evidence" | "connections"
  >("reports");
  const sources = new Map<
    string,
    { name: string; url: string; events: IntelEvent[] }
  >();
  for (const e of events)
    for (const s of [{ name: e.source, url: e.url }, ...e.sources]) {
      if (!sourceURL(s.url)) continue;
      const item = sources.get(s.url) || { ...s, events: [] };
      if (!item.events.some((row) => row.id === e.id)) item.events.push(e);
      sources.set(s.url, item);
    }
  const shared = [...sources.values()].filter((s) => s.events.length > 1);
  const ordered = [...events].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );
  return (
    <>
      <SearchBox
        label="Investigation subject"
        defaultValue={query}
        submit={submit}
        button="Investigate"
      />
      {!query ? (
        <section className="panel research-start">
          <Search size={28} />
          <h2>Start with a question or a name.</h2>
          <p>
            Search published reports for a person, place, or claim. Compare
            source material and trace the order of events.
          </p>
        </section>
      ) : (
        <section className="panel research-panel">
          <PanelHeading icon={<BookOpen size={18} />}>
            Investigation results
          </PanelHeading>
          <div className="research-head">
            <h2>{query}</h2>
            <p>
              {busy && !events.length
                ? "Searching the archive…"
                : events.length +
                  " matching " +
                  (events.length === 1 ? "report" : "reports") +
                  " loaded · " +
                  sources.size +
                  " source " +
                  (sources.size === 1 ? "link" : "links")}
            </p>
            <button onClick={ask} className="secondary">
              Ask about the evidence
            </button>
          </div>
          <div
            className="research-tabs"
            role="group"
            aria-label="Investigation view"
          >
            {(
              [
                ["reports", BookOpen, "Reports"],
                ["timeline", ListTree, "Timeline"],
                ["evidence", Layers, "Evidence"],
                ["connections", Network, "Connections"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          {!events.length ? (
            <NoItems
              icon="search"
              title={busy ? "Searching source records" : "No matches found"}
              detail={
                busy
                  ? undefined
                  : "Try a shorter phrase, alternate spelling, or a broader topic."
              }
            />
          ) : tab === "reports" ? (
            events.map((e) => (
              <StoryRow
                key={e.id}
                e={e}
                open={open}
                saved={saved.includes(e.id)}
                save={() => save(e)}
              />
            ))
          ) : tab === "timeline" ? (
            <ol className="timeline section-pad">
              {ordered.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.publishedAt}>
                    {dateTime(e.publishedAt)}
                  </time>
                  <button className="text-headline" onClick={() => open(e)}>
                    {e.title}
                  </button>
                  <small>{e.source}</small>
                </li>
              ))}
            </ol>
          ) : tab === "evidence" ? (
            <div className="section-pad evidence-list">
              <p>
                Compare each publisher’s coverage and the verification status
                attached to its report.
              </p>
              {[...sources.values()].map((s) => (
                <div key={s.url}>
                  <a href={sourceURL(s.url)} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                  {s.events.map((e) => (
                    <p key={e.id}>
                      <b>
                        {e.status === "speculation"
                          ? "Unverified claim"
                          : e.status}
                      </b>{" "}
                      · {e.title}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : shared.length ? (
            <div className="section-pad evidence-list">
              <p>These reports cite the same source document.</p>
              {shared.map((s) => (
                <div key={s.url}>
                  <a target="_blank" rel="noreferrer" href={sourceURL(s.url)}>
                    {s.name}
                  </a>
                  {s.events.map((e) => (
                    <button
                      key={e.id}
                      className="text-headline"
                      onClick={() => open(e)}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <NoItems
              icon="search"
              title="No shared source documents"
              detail="Connections appear when multiple matching reports cite the same source URL."
            />
          )}
        </section>
      )}
    </>
  );
}

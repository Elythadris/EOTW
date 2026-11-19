import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Compass,
  MapPin,
  Radar,
  Radio,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import EventMap from "./EventMap";
import { NoItems, PanelHeading, Skeleton, StoryRow } from "./components";
import { useFeed, type PrefsState } from "./data";
import {
  activePriority,
  dateTime,
  relative,
  type Feed,
  type IntelEvent,
  type Page,
} from "./types";

type Props = {
  data: Feed;
  busy: boolean;
  state: PrefsState;
  open: (e: IntelEvent) => void;
  save: (e: IntelEvent) => void;
  go: (page: Page) => void;
  setLocation: () => void;
};
export default function Briefing({
  data,
  busy,
  state,
  open,
  save,
  go,
  setLocation,
}: Props) {
  const { prefs } = state;
  const trending = useFeed({
    view: "trending",
    scope: "all",
    location: prefs.location,
  });
  const local = data.events.filter((e) => e.scope === "local");
  const urgent = data.events.filter(activePriority);
  const groups = [
    { id: "local", label: "Local reports" },
    { id: "us", label: "United States" },
    { id: "global", label: "Around the world" },
  ];
  const coverage = data.health.filter((s) => s.status === "ok").length;
  return (
    <>
      {urgent.length > 0 && (
        <section className="alert-strip" aria-label="Priority alert">
          <AlertTriangle size={18} />
          <b>Priority report</b>
          <button onClick={() => open(urgent[0])}>
            {urgent[0].title}
            <ArrowUpRight size={15} />
          </button>
        </section>
      )}
      <div className="home-hero">
        <section className="panel map-panel">
          <PanelHeading
            icon={<Radar size={19} />}
            action={() => go("map")}
            actionLabel="Open map"
          >
            Situation map
          </PanelHeading>
          <EventMap events={data.events} onSelect={open} compact />
          <div className="map-caption">
            <span>
              <i className="map-dot" />
              Hazards use source coordinates. News markers show broad reporting
              areas.
            </span>
          </div>
        </section>
        <section className="panel local-panel">
          <div className="local-head">
            <span className="section-kicker">
              <MapPin size={15} />
              Local briefing
            </span>
            <button onClick={setLocation} className="small-link">
              Change
            </button>
          </div>
          <h2>{prefs.location}</h2>
          {local.length > 0 ? (
            <div className="local-items">
              {local.slice(0, 2).map((e) => (
                <article key={e.id}>
                  <div className="story-meta">
                    <span className="category">{e.category}</span>
                    <time
                      dateTime={e.publishedAt}
                      title={dateTime(e.publishedAt)}
                    >
                      {relative(e.publishedAt)}
                    </time>
                  </div>
                  <h3>
                    <a
                      href={"/story/" + encodeURIComponent(e.id)}
                      onClick={(ev) => {
                        if (
                          !ev.ctrlKey &&
                          !ev.metaKey &&
                          !ev.shiftKey &&
                          !ev.altKey
                        ) {
                          ev.preventDefault();
                          open(e);
                        }
                      }}
                    >
                      {e.title}
                    </a>
                  </h3>
                  <span>{e.source}</span>
                </article>
              ))}
            </div>
          ) : busy ? (
            <Skeleton />
          ) : (
            <div className="local-empty">
              <Compass size={26} />
              <p>No current reports matched this location.</p>
              <small>New matches appear as sources update.</small>
            </div>
          )}
          <div className="local-foot">
            <Radio size={13} />
            Local coverage is prioritized
          </div>
        </section>
      </div>
      <div className="home-columns">
        <section className="panel latest-panel">
          <PanelHeading
            icon={<Radio size={18} />}
            action={() => go("archive")}
            actionLabel="Archive"
          >
            Latest reporting
          </PanelHeading>
          {data.events.length ? (
            groups.map((g) => {
              const rows = data.events
                .filter((e) => e.scope === g.id)
                .slice(0, 4);
              return rows.length ? (
                <div key={g.id}>
                  <div className="region-heading">
                    <i />
                    {g.label}
                  </div>
                  {rows.map((e) => (
                    <StoryRow
                      key={e.id}
                      e={e}
                      open={open}
                      saved={prefs.saved.includes(e.id)}
                      save={() => save(e)}
                    />
                  ))}
                </div>
              ) : null;
            })
          ) : busy ? (
            <Skeleton />
          ) : (
            <NoItems
              title="Awaiting published reports"
              detail="The briefing will update when a source delivers its first records."
            />
          )}
        </section>
        <aside>
          <section className="panel">
            <PanelHeading
              icon={<TrendingUp size={18} />}
              action={() => go("trending")}
              actionLabel="View all"
            >
              Trending 24h
            </PanelHeading>
            {trending.data.events.length ? (
              trending.data.events.slice(0, 4).map((e, i) => (
                <button
                  className="trending-item"
                  key={e.id}
                  onClick={() => open(e)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>
                    {e.title}
                    <small>{e.source}</small>
                  </strong>
                </button>
              ))
            ) : trending.busy ? (
              <Skeleton />
            ) : (
              <NoItems
                title={
                  trending.error
                    ? "Ranking unavailable"
                    : "No ranked reports yet"
                }
                detail="Rankings use reports published in the past day."
              />
            )}
          </section>
          <section className="panel signals">
            <PanelHeading icon={<Activity size={18} />}>
              Briefing indicators
            </PanelHeading>
            <div>
              <span>
                <AlertTriangle size={15} />
                High severity
              </span>
              <b>{data.updatedAt ? urgent.length : "—"}</b>
            </div>
            <div>
              <span>
                <ShieldCheck size={15} />
                Sources reporting normally
              </span>
              <b>
                {data.health.length
                  ? coverage +
                    " / " +
                    data.health.filter((s) => s.status !== "disabled").length
                  : "—"}
              </b>
            </div>
            <p>
              Counts cover active high-severity reports in this briefing. Each
              story shows the reason for its severity.
            </p>
            <button className="link-button" onClick={() => go("health")}>
              Source health
              <ArrowUpRight size={15} />
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}

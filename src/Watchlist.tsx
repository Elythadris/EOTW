import { useEffect, useState, type FormEvent } from "react";
import { Bell, Bookmark, Check, MapPin, Plus, Radio, X } from "lucide-react";
import Account from "./Account";
import { NoItems, Skeleton, StoryRow } from "./components";
import { useFeed, type PrefsState } from "./data";
import type { IntelEvent } from "./types";

export function LocationForm({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [place, setPlace] = useState(value);
  return (
    <form
      className="control-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (place.trim()) onSave(place.trim());
      }}
    >
      <label htmlFor="location-input">City, island, or region</label>
      <div className="inline-input">
        <MapPin size={17} />
        <input
          id="location-input"
          name="location"
          maxLength={100}
          autoComplete="address-level2"
          value={place}
          onChange={(ev) => setPlace(ev.target.value)}
          required
        />
        <button className="secondary" disabled={!place.trim()} type="submit">
          Set location
        </button>
      </div>
    </form>
  );
}
function SavedRecord({
  id,
  location,
  open,
  remove,
}: {
  id: string;
  location: string;
  open: (e: IntelEvent) => void;
  remove: () => void;
}) {
  const feed = useFeed({ view: "archive", id, location });
  const e = feed.data.events[0];
  if (e) return <StoryRow e={e} open={open} saved save={remove} />;
  if (feed.busy) return <Skeleton />;
  return (
    <div className="missing-record">
      <p>
        {feed.error
          ? "Saved report could not be loaded."
          : "This saved report is unavailable."}
      </p>
      {feed.error && (
        <button className="link-button" onClick={feed.retry}>
          Retry
        </button>
      )}
      <button className="link-button" onClick={remove}>
        Remove
      </button>
    </div>
  );
}
function TopicStream({
  topic,
  state,
  open,
}: {
  topic: string;
  state: PrefsState;
  open: (e: IntelEvent) => void;
}) {
  const feed = useFeed({
    view: "archive",
    q: topic,
    scope: "all",
    location: state.prefs.location,
  });
  if (!feed.data.events.length && feed.busy) return <Skeleton />;
  if (!feed.data.events.length)
    return (
      <NoItems
        icon="search"
        title={
          feed.error ? "Topic feed unavailable" : "No matching reports yet"
        }
        detail={
          feed.error || "New records matching this topic will appear here."
        }
      />
    );
  return (
    <>
      {feed.data.events.map((e) => (
        <StoryRow
          key={e.id}
          e={e}
          open={open}
          saved={state.prefs.saved.includes(e.id)}
          save={() =>
            state.change((p) => ({
              ...p,
              saved: p.saved.includes(e.id)
                ? p.saved.filter((id) => id !== e.id)
                : [e.id, ...p.saved].slice(0, 200),
            }))
          }
        />
      ))}
      {feed.data.nextCursor && (
        <button
          className="load-more"
          disabled={feed.more}
          onClick={feed.loadMore}
        >
          Load more reports
        </button>
      )}
    </>
  );
}
export default function Watchlist({
  state,
  open,
  notify,
}: {
  state: PrefsState;
  open: (e: IntelEvent) => void;
  notify: (s: string) => void;
}) {
  const { prefs, change, sync } = state;
  const [input, setInput] = useState("");
  useEffect(() => {
    if (window.location.hash === "#account") document.getElementById("account")?.scrollIntoView();
  }, []);
  const [topic, setTopic] = useState("");
  const [limit, setLimit] = useState(8);
  const activeTopic = prefs.topics.includes(topic) ? topic : "";
  const add = (ev: FormEvent) => {
    ev.preventDefault();
    const t = input.trim();
    if (!t) return;
    const existing = prefs.topics.find(
      (x) => x.toLowerCase() === t.toLowerCase(),
    );
    if (!existing && prefs.topics.length >= 32) {
      notify("Your watchlist already has 32 topics.");
      return;
    }
    if (!existing) change((p) => ({ ...p, topics: [...p.topics, t] }));
    setTopic(existing || t);
    setInput("");
  };
  const toggleAlerts = async () => {
    if (prefs.notifications) {
      change((p) => ({ ...p, notifications: false }));
      return;
    }
    if ("Notification" in window) {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted")
          notify("Alerts will appear within EOTW while it is open.");
      } catch {
        notify("Alerts will appear within EOTW while it is open.");
      }
    }
    change((p) => ({ ...p, notifications: true }));
  };
  return (
    <div className="watch-grid">
      <div>
        <section className="panel section-pad">
          <h2>
            <Radio size={19} />
            Followed topics
          </h2>
          <form className="control-form" onSubmit={add}>
            <label htmlFor="follow-topic">Add a topic to track</label>
            <div className="inline-input">
              <input
                id="follow-topic"
                name="topic"
                placeholder="e.g. wildfire, UAP, Maui"
                maxLength={80}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                className="secondary"
                disabled={!input.trim()}
              >
                <Plus size={15} />
                Follow
              </button>
            </div>
          </form>
          {!!prefs.topics.length && (
            <div className="topic-chips">
              {prefs.topics.map((t) => (
                <span key={t}>
                  <button
                    className={activeTopic === t ? "on" : ""}
                    onClick={() => setTopic(activeTopic === t ? "" : t)}
                    aria-pressed={activeTopic === t}
                  >
                    {t}
                  </button>
                  <button
                    aria-label={"Unfollow " + t}
                    onClick={() =>
                      change((p) => ({
                        ...p,
                        topics: p.topics.filter((x) => x !== t),
                      }))
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>
        {activeTopic && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Reports on {activeTopic}</h2>
            </div>
            <TopicStream topic={activeTopic} state={state} open={open} />
          </section>
        )}
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Bookmark size={18} />
              Saved stories
            </h2>
            <span className="count">{prefs.saved.length}</span>
          </div>
          {prefs.saved.length ? (
            prefs.saved.slice(0, limit).map((id) => (
              <SavedRecord
                key={id}
                id={id}
                location={prefs.location}
                open={open}
                remove={() =>
                  change((p) => ({
                    ...p,
                    saved: p.saved.filter((x) => x !== id),
                  }))
                }
              />
            ))
          ) : (
            <NoItems
              icon="saved"
              title="No saved stories yet"
              detail="Use the bookmark on any report to keep its sources and timeline here."
            />
          )}
          {prefs.saved.length > limit && (
            <button
              className="load-more"
              onClick={() => setLimit((n) => n + 8)}
            >
              Show more saved stories
            </button>
          )}
        </section>
      </div>
      <aside>
        <section className="panel section-pad">
          <h2>
            <MapPin size={18} />
            Your location
          </h2>
          <LocationForm
            key={prefs.location}
            value={prefs.location}
            onSave={(value) => {
              change((p) => ({ ...p, location: value }));
              notify("Location updated.");
            }}
          />
        </section>
        <section className="panel section-pad">
          <h2>
            <Bell size={18} />
            Significant alerts
          </h2>
          <p>
            Notify me about new elevated or high-priority signals and material
            escalations affecting my location, saved stories, or followed topics
            while EOTW is open.
          </p>
          <button
            className={"secondary " + (prefs.notifications ? "switch-on" : "")}
            aria-pressed={prefs.notifications}
            onClick={() => void toggleAlerts()}
          >
            {prefs.notifications ? <Check size={16} /> : <Bell size={16} />}
            Alerts {prefs.notifications ? "on" : "off"}
          </button>
        </section>
        <section id="account" className="panel section-pad">
          <h2>Account &amp; storage</h2>
          <p className="sync-state" role="status">
            {sync === "saved"
              ? "Preferences synced"
              : sync === "syncing"
                ? "Saving preferences…"
                : sync === "loading"
                  ? "Loading preferences…"
                  : sync === "pending"
                    ? "Sync unavailable. Changes stay in this tab."
                    : "Saved on this device"}
          </p>
          <Account />
        </section>
      </aside>
    </div>
  );
}

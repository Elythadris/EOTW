import { digest, RequestError } from "../assistant/http.mjs";

export const topics = [
  { id: "maui", name: "Maui & Hawaiʻi", description: "Local notices, island infrastructure, and community observations." },
  { id: "emergencies", name: "Weather & emergencies", description: "Compare public warnings, conditions, and recovery updates." },
  { id: "world", name: "U.S. & world", description: "Compare reporting on political, economic, and international developments." },
  { id: "infrastructure", name: "Infrastructure & technology", description: "Discuss public service disruptions, technology, and their effects." },
  { id: "evidence", name: "Evidence & open questions", description: "Trace a claim to its source and identify what remains unverified." },
];
const HOUR = 3_600_000;
export const perTopic = 50;
const retention = 30 * 24 * HOUR;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageId = /^[a-f0-9]{32}$/;
const email = /\b[^\s@/]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const phone = /(?:^|[^\d])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/;
const internationalPhone = /(?:^|[^\d])\+[1-9](?:[\s().-]*\d){7,14}(?!\d)/;
const contact = value => email.test(value) || phone.test(value) || internationalPhone.test(value);
const secretField = /token|password|signature|secret|credential|authorization|^(?:auth|key|sig|code|session|api[_-]?key|access[_-]?key)$/i;
const hidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;

export function topicById(id) {
  const topic = topics.find(item => item.id === id);
  if (!topic) throw new RequestError(404, "Choose an available discussion topic.");
  return topic;
}

export function member(user, scope) {
  if (!user?.id || typeof user.id !== "string") return null;
  const key = digest("community/v1/" + scope + "/" + user.id);
  const moderator = Array.isArray(user.roles) && user.roles.some(role => role === "admin" || role === "community-moderator");
  return { key, alias: "Reader " + key.slice(0, 10).toUpperCase(), moderator };
}

function sourceLink(raw) {
  if (raw === undefined || raw === "") return "";
  if (typeof raw !== "string" || raw.length > 600 || hidden.test(raw))
    throw new RequestError(400, "Use one public HTTPS source link.");
  try {
    const url = new URL(raw);
    const readable = decodeURIComponent(url.href);
    const privateHost = /(^|\.)localhost$|\.(?:local|internal|test|invalid)$|^[\d.]+$|[:\[\]]/i;
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") ||
        privateHost.test(url.hostname) || contact(readable) ||
        [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some(key => secretField.test(key))) throw Error();
    return url.href;
  } catch {
    throw new RequestError(400, "Use a public HTTPS source link without credentials or private tokens.");
  }
}

export function readAction(input) {
  if (input.action === "post") {
    if (typeof input.nonce !== "string" || !uuid.test(input.nonce)) throw new RequestError(400, "A valid message reference is required.");
    if (typeof input.text !== "string" || hidden.test(input.text))
      throw new RequestError(400, "Use plain text for your message.");
    const text = input.text.trim().normalize("NFC");
    if (text.length < 2 || text.length > 800 || text.split(/\r?\n/).length > 12 || /(.)\1{12}/u.test(text))
      throw new RequestError(400, "Use 2–800 characters and avoid repeated characters or lines.");
    if (contact(text)) throw new RequestError(400, "Remove personal contact details before posting.");
    if (/(?:https?:\/\/|www\.)/i.test(text)) throw new RequestError(400, "Put your source URL in the source link field.");
    const source = sourceLink(input.source);
    return { action: "post", text, source, nonce: input.nonce.toLowerCase() };
  }
  if (!["remove", "report", "dismiss"].includes(input.action) || typeof input.id !== "string" || !messageId.test(input.id))
    throw new RequestError(400, "Unknown discussion action or message.");
  return { action: input.action, id: input.id };
}

export function activeBoard(saved, now) {
  if (!saved) return { version: 1, messages: [], receipts: [] };
  if (saved.version !== 1 || !Array.isArray(saved.messages) || !Array.isArray(saved.receipts))
    throw new Error("Invalid stored discussion");
  return {
    version: 1,
    messages: saved.messages.filter(message => message.at > now - retention),
    receipts: saved.receipts.filter(receipt => receipt.at > now - HOUR),
  };
}

export function view(board, topic, actor, enabled, unavailable = false) {
  return {
    topics, topic: topic.id,
    account: { enabled, unavailable, alias: actor?.alias || null },
    messages: board.messages.filter(message => message.topic === topic.id).map(message => ({
      id: message.id, text: message.text, source: message.source, author: message.alias,
      at: new Date(message.at).toISOString(), own: Boolean(actor && actor.key === message.owner),
      canRemove: Boolean(actor && (actor.key === message.owner || actor.moderator)),
      reported: Boolean(actor && message.flags.includes(actor.key)),
      flags: actor?.moderator ? message.flags.length : 0,
    })).reverse(),
  };
}

export function applyAction(board, topic, actor, action, now) {
  const receipts = board.receipts;
  if (action.action === "post") {
    const id = digest(actor.key + "/" + action.nonce).slice(0, 32);
    const signature = digest(action.text.toLowerCase().replace(/\s+/gu, " ") + "\n" + action.source);
    const existing = board.messages.find(message => message.id === id);
    if (existing) {
      if (existing.topic !== topic.id || existing.text !== action.text || existing.source !== action.source)
        throw new RequestError(409, "This message reference was already used.");
      return false;
    }
    if (receipts.some(r => r.id === id)) throw new RequestError(409, "This message was previously received.");
    const posts = receipts.filter(r => r.who === actor.key && r.type === "post");
    if (posts.some(r => r.signature === signature)) throw new RequestError(409, "You already posted that message recently.");
    if (posts.length >= 12 || posts.some(r => r.at > now - 30_000))
      throw new RequestError(429, "Allow 30 seconds between posts and up to 12 posts per hour.");
    if (receipts.length >= 480) throw new RequestError(429, "Discussion is busy. Please try again later.");
    const recent = board.messages.filter(message => message.topic === topic.id);
    if (recent.length >= perTopic) board.messages = board.messages.filter(message => message.id !== recent[0].id);
    board.messages.push({ id, topic: topic.id, text: action.text, source: action.source, owner: actor.key,
      alias: actor.alias, at: now, flags: [] });
    receipts.push({ id, type: "post", who: actor.key, signature, at: now });
    return true;
  }

  const message = board.messages.find(item => item.topic === topic.id && item.id === action.id);
  if (!message) throw new RequestError(404, "This message is no longer available.");
  if (action.action === "remove") {
    if (!actor.moderator && message.owner !== actor.key) throw new RequestError(403, "Only the author or a moderator can remove this message.");
    board.messages = board.messages.filter(item => item.id !== message.id);
    return true;
  }
  if (action.action === "dismiss") {
    if (!actor.moderator) throw new RequestError(403, "Only a moderator can review reports.");
    if (!message.flags.length) return false;
    board.messages = board.messages.map(item => item.id === message.id ? { ...item, flags: [] } : item);
    return true;
  }
  if (message.owner === actor.key) throw new RequestError(400, "You can remove your own message.");
  if (message.flags.includes(actor.key)) return false;
  if (message.flags.length >= 10) throw new RequestError(409, "This message has already been flagged for review.");
  if (receipts.length >= 480 || receipts.filter(r => r.type === "report" && r.who === actor.key).length >= 8)
    throw new RequestError(429, "The report limit has been reached. Try again later.");
  board.messages = board.messages.map(item => item.id === message.id ? { ...item, flags: [...item.flags, actor.key] } : item);
  receipts.push({ type: "report", who: actor.key, at: now });
  return true;
}

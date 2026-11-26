// West End Chiropractic Google reviews -> Webflow CMS sync.
// Mirrors thr-reviews-sync's logic (same scoring/filtering rules); only the
// BLOCK list and env-driven ids differ per client.

var BLOCK = new RegExp(
  "\\b(" + [
    // Sensitive-topic review filters, same families as the Thrive worker.
    // No former-staff names added yet for West End; add real names here if any show up.
    "colic",
    "infants?",
    "newborns?",
    "reflux",
    "\\d+[- ](?:day|week)s?[- ]old",
    "medications?",
    "meds",
    "medicines?",
    "pharmaceuticals?",
    "prescriptions?",
    "pills?",
    "opioids?",
    "pain ?killers?",
    "drugs?(?!-free)",
    "steroids?",
    "injections?",
    "anxiety",
    "depress\\w*",
    "mental",
    "panic",
    "adhd",
    "ptsd",
    "bipolar",
    "ocd",
    "autis\\w*",
    "suicid\\w*"
  ].join("|") + ")\\b",
  "i"
);

const day = (iso) => iso.slice(0, 10) + "T12:00:00.000Z";

// "Review Text" is a Rich Text field. It was converted from plain text on
// 2026-11-24; Webflow never frees a deleted field's slug, so it lives at
// "review-text-3". Blank lines become paragraphs, single newlines <br>.
const TEXT_FIELD = "review-text-3";
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toRichText = (text) =>
  text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${p.split("\n").map((l) => escapeHtml(l.trim())).join("<br>")}</p>`).join("");
// Compare rich text by its words, so Webflow's own HTML normalisation never
// reads as a change and triggers a rewrite of every review each sync.
const plainText = (html) =>
  (html ?? "").replace(/<br\s*\/?>|<\/p>\s*<p[^>]*>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const BEST_CUTOFF = 5;
const TEAM_MENTION = 3;

const RESULT = /no longer|\bgone\b|relief|pain[- ]?free|life[- ]?chang|can finally|\bfinally\b|completely resolved|dramatic|significantly|back to normal/i;
const CONDITION = /sciatic|pinched nerve|migraine|headache|scoliosis|decompress|car (?:accident|wreck)|pregnan|postpartum|whiplash|neck pain|back pain|shoulder|posture|herniat|disc/i;
const DOCTOR = /morgan|dr\.? ?casey|doctor casey|dr\.? ?m\b/i;
const TEAM = /\b(staff|team|front desk|friendly|welcoming|caring|kind)\b/i;
const EDUCATION = /x-?rays?|explain/i;
const GENERIC = /^\W*(great|amazing|awesome|best|excellent|love|good|wonderful|fantastic)\b/i;

function qualityScore(rv, team) {
  const c = rv.comment.trim(), n = c.length;
  const recent = Date.now() - Date.parse(rv.createTime) < 3 * 365 * 864e5;
  const upper = [...c].filter((ch) => ch !== ch.toLowerCase()).length / n;
  const emoji = [...c].filter((ch) => ch.codePointAt(0) > 9728).length;
  return (n >= 120 && n <= 600 ? 2 : n < 60 ? -3 : n > 800 ? -1 : 0)
    + (RESULT.test(c) ? 3 : 0)
    + (CONDITION.test(c) ? 2 : 0)
    + (DOCTOR.test(c) ? 1 : 0)
    + (TEAM.test(c) ? 1 : 0)
    + (EDUCATION.test(c) ? 1 : 0)
    + (recent ? 1 : 0)
    + (team?.test(c) ? TEAM_MENTION : 0)
    - (n < 60 && GENERIC.test(c) ? 3 : 0)
    - (upper > 0.4 || emoji >= 3 ? 2 : 0);
}

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const WF = "https://api.webflow.com/v2";

async function googleToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function googleReviews(env, token) {
  const out = [];
  let page = "";
  do {
    const url = `https://mybusiness.googleapis.com/v4/${env.GBP_LOCATION}/reviews?pageSize=50${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`gbp reviews ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...j.reviews ?? []);
    page = j.nextPageToken ? `&pageToken=${encodeURIComponent(j.nextPageToken)}` : "";
  } while (page);
  return out;
}

async function wf(env, path, init = {}) {
  const r = await fetch(WF + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.WEBFLOW_TOKEN}`, "Content-Type": "application/json" }
  });
  if (!r.ok) throw new Error(`webflow ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function existingItems(env) {
  const byId = new Map();
  for (let offset = 0; ; offset += 100) {
    const j = await wf(env, `/collections/${env.WEBFLOW_COLLECTION_ID}/items?limit=100&offset=${offset}`);
    for (const it of j.items) byId.set(it.fieldData["review-id"], it);
    if (offset + 100 >= j.pagination.total) return byId;
  }
}

const NICKNAMES = {};

async function teamPattern(env) {
  if (!env.WEBFLOW_TEAM_COLLECTION_ID) return null;
  const j = await wf(env, `/collections/${env.WEBFLOW_TEAM_COLLECTION_ID}/items?limit=100`);
  const names = j.items.filter((it) => !it.isDraft && !it.isArchived).flatMap((it) => {
    const first = it.fieldData.name.split(/\s+/)[0].toLowerCase();
    return [first, NICKNAMES[first]].filter(Boolean);
  });
  return names.length ? new RegExp(`\\b(${names.join("|")})\\b`, "i") : null;
}

function toFields(rv, team) {
  const name = rv.reviewer?.displayName || "A Google User";
  const text = rv.comment ?? "";
  const f = {
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "review"}-${rv.reviewId.slice(-6).toLowerCase()}`,
    "star-rating": STARS[rv.starRating],
    [TEXT_FIELD]: toRichText(text),
    "review-date": day(rv.createTime),
    "has-text": text.trim().length > 0,
    "owner-reply": rv.reviewReply?.comment ?? "",
    "review-id": rv.reviewId,
    source: "Google",
    "quality-score": qualityScore(rv, team)
  };
  f["best-of"] = STARS[rv.starRating] === 5 && f["quality-score"] >= BEST_CUTOFF;
  if (rv.reviewReply?.updateTime) f["owner-reply-date"] = day(rv.reviewReply.updateTime);
  if (rv.reviewer?.profilePhotoUrl) f["reviewer-photo"] = rv.reviewer.profilePhotoUrl;
  return f;
}

const changed = (item, f) =>
  plainText(item.fieldData[TEXT_FIELD]) !== plainText(f[TEXT_FIELD]) ||
  ["star-rating", "owner-reply", "review-date", "owner-reply-date", "quality-score", "best-of"]
    .some((k) => (item.fieldData[k] ?? "") !== (f[k] ?? "")) || item.isArchived;

// --- Business hours / open-closed banner --------------------------------

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

async function businessHours(env, token) {
  // Business Information API v1 wants a bare "locations/{id}" resource name,
  // unlike the v4 My Business reviews API which needs the full
  // "accounts/{id}/locations/{id}" path (env.GBP_LOCATION is that full path).
  const locationOnly = env.GBP_LOCATION.replace(/^accounts\/[^/]+\//, "");
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${locationOnly}?readMask=regularHours,specialHours`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`gbp hours ${r.status}: ${await r.text()}`);
  return r.json();
}

function fmt12h(h, m) {
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh}:00 ${period}` : `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

// Opening windows for one calendar day: a special-hours entry covering that date wins over regular hours.
function periodsOn(hours, iso, weekday) {
  const special = (hours.specialHours?.specialHourPeriods ?? []).find((p) => {
    const start = `${p.startDate.year}-${String(p.startDate.month).padStart(2, "0")}-${String(p.startDate.day).padStart(2, "0")}`;
    const end = p.endDate
      ? `${p.endDate.year}-${String(p.endDate.month).padStart(2, "0")}-${String(p.endDate.day).padStart(2, "0")}`
      : start;
    return iso >= start && iso <= end;
  });
  if (special) return special.closed ? [] : [{ openTime: special.openTime, closeTime: special.closeTime }];
  return (hours.regularHours?.periods ?? []).filter((p) => p.openDay === weekday);
}

// hours = { regularHours: { periods: [{ openDay, openTime:{hours,minutes}, closeDay, closeTime }] },
//           specialHours: { specialHourPeriods: [{ startDate, endDate?, openTime?, closeTime?, closed? }] } }
// Returns { statusText, isOpen } computed for "now" in the given IANA timezone.
// When closed, statusText names the next opening ("Closed, opens tomorrow at 9:00 AM").
function computeStatus(hours, timeZone) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long"
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const todayISO = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = parts.weekday.toUpperCase();
  const nowMin = Number(parts.hour) * 60 + Number(parts.minute);

  const todaysPeriods = periodsOn(hours, todayISO, weekday);

  if (todaysPeriods.length > 0) {
    for (const p of todaysPeriods) {
      const openMin = (p.openTime?.hours ?? 0) * 60 + (p.openTime?.minutes ?? 0);
      const closeMin = (p.closeTime?.hours ?? 0) * 60 + (p.closeTime?.minutes ?? 0);
      if (nowMin >= openMin && nowMin < closeMin) {
        return {
          statusText: `Open today until ${fmt12h(p.closeTime?.hours ?? 0, p.closeTime?.minutes ?? 0)}`,
          isOpen: true
        };
      }
    }

    // Closed right now, but a window is still ahead today.
    const next = todaysPeriods
      .map((p) => (p.openTime?.hours ?? 0) * 60 + (p.openTime?.minutes ?? 0))
      .filter((openMin) => openMin > nowMin)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) {
      return { statusText: `Closed, opens today at ${fmt12h(Math.floor(next / 60), next % 60)}`, isOpen: false };
    }
  }

  // Nothing left today: find the next day with hours (up to a week out, so special-hour closures are honoured).
  for (let offset = 1; offset <= 7; offset++) {
    const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset, 12));
    const iso = d.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d.getUTCDay()];
    const periods = periodsOn(hours, iso, dayName);
    if (periods.length === 0) continue;
    const first = periods
      .map((p) => (p.openTime?.hours ?? 0) * 60 + (p.openTime?.minutes ?? 0))
      .sort((a, b) => a - b)[0];
    const label = offset === 1 ? "tomorrow" : dayName[0] + dayName.slice(1).toLowerCase();
    return { statusText: `Closed, opens ${label} at ${fmt12h(Math.floor(first / 60), first % 60)}`, isOpen: false };
  }
  return { statusText: "Closed today", isOpen: false };
}

async function syncBusinessStatus(env, token) {
  if (!env.WEBFLOW_STATUS_COLLECTION_ID || !env.WEBFLOW_STATUS_ITEM_ID) return null;
  const hours = await businessHours(env, token);
  const { statusText, isOpen } = computeStatus(hours, env.BUSINESS_TIMEZONE || "America/Chicago");
  const result = { statusText, isOpen, dryRun: env.DRY_RUN };
  console.log(JSON.stringify({ businessStatus: result }));
  if (env.DRY_RUN !== "false") return result;

  const col = `/collections/${env.WEBFLOW_STATUS_COLLECTION_ID}/items`;
  await wf(env, col, {
    method: "PATCH",
    body: JSON.stringify({
      items: [{
        id: env.WEBFLOW_STATUS_ITEM_ID,
        fieldData: { "status-text": statusText, "is-open": isOpen, "computed-at": new Date().toISOString() }
      }]
    })
  });
  await wf(env, col + "/publish", { method: "POST", body: JSON.stringify({ itemIds: [env.WEBFLOW_STATUS_ITEM_ID] }) });
  return result;
}

// Fast path: just the open/closed banner. Runs every 5 min.
async function statusOnly(env) {
  const token = await googleToken(env);
  const businessStatus = await syncBusinessStatus(env, token);
  console.log(JSON.stringify({ businessStatus }));
  return { businessStatus };
}

// Aggregate rating/count -> "GBP Reviews" collection (single item, shown as
// "5.0 stars, 250+ Google reviews" sitewide). Reuses the reviews already
// fetched for the per-review sync, no extra API call.
async function syncAggregateStats(env, reviews) {
  if (!env.WEBFLOW_STATS_COLLECTION_ID || !env.WEBFLOW_STATS_ITEM_ID) return null;
  const rated = reviews.filter((rv) => STARS[rv.starRating]);
  const avg = rated.length
    ? Math.round((rated.reduce((s, rv) => s + STARS[rv.starRating], 0) / rated.length) * 10) / 10
    : null;
  const result = { rating: avg, "review-count": reviews.length, dryRun: env.DRY_RUN };
  console.log(JSON.stringify({ aggregateStats: result }));
  if (env.DRY_RUN !== "false") return result;

  const col = `/collections/${env.WEBFLOW_STATS_COLLECTION_ID}/items`;
  const fieldData = { rating: avg, "review-count": reviews.length };
  if (env.GBP_PLACE_ID) fieldData["place-id"] = env.GBP_PLACE_ID;
  if (env.GBP_MAPS_URL) fieldData["maps-url"] = env.GBP_MAPS_URL;
  await wf(env, col, { method: "PATCH", body: JSON.stringify({ items: [{ id: env.WEBFLOW_STATS_ITEM_ID, fieldData }] }) });
  await wf(env, col + "/publish", { method: "POST", body: JSON.stringify({ itemIds: [env.WEBFLOW_STATS_ITEM_ID] }) });
  return result;
}

// Slow path: full review sync. Runs every 12h.
async function syncReviews(env) {
  const [token, have, team] = await Promise.all([googleToken(env), existingItems(env), teamPattern(env)]);
  const reviews = await googleReviews(env, token);
  const aggregateStats = await syncAggregateStats(env, reviews).catch((e) => {
    console.error("aggregate stats sync failed: " + String(e));
    return { error: String(e) };
  });
  const create = [], update = [];
  let blocked = 0, lowScore = 0;
  for (const rv of reviews) {
    const item = have.get(rv.reviewId);
    if (BLOCK.test(rv.comment ?? "") || !rv.comment?.trim()) {
      blocked++;
      if (item && !item.isArchived) update.push({ id: item.id, isArchived: true });
      continue;
    }
    const f = toFields(rv, team);
    if (!f["best-of"] && !item?.fieldData.featured) {
      lowScore++;
      if (item && !item.isArchived) update.push({ id: item.id, isArchived: true });
      continue;
    }
    if (!item) create.push({ isArchived: false, isDraft: false, fieldData: f });
    else if (changed(item, f)) update.push({ id: item.id, isArchived: false, fieldData: f });
  }
  const summary = { fetched: reviews.length, blocked, lowScore, create: create.length, update: update.length, dryRun: env.DRY_RUN, aggregateStats };
  console.log(JSON.stringify(summary));
  if (env.DRY_RUN !== "false") return summary;

  const col = `/collections/${env.WEBFLOW_COLLECTION_ID}/items`;
  const send = async (method, path, items) => {
    const j = await wf(env, col + path, { method, body: JSON.stringify({ items }) });
    return j.items ?? [];
  };
  const ids = [...have.values()].filter((x) => !x.lastPublished && !x.isArchived).map((x) => x.id);
  for (let i = 0; i < create.length; i += 100)
    ids.push(...(await send("POST", "/insert", create.slice(i, i + 100))).map((x) => x.id));
  for (let i = 0; i < update.length; i += 100) {
    await send("PATCH", "", update.slice(i, i + 100));
    ids.push(...update.slice(i, i + 100).map((x) => x.id));
  }
  for (let i = 0; i < ids.length; i += 100)
    await wf(env, col + "/publish", { method: "POST", body: JSON.stringify({ itemIds: ids.slice(i, i + 100) }) });
  console.log(JSON.stringify({ published: ids.length }));
  return { ...summary, published: ids.length };
}

// --- Blog read time ------------------------------------------------------
// Fills the Blog Posts "read-time" field (minutes) when it is empty: words in
// Body + Key Takeaways at 200 wpm, rounded up. A value someone typed is never
// overwritten. Runs from the Webflow "collection_item_published" webhook and
// a daily sweep that catches anything the webhook missed.

const WPM = 200;
const readMinutes = (f) => {
  // Tags become spaces so list items and headings never glue words together.
  const text = `${f.body ?? ""} ${f["key-takeaways"] ?? ""}`.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const words = text.split(/\s+/).filter((w) => /\w/.test(w)).length;
  return Math.max(1, Math.ceil(words / WPM));
};
const needsReadTime = (it) =>
  !it.isArchived && !it.isDraft && !(Number(it.fieldData["read-time"]) > 0);

async function fillReadTimes(env, items) {
  const todo = items.filter(needsReadTime).map((it) => ({ id: it.id, fieldData: { "read-time": readMinutes(it.fieldData) } }));
  const result = { checked: items.length, filled: todo.map((t) => ({ id: t.id, "read-time": t.fieldData["read-time"] })), dryRun: env.DRY_RUN };
  console.log(JSON.stringify({ readTime: result }));
  if (!todo.length || env.DRY_RUN !== "false") return result;
  const col = `/collections/${env.WEBFLOW_BLOG_COLLECTION_ID}/items`;
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    await wf(env, col, { method: "PATCH", body: JSON.stringify({ items: batch }) });
    // Republish so the live post shows it. That publish fires the webhook
    // again, but read-time is set by then, so it is a no-op (no loop).
    await wf(env, col + "/publish", { method: "POST", body: JSON.stringify({ itemIds: batch.map((t) => t.id) }) });
  }
  return result;
}

// Daily sweep over every post.
async function sweepReadTimes(env) {
  if (!env.WEBFLOW_BLOG_COLLECTION_ID) return null;
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const j = await wf(env, `/collections/${env.WEBFLOW_BLOG_COLLECTION_ID}/items?limit=100&offset=${offset}`);
    items.push(...j.items);
    if (offset + 100 >= j.pagination.total) break;
  }
  return fillReadTimes(env, items);
}

// Webhook: the body only tells us which item ids changed. Each one is
// re-fetched from Webflow and only blog posts are touched, so a forged
// request can at most trigger a harmless recalculation.
async function readTimeWebhook(env, req) {
  if (!env.WEBFLOW_BLOG_COLLECTION_ID) return { skipped: "no blog collection" };
  const body = await req.json().catch(() => ({}));
  const p = body.payload ?? {};
  const refs = (p.items ?? [p]).filter((x) => x && x.id && (!x.collectionId || x.collectionId === env.WEBFLOW_BLOG_COLLECTION_ID));
  const items = [];
  for (const ref of refs.slice(0, 100)) {
    try {
      items.push(await wf(env, `/collections/${env.WEBFLOW_BLOG_COLLECTION_ID}/items/${ref.id}`));
    } catch (e) {
      console.log(JSON.stringify({ readTimeSkip: ref.id, error: String(e).slice(0, 120) }));
    }
  }
  return fillReadTimes(env, items);
}

// Cron entries in wrangler.toml:
//   "*/5 * * * *"  -> business status (every 5 min)
//   "0 */12 * * *" -> review sync (every 12h)
//   "0 8 * * *"    -> blog read-time sweep (daily)
// Routed by the fired cron expression, not by array position, so reordering
// the list in wrangler.toml still works correctly.
const STATUS_CRON = "*/5 * * * *";
const READ_TIME_CRON = "0 8 * * *";

export default {
  // Manual trigger for a dry run from a browser/curl:
  //   GET /?run=status    -> business status only
  //   GET /?run=reviews   -> full review sync
  //   GET /?run=readtime  -> blog read-time sweep
  //   POST /webhook/read-time -> Webflow collection_item_published webhook
  // Does not bypass DRY_RUN; still controlled by the env var.
  async fetch(req, env) {
    const url = new URL(req.url);
    const run = url.searchParams.get("run");
    try {
      if (req.method === "POST" && url.pathname === "/webhook/read-time")
        return Response.json(await readTimeWebhook(env, req));
      if (run === "status") return Response.json(await statusOnly(env));
      if (run === "reviews") return Response.json(await syncReviews(env));
      if (run === "readtime") return Response.json(await sweepReadTimes(env));
      return new Response("not found", { status: 404 });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
  scheduled: (event, env) => {
    const job = event.cron === STATUS_CRON ? statusOnly(env)
      : event.cron === READ_TIME_CRON ? sweepReadTimes(env)
      : syncReviews(env);
    return job.catch((e) => {
      console.error(String(e));
      throw e;
    });
  }
};

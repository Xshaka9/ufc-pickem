/* ============================================================
   UFC Pick'em League — core app
   Players: Beezus, Tee Tee, Dripple, Gnarl
   Scoring: 1 pt correct winner; +1 correct round; +1 correct
   method (bonuses only when the winner pick is right).
   "Decision" matches UD/SD/MD. Picks lock at event start.
   ============================================================ */

const VERSION = "1.0.0";

const PLAYERS = [
  { slug: "beezus",  name: "Beezus",  joinedYear: 2019 },
  { slug: "teetee",  name: "Tee Tee", joinedYear: 2019 },
  { slug: "dripple", name: "Dripple", joinedYear: 2019 },
  { slug: "gnarl",   name: "Gnarl",   joinedYear: 2023 },
];
const METHODS = [
  { v: "KO",  label: "KO/TKO" },
  { v: "SUB", label: "Submission" },
  { v: "DEC", label: "Decision" },
];
const SECTIONS = [
  { v: "main",   label: "Main Card" },
  { v: "prelim", label: "Preliminary Card" },
  { v: "early",  label: "Early Prelims" },
];
const AUTH_DOMAIN_SUFFIX = "@ufcpickem.app";

/* ================= tiny DOM helpers ================= */
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}
function showModal(title, bodyNodes, buttons) {
  const root = $("modal-root");
  root.innerHTML = "";
  const modal = el("div", { class: "modal" }, el("h3", {}, title), ...bodyNodes);
  const row = el("div", { class: "row-gap" });
  for (const b of buttons) {
    row.append(el("button", {
      class: "btn " + (b.style || "ghost"),
      onclick: async () => { if ((await b.onClick?.()) !== false) closeModal(); },
    }, b.label));
  }
  modal.append(row);
  const bg = el("div", { class: "modal-bg", onclick: (e) => { if (e.target === bg) closeModal(); } }, modal);
  root.append(bg);
}
function closeModal() { $("modal-root").innerHTML = ""; }

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
    " • " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function yearOf(iso) { return new Date(iso).getFullYear(); }
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ================= ESPN data source ================= */
const ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";
const CORS_PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
];
async function espnFetch(url) {
  const attempts = [url, ...CORS_PROXIES.map((p) => p(url))];
  let lastErr;
  for (const u of attempts) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (res.ok) return await res.json();
      lastErr = new Error("HTTP " + res.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("fetch failed");
}
function ymd(d) {
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
}
async function espnFindEvents(daysBack = 21, daysAhead = 90) {
  const from = new Date(Date.now() - daysBack * 864e5);
  const to = new Date(Date.now() + daysAhead * 864e5);
  const json = await espnFetch(`${ESPN_SB}?dates=${ymd(from)}-${ymd(to)}&limit=100`);
  const out = [];
  for (const ev of json.events || []) {
    // League wants real UFC cards only — skip Contender Series / TUF filler
    if (/contender series|ultimate fighter/i.test(ev.name || "")) continue;
    out.push({
      espnId: String(ev.id),
      name: ev.name || ev.shortName || "UFC Event",
      shortName: ev.shortName || ev.name,
      dateISO: ev.date,
    });
  }
  return out;
}
function normMethod(txt) {
  const t = (txt || "").toLowerCase();
  if (/no contest|overturn|could not/.test(t)) return { method: "NC", detail: "NC" };
  if (/sub/.test(t)) return { method: "SUB", detail: "SUB" };
  if (/decision|unanimous|split|majority/.test(t)) {
    const d = /split/.test(t) ? "SD" : /majority/.test(t) ? "MD" : /unanimous/.test(t) ? "UD" : "DEC";
    return { method: "DEC", detail: d };
  }
  if (/disqual/.test(t)) return { method: "DQ", detail: "DQ" };
  if (/ko|knockout/.test(t)) return { method: "KO", detail: "KO/TKO" };
  return { method: null, detail: txt || "" };
}
function competitorName(c) {
  return c?.athlete?.displayName || c?.athlete?.shortName || c?.athlete?.fullName || c?.displayName || "TBD";
}
function mapCompetition(c, idx, section) {
  const comps = c.competitors || [];
  const rounds = c.format?.regulation?.periods || 3;
  const fight = {
    id: String(c.id || uid()),
    espnId: String(c.id || ""),
    order: idx,
    section,
    f1: competitorName(comps[0]),
    f2: competitorName(comps[1]),
    rounds,
    pickem: false,
    result: null,
  };
  // result, if completed
  const st = c.status || {};
  if (st.type?.completed) {
    let winner = 0;
    if (comps[0]?.winner === true) winner = 1;
    else if (comps[1]?.winner === true) winner = 2;
    let txt = st.result?.displayName || st.result?.name || st.result?.shortDisplayName || "";
    if (!txt && Array.isArray(c.details)) {
      txt = c.details.map((d) => d.type?.text || "").join(" ");
    }
    const m = normMethod(txt);
    if (winner === 0 || m.method === "NC") {
      fight.result = { winner: 0, round: st.period || null, method: "NC", detail: m.detail || "No Contest / Draw", clock: st.displayClock || null };
    } else {
      fight.result = { winner, round: st.period || null, method: m.method, detail: m.detail, clock: st.displayClock || null };
    }
  }
  return fight;
}
async function espnGetCard(espnId, dateISO) {
  const d = new Date(dateISO);
  // fetch a 3-day window around the event date to dodge timezone edges
  const from = new Date(d.getTime() - 864e5);
  const to = new Date(d.getTime() + 864e5);
  const json = await espnFetch(`${ESPN_SB}?dates=${ymd(from)}-${ymd(to)}&limit=50`);
  const ev = (json.events || []).find((e) => String(e.id) === String(espnId));
  if (!ev) throw new Error("Event not found on ESPN for that date");
  const comps = ev.competitions || [];
  // ESPN groups card sections by start time: the latest block is the main
  // card, earlier blocks are prelims / early prelims. Within each block the
  // headliner is listed LAST, so we reverse for sheet-style ordering.
  const times = [...new Set(comps.map((c) => c.date))].sort();
  const sectionOf = (c) => {
    if (times.length <= 1) return "main";
    const i = times.indexOf(c.date);
    if (i === times.length - 1) return "main";
    if (times.length >= 3 && i === 0) return "early";
    return "prelim";
  };
  const n = comps.length;
  return {
    dateISO: ev.date,
    name: ev.name || ev.shortName,
    fights: comps.map((c, i) => mapCompetition(c, n - i, sectionOf(c))),
  };
}

/* ================= scoring engine ================= */
function scoreFight(pick, result) {
  if (!result || !result.winner) return null;         // no result yet, or NC/draw → excluded
  if (!pick || !pick.w) return { pts: 0, correct: false, noPick: true, roundBonus: false, methodBonus: false };
  const correct = Number(pick.w) === Number(result.winner);
  if (!correct) return { pts: 0, correct: false, roundBonus: false, methodBonus: false };
  const roundBonus = !!(pick.r && result.round && Number(pick.r) === Number(result.round));
  const methodBonus = !!(pick.m && result.method && pick.m === result.method);
  return { pts: 1 + (roundBonus ? 1 : 0) + (methodBonus ? 1 : 0), correct: true, roundBonus, methodBonus };
}
// aggregate one event for all players → {slug: {correct,pts,decided,pickemCorrect,pickemTotal,perfect,noHitter}}
function scoreEvent(fights, picksBySlug) {
  const out = {};
  const scorable = fights.filter((f) => !f.omitted);
  for (const p of PLAYERS) {
    const mine = picksBySlug[p.slug]?.picks || {};
    const participated = scorable.some((f) => mine[f.id]?.w);
    let correct = 0, pts = 0, decided = 0, pickemCorrect = 0, pickemTotal = 0;
    for (const f of scorable) {
      const s = scoreFight(mine[f.id], f.result);
      if (s === null) continue;
      decided++;
      if (s.correct) correct++;
      pts += s.pts;
      if (f.pickem) { pickemTotal++; if (s.correct) pickemCorrect++; }
    }
    out[p.slug] = {
      correct, pts, decided, participated, pickemCorrect, pickemTotal,
      perfect: participated && decided > 0 && correct === decided,
      noHitter: participated && decided > 0 && correct === 0,
    };
  }
  return out;
}

/* ================= data layer ================= */
let DATA = null;   // active store
let LIVE = false;  // firebase mode?

/* ---------- localStorage store (demo mode) ---------- */
function makeLocalStore() {
  const KEY = "ufcpickem-local-v1";
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  let db = load();
  db.players ||= {}; db.events ||= {}; db.legacy ||= null;
  return {
    mode: "demo",
    async init() {},
    currentSlug() { return db.session || null; },
    async listPlayers() {
      return PLAYERS.map((p) => ({ ...p, claimed: !!db.players[p.slug] }));
    },
    async claim(slug, pin) {
      if (db.players[slug]) throw new Error("Already claimed — sign in instead.");
      db.players[slug] = { pinHash: await sha256(slug + ":" + pin) };
      db.session = slug; save(db);
    },
    async signIn(slug, pin) {
      const p = db.players[slug];
      if (!p) throw new Error("Not set up yet — tap again to create a PIN.");
      if (p.pinHash !== await sha256(slug + ":" + pin)) throw new Error("Wrong PIN.");
      db.session = slug; save(db);
    },
    async signOut() { delete db.session; save(db); },
    async changePin(oldPin, newPin) {
      const slug = db.session;
      await this.signIn(slug, oldPin);
      db.players[slug].pinHash = await sha256(slug + ":" + newPin); save(db);
    },
    async listEvents() {
      return Object.values(db.events).map(({ fights, picks, ...ev }) => ev);
    },
    async getEvent(id) {
      const e = db.events[id]; if (!e) return null;
      const { fights, picks, ...ev } = e; return ev;
    },
    async saveEvent(ev) {
      const cur = db.events[ev.id] || { fights: {}, picks: {} };
      db.events[ev.id] = { ...cur, ...ev }; save(db);
    },
    async deleteEvent(id) { delete db.events[id]; save(db); },
    async listFights(evId) {
      return Object.values(db.events[evId]?.fights || {}).sort((a, b) => a.order - b.order);
    },
    async saveFight(evId, fight) {
      db.events[evId].fights[fight.id] = fight; save(db);
    },
    async deleteFight(evId, fid) { delete db.events[evId].fights[fid]; save(db); },
    async getAllPicks(evId) { return db.events[evId]?.picks || {}; },
    async saveMyPicks(evId, picksObj) {
      const slug = db.session;
      db.events[evId].picks[slug] = { picks: picksObj, updatedAt: Date.now() }; save(db);
    },
    subscribeEvent() { return () => {}; },
    async getLegacy() { return db.legacy; },
    async saveLegacy(data) { db.legacy = data; save(db); },
  };
}

/* ---------- Firebase store (live mode) ---------- */
async function makeFirebaseStore(cfg) {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const authM = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const fsM = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const app = initializeApp(cfg);
  const auth = authM.getAuth(app);
  const fdb = fsM.initializeFirestore(app, {
    localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
  });
  const {
    doc, getDoc, setDoc, deleteDoc, collection, getDocs, onSnapshot,
  } = fsM;

  // wait for initial auth state
  const firstAuth = new Promise((res) => {
    const un = authM.onAuthStateChanged(auth, (u) => { un(); res(u); });
  });

  function slugFromUser(u) {
    if (!u?.email) return null;
    return u.email.split("@")[0];
  }

  return {
    mode: "live",
    async init() { await firstAuth; },
    currentSlug() { return slugFromUser(auth.currentUser); },
    async listPlayers() {
      try {
        const snap = await getDocs(collection(fdb, "players"));
        const claimed = new Set(snap.docs.map((d) => d.id));
        return PLAYERS.map((p) => ({ ...p, claimed: claimed.has(p.slug) }));
      } catch {
        // not signed in yet — rules hide player docs, claim status unknown
        return PLAYERS.map((p) => ({ ...p, claimed: null }));
      }
    },
    async claim(slug, pin) {
      const email = slug + AUTH_DOMAIN_SUFFIX;
      const cred = await authM.createUserWithEmailAndPassword(auth, email, pin)
        .catch((e) => {
          if (e.code === "auth/email-already-in-use") throw new Error("Already claimed — sign in instead.");
          if (e.code === "auth/weak-password") throw new Error("PIN must be at least 6 digits.");
          throw e;
        });
      const p = PLAYERS.find((x) => x.slug === slug);
      await setDoc(doc(fdb, "players", slug), {
        name: p.name, uid: cred.user.uid, joinedYear: p.joinedYear, createdAt: Date.now(),
      });
    },
    async signIn(slug, pin) {
      const email = slug + AUTH_DOMAIN_SUFFIX;
      await authM.signInWithEmailAndPassword(auth, email, pin).catch((e) => {
        if (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password")
          throw new Error("Wrong PIN.");
        if (e.code === "auth/user-not-found")
          throw new Error("Not set up yet — this player has no PIN. Tap again to create one.");
        throw new Error(e.message);
      });
    },
    async signOut() { await authM.signOut(auth); },
    async changePin(oldPin, newPin) {
      const u = auth.currentUser;
      const cred = authM.EmailAuthProvider.credential(u.email, oldPin);
      await authM.reauthenticateWithCredential(u, cred)
        .catch(() => { throw new Error("Current PIN is wrong."); });
      await authM.updatePassword(u, newPin).catch((e) => {
        if (e.code === "auth/weak-password") throw new Error("New PIN must be at least 6 digits.");
        throw e;
      });
    },
    async listEvents() {
      const snap = await getDocs(collection(fdb, "events"));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async getEvent(id) {
      const d = await getDoc(doc(fdb, "events", id));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    },
    async saveEvent(ev) {
      const { id, ...rest } = ev;
      await setDoc(doc(fdb, "events", id), rest, { merge: true });
    },
    async deleteEvent(id) {
      // delete subcollections first (small counts, fine client-side)
      for (const sub of ["fights", "picks"]) {
        const snap = await getDocs(collection(fdb, "events", id, sub));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(fdb, "events", id));
    },
    async listFights(evId) {
      const snap = await getDocs(collection(fdb, "events", evId, "fights"));
      return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => a.order - b.order);
    },
    async saveFight(evId, fight) {
      const { id, ...rest } = fight;
      await setDoc(doc(fdb, "events", evId, "fights", id), rest, { merge: false });
    },
    async deleteFight(evId, fid) {
      await deleteDoc(doc(fdb, "events", evId, "fights", fid));
    },
    async getAllPicks(evId) {
      // security rules hide other players' picks pre-lock; query own doc + try the rest
      const out = {};
      await Promise.all(PLAYERS.map(async (p) => {
        try {
          const d = await getDoc(doc(fdb, "events", evId, "picks", p.slug));
          if (d.exists()) out[p.slug] = d.data();
        } catch { /* permission denied pre-lock — expected */ }
      }));
      return out;
    },
    async saveMyPicks(evId, picksObj) {
      const slug = this.currentSlug();
      await setDoc(doc(fdb, "events", evId, "picks", slug), {
        uid: auth.currentUser.uid, picks: picksObj, updatedAt: Date.now(),
      });
    },
    subscribeEvent(evId, cb) {
      const un1 = onSnapshot(collection(fdb, "events", evId, "fights"), () => cb());
      return () => { un1(); };
    },
    async getLegacy() {
      const d = await getDoc(doc(fdb, "league", "legacy"));
      return d.exists() ? d.data() : null;
    },
    async saveLegacy(data) { await setDoc(doc(fdb, "league", "legacy"), data); },
  };
}

/* ================= app state & navigation ================= */
const state = {
  me: null,             // my slug
  events: [],
  currentEventId: null,
  unsubEvent: null,
  pendingSignin: null,  // slug awaiting PIN
  claimedSet: new Set(),
  saveTimer: null,
};

function playerName(slug) { return PLAYERS.find((p) => p.slug === slug)?.name || slug; }
function eventLocked(ev) { return Date.now() >= (ev.startMs || new Date(ev.dateISO).getTime()); }

function switchTab(tab) {
  for (const t of ["events", "event", "board", "more"]) {
    $("tab-" + t)?.classList.toggle("hidden", t !== tab);
  }
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab || (tab === "event" && b.dataset.tab === "events")));
  $("topbar-title").textContent =
    tab === "board" ? "Leaderboard" : tab === "more" ? "Settings" : tab === "event" ? "Event" : "Events";
  if (state.unsubEvent && tab !== "event") { state.unsubEvent(); state.unsubEvent = null; }
}

/* ================= sign-in view ================= */
async function renderSignin() {
  $("view-signin").classList.remove("hidden");
  $("view-main").classList.add("hidden");
  $("signin-pin").classList.add("hidden");
  $("signin-players").classList.remove("hidden");
  $("signin-status").textContent = DATA.mode === "demo"
    ? "DEMO MODE — data stays on this device until Firebase is connected (see SETUP.md)"
    : "";
  const players = await DATA.listPlayers();
  state.claimedKnown = players.every((p) => p.claimed !== null);
  state.claimedSet = new Set(players.filter((p) => p.claimed).map((p) => p.slug));
  const grid = $("signin-players");
  grid.innerHTML = "";
  for (const p of players) {
    const hint = p.claimed === null ? "Tap to sign in" : p.claimed ? "Tap to sign in" : "Tap to set up";
    grid.append(el("button", {
      class: "player-btn",
      onclick: () => showPinEntry(p.slug),
    }, p.name, el("small", {}, hint)));
  }
}
function showPinEntry(slug) {
  state.pendingSignin = slug;
  const claimed = state.claimedKnown ? state.claimedSet.has(slug) : null;
  $("signin-players").classList.add("hidden");
  $("signin-pin").classList.remove("hidden");
  $("pin-title").textContent =
    claimed === null ? `${playerName(slug)} — enter your PIN (first time? this creates it)`
    : claimed ? `${playerName(slug)} — enter your PIN`
    : `${playerName(slug)} — create a PIN (6+ digits)`;
  $("pin-go").textContent = claimed === false ? "Create PIN" : "Sign In";
  $("pin-error").classList.add("hidden");
  $("pin-input").value = "";
  $("pin-input").focus();
}
async function submitPin() {
  const slug = state.pendingSignin;
  const pin = $("pin-input").value.trim();
  const errEl = $("pin-error");
  errEl.classList.add("hidden");
  if (pin.length < 6) {
    errEl.textContent = "PIN must be at least 6 digits."; errEl.classList.remove("hidden"); return;
  }
  $("pin-go").disabled = true;
  try {
    if (!state.claimedKnown) {
      // claim status unknown pre-auth: try sign-in, fall back to claiming
      try {
        await DATA.signIn(slug, pin);
      } catch (e1) {
        try {
          await DATA.claim(slug, pin);
        } catch (e2) {
          // account exists but the PIN didn't match it
          if (/already claimed/i.test(e2.message || "")) throw new Error("Wrong PIN.");
          throw e2;
        }
      }
    } else if (state.claimedSet.has(slug)) {
      await DATA.signIn(slug, pin);
    } else {
      await DATA.claim(slug, pin);
    }
    state.me = slug;
    await enterApp();
  } catch (e) {
    errEl.textContent = e.message || String(e);
    errEl.classList.remove("hidden");
  } finally {
    $("pin-go").disabled = false;
  }
}

/* ================= main views ================= */
async function enterApp() {
  $("view-signin").classList.add("hidden");
  $("view-main").classList.remove("hidden");
  $("topbar-user").textContent = playerName(state.me);
  $("more-name").textContent = playerName(state.me) + (DATA.mode === "demo" ? "  (demo mode)" : "");
  $("app-version").textContent = `UFC Pick'em v${VERSION} — ${DATA.mode === "demo" ? "DEMO (this device only)" : "LIVE (shared)"}`;
  switchTab("events");
  await refreshEvents();
}

async function refreshEvents() {
  state.events = (await DATA.listEvents()).sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO));
  const now = Date.now();
  const cutoff = now - 18 * 3600e3; // events stay "upcoming" until ~18h after start
  const upcoming = state.events.filter((e) => new Date(e.dateISO).getTime() >= cutoff);
  const past = state.events.filter((e) => new Date(e.dateISO).getTime() < cutoff).reverse();

  const upEl = $("events-upcoming"), pastEl = $("events-past");
  upEl.innerHTML = ""; pastEl.innerHTML = "";
  if (!upcoming.length) {
    upEl.append(el("div", { class: "card muted" },
      'No upcoming events yet. Tap "Find Events" to pull the UFC schedule.'));
  }
  for (const ev of upcoming) upEl.append(eventCard(ev, false));
  for (const ev of past) pastEl.append(eventCard(ev, true));
  if (!past.length) pastEl.append(el("div", { class: "card muted" }, "No past events recorded in the app yet."));
}
function eventCard(ev, isPast) {
  const locked = eventLocked(ev);
  const badges = el("div", { class: "ev-badges" });
  if (isPast) badges.append(el("span", { class: "badge done" }, "Final"));
  else if (locked) badges.append(el("span", { class: "badge live" }, "Live"));
  else badges.append(el("span", { class: "badge open" }, "Picks Open"));
  return el("div", { class: "event-card", onclick: () => openEvent(ev.id) },
    el("div", { class: "ev-name" }, ev.name),
    el("div", { class: "ev-date" }, fmtDate(ev.dateISO)),
    badges);
}

async function syncEventsList() {
  const btn = $("btn-sync-events");
  btn.disabled = true; btn.textContent = "Searching…";
  try {
    const found = await espnFindEvents();
    // clean up filtered-out events (e.g. Contender Series) that were synced
    // before the filter existed and never got a card imported
    for (const ev of state.events) {
      if (/contender series|ultimate fighter/i.test(ev.name || "")) {
        const fights = await DATA.listFights(ev.id);
        if (!fights.length) await DATA.deleteEvent(ev.id);
      }
    }
    const known = new Set(state.events.map((e) => e.espnId));
    let added = 0;
    for (const f of found) {
      if (known.has(f.espnId)) {
        // refresh date/name on existing events (cards move around)
        const existing = state.events.find((e) => e.espnId === f.espnId);
        if (existing && (existing.dateISO !== f.dateISO || existing.name !== f.name)) {
          await DATA.saveEvent({ ...existing, dateISO: f.dateISO, name: f.name, startMs: new Date(f.dateISO).getTime() });
        }
        continue;
      }
      await DATA.saveEvent({
        id: "espn-" + f.espnId,
        espnId: f.espnId,
        name: f.name,
        shortName: f.shortName,
        dateISO: f.dateISO,
        startMs: new Date(f.dateISO).getTime(),
        year: yearOf(f.dateISO),
        createdBy: state.me,
      });
      added++;
    }
    await refreshEvents();
    toast(added ? `Added ${added} event${added > 1 ? "s" : ""} from ESPN` : "Schedule is up to date");
  } catch (e) {
    console.error(e);
    toast("Couldn't reach ESPN — try again in a minute");
  } finally {
    btn.disabled = false; btn.innerHTML = "&#8635; Find Events";
  }
}

/* ================= event detail ================= */
async function openEvent(id) {
  state.currentEventId = id;
  switchTab("event");
  await renderEvent();
  if (state.unsubEvent) state.unsubEvent();
  state.unsubEvent = DATA.subscribeEvent(id, () => renderEvent(true));
}

async function renderEvent(quiet = false) {
  const id = state.currentEventId;
  const ev = await DATA.getEvent(id);
  if (!ev) { switchTab("events"); return; }
  const fights = await DATA.listFights(id);
  const allPicks = await DATA.getAllPicks(id);
  const locked = eventLocked(ev);
  const mine = allPicks[state.me]?.picks || {};

  /* --- head --- */
  const head = $("event-head");
  head.innerHTML = "";
  head.append(
    el("button", { class: "btn small ghost", onclick: () => { switchTab("events"); refreshEvents(); } }, "← Events"),
    el("h2", { style: "margin-top:10px" }, ev.name),
    el("div", { class: "ev-date" }, fmtDate(ev.dateISO) + (locked ? "  •  \u{1F512} picks locked" : "  •  ✅ picks open")),
  );

  /* --- tools --- */
  const tools = $("event-tools");
  tools.innerHTML = "";
  if (ev.espnId) {
    tools.append(el("button", { class: "btn small", onclick: () => syncCard(ev, fights) },
      fights.length ? "↻ Refresh Card" : "⬇ Import Card"));
    tools.append(el("button", { class: "btn small gold", onclick: () => syncResults(ev, fights) }, "⚡ Sync Results"));
  }
  tools.append(el("button", { class: "btn small ghost", onclick: () => editFightModal(ev, null, fights.length) }, "+ Add Fight"));
  tools.append(el("button", { class: "btn small ghost", onclick: () => editEventModal(ev) }, "✎ Event"));

  /* --- fights --- */
  const wrap = $("event-fights");
  wrap.innerHTML = "";
  if (!fights.length) {
    wrap.append(el("div", { class: "card muted" },
      ev.espnId ? 'Tap "Import Card" to pull the fight card from ESPN.' : "Add fights manually with + Add Fight."));
  }
  for (const sec of SECTIONS) {
    const secFights = fights.filter((f) => f.section === sec.v);
    if (!secFights.length) continue;
    wrap.append(el("div", { class: "card-section-title" }, sec.label));
    for (const f of secFights) wrap.append(fightRow(ev, f, mine, allPicks, locked));
  }

  /* --- scoreboard --- */
  renderEventScoreboard(ev, fights, allPicks, locked);
  if (!quiet) window.scrollTo({ top: 0 });
}

function fightRow(ev, f, mine, allPicks, locked) {
  // Omitted fights: grayed out, no picking, no scoring — just an un-omit path
  if (f.omitted) {
    return el("div", { class: "fight omitted" },
      el("div", { class: "fight-head", style: "display:flex;align-items:center;gap:10px" },
        el("span", { class: "badge done" }, "Omitted"),
        el("span", { class: "muted", style: "flex:1" }, `${f.f1} vs ${f.f2} — not counted`),
        el("button", { class: "btn small ghost", onclick: () => editFightModal(ev, f) }, "✎")));
  }
  const pick = mine[f.id] || {};
  const res = f.result;
  const decided = res && res.winner !== undefined && res !== null;

  const b1 = el("button", {
    class: "fighter-btn" + (pick.w === 1 ? " picked" : "") + (res?.winner === 1 ? " won" : ""),
    disabled: locked ? "disabled" : null,
    onclick: () => setPick(f, { ...pick, w: pick.w === 1 ? undefined : 1 }),
  }, f.f1);
  const b2 = el("button", {
    class: "fighter-btn" + (pick.w === 2 ? " picked" : "") + (res?.winner === 2 ? " won" : ""),
    disabled: locked ? "disabled" : null,
    onclick: () => setPick(f, { ...pick, w: pick.w === 2 ? undefined : 2 }),
  }, f.f2);

  const rdSel = el("select", { class: "select", disabled: locked ? "disabled" : null,
    onchange: (e) => setPick(f, { ...pick, r: e.target.value ? Number(e.target.value) : undefined }) },
    el("option", { value: "" }, "Rd: any"),
    ...Array.from({ length: f.rounds || 3 }, (_, i) =>
      el("option", { value: String(i + 1), selected: pick.r === i + 1 ? "selected" : null }, "Rd " + (i + 1))));
  const mSel = el("select", { class: "select", disabled: locked ? "disabled" : null,
    onchange: (e) => setPick(f, { ...pick, m: e.target.value || undefined }) },
    el("option", { value: "" }, "By: any"),
    ...METHODS.map((m) =>
      el("option", { value: m.v, selected: pick.m === m.v ? "selected" : null }, m.label)));

  const headBits = [
    el("div", { class: "fight-vs" }, b1, el("span", { class: "vs-label" }, "VS"), b2),
    el("div", { class: "pick-extras" }, rdSel, mSel,
      el("button", { class: "btn small ghost", onclick: () => editFightModal(ev, f) }, "✎")),
  ];
  if (f.pickem) headBits.unshift(el("div", { class: "pickem-flag" }, "⚔ PICK'EM FIGHT"));
  const node = el("div", { class: "fight" }, el("div", { class: "fight-head" }, ...headBits));

  if (decided && res.winner !== undefined) {
    const winName = res.winner === 1 ? f.f1 : res.winner === 2 ? f.f2 : "No Contest / Draw";
    const parts = [el("span", { class: "res-main" }, "✔ " + winName)];
    if (res.winner) {
      parts.push(el("span", { class: "muted" },
        (res.method === "DEC" ? (res.detail || "Decision") : res.detail || res.method) +
        (res.round ? ` • R${res.round}` : "") + (res.clock ? ` ${res.clock}` : "")));
    }
    node.append(el("div", { class: "fight-result" }, ...parts));
  }

  // after lock: reveal everyone's picks + per-fight points
  if (locked) {
    const reveal = el("div", { class: "fight-picks-reveal" });
    for (const p of PLAYERS) {
      const pk = allPicks[p.slug]?.picks?.[f.id];
      const s = scoreFight(pk, res);
      let txt = "—";
      if (pk?.w) {
        txt = pk.w === 1 ? f.f1 : f.f2;
        const extra = [pk.r ? "R" + pk.r : null, pk.m ? METHODS.find((m) => m.v === pk.m)?.label : null].filter(Boolean).join(" ");
        if (extra) txt += ` (${extra})`;
      } else if (!allPicks[p.slug]) {
        txt = "no picks";
      }
      const ptsClass = s ? "p" + Math.min(s.pts, 3) : "p0";
      reveal.append(el("div", { class: "reveal-row" },
        el("span", {}, el("b", {}, p.name + ": "), txt),
        el("span", { class: "pts " + ptsClass }, s === null ? "" : s.pts + " pt" + (s.pts === 1 ? "" : "s"))));
    }
    node.append(reveal);
  }
  return node;
}

async function setPick(f, newPick) {
  const evId = state.currentEventId;
  const ev = await DATA.getEvent(evId);
  if (eventLocked(ev)) { toast("Picks are locked — event has started"); return; }
  const all = await DATA.getAllPicks(evId);
  const mine = all[state.me]?.picks || {};
  const clean = {};
  if (newPick.w) clean.w = newPick.w;
  if (newPick.r) clean.r = newPick.r;
  if (newPick.m) clean.m = newPick.m;
  if (Object.keys(clean).length) mine[f.id] = clean;
  else delete mine[f.id];
  await DATA.saveMyPicks(evId, mine);
  renderEvent(true);
}

function renderEventScoreboard(ev, fights, allPicks, locked) {
  const box = $("event-scoreboard");
  box.innerHTML = "";
  const anyResults = fights.some((f) => f.result);
  if (!locked && !anyResults) {
    // pre-lock: show my pick completion (omitted fights don't count)
    const pickable = fights.filter((f) => !f.omitted);
    const total = pickable.length;
    if (total) {
      const mine = allPicks[state.me]?.picks || {};
      const made = pickable.filter((f) => mine[f.id]?.w).length;
      box.append(el("div", { class: "card", style: "margin-top:16px" },
        el("b", {}, `Your picks: ${made}/${total}`),
        el("p", { class: "muted small" }, "Other players' picks are hidden until the event starts.")));
    }
    return;
  }
  const scores = scoreEvent(fights, allPicks);
  const ranked = PLAYERS.slice().sort((a, b) => scores[b.slug].pts - scores[a.slug].pts);
  const tbl = el("table", {},
    el("tr", {}, ...["Player", "Pts", "Correct", "Bonus", ""].map((h) => el("th", {}, h))),
    ...ranked.map((p, i) => {
      const s = scores[p.slug];
      const flags = [s.perfect ? "\u{1F3AF} Perfect" : null, s.noHitter ? "\u{1F4A9} No-Hitter" : null].filter(Boolean).join(" ");
      return el("tr", { class: (p.slug === state.me ? "me" : "") + (i === 0 && s.pts > 0 ? " rank-1" : "") },
        el("td", {}, p.name),
        el("td", {}, el("b", {}, s.participated ? String(s.pts) : "—")),
        el("td", {}, s.participated ? `${s.correct}/${s.decided}` : "no picks"),
        el("td", {}, s.participated ? String(s.pts - s.correct) : "—"),
        el("td", {}, flags));
    }));
  box.append(
    el("div", { class: "card-section-title", style: "margin-top:22px" }, "Scoreboard"),
    el("div", { class: "table-wrap" }, tbl));
}

/* --- card / result sync --- */
async function syncCard(ev, existingFights) {
  toast("Importing card from ESPN…");
  try {
    const card = await espnGetCard(ev.espnId, ev.dateISO);
    const byEspn = new Map(existingFights.map((f) => [f.espnId, f]));
    let added = 0, updated = 0;
    for (const nf of card.fights) {
      const old = byEspn.get(nf.espnId);
      if (old) {
        // keep picks/pickem flags; refresh names/order/section/rounds from ESPN
        const merged = { ...old, f1: nf.f1, f2: nf.f2, order: nf.order, rounds: nf.rounds, section: nf.section };
        if (!old.result && nf.result) merged.result = nf.result;
        await DATA.saveFight(ev.id, merged);
        updated++;
      } else {
        await DATA.saveFight(ev.id, nf);
        added++;
      }
    }
    if (card.dateISO && card.dateISO !== ev.dateISO) {
      await DATA.saveEvent({ ...ev, dateISO: card.dateISO, startMs: new Date(card.dateISO).getTime() });
    }
    toast(`Card synced — ${added} added, ${updated} refreshed`);
    renderEvent(true);
  } catch (e) {
    console.error(e);
    toast("Card import failed: " + (e.message || e));
  }
}
async function syncResults(ev, fights) {
  toast("Syncing results from ESPN…");
  try {
    const card = await espnGetCard(ev.espnId, ev.dateISO);
    const byEspn = new Map(card.fights.map((f) => [f.espnId, f]));
    let n = 0;
    for (const f of fights) {
      const remote = byEspn.get(f.espnId);
      if (remote?.result) {
        await DATA.saveFight(ev.id, { ...f, result: remote.result });
        n++;
      }
    }
    toast(n ? `Results in for ${n} fight${n > 1 ? "s" : ""}` : "No results posted yet");
    renderEvent(true);
  } catch (e) {
    console.error(e);
    toast("Result sync failed: " + (e.message || e));
  }
}

/* --- fight edit modal (manual override) --- */
function editFightModal(ev, fight, nextOrder = 0) {
  const isNew = !fight;
  const f = fight || { id: uid(), espnId: "", order: nextOrder, section: "main", f1: "", f2: "", rounds: 3, pickem: false, result: null };
  const in1 = el("input", { value: f.f1, placeholder: "Fighter 1" });
  const in2 = el("input", { value: f.f2, placeholder: "Fighter 2" });
  const secSel = el("select", {}, ...SECTIONS.map((s) =>
    el("option", { value: s.v, selected: f.section === s.v ? "selected" : null }, s.label)));
  const rdsSel = el("select", {},
    el("option", { value: "3", selected: f.rounds === 3 ? "selected" : null }, "3 rounds"),
    el("option", { value: "5", selected: f.rounds === 5 ? "selected" : null }, "5 rounds"));
  const pickemChk = el("input", { type: "checkbox", style: "width:auto" });
  pickemChk.checked = !!f.pickem;
  const omitChk = el("input", { type: "checkbox", style: "width:auto" });
  omitChk.checked = !!f.omitted;

  const r = f.result || {};
  const winSel = el("select", {},
    el("option", { value: "" }, "No result yet"),
    el("option", { value: "1", selected: r.winner === 1 ? "selected" : null }, "Fighter 1 wins"),
    el("option", { value: "2", selected: r.winner === 2 ? "selected" : null }, "Fighter 2 wins"),
    el("option", { value: "0", selected: r.winner === 0 ? "selected" : null }, "No Contest / Draw"));
  const rndSel = el("select", {}, el("option", { value: "" }, "Round —"),
    ...[1, 2, 3, 4, 5].map((n) => el("option", { value: String(n), selected: r.round === n ? "selected" : null }, "Round " + n)));
  const metSel = el("select", {}, el("option", { value: "" }, "Method —"),
    ...[["KO", "KO/TKO"], ["SUB", "Submission"], ["DEC", "Decision (any)"], ["DQ", "DQ"]].map(([v, l]) =>
      el("option", { value: v, selected: r.method === v ? "selected" : null }, l)));
  const detIn = el("input", { value: r.detail || "", placeholder: "Detail (e.g. UD, RNC, head kick)" });

  const body = [
    el("label", {}, "Fighters"), in1, el("div", { style: "height:8px" }), in2,
    el("label", {}, "Card section"), secSel,
    el("label", {}, "Scheduled rounds"), rdsSel,
    el("label", {}, el("span", {}, "Pick'em fight (tracked separately)  "), pickemChk),
    el("label", {}, el("span", {}, "Omit this fight (no picks, doesn't count)  "), omitChk),
    el("label", {}, "Result (manual override)"), winSel,
    el("div", { class: "row-gap" }, rndSel, metSel),
    el("label", {}, "Result detail"), detIn,
  ];
  const buttons = [
    ...(isNew ? [] : [{
      label: "Delete", style: "ghost",
      onClick: async () => {
        if (!confirm("Delete this fight?")) return false;
        await DATA.deleteFight(ev.id, f.id); renderEvent(true);
      },
    }]),
    { label: "Cancel", style: "ghost" },
    {
      label: "Save", style: "primary",
      onClick: async () => {
        f.f1 = in1.value.trim() || "TBD";
        f.f2 = in2.value.trim() || "TBD";
        f.section = secSel.value;
        f.rounds = Number(rdsSel.value);
        f.pickem = pickemChk.checked;
        f.omitted = omitChk.checked;
        if (winSel.value === "") f.result = null;
        else f.result = {
          winner: Number(winSel.value),
          round: rndSel.value ? Number(rndSel.value) : null,
          method: metSel.value || null,
          detail: detIn.value.trim() || null,
          clock: r.clock || null,
        };
        await DATA.saveFight(ev.id, f);
        renderEvent(true);
      },
    },
  ];
  showModal(isNew ? "Add Fight" : "Edit Fight", body, buttons);
}

function editEventModal(ev) {
  const nameIn = el("input", { value: ev.name });
  const dateIn = el("input", { type: "datetime-local" });
  const d = new Date(ev.dateISO);
  dateIn.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const body = [
    el("label", {}, "Event name (rename it something dumb, tradition demands it)"), nameIn,
    el("label", {}, "Start time — picks lock at this moment"), dateIn,
  ];
  showModal("Edit Event", body, [
    {
      label: "Delete Event", style: "ghost",
      onClick: async () => {
        if (!confirm(`Delete "${ev.name}" and all its picks?`)) return false;
        await DATA.deleteEvent(ev.id);
        switchTab("events"); refreshEvents();
      },
    },
    { label: "Cancel", style: "ghost" },
    {
      label: "Save", style: "primary",
      onClick: async () => {
        const iso = new Date(dateIn.value).toISOString();
        await DATA.saveEvent({ ...ev, name: nameIn.value.trim() || ev.name, dateISO: iso, startMs: new Date(iso).getTime(), year: yearOf(iso) });
        renderEvent(true);
      },
    },
  ]);
}

/* ================= leaderboard ================= */
async function renderBoard() {
  const yearSel = $("board-year");
  if (!yearSel.dataset.filled) {
    const years = ["All-Time"];
    for (let y = new Date().getFullYear(); y >= 2019; y--) years.push(String(y));
    yearSel.innerHTML = "";
    for (const y of years) yearSel.append(el("option", { value: y }, y));
    yearSel.dataset.filled = "1";
    yearSel.onchange = renderBoard;
  }
  const mode = yearSel.value || "All-Time";
  const body = $("board-body");
  body.innerHTML = "";
  body.append(el("div", { class: "card muted small" }, "Crunching numbers…"));

  const legacy = await DATA.getLegacy();
  const events = await DATA.listEvents();
  // pull per-event scores (only decided fights count)
  const agg = {};
  for (const p of PLAYERS) agg[p.slug] = { pts: 0, correct: 0, decided: 0, perfects: 0, noHitters: 0, pickemC: 0, pickemT: 0 };
  const wanted = events.filter((e) => mode === "All-Time" || String(e.year || yearOf(e.dateISO)) === mode);
  for (const ev of wanted) {
    const fights = await DATA.listFights(ev.id);
    if (!fights.some((f) => f.result)) continue;
    const picks = await DATA.getAllPicks(ev.id);
    const s = scoreEvent(fights, picks);
    for (const p of PLAYERS) {
      const x = s[p.slug];
      if (!x.participated) continue; // skipped this card — doesn't count against them
      agg[p.slug].pts += x.pts; agg[p.slug].correct += x.correct; agg[p.slug].decided += x.decided;
      if (x.perfect) agg[p.slug].perfects++;
      if (x.noHitter) agg[p.slug].noHitters++;
      agg[p.slug].pickemC += x.pickemCorrect; agg[p.slug].pickemT += x.pickemTotal;
    }
  }

  // merge legacy
  const rows = PLAYERS.map((p) => {
    const a = agg[p.slug];
    let pts = a.pts, correct = a.correct, decided = a.decided, perfects = a.perfects, noHitters = a.noHitters;
    const lg = legacy?.players?.[p.slug];
    if (lg) {
      if (mode === "All-Time") {
        pts += lg.totalPointsWithBonus || 0;
        correct += lg.correctPicks || 0;
        decided += lg.percentage ? Math.round((lg.correctPicks / lg.percentage) * 100) : 0;
        perfects += lg.perfects || 0;
        noHitters += lg.noHitters || 0;
      } else {
        const yc = lg.correctByYear?.[mode];
        const yb = lg.withBonusByYear?.[mode];
        if (yc !== undefined) correct += yc;
        if (yb !== undefined) pts += yb;
        const tf = legacy.totalFightsByYear?.[mode];
        if (tf) decided += tf;
      }
    }
    return { p, pts, correct, decided, perfects, noHitters, a };
  });
  rows.sort((x, y) => y.pts - x.pts);

  body.innerHTML = "";
  const tbl = el("table", {},
    el("tr", {}, ...["Player", "Points", "Correct", "%", "\u{1F3AF}", "\u{1F4A9}"].map((h) => el("th", {}, h))),
    ...rows.map((r, i) => el("tr", { class: (r.p.slug === state.me ? "me" : "") + (i === 0 && r.pts > 0 ? " rank-1" : "") },
      el("td", {}, r.p.name),
      el("td", {}, el("b", {}, String(r.pts))),
      el("td", {}, String(r.correct)),
      el("td", {}, r.decided ? ((r.correct / r.decided) * 100).toFixed(1) + "%" : "—"),
      el("td", {}, String(r.perfects)),
      el("td", {}, String(r.noHitters)))));
  body.append(el("div", { class: "table-wrap" }, tbl));
  if (!legacy) {
    body.append(el("div", { class: "card muted small", style: "margin-top:10px" },
      "Spreadsheet history not imported yet — go to Settings → Import 2019–2026 totals."));
  } else {
    body.append(el("div", { class: "muted small", style: "margin-top:10px;padding:0 4px" },
      mode === "All-Time"
        ? "Includes spreadsheet history 2019–" + (legacy.snapshotDate || "2026") + " plus everything tracked in the app."
        : "Includes spreadsheet totals for " + mode + " plus app-tracked events. \u{1F3AF} = perfect cards, \u{1F4A9} = no-hitters (app-tracked era only for yearly view)."));
  }
}

/* ================= settings ================= */
async function importLegacy() {
  const existing = await DATA.getLegacy();
  if (existing && !confirm("History already imported. Re-import and overwrite?")) return;
  await DATA.saveLegacy(window.LEGACY_DATA);
  toast("Spreadsheet history imported ✅");
  renderBoard();
}
function changePinModal() {
  const oldIn = el("input", { type: "password", inputmode: "numeric", placeholder: "Current PIN" });
  const newIn = el("input", { type: "password", inputmode: "numeric", placeholder: "New PIN (6+ digits)" });
  showModal("Change PIN", [el("label", {}, "Current PIN"), oldIn, el("label", {}, "New PIN"), newIn], [
    { label: "Cancel", style: "ghost" },
    {
      label: "Change", style: "primary",
      onClick: async () => {
        if (newIn.value.trim().length < 6) { toast("New PIN must be 6+ digits"); return false; }
        try {
          await DATA.changePin(oldIn.value.trim(), newIn.value.trim());
          toast("PIN changed ✅");
        } catch (e) { toast(e.message || String(e)); return false; }
      },
    },
  ]);
}

/* ================= boot ================= */
async function boot() {
  const cfg = window.FIREBASE_CONFIG;
  if (cfg && cfg.apiKey) {
    try {
      DATA = await makeFirebaseStore(cfg);
      LIVE = true;
    } catch (e) {
      console.error("Firebase init failed, falling back to demo:", e);
      DATA = makeLocalStore();
    }
  } else {
    DATA = makeLocalStore();
  }
  await DATA.init();

  // nav
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.onclick = () => {
      switchTab(b.dataset.tab);
      if (b.dataset.tab === "events") refreshEvents();
      if (b.dataset.tab === "board") renderBoard();
    };
  });
  $("btn-sync-events").onclick = syncEventsList;
  $("pin-go").onclick = submitPin;
  $("pin-back").onclick = () => { $("signin-pin").classList.add("hidden"); $("signin-players").classList.remove("hidden"); };
  $("pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
  $("btn-signout").onclick = async () => { await DATA.signOut(); state.me = null; renderSignin(); };
  $("btn-change-pin").onclick = changePinModal;
  $("btn-import-legacy").onclick = importLegacy;

  // resume session?
  const slug = DATA.currentSlug();
  if (slug && PLAYERS.some((p) => p.slug === slug)) {
    state.me = slug;
    await enterApp();
  } else {
    await renderSignin();
  }

  // PWA service worker
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();

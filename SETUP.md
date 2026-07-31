# UFC Pick'em League — Setup Guide

Your league app for **Beezus, Tee Tee, Dripple, and Gnarl**.
Same rules as the Google Sheet: 1 point per correct winner, +1 for the right
round, +1 for the right method (bonuses only count when the winner pick is
right; "Decision" matches UD/SD/MD). Picks lock when the event starts.
Fight cards and results auto-import from ESPN — no more typing in fighters.

---

## Try it right now (Demo Mode)

Open `index.html` in a browser. Until Firebase is connected the app runs in
**Demo Mode** — everything works (ESPN sync included) but data stays on your
device only. Great for kicking the tires.

---

## Going live (shared with your friends) — ~15 minutes, free

The app needs a small free backend so everyone shares the same picks and
leaderboard. Firebase's free tier is far more than a 4-person league will
ever use.

### 1. Create the Firebase project

1. Go to https://console.firebase.google.com and sign in with any Google account
2. **Create a project** → name it anything (e.g. `ufc-pickem`) → Google
   Analytics is optional (feel free to disable)

### 2. Turn on Authentication

1. In the left menu: **Build → Authentication → Get started**
2. Choose **Email/Password** → enable the first toggle → Save

   (The app uses hidden `name@ufcpickem.app` emails under the hood — your
   friends only ever see "pick your name, enter your PIN".)

### 3. Turn on Firestore

1. **Build → Firestore Database → Create database**
2. Pick the default location → **Start in production mode**
3. Open the **Rules** tab, delete what's there, paste the entire contents of
   `firestore.rules` (in this folder), then **Publish**

### 4. Connect the app

1. Project overview (gear icon) → **Project settings** → scroll to
   **Your apps** → click the **`</>` (Web)** icon
2. Nickname: `ufc-pickem` → **Register app** (skip Firebase Hosting checkbox)
3. It shows a `firebaseConfig = { ... }` block — copy just the `{ ... }` part
4. Open `firebase-config.js` in this folder and replace `null` with it:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza....",
     authDomain: "ufc-pickem.firebaseapp.com",
     projectId: "ufc-pickem",
     storageBucket: "ufc-pickem.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```

### 5. Put it on the internet (GitHub Pages — free)

You already use GitHub, so:

1. Create a new repository (e.g. `ufc-pickem`), push this `app/` folder's
   contents to it (the files, not the folder)
2. Repo **Settings → Pages** → Source: *Deploy from a branch* →
   Branch: `main`, folder `/ (root)` → Save
3. A couple minutes later your app is live at
   `https://<your-username>.github.io/ufc-pickem/`
4. Send the link to the guys

> Any static host works (Netlify, Cloudflare Pages, Firebase Hosting) —
> GitHub Pages is just the path of least resistance since you have git.

### 6. First run

1. Each player opens the link, taps their name, **creates a PIN** (6+ digits)
2. One of you goes to **Settings → Import 2019–2026 spreadsheet totals**
   (one time only — seeds the all-time leaderboard with the sheet history)
3. On the Events tab, tap **Find Events** — upcoming UFC cards appear
4. Open an event → **Import Card** pulls the fights from ESPN
5. Everybody makes picks (winner, round, method) before it starts
6. During/after the card, tap **Sync Results** — scoring happens automatically

---

## How it maps to the old spreadsheet

| Spreadsheet                        | App                                       |
| ---------------------------------- | ----------------------------------------- |
| Copy a tab, type fighter names     | "Find Events" + "Import Card" (ESPN)      |
| Winner / Rd / By columns per player| Tap a fighter, pick round & method        |
| Manually entering results          | "Sync Results" (manual override available)|
| CORRECT/INCORRECT formulas         | Automatic scoring                         |
| Bonus rows                         | Automatic (+1 round, +1 method)           |
| Leaderboard tab                    | Board tab (per-year + all-time, incl. legacy 2019–2026) |
| Perfects / No Hitters / Pick'em    | Tracked automatically (⚔ flag a fight as Pick'em in its ✎ editor) |

## Notes & tips

- **Install it like an app:** on your phone, open the link → browser menu →
  "Add to Home Screen". It's a PWA — full screen, with an icon.
- **Picks are hidden** from the other players until the event starts, then
  everything reveals along with live per-fight points.
- **Wrong result from ESPN?** Tap the ✎ on the fight and set the result
  manually — your version wins.
- **Renaming events** (Freedumb250 energy): open the event → ✎ Event.
- **Don't re-create past events** that are already counted in the imported
  spreadsheet totals — they'd double count. The app history starts fresh from
  today; the sheet history covers everything before.
- The 101 MB spreadsheet stays as your archive; nothing in it is modified.

# Admin Action Buttons

## Context

Follows [2026-09-10-admin-stats-and-controls-design.md](2026-09-10-admin-stats-and-controls-design.md), which added `/stats`, `/addadmin`, `/removeadmin`, `/myid`, `/performer_open`, `/performer_close` as typed Telegram commands. The user tested the whole thing live and confirmed it works, then asked for the same actions to be reachable as buttons — matching the existing pattern where admins already get an extra "📷 Сканер квитків (Адмін)" button on the reply keyboard shown by `/start`.

The user clarified mid-write: the add/remove-admin buttons don't need to avoid typing an ID — their purpose is discoverability ("so it's visible the add-admin command exists at all"), typing the ID manually afterward is fine. That simplified the design below considerably from an earlier draft that had the buttons drive a stateful conversational flow.

## Goal

Add a reply-keyboard button for each of the five actions the user named: statistics, add admin, remove admin, open performer sales, close performer sales — visible only to admins, alongside the existing "Купити квиток" / "Сканер квитків" buttons.

## Non-goals

- No permission tiers (separating "full admins" from "scanner-only admins"). The user asked how hard that would be, as a question, not as a firm request — it's addressed separately below as an assessment, not built here.
- No changes to the underlying `/stats`, `/addadmin`, `/removeadmin`, `/performer_open`, `/performer_close` logic — the buttons trigger the exact same code paths already implemented and tested.
- The typed commands keep working exactly as before; buttons are an additional way to reach the same actions, not a replacement.

## Design

### Keyboard

`bot.start`'s admin branch grows from one extra row to six:

```
[Купити квиток 🎟]
[📷 Сканер квитків (Адмін)]      ← admins only
[📊 Статистика]                  ← admins only
[➕ Додати адміна] [➖ Видалити адміна]   ← admins only, same row
[🟢 Увімкнути виступаючих] [🔴 Вимкнути виступаючих]   ← admins only, same row
```

### Statistics / performer toggle buttons — direct triggers

"📊 Статистика", "🟢 Увімкнути виступаючих", "🔴 Вимкнути виступаючих" need no extra input — pressing them does exactly what `/stats`, `/performer_open`, `/performer_close` already do. Implemented as `bot.hears(<exact button label>, ...)` handlers that call the same logic the existing commands call (not new logic — same `isAdmin` gate, same `computeStats`/`formatStatsMessage`/`loadConfigDB`/`saveConfigDB` calls).

### Add/remove admin buttons — discoverability only, no new input flow

Per the user's clarification, these two buttons don't need to avoid manual ID entry — they exist so an admin can see the add/remove-admin actions exist at all, and their job is just to remind the admin of the exact command to type next. No new conversational state, no inline keyboards, no persistence.

- "➕ Додати адміна" → replies with usage instructions: how to add an admin (`/addadmin <telegram_id>`) and where to get someone's ID (`/myid`, run by the person being added).
- "➖ Видалити адміна" → replies with usage instructions (`/removeadmin <telegram_id>`) **plus the current admin list**, so the admin doesn't have to go look it up elsewhere — a small, free convenience since `loadAdminsDB()` is already being called for the `isAdmin` gate on this handler.

Both handlers are plain `bot.hears(<exact button label>, ...)` — no different in kind from the Statistics/performer-toggle handlers, just replying with text instead of executing an action.

### Everything else unchanged

The five button handlers reuse existing store functions (`loadAdminsDB`, `saveAdminsDB`, `loadConfigDB`, `saveConfigDB`, `loadDB`, `loadReqDB`) and existing pure functions (`computeStats`, `formatStatsMessage`, `isValidTelegramId`, `addAdminId`, `removeAdminId`) from `logic.js` — no new persistence files, no new pure-function logic to unit test beyond what Tasks 1–2 of the prior plan already cover. The typed commands (`/stats`, `/addadmin`, etc.) stay exactly as they are.

## Assessment: separating "full admin" from "scanner-only admin"

Not built in this spec — answering the question asked.

It's a moderate change, not a small one, because it's not just an access-list split — it changes what the bot needs to know about each admin: today `admins.json` is a flat array of IDs with one permission level; a tier split needs each entry to carry a role (e.g. `{ id, role: 'full' | 'scanner' }`), every `isAdmin(...)` call site needs to become "is this the *right kind* of admin for this action," and every current admin-gated action needs a decision about which tier it requires:

- Scanning tickets at the door (`SCAN:` webapp data) — presumably scanner-only should be allowed, that's the point.
- Confirming/rejecting payment receipts (`confirm_`/`reject_` actions) — unclear: is a door-scanner also trusted to approve payments, or should that stay full-admin-only?
- `/stats`, `/performer_open`/`close`, `/addadmin`/`removeadmin` — presumably full-admin-only.

Those three open questions are exactly the kind of thing that needs the user's input before building — guessing wrong either locks scanner-only staff out of something they need at the door, or hands door staff more access than intended. Worth a short follow-up conversation, not a large engineering effort once answered — the plumbing (role field, updated `isAdmin`-equivalent checks) is a few hours of work following the same pattern this whole plan already established.

## Testing

Same shape as the prior plan: the button-triggered logic is identical to already-unit-tested command logic, so no new `logic.js` unit tests are needed. Verification is a live Telegram smoke test (buttons appear only for admins, each button does what its command equivalent does, the two text-reply buttons show correct usage instructions) — the user already has a working local test setup (`BOT_TOKEN` + `node bot.js` in this worktree) from the prior round.

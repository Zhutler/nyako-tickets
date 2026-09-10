# Nyako-kon Bot: Ticket Monitoring & Admin Controls

## Context

The Telegram bot (`bot.js`) sells convention tickets via a Telegram WebApp (`app.html`), stores
tickets/pending-payment requests as JSON files on a Railway persistent volume (`/data`), and
falls back to local files when `/data` doesn't exist (used for local dev/testing on this
machine, since Windows has no `/data`).

Two pain points from the organizers:

1. No way to check how many tickets have sold / been redeemed without opening the raw JSON file.
2. Adding or removing an admin requires editing the hardcoded `ADMIN_IDS` array in `bot.js` and
   redeploying.

A third need surfaced during design: "Виступаючий" (performer) tickets go on sale later than
regular tickets, and organizers want to flip that on/off without a code change.

`app.html`/`scanner.html` are static pages hosted on GitHub Pages, separate from the bot's
deploy. Nothing in this design requires publishing changes to those pages — all three features
are handled bot-side.

## Goals

- `/stats` command (admin-only): summary of tickets sold, broken down by type, redemption count,
  total revenue, pending receipts awaiting approval, and performer-ticket sale status.
- `/addadmin <id>`, `/removeadmin <id>`, `/myid` commands: manage the admin list at runtime,
  persisted to disk, no redeploy needed.
- `/performer_open`, `/performer_close` commands: gate purchases of "Для виступаючих" tickets
  without touching `app.html`.
- All new logic must be testable locally without a live Telegram bot token, then smoke-tested
  live before anything is pushed to GitHub.

## Non-goals

- No web dashboard. No changes to `app.html` / `scanner.html`.
- No new dependency (no need for `express`/`multer` here — out of scope for this change).
- No migration of ticket/request storage format.

## Data model changes

Two new persistent JSON files, following the exact `loadDB`/`saveDB` pattern already used for
`tickets.json` and `requests.json` (prefer `/data/<file>`, fall back to a local file next to
`bot.js`):

- **`admins.json`** — array of admin Telegram ID strings, e.g. `["789355423", "821782817", ...]`.
  - **Migration on first run:** if the file doesn't exist, it's created and seeded from the
    current hardcoded `ADMIN_IDS` constant, so nobody loses access when this ships.
  - All existing `ADMIN_IDS.includes(...)` permission checks switch to reading this file.
- **`config.json`** — small settings object: `{ "performerTicketsOpen": true }`.
  - Defaults to `true` on first run (matches current behavior — sales are open today).

## Commands

All admin-only commands reply with a "Тільки для оргів!" style message (matching existing style)
if called by a non-admin.

### `/stats`
Reads `tickets.json` + `requests.json`, computes and replies with:
```
📊 Nyako-kon — статистика

Продано квитків: 12
 • Класичний: 8 (2400 ₴)
 • Для виступаючих: 4 (1000 ₴, 🔴 закрито)

Погашено на вході: 5 / 12
Загальна сума: 3400 ₴
Очікують підтвердження: 2 чека
```
- Per-type breakdown uses the ticket's stored `type` field.
- Revenue reuses the existing price mapping (300 ₴ Класичний / 250 ₴ else) — no price stored per
  ticket today, so it's derived the same way `bot.on('message')` derives it now.
- "Очікують підтвердження" counts `requests.json` entries that are transactions (`tx_...` keys),
  ignoring in-progress `draft_...` entries (those aren't a submitted receipt yet).
- Performer-ticket status line shows 🟢 відкрито / 🔴 закрито based on `config.json`.

### `/myid`
No admin check. Replies with the caller's numeric Telegram ID, e.g. `Твій ID: 123456789`. Lets a
new admin self-serve the ID an existing admin needs to run `/addadmin`.

### `/addadmin <id>`
Admin-only. Validates `<id>` is numeric. Adds to `admins.json` if not already present
(no duplicates). Confirms with the new admin count.

### `/removeadmin <id>`
Admin-only. Refuses (with an explanatory reply) if `<id>` is not currently an admin, or if
removing it would leave zero admins — prevents accidental lockout.

### `/performer_open` / `/performer_close`
Admin-only. Set `config.json`'s `performerTicketsOpen` to `true`/`false`. Confirms new state.

## Enforcement point for the performer-ticket toggle

In the existing `bot.on('message')` handler, where `web_app_data` is parsed into `{ ticket,
count }`: if `data.ticket === 'Для виступаючих'` and `performerTicketsOpen` is `false`, reply
`«Продаж квитків для виступаючих ще не відкрито»` and skip creating the draft — same place the
price/draft logic already lives. The purchase button in `app.html` stays visible at all times;
this is enforced only when the bot receives the selection.

## Testability

Extract the new pure logic (stats computation, admin add/remove, config read/write validation)
into plain functions that take already-loaded DB objects and return a result — no direct
Telegram/filesystem calls inside them. This lets a throwaway local Node script exercise them
against fixture data (e.g. a copy of the existing sample `tickets.json`) without a bot token.

## Rollout / verification plan

1. Implement in `D:\NyakoTICKETSbot-dev` (this clone), against local fallback files — nothing
   touches the old `D:\NyakoTICKETSbot` copy or Railway.
2. Run the pure-function sanity check against fixture data.
3. Run `node bot.js` locally with a real (test) bot token if available, and manually exercise
   `/stats`, `/myid`, `/addadmin`, `/removeadmin`, `/performer_open`, `/performer_close`, and a
   performer-ticket purchase attempt while closed, in actual Telegram chat.
4. Nothing is pushed/committed to the GitHub remote until the user explicitly approves it.

## Edge cases handled

- First run after deploy: `admins.json`/`config.json` auto-created with safe defaults —
  no manual setup step, no access lost.
- `/removeadmin` can't remove the last admin.
- `/addadmin`/`/removeadmin` reject non-numeric IDs and no-op on duplicate add / not-found
  remove, with a clear reply either way.
- `/stats` on an empty `tickets.json`/`requests.json` shows zeros rather than erroring.

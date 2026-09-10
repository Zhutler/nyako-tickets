# Admin Action Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reply-keyboard buttons for the five admin actions the user asked for (Статистика, Додати адміна, Видалити адміна, Увімкнути виступаючих, Вимкнути виступаючих) to the Nyako-kon Telegram bot, alongside the existing typed commands, visible only to admins.

**Architecture:** The three actions that need no extra input (stats, performer-open, performer-close) get their command bodies extracted into named handler functions, then both the existing `bot.command(...)` and a new `bot.hears(<button label>, ...)` call the same function — one behavior, two entry points. The two admin-management actions (add/remove admin) stay typed-only for the actual ID entry per the user's explicit call; their buttons just reply with usage instructions (for add) or usage instructions plus the current admin list (for remove) — pure discoverability, no new state or logic.

**Tech Stack:** Node.js, Telegraf 4.x (`bot.hears`, `Markup.keyboard`). No new dependencies, no new persisted files, no new `logic.js` functions — every button reuses `logic.js` functions already shipped and unit-tested by the prior plan (`docs/superpowers/plans/2026-09-10-admin-stats-and-controls.md`).

## Global Constraints

- All user-facing bot replies must be in Ukrainian, matching the existing style in `bot.js`.
- No new npm dependencies.
- No changes to `app.html` or `scanner.html`.
- No new persisted files and no new `logic.js` functions — this feature is pure `bot.js` wiring over existing, already-tested logic.
- The existing typed commands (`/stats`, `/addadmin`, `/removeadmin`, `/performer_open`, `/performer_close`, `/myid`) must keep working exactly as before — buttons are an additional way to reach the same actions, never a replacement.
- Nothing gets pushed or committed to the GitHub remote as part of this plan — all work stays in the local worktree/branch until the user explicitly approves a push (same standing instruction as the prior plan).

---

## File Structure

- **Modify `bot.js`** only. No other file changes.
  - Extract `/stats`, `/performer_open`, `/performer_close`'s command bodies into three named functions (`sendStats`, `openPerformerSales`, `closePerformerSales`), each still doing its own `isAdmin` check first.
  - Extend `bot.start`'s admin-only keyboard rows from one (`📷 Сканер квитків`) to five more.
  - Add five `bot.hears(...)` handlers: three call the extracted named functions, two (add/remove admin) are new, self-contained, reply-only handlers.

---

### Task 1: Extract command bodies into named functions (no behavior change)

**Files:**
- Modify: `bot.js:264-289` (the `/performer_open`, `/performer_close`, `/stats` command definitions)

**Interfaces:**
- Consumes: `isAdmin`, `loadConfigDB`, `saveConfigDB`, `loadDB`, `loadReqDB`, `computeStats`, `formatStatsMessage` — all already defined earlier in `bot.js` / imported from `logic.js`.
- Produces: `sendStats(ctx)`, `openPerformerSales(ctx)`, `closePerformerSales(ctx)` — plain functions taking a Telegraf `ctx`, used by Task 2's `bot.hears(...)` handlers in addition to the `bot.command(...)` registrations already here.

This task is a pure refactor: same behavior, same messages, same admin gate — just named functions instead of inline arrow functions, so Task 2 can wire the same behavior to buttons without duplicating the bodies.

- [ ] **Step 1: Replace the three command definitions**

In `bot.js`, replace:

```javascript
bot.command('performer_open', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = true;
    saveConfigDB(config);
    ctx.reply('🟢 Продаж квитків для виступаючих відкрито.');
});

bot.command('performer_close', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = false;
    saveConfigDB(config);
    ctx.reply('🔴 Продаж квитків для виступаючих закрито.');
});

bot.command('stats', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const ticketsDb = loadDB();
    const requestsDb = loadReqDB();
    const config = loadConfigDB();
    const stats = computeStats(ticketsDb, requestsDb);

    ctx.reply(formatStatsMessage(stats, config.performerTicketsOpen));
});
```

with:

```javascript
function openPerformerSales(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = true;
    saveConfigDB(config);
    ctx.reply('🟢 Продаж квитків для виступаючих відкрито.');
}

function closePerformerSales(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = false;
    saveConfigDB(config);
    ctx.reply('🔴 Продаж квитків для виступаючих закрито.');
}

function sendStats(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const ticketsDb = loadDB();
    const requestsDb = loadReqDB();
    const config = loadConfigDB();
    const stats = computeStats(ticketsDb, requestsDb);

    ctx.reply(formatStatsMessage(stats, config.performerTicketsOpen));
}

bot.command('performer_open', openPerformerSales);
bot.command('performer_close', closePerformerSales);
bot.command('stats', sendStats);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check bot.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all 15 tests still pass (this task doesn't touch `logic.js`, so this just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "Extract stats/performer-toggle command bodies into named functions"
```

---

### Task 2: Add admin action buttons

**Files:**
- Modify: `bot.js:74-82` (`bot.start`'s keyboard)
- Modify: `bot.js` (before `bot.catch(...)`, add five `bot.hears(...)` handlers)

**Interfaces:**
- Consumes: `sendStats`, `openPerformerSales`, `closePerformerSales` from Task 1; `isAdmin`, `loadAdminsDB` already defined earlier in `bot.js`.

- [ ] **Step 1: Extend the admin keyboard**

In `bot.js`, replace:

```javascript
    const userIsAdmin = isAdmin(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin) buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
```

with:

```javascript
    const userIsAdmin = isAdmin(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin) {
        buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
        buttons.push(['📊 Статистика']);
        buttons.push(['➕ Додати адміна', '➖ Видалити адміна']);
        buttons.push(['🟢 Увімкнути виступаючих', '🔴 Вимкнути виступаючих']);
    }
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
```

- [ ] **Step 2: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 3: Add the five button handlers**

Immediately before `bot.catch((err, ctx) => {`, add:

```javascript
bot.hears('📊 Статистика', sendStats);
bot.hears('🟢 Увімкнути виступаючих', openPerformerSales);
bot.hears('🔴 Вимкнути виступаючих', closePerformerSales);

bot.hears('➕ Додати адміна', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    ctx.reply('Щоб додати адміна, напиши команду:\n/addadmin <telegram_id>\n\nID можна дізнатись командою /myid — нехай новий адмін напише її сам і надішле тобі результат.');
});

bot.hears('➖ Видалити адміна', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const admins = loadAdminsDB();
    ctx.reply(`Щоб видалити адміна, напиши команду:\n/removeadmin <telegram_id>\n\nПоточні адміни:\n${admins.join('\n')}`);
});

```

- [ ] **Step 4: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: all 15 tests still pass (this task doesn't touch `logic.js` either).

- [ ] **Step 6: Commit**

```bash
git add bot.js
git commit -m "Add admin action buttons to the reply keyboard"
```

---

### Task 3: Local live smoke test

Same shape as the prior plan's Task 7 — needs a human with a real Telegram bot token, no subagent can complete it.

**Files:** none (verification only).

- [ ] **Step 1: Run the bot locally**

From the worktree root, with a `BOT_TOKEN` the user provides (the same one used for the prior plan's live test is fine — same offline-Railway situation applies):

```bash
BOT_TOKEN="<token>" node bot.js
```

- [ ] **Step 2: Manually verify in Telegram, as an admin account**

- Send `/start`. Confirm the keyboard now shows, below "Купити квиток" and "📷 Сканер квитків (Адмін)": a "📊 Статистика" row, an "➕ Додати адміна" / "➖ Видалити адміна" row, and a "🟢 Увімкнути виступаючих" / "🔴 Вимкнути виступаючих" row.
- Send `/start` from a non-admin account (or temporarily remove yourself as admin via `/removeadmin` on a second admin account, if more than one exists) — confirm only "Купити квиток" appears, none of the admin buttons.
- Tap "📊 Статистика" — confirm it replies with the same summary `/stats` would.
- Tap "🟢 Увімкнути виступаючих" then "🔴 Вимкнути виступаючих" — confirm each replies exactly like the equivalent typed command, and that a "Для виступаючих" purchase attempt is blocked/allowed accordingly (same behavior already verified for the typed commands in the prior plan — this just confirms the button path produces identical behavior).
- Tap "➕ Додати адміна" — confirm it replies with usage instructions mentioning `/addadmin` and `/myid`.
- Tap "➖ Видалити адміна" — confirm it replies with usage instructions mentioning `/removeadmin` and lists the current admin IDs.

- [ ] **Step 3: Stop the local bot and report results**

Press `Ctrl+C`. Report which checks passed and any that didn't.

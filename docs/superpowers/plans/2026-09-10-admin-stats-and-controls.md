# Ticket Monitoring & Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/stats` command, runtime admin management (`/addadmin`, `/removeadmin`, `/myid`), and a performer-ticket sales toggle (`/performer_open`, `/performer_close`) to the Nyako-kon Telegram bot, with no code-editing required for future admin/sales changes.

**Architecture:** Pure computation/validation logic (stats math, admin list add/remove, ID validation) lives in a new `logic.js` module with no filesystem or Telegram dependencies, so it can be unit-tested with plain Node scripts. `bot.js` gains two new JSON-backed stores (`admins.json`, `config.json`) that follow the exact `loadDB`/`saveDB` pattern already used for `tickets.json`/`requests.json`, and wires the pure logic into new Telegraf commands.

**Tech Stack:** Node.js, Telegraf 4.x, Node's built-in `assert/strict` for tests (no new dependency).

## Global Constraints

- No new npm dependencies (spec Non-goals: no `express`/`multer` usage added).
- No changes to `app.html` or `scanner.html` (spec Non-goals).
- All user-facing bot replies must be in Ukrainian, matching the existing style in `bot.js` (e.g. "Тільки для оргів!", "Помилка даних. Спробуй ще раз.").
- New persistent files (`admins.json`, `config.json`) must follow the existing `loadDB`/`saveDB` pattern exactly: prefer `/data/<file>`, fall back to a local file next to `bot.js` when `/data` doesn't exist.
- `admins.json` must be seeded from the current hardcoded admin list on first run — no admin may lose access when this ships (spec Data model changes).
- `/removeadmin` must refuse to remove the last remaining admin (spec Edge cases).
- Nothing gets pushed or committed to the GitHub remote as part of this plan — all work stays in the local clone at `D:\NyakoTICKETSbot-dev` until the user explicitly approves a push.

---

## File Structure

- **Create `logic.js`** — pure functions: `computeStats`, `formatStatsMessage`, `isValidTelegramId`, `addAdminId`, `removeAdminId`. No `fs`/`telegraf` imports.
- **Create `test/logic.test.js`** — Node `assert/strict` script exercising every `logic.js` function against fixture data. Run with `node test/logic.test.js`.
- **Modify `bot.js`** — import `logic.js`, add `admins.json`/`config.json` load/save + migration, add `isAdmin()` helper, add new command handlers, enforce the performer-ticket gate in the existing `web_app_data` handler, replace the three `ADMIN_IDS.includes(...)` checks.
- **Modify `package.json`** — point the `test` script at `node test/logic.test.js`.

---

### Task 1: Stats computation logic

**Files:**
- Create: `logic.js`
- Create: `test/logic.test.js`

**Interfaces:**
- Produces: `computeStats(ticketsDb, requestsDb)` → `{ totalSold: number, byType: { [type: string]: { count: number, revenue: number } }, redeemed: number, totalRevenue: number, pendingCount: number }`
- Produces: `formatStatsMessage(stats, performerOpen)` → `string`

- [ ] **Step 1: Write the failing test**

Create `test/logic.test.js`:

```javascript
const assert = require('assert/strict');
const { computeStats, formatStatsMessage } = require('../logic');

function test(name, fn) {
    try {
        fn();
        console.log(`PASS: ${name}`);
    } catch (e) {
        console.error(`FAIL: ${name}`);
        console.error(e);
        process.exitCode = 1;
    }
}

test('computeStats: empty DBs return zeros', () => {
    const stats = computeStats({}, {});
    assert.deepEqual(stats, {
        totalSold: 0,
        byType: {},
        redeemed: 0,
        totalRevenue: 0,
        pendingCount: 0
    });
});

test('computeStats: counts tickets by type, revenue, and redemption', () => {
    const ticketsDb = {
        't1': { used: true, type: 'Класичний' },
        't2': { used: false, type: 'Класичний' },
        't3': { used: false, type: 'Для виступаючих' }
    };
    const requestsDb = {
        'draft_111': { ticketType: 'Класичний', count: 1 },
        'tx_222': { userId: 222, ticketType: 'Класичний', count: 1, adminMsgs: [] },
        'tx_333': { userId: 333, ticketType: 'Для виступаючих', count: 2, adminMsgs: [] }
    };
    const stats = computeStats(ticketsDb, requestsDb);
    assert.deepEqual(stats, {
        totalSold: 3,
        byType: {
            'Класичний': { count: 2, revenue: 600 },
            'Для виступаючих': { count: 1, revenue: 250 }
        },
        redeemed: 1,
        totalRevenue: 850,
        pendingCount: 2
    });
});

test('formatStatsMessage: renders full summary with performer status', () => {
    const stats = {
        totalSold: 12,
        byType: {
            'Класичний': { count: 8, revenue: 2400 },
            'Для виступаючих': { count: 4, revenue: 1000 }
        },
        redeemed: 5,
        totalRevenue: 3400,
        pendingCount: 2
    };
    const msg = formatStatsMessage(stats, false);
    assert.ok(msg.includes('Продано квитків: 12'));
    assert.ok(msg.includes('Класичний: 8 (2400 ₴)'));
    assert.ok(msg.includes('Для виступаючих: 4 (1000 ₴, 🔴 закрито)'));
    assert.ok(msg.includes('Погашено на вході: 5 / 12'));
    assert.ok(msg.includes('Загальна сума: 3400 ₴'));
    assert.ok(msg.includes('Очікують підтвердження: 2'));
});

test('formatStatsMessage: shows open status for performer tickets', () => {
    const stats = {
        totalSold: 1,
        byType: { 'Для виступаючих': { count: 1, revenue: 250 } },
        redeemed: 0,
        totalRevenue: 250,
        pendingCount: 0
    };
    const msg = formatStatsMessage(stats, true);
    assert.ok(msg.includes('🟢 відкрито'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/logic.test.js`
Expected: `Error: Cannot find module '../logic'` (the module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `logic.js`:

```javascript
function priceFor(ticketType) {
    return ticketType === 'Класичний' ? 300 : 250;
}

function computeStats(ticketsDb, requestsDb) {
    const byType = {};
    let redeemed = 0;

    for (const ticket of Object.values(ticketsDb)) {
        if (!byType[ticket.type]) byType[ticket.type] = { count: 0, revenue: 0 };
        byType[ticket.type].count += 1;
        byType[ticket.type].revenue += priceFor(ticket.type);
        if (ticket.used) redeemed += 1;
    }

    const totalSold = Object.keys(ticketsDb).length;
    const totalRevenue = Object.values(byType).reduce((sum, t) => sum + t.revenue, 0);
    const pendingCount = Object.keys(requestsDb).filter(key => key.startsWith('tx_')).length;

    return { totalSold, byType, redeemed, totalRevenue, pendingCount };
}

function formatStatsMessage(stats, performerOpen) {
    const classic = stats.byType['Класичний'] || { count: 0, revenue: 0 };
    const performer = stats.byType['Для виступаючих'] || { count: 0, revenue: 0 };
    const performerStatus = performerOpen ? '🟢 відкрито' : '🔴 закрито';

    return `📊 Nyako-kon — статистика\n\n` +
        `Продано квитків: ${stats.totalSold}\n` +
        ` • Класичний: ${classic.count} (${classic.revenue} ₴)\n` +
        ` • Для виступаючих: ${performer.count} (${performer.revenue} ₴, ${performerStatus})\n\n` +
        `Погашено на вході: ${stats.redeemed} / ${stats.totalSold}\n` +
        `Загальна сума: ${stats.totalRevenue} ₴\n` +
        `Очікують підтвердження: ${stats.pendingCount} чека`;
}

module.exports = { computeStats, formatStatsMessage, priceFor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/logic.test.js`
Expected: four `PASS:` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "Add stats computation and formatting logic"
```

---

### Task 2: Admin list management logic

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 (independent pure functions in the same module).
- Produces: `isValidTelegramId(idStr)` → `boolean`
- Produces: `addAdminId(adminIds, idStr)` → `{ adminIds: string[], added: boolean }`
- Produces: `removeAdminId(adminIds, idStr)` → `{ adminIds: string[], removed: boolean, reason: null | 'not_found' | 'last_admin' }`

- [ ] **Step 1: Write the failing test**

Append to `test/logic.test.js` (change the top import line to include the new functions):

```javascript
const { computeStats, formatStatsMessage, isValidTelegramId, addAdminId, removeAdminId } = require('../logic');
```

Add these test cases at the end of the file:

```javascript
test('isValidTelegramId: accepts digit-only strings', () => {
    assert.equal(isValidTelegramId('123456789'), true);
});

test('isValidTelegramId: rejects non-numeric or empty strings', () => {
    assert.equal(isValidTelegramId('abc'), false);
    assert.equal(isValidTelegramId(''), false);
    assert.equal(isValidTelegramId('123abc'), false);
});

test('addAdminId: adds a new id', () => {
    const result = addAdminId(['111', '222'], '333');
    assert.deepEqual(result, { adminIds: ['111', '222', '333'], added: true });
});

test('addAdminId: no-ops on duplicate', () => {
    const result = addAdminId(['111', '222'], '111');
    assert.deepEqual(result, { adminIds: ['111', '222'], added: false });
});

test('removeAdminId: removes an existing id', () => {
    const result = removeAdminId(['111', '222'], '111');
    assert.deepEqual(result, { adminIds: ['222'], removed: true, reason: null });
});

test('removeAdminId: refuses to remove the last admin', () => {
    const result = removeAdminId(['111'], '111');
    assert.deepEqual(result, { adminIds: ['111'], removed: false, reason: 'last_admin' });
});

test('removeAdminId: reports not_found for unknown id', () => {
    const result = removeAdminId(['111', '222'], '999');
    assert.deepEqual(result, { adminIds: ['111', '222'], removed: false, reason: 'not_found' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/logic.test.js`
Expected: `TypeError: isValidTelegramId is not a function` (or similar — the exports don't exist yet).

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js`, above the final `module.exports` line:

```javascript
function isValidTelegramId(idStr) {
    return typeof idStr === 'string' && /^\d+$/.test(idStr);
}

function addAdminId(adminIds, idStr) {
    if (adminIds.includes(idStr)) return { adminIds, added: false };
    return { adminIds: [...adminIds, idStr], added: true };
}

function removeAdminId(adminIds, idStr) {
    if (!adminIds.includes(idStr)) return { adminIds, removed: false, reason: 'not_found' };
    if (adminIds.length === 1) return { adminIds, removed: false, reason: 'last_admin' };
    return { adminIds: adminIds.filter(id => id !== idStr), removed: true, reason: null };
}
```

Update the `module.exports` line to:

```javascript
module.exports = { computeStats, formatStatsMessage, priceFor, isValidTelegramId, addAdminId, removeAdminId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/logic.test.js`
Expected: eleven `PASS:` lines total, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "Add admin id validation and list management logic"
```

---

### Task 3: Runtime admin storage and commands

**Files:**
- Modify: `bot.js:1-17` (imports and constants)
- Modify: `bot.js:36-39` (after `saveReqDB`, add new store functions)
- Modify: `bot.js:41-49` (`bot.start` handler)
- Modify: `bot.js:127-128` (confirm handler admin check)
- Modify: `bot.js:167-168` (reject handler admin check)
- Modify: `bot.js:185` (before `bot.launch()`, add new commands)

**Interfaces:**
- Consumes: `isValidTelegramId`, `addAdminId`, `removeAdminId` from `logic.js` (Task 2).
- Produces: `isAdmin(idStr)` → `boolean`, used by later tasks (Task 4, Task 5) instead of `ADMIN_IDS.includes(...)`.
- Produces: `loadAdminsDB()` / `saveAdminsDB(adminIds)`, following the same shape as `loadDB`/`saveDB`.

- [ ] **Step 1: Update imports and constants**

In `bot.js`, replace lines 1-17:

```javascript
const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Бот берет токен из скрытых настроек Railway
const bot = new Telegraf(process.env.BOT_TOKEN); 
const ADMIN_IDS = ['789355423', '821782817', '678439277', '1672507362', '1089717768', '8595175426']; // Не забудь айди Хироши
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=5';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

const dbPath = '/data/tickets.json';
const reqDbPath = '/data/requests.json';

if (!fs.existsSync('/data')) {
    try { fs.mkdirSync('/data'); } catch (e) { console.log('Папка /data відсутня'); }
}
```

with:

```javascript
const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { isValidTelegramId, addAdminId, removeAdminId } = require('./logic');

// Бот берет токен из скрытых настроек Railway
const bot = new Telegraf(process.env.BOT_TOKEN); 
const DEFAULT_ADMIN_IDS = ['789355423', '821782817', '678439277', '1672507362', '1089717768', '8595175426']; // Використовується лише для первинної міграції admins.json
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=5';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

const dbPath = '/data/tickets.json';
const reqDbPath = '/data/requests.json';
const adminsDbPath = '/data/admins.json';

if (!fs.existsSync('/data')) {
    try { fs.mkdirSync('/data'); } catch (e) { console.log('Папка /data відсутня'); }
}
```

- [ ] **Step 2: Add admin store functions**

Directly after the existing `saveReqDB` function (originally lines 36-39), insert:

```javascript
function loadAdminsDB() {
    const currentPath = fs.existsSync(adminsDbPath) ? adminsDbPath : path.join(__dirname, 'admins.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify(DEFAULT_ADMIN_IDS));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveAdminsDB(adminIds) {
    const currentPath = fs.existsSync('/data') ? adminsDbPath : path.join(__dirname, 'admins.json');
    fs.writeFileSync(currentPath, JSON.stringify(adminIds, null, 2));
}

function isAdmin(idStr) {
    return loadAdminsDB().includes(idStr);
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check bot.js`
Expected: no output (syntax OK). This does not require `BOT_TOKEN` since `--check` doesn't execute the file.

- [ ] **Step 4: Replace admin checks and add id-management commands**

In `bot.start`, replace:

```javascript
    const isAdmin = ADMIN_IDS.includes(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (isAdmin) buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
```

with:

```javascript
    const userIsAdmin = isAdmin(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin) buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
```

In the `confirm_` action handler, replace:

```javascript
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return ctx.answerCbQuery('Тільки для оргів!');
```

with:

```javascript
    if (!isAdmin(ctx.from.id.toString())) return ctx.answerCbQuery('Тільки для оргів!');
```

In the `reject_` action handler, replace:

```javascript
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;
```

with:

```javascript
    if (!isAdmin(ctx.from.id.toString())) return;
```

Immediately before `bot.launch();`, add:

```javascript
bot.command('myid', (ctx) => {
    ctx.reply(`Твій ID: ${ctx.from.id}`);
});

bot.command('addadmin', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId || !isValidTelegramId(targetId)) return ctx.reply('Використання: /addadmin <telegram_id>');

    const admins = loadAdminsDB();
    const result = addAdminId(admins, targetId);
    if (!result.added) return ctx.reply('Цей користувач вже адмін.');

    saveAdminsDB(result.adminIds);
    ctx.reply(`✅ Додано адміна ${targetId}. Всього адмінів: ${result.adminIds.length}`);
});

bot.command('removeadmin', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId || !isValidTelegramId(targetId)) return ctx.reply('Використання: /removeadmin <telegram_id>');

    const admins = loadAdminsDB();
    const result = removeAdminId(admins, targetId);
    if (!result.removed) {
        if (result.reason === 'last_admin') return ctx.reply('❌ Не можна видалити останнього адміна.');
        return ctx.reply('Цей ID не є адміном.');
    }

    saveAdminsDB(result.adminIds);
    ctx.reply(`✅ Видалено адміна ${targetId}. Всього адмінів: ${result.adminIds.length}`);
});
```

- [ ] **Step 5: Verify syntax again**

Run: `node --check bot.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add bot.js
git commit -m "Wire runtime admin management into the bot"
```

---

### Task 4: Performer-ticket sales toggle

**Files:**
- Modify: `bot.js` (constants section, after `adminsDbPath`)
- Modify: `bot.js` (after `saveAdminsDB`/`isAdmin`, add config store functions)
- Modify: `bot.js` (`bot.on('message')` handler — the `web_app_data` JSON branch)
- Modify: `bot.js` (before `bot.launch()`, add two new commands)

**Interfaces:**
- Consumes: `isAdmin` from Task 3.
- Produces: `loadConfigDB()` / `saveConfigDB(config)` → `config.performerTicketsOpen: boolean`, used by Task 5's `/stats`.

- [ ] **Step 1: Add config path constant**

Add a line after the `adminsDbPath` constant added in Task 3:

```javascript
const configDbPath = '/data/config.json';
```

- [ ] **Step 2: Add config store functions**

Directly after the `isAdmin` function added in Task 3, insert:

```javascript
function loadConfigDB() {
    const currentPath = fs.existsSync(configDbPath) ? configDbPath : path.join(__dirname, 'config.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify({ performerTicketsOpen: true }));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveConfigDB(config) {
    const currentPath = fs.existsSync('/data') ? configDbPath : path.join(__dirname, 'config.json');
    fs.writeFileSync(currentPath, JSON.stringify(config, null, 2));
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 4: Enforce the gate in the web_app_data handler**

In `bot.on('message')`, inside the `try { const data = JSON.parse(rawData); ... }` block, replace:

```javascript
        try {
            const data = JSON.parse(rawData);
            const userId = ctx.from.id;
            
            const price = data.ticket === 'Класичний' ? 300 : 250;
```

with:

```javascript
        try {
            const data = JSON.parse(rawData);
            const userId = ctx.from.id;

            if (data.ticket === 'Для виступаючих') {
                const config = loadConfigDB();
                if (!config.performerTicketsOpen) {
                    return ctx.reply('Продаж квитків для виступаючих ще не відкрито.');
                }
            }

            const price = data.ticket === 'Класичний' ? 300 : 250;
```

- [ ] **Step 5: Add the toggle commands**

Before `bot.launch();`, add (alongside the commands added in Task 3):

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
```

- [ ] **Step 6: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add bot.js
git commit -m "Add performer ticket sales toggle"
```

---

### Task 5: /stats command

**Files:**
- Modify: `bot.js` (imports — extend the `logic.js` destructure)
- Modify: `bot.js` (before `bot.launch()`, add the `/stats` command)

**Interfaces:**
- Consumes: `computeStats`, `formatStatsMessage` from `logic.js` (Task 1); `isAdmin`, `loadDB`, `loadReqDB` from earlier tasks/existing code; `loadConfigDB` from Task 4.

- [ ] **Step 1: Extend the logic.js import**

Replace:

```javascript
const { isValidTelegramId, addAdminId, removeAdminId } = require('./logic');
```

with:

```javascript
const { computeStats, formatStatsMessage, isValidTelegramId, addAdminId, removeAdminId } = require('./logic');
```

- [ ] **Step 2: Add the /stats command**

Before `bot.launch();`, add (alongside the commands from Tasks 3 and 4):

```javascript
bot.command('stats', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const ticketsDb = loadDB();
    const requestsDb = loadReqDB();
    const config = loadConfigDB();
    const stats = computeStats(ticketsDb, requestsDb);

    ctx.reply(formatStatsMessage(stats, config.performerTicketsOpen));
});
```

- [ ] **Step 3: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "Add /stats admin command"
```

---

### Task 6: Wire up the test script

**Files:**
- Modify: `package.json:6-8`

**Interfaces:**
- Consumes: `test/logic.test.js` from Tasks 1-2.

- [ ] **Step 1: Update the test script**

In `package.json`, replace:

```json
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
```

with:

```json
  "scripts": {
    "test": "node test/logic.test.js"
  },
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: eleven `PASS:` lines, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "Wire logic tests into npm test"
```

---

### Task 7: Local live smoke test

This task needs a human with access to a Telegram bot token — no subagent can complete it, since it requires interacting with Telegram directly. Whoever runs this plan should pause here and do this step themselves (or with the user watching).

**Files:** none (verification only).

- [ ] **Step 1: Confirm a test bot token is available**

Ask the user for a `BOT_TOKEN` safe to use for local testing (ideally a separate test bot via @BotFather, not the production one, so test data doesn't reach real buyers). Do not proceed to Step 2 without one.

- [ ] **Step 2: Run the bot locally**

From `D:\NyakoTICKETSbot-dev`, run (PowerShell):

```powershell
$env:BOT_TOKEN = "<the test token>"; node bot.js
```

Since `/data` doesn't exist on this machine, all stores (`tickets.json`, `requests.json`, `admins.json`, `config.json`) fall back to local files in the project folder — confirm `admins.json` appears after the first admin-checking interaction and contains the seeded `DEFAULT_ADMIN_IDS`.

- [ ] **Step 3: Manually verify each new command in Telegram**

Using the test bot in Telegram (as a user whose ID is in `DEFAULT_ADMIN_IDS`, or added via `/myid` + `/addadmin`):

- `/myid` replies with the caller's numeric ID.
- `/stats` (as admin) replies with the summary; matches the counts in the local `tickets.json`/`requests.json`.
- `/stats` (as a non-admin account, if available) replies `Тільки для оргів!`.
- `/addadmin <id>` adds a new ID; re-running with the same ID replies "вже адмін".
- `/removeadmin <id>` removes it; running `/removeadmin` on the last remaining admin ID is refused.
- `/performer_close` then attempting to buy "Для виступаючих" via the WebApp replies with the closed message instead of creating a draft.
- `/performer_open` then the same purchase attempt proceeds normally (draft created, payment instructions shown).

- [ ] **Step 4: Stop the local bot and report results**

Press `Ctrl+C` to stop the process. Report back to the user which checks passed, and any that didn't — do not proceed to any git push until every check above passes and the user has confirmed.

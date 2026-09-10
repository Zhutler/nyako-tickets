# Admin/Scanner Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split staff into two roles — full admins (everything that exists today, unchanged) and a new scanner-only tier that sees just the door-scanner button in the bot's keyboard, managed via `/addscanner`/`/removescanner`.

**Architecture:** A second, independent `scanners.json` store mirrors `admins.json`'s existing `loadDB`/`saveDB` shape (with the same corrupt-file resilience `admins.json` already has). `logic.js` gains one new pure function, `removeScannerId`, because scanner removal must NOT have the last-entry protection `removeAdminId` has for admins. Scanner-list additions reuse the existing `addAdminId` unchanged (its dedupe-or-add behavior is generic). The `/start` keyboard's single `userIsAdmin` gate splits into two independent checks: scanner-button visibility now also accepts scanners, while the 5 admin-action buttons stay full-admin-only.

**Tech Stack:** Node.js, Telegraf 4.x. No new dependencies. Tests via Node's built-in `assert/strict` in `test/logic.test.js`, same as the rest of the project.

## Global Constraints

- All user-facing bot replies must be in Ukrainian, matching the existing style in `bot.js`.
- No new npm dependencies.
- No changes to `app.html` or `scanner.html`.
- Full admins (`admins.json`) keep every capability they have today, unchanged — this plan only adds a new, strictly narrower tier alongside them.
- The scanner tier is a **visual-only** restriction, by explicit user decision — do NOT add a permission check to the `SCAN:` webapp-data handler in `bot.js`. This is a deliberate scope boundary, not an oversight to "fix."
- `/removescanner` must NOT refuse to remove the last scanner (unlike `/removeadmin`, which refuses to remove the last admin) — an empty scanner list is a normal, safe state.
- `scanners.json` must be added to `.gitignore` alongside the existing `admins.json`/`config.json`/`tickets.json`/`requests.json` entries — same reasoning as the prior plan's final-review fix: a committed scanner list would leak real Telegram IDs and could become the effective production list on first deploy.
- Nothing gets pushed or committed to the GitHub remote as part of this plan — all work stays in the local worktree/branch until the user explicitly approves a push.

---

## File Structure

- **Modify `logic.js`** — add `removeScannerId(scannerIds, idStr)`, exported alongside the existing functions.
- **Modify `test/logic.test.js`** — add tests for `removeScannerId`.
- **Modify `bot.js`** — add `scannersDbPath` constant, `loadScannersDB`/`saveScannersDB`/`isScanner` functions (mirroring the `admins.json` trio), two new commands (`/addscanner`, `/removescanner`), and the two-way keyboard-visibility split in `bot.start`.
- **Modify `.gitignore`** — add `scanners.json`.

---

### Task 1: `removeScannerId` pure logic

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

**Interfaces:**
- Consumes: nothing new — independent pure function alongside the existing ones.
- Produces: `removeScannerId(scannerIds, idStr)` → `{ scannerIds: string[], removed: boolean, reason: null | 'not_found' }`

- [ ] **Step 1: Write the failing test**

Add to `test/logic.test.js` (append at the end, following the existing `test(name, fn)` helper style already in the file). First update the top import line to add `removeScannerId`:

```javascript
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId } = require('../logic');
```

Then add these test cases:

```javascript
test('removeScannerId: removes an existing id', () => {
    const result = removeScannerId(['111', '222'], '111');
    assert.deepEqual(result, { scannerIds: ['222'], removed: true, reason: null });
});

test('removeScannerId: removes the last remaining scanner (no last-entry protection)', () => {
    const result = removeScannerId(['111'], '111');
    assert.deepEqual(result, { scannerIds: [], removed: true, reason: null });
});

test('removeScannerId: reports not_found for unknown id', () => {
    const result = removeScannerId(['111', '222'], '999');
    assert.deepEqual(result, { scannerIds: ['111', '222'], removed: false, reason: 'not_found' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/logic.test.js`
Expected: `TypeError: removeScannerId is not a function` (or similar — the export doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js`, above the `module.exports` line:

```javascript
function removeScannerId(scannerIds, idStr) {
    if (!scannerIds.includes(idStr)) return { scannerIds, removed: false, reason: 'not_found' };
    return { scannerIds: scannerIds.filter(id => id !== idStr), removed: true, reason: null };
}
```

Update the `module.exports` line to add `removeScannerId`:

```javascript
module.exports = { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/logic.test.js`
Expected: all previous tests plus 3 new `PASS:` lines for `removeScannerId`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "Add removeScannerId (no last-entry protection, unlike removeAdminId)"
```

---

### Task 2: Scanner storage and `/addscanner`/`/removescanner`

**Files:**
- Modify: `bot.js` (constants section)
- Modify: `bot.js` (after the existing `isAdmin` function, add scanner store functions)
- Modify: `bot.js` (imports — extend the `logic.js` destructure)
- Modify: `bot.js` (before `bot.catch(...)`, add two new commands)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `addAdminId` (already imported), `removeScannerId` from Task 1, `isValidTelegramId` (already imported).
- Produces: `loadScannersDB()` / `saveScannersDB(scannerIds)` / `isScanner(idStr)` — `isScanner` is used by Task 3's keyboard change.

- [ ] **Step 1: Add the scanners.json path constant**

In `bot.js`, add a line after the existing `configDbPath` constant:

```javascript
const scannersDbPath = '/data/scanners.json';
```

- [ ] **Step 2: Add scanner store functions**

Directly after the existing `isAdmin` function, insert:

```javascript
function loadScannersDB() {
    const currentPath = fs.existsSync(scannersDbPath) ? scannersDbPath : path.join(__dirname, 'scanners.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify([]));
    try {
        const parsed = JSON.parse(fs.readFileSync(currentPath));
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { console.log('scanners.json пошкоджено — використовую порожній список'); }
    return [];
}

function saveScannersDB(scannerIds) {
    const currentPath = fs.existsSync('/data') ? scannersDbPath : path.join(__dirname, 'scanners.json');
    fs.writeFileSync(currentPath, JSON.stringify(scannerIds, null, 2));
}

function isScanner(idStr) {
    return loadScannersDB().includes(idStr);
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 4: Extend the logic.js import**

Replace:

```javascript
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId } = require('./logic');
```

with:

```javascript
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId } = require('./logic');
```

- [ ] **Step 5: Add the two commands**

Before `bot.catch((err, ctx) => {`, add (alongside the existing commands/handlers):

```javascript
bot.command('addscanner', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId || !isValidTelegramId(targetId)) return ctx.reply('Використання: /addscanner <telegram_id>');

    const scanners = loadScannersDB();
    const { adminIds: newScanners, added } = addAdminId(scanners, targetId);
    if (!added) return ctx.reply('Цей користувач вже сканер.');

    saveScannersDB(newScanners);
    ctx.reply(`✅ Додано сканера ${targetId}. Всього сканерів: ${newScanners.length}`);
});

bot.command('removescanner', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId || !isValidTelegramId(targetId)) return ctx.reply('Використання: /removescanner <telegram_id>');

    const scanners = loadScannersDB();
    const result = removeScannerId(scanners, targetId);
    if (!result.removed) return ctx.reply('Цей ID не є сканером.');

    saveScannersDB(result.scannerIds);
    ctx.reply(`✅ Видалено сканера ${targetId}. Всього сканерів: ${result.scannerIds.length}`);
});

```

- [ ] **Step 6: Update .gitignore**

The current `.gitignore` reads exactly:

```
node_modules/
tickets.json
requests.json
admins.json
config.json
```

Add `scanners.json` as a new line at the end:

```
node_modules/
tickets.json
requests.json
admins.json
config.json
scanners.json
```

- [ ] **Step 7: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 8: Verify tests still pass**

Run: `npm test`
Expected: all tests from Task 1 still pass (this task doesn't add new `logic.js` functions, just consumes `removeScannerId`).

- [ ] **Step 9: Commit**

```bash
git add bot.js .gitignore
git commit -m "Add scanner storage and /addscanner, /removescanner commands"
```

---

### Task 3: Split keyboard visibility (scanner button vs. admin buttons)

**Files:**
- Modify: `bot.js:74-87` (`bot.start`'s keyboard construction)

**Interfaces:**
- Consumes: `isAdmin`, `isScanner` (from Task 2).

- [ ] **Step 1: Split the keyboard gate**

In `bot.js`, replace:

```javascript
bot.start(async (ctx) => {
    // Вбиваємо синю кнопку зліва знизу
    try { await ctx.setChatMenuButton({ type: 'default' }); } catch(e){}

    const userIsAdmin = isAdmin(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin) {
        buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
        buttons.push(['📊 Статистика']);
        buttons.push(['➕ Додати адміна', '➖ Видалити адміна']);
        buttons.push(['🟢 Увімкнути виступаючих', '🔴 Вимкнути виступаючих']);
    }
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
});
```

with:

```javascript
bot.start(async (ctx) => {
    // Вбиваємо синю кнопку зліва знизу
    try { await ctx.setChatMenuButton({ type: 'default' }); } catch(e){}

    const userId = ctx.from.id.toString();
    const userIsAdmin = isAdmin(userId);
    const userIsScanner = isScanner(userId);
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin || userIsScanner) {
        buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
    }
    if (userIsAdmin) {
        buttons.push(['📊 Статистика']);
        buttons.push(['➕ Додати адміна', '➖ Видалити адміна']);
        buttons.push(['🟢 Увімкнути виступаючих', '🔴 Вимкнути виступаючих']);
    }
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check bot.js`
Expected: no output.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all tests still pass (this task doesn't touch `logic.js`).

- [ ] **Step 4: Commit**

```bash
git add bot.js
git commit -m "Split keyboard visibility between admins and scanners"
```

---

### Task 4: Local live smoke test

Same shape as the prior two plans' final task — needs a human with a real Telegram bot token, no subagent can complete it.

**Files:** none (verification only).

- [ ] **Step 1: Run the bot locally**

```bash
BOT_TOKEN="<token>" node bot.js
```

- [ ] **Step 2: Manually verify in Telegram**

- As a full admin: `/start` still shows all 6 button rows (buy, scanner, stats, add/remove admin, performer toggle) exactly as before — full admins lose nothing.
- `/addscanner <some test id>` — confirm success reply with a scanner count; running it again with the same ID replies "вже сканер".
- With that test ID's account (or by checking `scanners.json`'s contents directly), confirm `/start` for that account now shows "Купити квиток" + "📷 Сканер квитків (Адмін)" only — no stats/admin buttons.
- `/removescanner <that id>` — confirm success reply; running `/removescanner` again on an already-empty scanner list should still work with no "last scanner" refusal (try adding and removing the very last scanner explicitly).
- Confirm a non-admin, non-scanner account's `/start` is unaffected — only "Купити квиток".

- [ ] **Step 3: Stop the local bot and report results**

Press `Ctrl+C`. Report which checks passed and any that didn't.

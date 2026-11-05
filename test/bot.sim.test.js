// Симуляція бота без мережі: підміняємо виклики Telegram API і подаємо фейкові апдейти.
// Дані пишуться у тимчасову папку, бойові файли не зачіпаються.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nyako-sim-'));
process.env.DATA_DIR = DATA_DIR;
process.env.BOT_TOKEN = '123456:SIMULATION';

const { Telegram } = require('telegraf');
const { bot, createStatsApp } = require('../bot');
const event = require('../event');

const ADMIN = Number(event.defaultAdminIds[0]); // перший стартовий адмін івенту
const CLASSIC = event.prices['Класичний'];
const PERFORMER = event.prices['Для виступаючих'];
const BUYER = 111222333;
const OTHER = 444555666;

let calls = [];
let nextMessageId = 1000;
bot.botInfo = { id: 1, is_bot: true, first_name: 'Sim', username: 'sim_bot' };
// Telegraf створює новий клієнт Telegram на кожен апдейт, тому підміняємо на рівні прототипу — жодних мережевих запитів.
Telegram.prototype.callApi = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'sendMediaGroup') return [{ message_id: nextMessageId++ }];
    return { message_id: nextMessageId++ };
};

let updateId = 1;
function user(id) { return { id, is_bot: false, first_name: `U${id}`, username: `u${id}` }; }
function msg(from, content) {
    return {
        update_id: updateId++,
        message: { message_id: updateId, date: 0, chat: { id: from, type: 'private' }, from: user(from), ...content }
    };
}
function text(from, t) {
    const entities = t.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: t.split(' ')[0].length }] : undefined;
    return msg(from, { text: t, ...(entities ? { entities } : {}) });
}
function webApp(from, data) { return msg(from, { web_app_data: { data: JSON.stringify(data), button_text: 'x' } }); }
function scan(from, ticketId) { return msg(from, { web_app_data: { data: `SCAN:${ticketId}`, button_text: 'x' } }); }
function photo(from) { return msg(from, { photo: [{ file_id: 'photo-small', file_unique_id: 'a', width: 1, height: 1 }, { file_id: 'photo-big', file_unique_id: 'b', width: 9, height: 9 }] }); }
function doc(from, mime) { return msg(from, { document: { file_id: `doc-${mime}`, file_unique_id: 'd', mime_type: mime } }); }
function usersShared(from, requestId, ids) { return msg(from, { users_shared: { request_id: requestId, users: ids.map(user_id => ({ user_id })) } }); }
function callback(from, data) {
    return { update_id: updateId++, callback_query: { id: `cb${updateId}`, from: user(from), chat_instance: 'ci', data, message: { message_id: 1, date: 0, chat: { id: from, type: 'private' } } } };
}

async function send(update) { calls = []; await bot.handleUpdate(update); return calls; }
function repliesTo(chatId, cs = calls) { return cs.filter(c => c.method === 'sendMessage' && c.payload.chat_id === chatId).map(c => c.payload.text); }
function keyboardOf(cs) {
    return cs.find(c => c.method === 'sendMessage').payload.reply_markup.keyboard.flat()
        .map(b => (typeof b === 'string' ? { text: b } : b));
}
function readData(file) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file))); }
function resetData() { for (const f of fs.readdirSync(DATA_DIR)) fs.unlinkSync(path.join(DATA_DIR, f)); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('/start: admin sees Test web-app button and contact-picker "Додати сканера"', async () => {
    await send(text(ADMIN, '/start'));
    const kb = keyboardOf(calls);
    const testBtn = kb.find(b => b.text === '🧪 Тест');
    assert.ok(testBtn && testBtn.web_app.url.endsWith('&test=1'), 'Test button opens app with test=1');
    const scannerBtn = kb.find(b => b.text === '➕ Додати сканера');
    assert.equal(scannerBtn.request_users.request_id, 1);
    const adminBtn = kb.find(b => b.text === '➕ Додати адміна');
    assert.equal(adminBtn.request_users.request_id, 2, 'Додати адміна також відкриває контакти');
});

test('/start: welcome and buy button use the event config', async () => {
    await send(text(BUYER, '/start'));
    const sent = calls.find(c => c.method === 'sendMessage').payload;
    assert.match(sent.text, new RegExp(event.name));
    assert.equal(keyboardOf(calls)[0].web_app.url, event.appUrl);
});

test('admin picks a contact via "Додати адміна" → becomes admin', async () => {
    resetData();
    await send(usersShared(ADMIN, 2, [OTHER]));
    assert.match(repliesTo(ADMIN)[0], /✅ Додано адміна/);
    assert.ok(readData('admins.json').includes(String(OTHER)));

    await send(usersShared(ADMIN, 2, [OTHER]));
    assert.match(repliesTo(ADMIN)[0], /Вже адмін/);

    await send(text(OTHER, '/stats'));
    assert.match(repliesTo(OTHER)[0], /статистика/);
});

test('non-admin sharing a contact cannot add admins', async () => {
    resetData();
    await send(usersShared(BUYER, 2, [OTHER]));
    assert.deepEqual(repliesTo(BUYER), ['Тільки для оргів!']);
    assert.ok(!readData('admins.json').includes(String(OTHER)));
});

test('confirmed tickets use the event ticket prefix and card number', async () => {
    resetData();
    await send(webApp(BUYER, { ticket: 'Класичний', count: 1 }));
    assert.match(repliesTo(BUYER)[0], new RegExp(event.card));
    await send(photo(BUYER));
    const txId = Object.keys(readData('requests.json')).find(k => k.startsWith('tx_'));
    await send(callback(ADMIN, `confirm_${txId}`));
    assert.ok(Object.keys(readData('tickets.json')).every(id => id.startsWith(`${event.ticketPrefix}_`)));
});

test('/start: regular buyer sees only the buy button', async () => {
    await send(text(BUYER, '/start'));
    const kb = keyboardOf(calls);
    assert.deepEqual(kb.map(b => b.text), ['Купити квиток 🎟']);
});

test('test purchase by admin: full flow works, tickets marked test, /stats unaffected', async () => {
    resetData();
    await send(webApp(ADMIN, { ticket: 'Класичний', count: 2, test: true }));
    assert.match(repliesTo(ADMIN)[0], /^🧪 ТЕСТ/);
    assert.equal(readData('requests.json')[`draft_${ADMIN}`].test, true);

    await send(photo(ADMIN));
    const sentToAdmins = calls.filter(c => c.method === 'sendPhoto');
    assert.ok(sentToAdmins.length > 0);
    assert.match(sentToAdmins[0].payload.caption, /ТЕСТ/);
    const txId = Object.keys(readData('requests.json')).find(k => k.startsWith('tx_'));

    await send(callback(ADMIN, `confirm_${txId}`));
    const tickets = Object.values(readData('tickets.json'));
    assert.equal(tickets.length, 2);
    assert.ok(tickets.every(t => t.test === true));

    await send(text(ADMIN, '/stats'));
    assert.match(repliesTo(ADMIN)[0], /Продано квитків: 0/);
    assert.match(repliesTo(ADMIN)[0], /Загальна сума: 0 ₴/);
});

test('scanning a test ticket works and is labelled (тест)', async () => {
    const ticketId = Object.keys(readData('tickets.json'))[0];
    await send(scan(ADMIN, ticketId));
    assert.match(repliesTo(ADMIN)[0], /Прохід дозволено.*\(тест\)/);
});

test('non-admin cannot fake a test purchase — it is a real purchase', async () => {
    resetData();
    await send(webApp(BUYER, { ticket: 'Класичний', count: 1, test: true }));
    assert.doesNotMatch(repliesTo(BUYER)[0], /ТЕСТ/);
    assert.equal(readData('requests.json')[`draft_${BUYER}`].test, undefined);
});

test('real purchase still counts in /stats', async () => {
    resetData();
    await send(webApp(BUYER, { ticket: 'Класичний', count: 1 }));
    await send(photo(BUYER));
    const txId = Object.keys(readData('requests.json')).find(k => k.startsWith('tx_'));
    await send(callback(ADMIN, `confirm_${txId}`));
    await send(text(ADMIN, '/stats'));
    assert.match(repliesTo(ADMIN)[0], /Продано квитків: 1/);
    assert.match(repliesTo(ADMIN)[0], new RegExp(`Загальна сума: ${CLASSIC} ₴`));
});

test('performer sales closed: real purchase blocked, admin test purchase allowed', async () => {
    resetData();
    await send(text(ADMIN, '/performer_close'));
    await send(webApp(BUYER, { ticket: 'Для виступаючих', count: 1 }));
    assert.match(repliesTo(BUYER)[0], /ще не відкрито/);
    await send(webApp(ADMIN, { ticket: 'Для виступаючих', count: 1, test: true }));
    assert.match(repliesTo(ADMIN)[0], /^🧪 ТЕСТ/);
});

test('waiting for receipt + sends a link/text → bot asks for an image', async () => {
    resetData();
    await send(webApp(BUYER, { ticket: 'Класичний', count: 1 }));
    await send(text(BUYER, 'https://privatbank.ua/receipt/123'));
    assert.match(repliesTo(BUYER)[0], /скріншот чека/);
    assert.ok(readData('requests.json')[`draft_${BUYER}`], 'draft is kept so a proper screenshot still works');
});

test('waiting for receipt + sends a PDF → bot asks for an image', async () => {
    await send(doc(BUYER, 'application/pdf'));
    assert.match(repliesTo(BUYER)[0], /скріншот чека/);
    assert.equal(calls.filter(c => c.method === 'sendDocument').length, 0);
});

test('waiting for receipt + sends a sticker → bot asks for an image', async () => {
    await send(msg(BUYER, { sticker: { file_id: 's', file_unique_id: 's', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false } }));
    assert.match(repliesTo(BUYER)[0], /скріншот чека/);
});

test('image sent as a file (uncompressed) is accepted as a receipt', async () => {
    await send(doc(BUYER, 'image/png'));
    assert.ok(calls.filter(c => c.method === 'sendDocument').length > 0, 'forwarded to admins as document');
    assert.match(repliesTo(BUYER)[0], /Чек полетів/);
});

test('random text with no pending purchase is still ignored', async () => {
    resetData();
    await send(text(OTHER, 'привіт'));
    assert.equal(repliesTo(OTHER).length, 0);
});

test('commands still work for a user with a pending purchase', async () => {
    resetData();
    await send(webApp(BUYER, { ticket: 'Класичний', count: 1 }));
    await send(text(BUYER, '/myid'));
    assert.deepEqual(repliesTo(BUYER), [`Твій ID: ${BUYER}`]);
});

test('admin picks a contact via "Додати сканера" → becomes scanner', async () => {
    resetData();
    await send(usersShared(ADMIN, 1, [OTHER]));
    assert.match(repliesTo(ADMIN)[0], /✅ Додано сканера/);
    assert.deepEqual(readData('scanners.json'), [String(OTHER)]);

    await send(usersShared(ADMIN, 1, [OTHER]));
    assert.match(repliesTo(ADMIN)[0], /Вже сканер/);

    await send(text(OTHER, '/start'));
    const kb = keyboardOf(calls);
    assert.deepEqual(kb.map(b => b.text), ['Купити квиток 🎟', '📷 Сканер квитків (Адмін)']);
});

test('non-admin sharing a contact cannot add scanners', async () => {
    resetData();
    await send(usersShared(BUYER, 1, [OTHER]));
    assert.deepEqual(repliesTo(BUYER), ['Тільки для оргів!']);
    const scannersFile = path.join(DATA_DIR, 'scanners.json');
    assert.ok(!fs.existsSync(scannersFile) || readData('scanners.json').length === 0, 'nobody was added');
});

test('/reset_tickets without confirm only warns, changes nothing', async () => {
    resetData();
    fs.writeFileSync(path.join(DATA_DIR, 'tickets.json'), JSON.stringify({ a: { used: true, type: 'Класичний' } }));
    await send(text(ADMIN, '/reset_tickets'));
    assert.match(repliesTo(ADMIN)[0], /архів/);
    assert.match(repliesTo(ADMIN)[0], /\/reset_tickets confirm/);
    assert.equal(Object.keys(readData('tickets.json')).length, 1);
    assert.equal(fs.readdirSync(DATA_DIR).filter(f => f.startsWith('archive-')).length, 0);
});

test('/reset_tickets confirm archives tickets and pending purchases, then starts from zero', async () => {
    resetData();
    const tickets = { a: { used: true, type: 'Класичний' }, b: { used: false, type: 'Для виступаючих' } };
    const requests = { [`draft_${BUYER}`]: { ticketType: 'Класичний', count: 1 }, tx_1: { userId: OTHER, ticketType: 'Класичний', count: 2, adminMsgs: [] } };
    fs.writeFileSync(path.join(DATA_DIR, 'tickets.json'), JSON.stringify(tickets));
    fs.writeFileSync(path.join(DATA_DIR, 'requests.json'), JSON.stringify(requests));

    await send(text(ADMIN, '/reset_tickets confirm'));

    const archives = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('archive-') && f.endsWith('.json'));
    assert.equal(archives.length, 1);
    const archive = readData(archives[0]);
    assert.deepEqual(archive.tickets, tickets);
    assert.deepEqual(archive.requests, requests);
    assert.ok(archive.archivedAt);
    assert.match(repliesTo(ADMIN)[0], new RegExp(archives[0]));

    assert.deepEqual(readData('tickets.json'), {});
    assert.deepEqual(readData('requests.json'), {});
    await send(text(ADMIN, '/stats'));
    assert.match(repliesTo(ADMIN)[0], /Продано квитків: 0/);
});

test('/reset_tickets is admin-only', async () => {
    resetData();
    fs.writeFileSync(path.join(DATA_DIR, 'tickets.json'), JSON.stringify({ a: { used: true, type: 'Класичний' } }));
    await send(text(BUYER, '/reset_tickets confirm'));
    assert.deepEqual(repliesTo(BUYER), ['Тільки для оргів!']);
    assert.equal(Object.keys(readData('tickets.json')).length, 1);
});

async function fetchStats(key) {
    const server = createStatsApp('s3cret').listen(0);
    await new Promise(r => server.once('listening', r));
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/stats.csv${key === undefined ? '' : `?key=${key}`}`);
        return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
    } finally {
        server.close();
    }
}

test('sheet endpoint: wrong or missing key is rejected', async () => {
    assert.equal((await fetchStats('nope')).status, 403);
    assert.equal((await fetchStats()).status, 403);
});

test('sheet endpoint: returns sales CSV, test tickets excluded', async () => {
    resetData();
    fs.writeFileSync(path.join(DATA_DIR, 'tickets.json'), JSON.stringify({
        a: { used: true, type: 'Класичний' },
        b: { used: false, type: 'Для виступаючих' },
        c: { used: true, type: 'Класичний', test: true }
    }));
    const res = await fetchStats('s3cret');
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/csv/);
    const lines = res.body.trim().split('\n');
    assert.deepEqual(lines.slice(0, 8), [
        'Показник,Значення',
        'Продано квитків,2',
        'Класичний (шт),1',
        `Класичний (₴),${CLASSIC}`,
        'Для виступаючих (шт),1',
        `Для виступаючих (₴),${PERFORMER}`,
        'Погашено на вході,1',
        `Загальна сума (₴),${CLASSIC + PERFORMER}`
    ]);
    assert.match(lines[8], /^Оновлено,/);
});

(async () => {
    let failed = 0;
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`PASS: ${name}`); }
        catch (e) { failed++; console.error(`FAIL: ${name}`); console.error(e); }
    }
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    if (failed) process.exitCode = 1;
})();

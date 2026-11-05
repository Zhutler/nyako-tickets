const assert = require('assert/strict');
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId, isImageDocument, statsToSheetRows, rowsToCsv } = require('../logic');
const event = require('../event');

// Ціни беремо з налаштувань івенту, щоб ті самі тести працювали і в Nyako, і в Dristic.
const CLASSIC = event.prices['Класичний'];
const PERFORMER = event.prices['Для виступаючих'];

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
            'Класичний': { count: 2, revenue: 2 * CLASSIC },
            'Для виступаючих': { count: 1, revenue: PERFORMER }
        },
        redeemed: 1,
        totalRevenue: 2 * CLASSIC + PERFORMER,
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

test('formatStatsMessage: title uses the event name', () => {
    const msg = formatStatsMessage({ totalSold: 0, byType: {}, redeemed: 0, totalRevenue: 0, pendingCount: 0 }, true);
    assert.ok(msg.startsWith(`📊 ${event.name} — статистика`), msg.split('\n')[0]);
});

test('priceFor: uses the event price for each ticket type', () => {
    assert.equal(priceFor('Класичний'), CLASSIC);
    assert.equal(priceFor('Для виступаючих'), PERFORMER);
});

test('priceFor: unknown ticket types count as 0 (not invented revenue)', () => {
    assert.equal(priceFor('bogus'), 0);
});

test('TICKET_TYPES: comes from the event config, both types present with positive prices', () => {
    assert.deepEqual(TICKET_TYPES, event.prices);
    assert.deepEqual(Object.keys(TICKET_TYPES).sort(), ['Для виступаючих', 'Класичний'].sort());
    assert.ok(Object.values(TICKET_TYPES).every(p => Number.isInteger(p) && p > 0));
});

test('event config: has everything the bot needs', () => {
    for (const key of ['name', 'ticketPrefix', 'card', 'appUrl', 'scannerUrl']) {
        assert.equal(typeof event[key], 'string', key);
        assert.ok(event[key].length > 0, key);
    }
    assert.ok(event.defaultAdminIds.length > 0);
    assert.ok(event.defaultAdminIds.every(isValidTelegramId));
});

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

test('computeStats: ignores test tickets and test receipts', () => {
    const ticketsDb = {
        't1': { used: true, type: 'Класичний' },
        't2': { used: true, type: 'Класичний', test: true },
        't3': { used: false, type: 'Для виступаючих', test: true }
    };
    const requestsDb = {
        'tx_1': { userId: 1, ticketType: 'Класичний', count: 1, adminMsgs: [] },
        'tx_2': { userId: 2, ticketType: 'Класичний', count: 1, adminMsgs: [], test: true }
    };
    assert.deepEqual(computeStats(ticketsDb, requestsDb), {
        totalSold: 1,
        byType: { 'Класичний': { count: 1, revenue: CLASSIC } },
        redeemed: 1,
        totalRevenue: CLASSIC,
        pendingCount: 1
    });
});

test('isImageDocument: accepts image files sent as documents', () => {
    assert.equal(isImageDocument({ file_id: 'x', mime_type: 'image/jpeg' }), true);
    assert.equal(isImageDocument({ file_id: 'x', mime_type: 'image/png' }), true);
});

test('statsToSheetRows: only sales figures, numbers stay numbers', () => {
    const stats = {
        totalSold: 12,
        byType: { 'Класичний': { count: 8, revenue: 2400 }, 'Для виступаючих': { count: 4, revenue: 1000 } },
        redeemed: 5,
        totalRevenue: 3400,
        pendingCount: 2
    };
    assert.deepEqual(statsToSheetRows(stats, '05.11.2026, 14:30:00'), [
        ['Показник', 'Значення'],
        ['Продано квитків', 12],
        ['Класичний (шт)', 8],
        ['Класичний (₴)', 2400],
        ['Для виступаючих (шт)', 4],
        ['Для виступаючих (₴)', 1000],
        ['Погашено на вході', 5],
        ['Загальна сума (₴)', 3400],
        ['Оновлено', '05.11.2026, 14:30:00']
    ]);
});

test('statsToSheetRows: missing ticket types show as zero', () => {
    const rows = statsToSheetRows({ totalSold: 0, byType: {}, redeemed: 0, totalRevenue: 0, pendingCount: 0 }, 'x');
    assert.deepEqual(rows.slice(2, 6), [
        ['Класичний (шт)', 0], ['Класичний (₴)', 0], ['Для виступаючих (шт)', 0], ['Для виступаючих (₴)', 0]
    ]);
});

test('rowsToCsv: quotes fields with commas or quotes', () => {
    assert.equal(
        rowsToCsv([['Показник', 'Значення'], ['Оновлено', '05.11.2026, 14:30:00'], ['Назва "x"', 5]]),
        'Показник,Значення\nОновлено,"05.11.2026, 14:30:00"\n"Назва ""x""",5\n'
    );
});

test('isImageDocument: rejects non-image documents and missing input', () => {
    assert.equal(isImageDocument({ file_id: 'x', mime_type: 'application/pdf' }), false);
    assert.equal(isImageDocument({ file_id: 'x' }), false);
    assert.equal(isImageDocument(undefined), false);
});

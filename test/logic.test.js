const assert = require('assert/strict');
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId } = require('../logic');

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

test('priceFor: prices Класичний at 300', () => {
    assert.equal(priceFor('Класичний'), 300);
});

test('priceFor: prices Для виступаючих at 250', () => {
    assert.equal(priceFor('Для виступаючих'), 250);
});

test('priceFor: falls back to 250 for unknown ticket types (historical data)', () => {
    assert.equal(priceFor('bogus'), 250);
});

test('TICKET_TYPES: contains exactly the two known ticket types', () => {
    assert.deepEqual(TICKET_TYPES, { 'Класичний': 300, 'Для виступаючих': 250 });
});

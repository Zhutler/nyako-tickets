const { prices, name: eventName } = require('./event');

// Ціни беруться з налаштувань івенту (event.js).
const TICKET_TYPES = prices;

function priceFor(ticketType) {
    return TICKET_TYPES[ticketType] || 0;
}

function computeStats(ticketsDb, requestsDb) {
    const byType = {};
    let redeemed = 0;

    const realTickets = Object.values(ticketsDb).filter(ticket => !ticket.test);

    for (const ticket of realTickets) {
        if (!byType[ticket.type]) byType[ticket.type] = { count: 0, revenue: 0 };
        byType[ticket.type].count += 1;
        byType[ticket.type].revenue += priceFor(ticket.type);
        if (ticket.used) redeemed += 1;
    }

    const totalSold = realTickets.length;
    const totalRevenue = Object.values(byType).reduce((sum, t) => sum + t.revenue, 0);
    const pendingCount = Object.entries(requestsDb)
        .filter(([key, tx]) => key.startsWith('tx_') && !tx.test).length;

    return { totalSold, byType, redeemed, totalRevenue, pendingCount };
}

function formatStatsMessage(stats, performerOpen) {
    const classic = stats.byType['Класичний'] || { count: 0, revenue: 0 };
    const performer = stats.byType['Для виступаючих'] || { count: 0, revenue: 0 };
    const performerStatus = performerOpen ? '🟢 відкрито' : '🔴 закрито';

    return `📊 ${eventName} — статистика\n\n` +
        `Продано квитків: ${stats.totalSold}\n` +
        ` • Класичний: ${classic.count} (${classic.revenue} ₴)\n` +
        ` • Для виступаючих: ${performer.count} (${performer.revenue} ₴, ${performerStatus})\n\n` +
        `Погашено на вході: ${stats.redeemed} / ${stats.totalSold}\n` +
        `Загальна сума: ${stats.totalRevenue} ₴\n` +
        `Очікують підтвердження: ${stats.pendingCount} чека`;
}

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

function removeScannerId(scannerIds, idStr) {
    if (!scannerIds.includes(idStr)) return { scannerIds, removed: false, reason: 'not_found' };
    return { scannerIds: scannerIds.filter(id => id !== idStr), removed: true, reason: null };
}

// Рядки для вкладки "Квитки (бот)" у кошторисі: лише продажі, числа лишаються числами.
function statsToSheetRows(stats, updatedAt) {
    const classic = stats.byType['Класичний'] || { count: 0, revenue: 0 };
    const performer = stats.byType['Для виступаючих'] || { count: 0, revenue: 0 };
    return [
        ['Показник', 'Значення'],
        ['Продано квитків', stats.totalSold],
        ['Класичний (шт)', classic.count],
        ['Класичний (₴)', classic.revenue],
        ['Для виступаючих (шт)', performer.count],
        ['Для виступаючих (₴)', performer.revenue],
        ['Погашено на вході', stats.redeemed],
        ['Загальна сума (₴)', stats.totalRevenue],
        ['Оновлено', updatedAt]
    ];
}

function csvField(value) {
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
    return rows.map(row => row.map(csvField).join(',')).join('\n') + '\n';
}

function isImageDocument(doc) {
    return Boolean(doc) && typeof doc.mime_type === 'string' && doc.mime_type.startsWith('image/');
}

module.exports = { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId, isImageDocument, statsToSheetRows, rowsToCsv };

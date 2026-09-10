const TICKET_TYPES = { 'Класичний': 300, 'Для виступаючих': 250 };

function priceFor(ticketType) {
    return TICKET_TYPES[ticketType] || 250;
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

module.exports = { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId };

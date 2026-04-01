const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf('8770505563:AAEE8UeScHMw-4zJekTODyVuHUdtGcr0K9Q'); 
const ADMIN_IDS = ['789355423', '821782817', '5690029894']; // Вставь реальный ID Хироши
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=5';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

const dbPath = '/data/tickets.json';
// Хранилище для синхронизации кнопок (userId -> {amount, type, adminMsgs: [{chatId, msgId}]})
let pendingRequests = {};

if (!fs.existsSync('/data')) {
    try { fs.mkdirSync('/data'); } catch (e) { console.log('Папка /data відсутня'); }
}

function loadDB() {
    const currentPath = fs.existsSync(dbPath) ? dbPath : path.join(__dirname, 'tickets.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveDB(data) {
    const currentPath = fs.existsSync('/data') ? dbPath : path.join(__dirname, 'tickets.json');
    fs.writeFileSync(currentPath, JSON.stringify(data, null, 2));
}

bot.start((ctx) => {
    const isAdmin = ADMIN_IDS.includes(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (isAdmin) buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
});

bot.on('message', async (ctx, next) => {
    if (ctx.message && ctx.message.web_app_data) {
        try {
            const data = JSON.parse(ctx.message.web_app_data.data);
            const userId = ctx.from.id;
            // Запоминаем, что юзер выбрал
            pendingRequests[userId] = { ticketType: data.ticket, count: data.count, adminMsgs: [] };
            
            return ctx.reply(`Обрано: ${data.ticket} — ${data.count} шт.\n\nСума: ${data.count * (data.ticket.includes('300') ? 300 : 250)} ₴\nКартка: 💳 4149 6090 6948 0624\n\nКидай скрін чека!`);
        } catch (e) {
            return ctx.reply('Помилка даних. Спробуй ще раз.');
        }
    }
    return next();
});

bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const req = pendingRequests[userId];
    
    if (!req) return ctx.reply('Спочатку обери квитки через кнопку!');

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    
    for (const adminId of ADMIN_IDS) {
        try {
            const msg = await ctx.telegram.sendPhoto(adminId, fileId, {
                caption: `Чек від @${ctx.message.from.username || userId}\nКвитки: ${req.ticketType} (${req.count} шт.)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Підтвердити', callback_data: `confirm_${userId}` }],
                        [{ text: '❌ Відхилити', callback_data: `reject_${userId}` }]
                    ]
                }
            });
            req.adminMsgs.push({ chatId: adminId, messageId: msg.message_id });
        } catch (e) { console.log(e); }
    }
    ctx.reply('Чек полетів до оргів! Очікуй.');
});

bot.action(/confirm_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return ctx.answerCbQuery('Тільки для оргів!');

    const req = pendingRequests[userId];
    if (!req) return ctx.answerCbQuery('Запит застарів або вже оброблений.');

    try {
        const db = loadDB();
        const ticketsToSend = [];

        for (let i = 0; i < req.count; i++) {
            const tId = `NYAKO_${userId}_${Math.random().toString(36).substring(7)}`;
            db[tId] = { used: false, owner: userId, type: req.ticketType, date: new Date().toISOString() };
            const qrBuf = await QRCode.toBuffer(tId);
            ticketsToSend.push({ type: 'photo', media: { source: qrBuf } });
        }
        
        saveDB(db);
        
        // Шлем пачку QR-кодов юзеру
        await ctx.telegram.sendMessage(userId, `Оплата підтверджена! Твої квитки (${req.count} шт.):`);
        await ctx.telegram.sendMediaGroup(userId, ticketsToSend);

        // Убираем кнопки у ВСЕХ админов
        for (const m of req.adminMsgs) {
            try {
                await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `✅ Схвалено адміном @${ctx.from.username || ctx.from.id}\nКвитки: ${req.ticketType} (${req.count} шт.)`);
            } catch (e) { console.log('Не вдалося оновити кнопки'); }
        }
        
        delete pendingRequests[userId];
    } catch (err) {
        console.log(err);
        ctx.reply('Помилка при створенні квитків.');
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const req = pendingRequests[userId];
    if (req) {
        for (const m of req.adminMsgs) {
            try { await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `❌ Відхилено адміном @${ctx.from.username}`); } catch(e){}
        }
        await ctx.telegram.sendMessage(userId, 'Твій чек відхилено. Звернись до оргів.');
        delete pendingRequests[userId];
    }
});

bot.launch();
console.log('Бот Nyako-kon з синхронізацією адмінів запущено!');

const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf('8770505563:AAEE8UeScHMw-4zJekTODyVuHUdtGcr0K9Q'); 
const ADMIN_IDS = ['789355423', 'ТУТ_ID_ХИРОШИ']; // Не забудь айди Хироши
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=5';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

const dbPath = '/data/tickets.json';
const reqDbPath = '/data/requests.json';

// Створюємо папку, якщо локальний тест
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

function loadReqDB() {
    const currentPath = fs.existsSync(reqDbPath) ? reqDbPath : path.join(__dirname, 'requests.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveReqDB(data) {
    const currentPath = fs.existsSync('/data') ? reqDbPath : path.join(__dirname, 'requests.json');
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
        const rawData = ctx.message.web_app_data.data;

        // Спочатку перевіряємо, чи це дані зі сканера
        if (rawData.startsWith('SCAN:')) {
            const ticketId = rawData.replace('SCAN:', '');
            const db = loadDB();
            
            if (!db[ticketId]) return ctx.reply('❌ Паль! Такого квитка не існує.');
            if (db[ticketId].used) return ctx.reply('⚠️ Увага! Квиток вже використано.');
            
            db[ticketId].used = true;
            saveDB(db);
            return ctx.reply('✅ Прохід дозволено! Квиток погашено.');
        }

        // Якщо це не сканер, значить це JSON з покупкою квитків
        try {
            const data = JSON.parse(rawData);
            const userId = ctx.from.id;
            
            const price = data.ticket === 'Класичний' ? 300 : 250;
            const totalSum = data.count * price;
            
            const reqDb = loadReqDB();
            reqDb[userId] = { ticketType: data.ticket, count: data.count, adminMsgs: [] };
            saveReqDB(reqDb);
            
            return ctx.reply(`Обрано: ${data.ticket} - ${data.count} шт.\n\nСума: ${totalSum} ₴\nКартка: 💳 4149 6090 6948 0624\n\nКидай скрін чека!`);
        } catch (e) {
            return ctx.reply('Помилка даних. Спробуй ще раз.');
        }
    }
    return next();
});

bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    
    const reqDb = loadReqDB();
    const req = reqDb[userId];
    
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
    
    saveReqDB(reqDb);
    ctx.reply('Чек полетів до оргів! Очікуй.');
});

bot.action(/confirm_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return ctx.answerCbQuery('Тільки для оргів!');

    const reqDb = loadReqDB();
    const req = reqDb[userId];
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
        
        await ctx.telegram.sendMessage(userId, `Оплата підтверджена! Твої квитки (${req.count} шт.):`);
        await ctx.telegram.sendMediaGroup(userId, ticketsToSend);

        for (const m of req.adminMsgs) {
            try {
                await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `✅ Схвалено адміном @${ctx.from.username || ctx.from.id}\nКвитки: ${req.ticketType} (${req.count} шт.)`);
            } catch (e) { console.log('Не вдалося оновити кнопки'); }
        }
        
        delete reqDb[userId];
        saveReqDB(reqDb);
    } catch (err) {
        console.log(err);
        ctx.reply('Помилка при створенні квитків.');
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const reqDb = loadReqDB();
    const req = reqDb[userId];
    if (req) {
        for (const m of req.adminMsgs) {
            try { await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `❌ Відхилено адміном @${ctx.from.username}`); } catch(e){}
        }
        await ctx.telegram.sendMessage(userId, 'Твій чек відхилено. Звернись до оргів.');
        
        delete reqDb[userId];
        saveReqDB(reqDb);
    }
});

bot.launch();
console.log('Бот Nyako-kon: фікс сканера завантажено!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

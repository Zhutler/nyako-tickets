const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId } = require('./logic');

// Бот берет токен из скрытых настроек Railway
const bot = new Telegraf(process.env.BOT_TOKEN);
const DEFAULT_ADMIN_IDS = ['789355423', '821782817', '678439277', '1672507362', '1089717768', '8595175426']; // Використовується лише для первинної міграції admins.json
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=5';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

const dbPath = '/data/tickets.json';
const reqDbPath = '/data/requests.json';
const adminsDbPath = '/data/admins.json';
const configDbPath = '/data/config.json';

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

function loadAdminsDB() {
    const currentPath = fs.existsSync(adminsDbPath) ? adminsDbPath : path.join(__dirname, 'admins.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify(DEFAULT_ADMIN_IDS));
    try {
        const parsed = JSON.parse(fs.readFileSync(currentPath));
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) { console.log('admins.json пошкоджено — використовую DEFAULT_ADMIN_IDS'); }
    return DEFAULT_ADMIN_IDS;
}

function saveAdminsDB(adminIds) {
    const currentPath = fs.existsSync('/data') ? adminsDbPath : path.join(__dirname, 'admins.json');
    fs.writeFileSync(currentPath, JSON.stringify(adminIds, null, 2));
}

function isAdmin(idStr) {
    return loadAdminsDB().includes(idStr);
}

function loadConfigDB() {
    const currentPath = fs.existsSync(configDbPath) ? configDbPath : path.join(__dirname, 'config.json');
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify({ performerTicketsOpen: true }));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveConfigDB(config) {
    const currentPath = fs.existsSync('/data') ? configDbPath : path.join(__dirname, 'config.json');
    fs.writeFileSync(currentPath, JSON.stringify(config, null, 2));
}

bot.start(async (ctx) => {
    // Вбиваємо синю кнопку зліва знизу
    try { await ctx.setChatMenuButton({ type: 'default' }); } catch(e){}

    const userIsAdmin = isAdmin(ctx.from.id.toString());
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    if (userIsAdmin) buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
    ctx.reply('Вітаємо на Nyako-kon! 🎫', Markup.keyboard(buttons).resize());
});

bot.on('message', async (ctx, next) => {
    if (ctx.message && ctx.message.web_app_data) {
        const rawData = ctx.message.web_app_data.data;

        if (rawData.startsWith('SCAN:')) {
            const ticketId = rawData.replace('SCAN:', '');
            const db = loadDB();
            
            if (!db[ticketId]) return ctx.reply('❌ Паль! Такого квитка не існує.');
            if (db[ticketId].used) return ctx.reply('⚠️ Увага! Квиток вже використано.');
            
            db[ticketId].used = true;
            saveDB(db);
            return ctx.reply('✅ Прохід дозволено! Квиток погашено.');
        }

        try {
            const data = JSON.parse(rawData);
            const userId = ctx.from.id;

            if (!TICKET_TYPES[data.ticket]) {
                return ctx.reply('Помилка даних. Спробуй ще раз.');
            }

            if (data.ticket === 'Для виступаючих') {
                const config = loadConfigDB();
                if (config.performerTicketsOpen === false) {
                    return ctx.reply('Продаж квитків для виступаючих ще не відкрито.');
                }
            }

            const price = priceFor(data.ticket);
            const totalSum = data.count * price;
            
            // ЗБЕРІГАЄМО ЯК ЧЕРНЕТКУ
            const reqDb = loadReqDB();
            reqDb[`draft_${userId}`] = { ticketType: data.ticket, count: data.count };
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
    const draft = reqDb[`draft_${userId}`];
    
    if (!draft) return ctx.reply('Спочатку обери квитки через кнопку!');

    // ФІКСУЄМО ТРАНЗАКЦІЮ (ніяких перезаписів)
    const txId = `tx_${Date.now()}_${userId}`;
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    
    reqDb[txId] = {
        userId: userId,
        ticketType: draft.ticketType,
        count: draft.count,
        adminMsgs: []
    };
    
    // Видаляємо чернетку, щоб другий чек не кинули на ті ж дані
    delete reqDb[`draft_${userId}`];

    for (const adminId of loadAdminsDB()) {
        try {
            const msg = await ctx.telegram.sendPhoto(adminId, fileId, {
                caption: `Чек від @${ctx.message.from.username || userId}\nКвитки: ${draft.ticketType} (${draft.count} шт.)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Підтвердити', callback_data: `confirm_${txId}` }],
                        [{ text: '❌ Відхилити', callback_data: `reject_${txId}` }]
                    ]
                }
            });
            reqDb[txId].adminMsgs.push({ chatId: adminId, messageId: msg.message_id });
        } catch (e) { console.log(e); }
    }
    
    saveReqDB(reqDb);
    ctx.reply('Чек полетів до оргів! Очікуй.');
});

bot.action(/confirm_(.+)/, async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.answerCbQuery('Тільки для оргів!');

    const txId = ctx.match[1];
    const reqDb = loadReqDB();
    const tx = reqDb[txId];

    if (!tx) return ctx.answerCbQuery('Запит застарів або вже оброблений.');

    try {
        const db = loadDB();
        const ticketsToSend = [];
        const userId = tx.userId;

        for (let i = 0; i < tx.count; i++) {
            const tId = `NYAKO_${userId}_${Math.random().toString(36).substring(7)}`;
            db[tId] = { used: false, owner: userId, type: tx.ticketType, date: new Date().toISOString() };
            const qrBuf = await QRCode.toBuffer(tId);
            ticketsToSend.push({ type: 'photo', media: { source: qrBuf } });
        }
        
        saveDB(db);
        
        await ctx.telegram.sendMessage(userId, `Оплата підтверджена! Твої квитки (${tx.count} шт.):`);
        await ctx.telegram.sendMediaGroup(userId, ticketsToSend);

        for (const m of tx.adminMsgs) {
            try {
                await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `✅ Схвалено адміном @${ctx.from.username || ctx.from.id}\nКвитки: ${tx.ticketType} (${tx.count} шт.)`);
            } catch (e) { console.log('Не вдалося оновити кнопки'); }
        }
        
        delete reqDb[txId];
        saveReqDB(reqDb);
    } catch (err) {
        console.log(err);
        ctx.reply('Помилка при створенні квитків.');
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return;

    const txId = ctx.match[1];
    const reqDb = loadReqDB();
    const tx = reqDb[txId];

    if (tx) {
        for (const m of tx.adminMsgs) {
            try { await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `❌ Відхилено адміном @${ctx.from.username}`); } catch(e){}
        }
        await ctx.telegram.sendMessage(tx.userId, 'Твій чек відхилено. Звернись до оргів.');
        
        delete reqDb[txId];
        saveReqDB(reqDb);
    }
});

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

bot.catch((err, ctx) => {
    console.log('Помилка обробки оновлення:', err);
});

bot.launch();
console.log('Бот Nyako-kon: анти-скам і фікс синьої кнопки завантажено!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

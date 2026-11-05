const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { computeStats, formatStatsMessage, priceFor, TICKET_TYPES, isValidTelegramId, addAdminId, removeAdminId, removeScannerId, isImageDocument } = require('./logic');

// Бот берет токен из скрытых настроек Railway
const bot = new Telegraf(process.env.BOT_TOKEN);
const DEFAULT_ADMIN_IDS = ['789355423', '821782817', '678439277', '1672507362', '1089717768', '8595175426']; // Використовується лише для первинної міграції admins.json
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=6';
const TEST_APP_URL = `${APP_URL}&test=1`;
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';
const SCANNER_REQUEST_ID = 1; // request_id для кнопки вибору контакту "Додати сканера"

// На Railway це постійний диск /data. DATA_DIR можна перевизначити (наприклад, для тестів).
const DATA_DIR = process.env.DATA_DIR || '/data';

if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR); } catch (e) { console.log(`Папка ${DATA_DIR} відсутня`); }
}

// Одне правило і для читання, і для запису: якщо DATA_DIR існує — працюємо там, інакше поруч з bot.js.
function dataPath(file) {
    return path.join(fs.existsSync(DATA_DIR) ? DATA_DIR : __dirname, file);
}

function loadJson(file, defaultValue) {
    const currentPath = dataPath(file);
    if (!fs.existsSync(currentPath)) fs.writeFileSync(currentPath, JSON.stringify(defaultValue));
    return JSON.parse(fs.readFileSync(currentPath));
}

function saveJson(file, data) {
    fs.writeFileSync(dataPath(file), JSON.stringify(data, null, 2));
}

function loadDB() { return loadJson('tickets.json', {}); }
function saveDB(data) { saveJson('tickets.json', data); }

function loadReqDB() { return loadJson('requests.json', {}); }
function saveReqDB(data) { saveJson('requests.json', data); }

function loadAdminsDB() {
    try {
        const parsed = loadJson('admins.json', DEFAULT_ADMIN_IDS);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) { console.log('admins.json пошкоджено — використовую DEFAULT_ADMIN_IDS'); }
    return DEFAULT_ADMIN_IDS;
}

function saveAdminsDB(adminIds) { saveJson('admins.json', adminIds); }

function isAdmin(idStr) {
    return loadAdminsDB().includes(idStr);
}

function loadScannersDB() {
    try {
        const parsed = loadJson('scanners.json', []);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { console.log('scanners.json пошкоджено — використовую порожній список'); }
    return [];
}

function saveScannersDB(scannerIds) { saveJson('scanners.json', scannerIds); }

function isScanner(idStr) {
    return loadScannersDB().includes(idStr);
}

function loadConfigDB() { return loadJson('config.json', { performerTicketsOpen: true }); }
function saveConfigDB(config) { saveJson('config.json', config); }

const TEST_MARK = '🧪 ТЕСТ\n';

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
        buttons.push(['📊 Статистика', Markup.button.webApp('🧪 Тест', TEST_APP_URL)]);
        buttons.push(['➕ Додати адміна', '➖ Видалити адміна']);
        buttons.push([Markup.button.userRequest('➕ Додати сканера', SCANNER_REQUEST_ID)]);
        buttons.push(['🟢 Увімкнути виступаючих', '🔴 Вимкнути виступаючих']);
    }
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
            return ctx.reply(`✅ Прохід дозволено! Квиток погашено.${db[ticketId].test ? ' (тест)' : ''}`);
        }

        try {
            const data = JSON.parse(rawData);
            const userId = ctx.from.id;

            if (!TICKET_TYPES[data.ticket]) {
                return ctx.reply('Помилка даних. Спробуй ще раз.');
            }

            // Тестова покупка можлива лише для головних адмінів — прапорець від інших ігноруємо.
            const isTest = data.test === true && isAdmin(userId.toString());

            if (data.ticket === 'Для виступаючих' && !isTest) {
                const config = loadConfigDB();
                if (config.performerTicketsOpen === false) {
                    return ctx.reply('Продаж квитків для виступаючих ще не відкрито.');
                }
            }

            const price = priceFor(data.ticket);
            const totalSum = data.count * price;

            // ЗБЕРІГАЄМО ЯК ЧЕРНЕТКУ
            const reqDb = loadReqDB();
            reqDb[`draft_${userId}`] = { ticketType: data.ticket, count: data.count, ...(isTest ? { test: true } : {}) };
            saveReqDB(reqDb);

            return ctx.reply(`${isTest ? TEST_MARK : ''}Обрано: ${data.ticket} - ${data.count} шт.\n\nСума: ${totalSum} ₴\nКартка: 💳 4149 6090 6948 0624\n\nКидай скрін чека!`);
        } catch (e) {
            return ctx.reply('Помилка даних. Спробуй ще раз.');
        }
    }
    return next();
});

// Обробка чека: фото або зображення, надіслане файлом (без стиснення)
async function handleReceipt(ctx, fileId, kind) {
    const userId = ctx.from.id;
    const reqDb = loadReqDB();
    const draft = reqDb[`draft_${userId}`];

    if (!draft) return ctx.reply('Спочатку обери квитки через кнопку!');

    // ФІКСУЄМО ТРАНЗАКЦІЮ (ніяких перезаписів)
    const txId = `tx_${Date.now()}_${userId}`;

    reqDb[txId] = {
        userId: userId,
        ticketType: draft.ticketType,
        count: draft.count,
        adminMsgs: [],
        ...(draft.test ? { test: true } : {})
    };

    // Видаляємо чернетку, щоб другий чек не кинули на ті ж дані
    delete reqDb[`draft_${userId}`];

    const caption = `${draft.test ? TEST_MARK : ''}Чек від @${ctx.message.from.username || userId}\nКвитки: ${draft.ticketType} (${draft.count} шт.)`;
    const extra = {
        caption,
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Підтвердити', callback_data: `confirm_${txId}` }],
                [{ text: '❌ Відхилити', callback_data: `reject_${txId}` }]
            ]
        }
    };

    for (const adminId of loadAdminsDB()) {
        try {
            const msg = kind === 'document'
                ? await ctx.telegram.sendDocument(adminId, fileId, extra)
                : await ctx.telegram.sendPhoto(adminId, fileId, extra);
            reqDb[txId].adminMsgs.push({ chatId: adminId, messageId: msg.message_id });
        } catch (e) { console.log(e); }
    }

    saveReqDB(reqDb);
    ctx.reply('Чек полетів до оргів! Очікуй.');
}

bot.on('photo', (ctx) => {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    return handleReceipt(ctx, photo.file_id, 'photo');
});

bot.on('document', (ctx, next) => {
    if (isImageDocument(ctx.message.document)) {
        return handleReceipt(ctx, ctx.message.document.file_id, 'document');
    }
    return next(); // не зображення — далі розбереться обробник "неправильний формат"
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
        const mark = tx.test ? TEST_MARK : '';

        for (let i = 0; i < tx.count; i++) {
            const tId = `NYAKO_${userId}_${Math.random().toString(36).substring(7)}`;
            db[tId] = { used: false, owner: userId, type: tx.ticketType, date: new Date().toISOString(), ...(tx.test ? { test: true } : {}) };
            const qrBuf = await QRCode.toBuffer(tId);
            ticketsToSend.push({ type: 'photo', media: { source: qrBuf } });
        }

        saveDB(db);

        await ctx.telegram.sendMessage(userId, `${mark}Оплата підтверджена! Твої квитки (${tx.count} шт.):`);
        await ctx.telegram.sendMediaGroup(userId, ticketsToSend);

        for (const m of tx.adminMsgs) {
            try {
                await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `${mark}✅ Схвалено адміном @${ctx.from.username || ctx.from.id}\nКвитки: ${tx.ticketType} (${tx.count} шт.)`);
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
        const mark = tx.test ? TEST_MARK : '';
        for (const m of tx.adminMsgs) {
            try { await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, `${mark}❌ Відхилено адміном @${ctx.from.username}`); } catch(e){}
        }
        await ctx.telegram.sendMessage(tx.userId, `${mark}Твій чек відхилено. Звернись до оргів.`);

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

function openPerformerSales(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = true;
    saveConfigDB(config);
    ctx.reply('🟢 Продаж квитків для виступаючих відкрито.');
}

function closePerformerSales(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const config = loadConfigDB();
    config.performerTicketsOpen = false;
    saveConfigDB(config);
    ctx.reply('🔴 Продаж квитків для виступаючих закрито.');
}

function sendStats(ctx) {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const ticketsDb = loadDB();
    const requestsDb = loadReqDB();
    const config = loadConfigDB();
    const stats = computeStats(ticketsDb, requestsDb);

    ctx.reply(formatStatsMessage(stats, config.performerTicketsOpen));
}

bot.command('performer_open', openPerformerSales);
bot.command('performer_close', closePerformerSales);
bot.command('stats', sendStats);

bot.hears('📊 Статистика', sendStats);
bot.hears('🟢 Увімкнути виступаючих', openPerformerSales);
bot.hears('🔴 Вимкнути виступаючих', closePerformerSales);

bot.hears('➕ Додати адміна', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    ctx.reply('Щоб додати адміна, напиши команду:\n/addadmin <telegram_id>\n\nID можна дізнатись командою /myid — нехай новий адмін напише її сам і надішле тобі результат.');
});

bot.hears('➖ Видалити адміна', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');
    const admins = loadAdminsDB();
    ctx.reply(`Щоб видалити адміна, напиши команду:\n/removeadmin <telegram_id>\n\nПоточні адміни:\n${admins.join('\n')}`);
});

// Кнопка "➕ Додати сканера" відкриває список контактів; Telegram повертає вибраних користувачів
bot.on(message('users_shared'), (ctx, next) => {
    const shared = ctx.message.users_shared;
    if (shared.request_id !== SCANNER_REQUEST_ID) return next();
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    let scanners = loadScannersDB();
    const added = [];
    const already = [];
    for (const user of shared.users) {
        const id = user.user_id.toString();
        const result = addAdminId(scanners, id);
        if (result.added) {
            scanners = result.adminIds;
            added.push(id);
        } else {
            already.push(id);
        }
    }

    if (added.length) saveScannersDB(scanners);

    const lines = [];
    if (added.length) lines.push(`✅ Додано сканера: ${added.join(', ')}. Всього сканерів: ${scanners.length}`);
    if (already.length) lines.push(`Вже сканер: ${already.join(', ')}`);
    ctx.reply(lines.join('\n'));
});

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

bot.command('reset_tickets', (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) return ctx.reply('Тільки для оргів!');

    const ticketsDb = loadDB();
    const count = Object.keys(ticketsDb).length;
    const confirmed = ctx.message.text.split(' ')[1] === 'confirm';

    if (!confirmed) {
        return ctx.reply(`⚠️ Це видалить ВСІ ${count} квитків без можливості відновлення.\n\nЩоб підтвердити, напиши: /reset_tickets confirm`);
    }

    saveDB({});
    ctx.reply(`✅ Список квитків очищено. Видалено: ${count}.`);
});

// Останній обробник: усе, що не розпізнали вище. Якщо людина чекає на оплату,
// а надіслала не зображення (посилання, текст, PDF, стікер...) — кажемо, що потрібне саме фото.
bot.on('message', (ctx) => {
    const reqDb = loadReqDB();
    if (reqDb[`draft_${ctx.from.id}`]) {
        return ctx.reply('⚠️ Потрібен саме скріншот чека — зображенням (фото).\nПосилання, текст чи інші файли не підходять. Надішли, будь ласка, скріншот.');
    }
});

bot.catch((err, ctx) => {
    console.log('Помилка обробки оновлення:', err);
});

if (require.main === module) {
    bot.launch();
    console.log('Бот Nyako-kon: анти-скам і фікс синьої кнопки завантажено!');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot };

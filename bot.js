const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf('8770505563:AAEE8UeScHMw-4zJekTODyVuHUdtGcr0K9Q'); 
const ADMIN_ID = '789355423'; 
const APP_URL = 'https://zhutler.github.io/nyako-tickets/app.html?v=4';
const SCANNER_URL = 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1';

// Шлях для Railway Volume (папка /data не стирається при перезапуску)
const dbPath = '/data/tickets.json';

// Перевірка та створення бази
if (!fs.existsSync('/data')) {
    try { fs.mkdirSync('/data'); } catch (e) { console.log('Папка /data відсутня (локальний запуск)'); }
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
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    const buttons = [[Markup.button.webApp('Купити квиток 🎟', APP_URL)]];
    
    if (isAdmin) {
        buttons.push([Markup.button.webApp('📷 Сканер квитків (Адмін)', SCANNER_URL)]);
    }

    ctx.reply(
        'Йо! Вітаємо в офіційному боті Nyako-kon. 🎫\n\nТисни на кнопку, обирай свій квиток, а потім просто кидай чек про оплату сюди в чат.',
        Markup.keyboard(buttons).resize()
    );
});

bot.on('message', async (ctx, next) => {
    if (ctx.message && ctx.message.web_app_data) {
        const data = ctx.message.web_app_data.data;
        
        if (data.startsWith('SCAN:')) {
            const ticketId = data.replace('SCAN:', '');
            const db = loadDB();
            
            if (!db[ticketId]) return ctx.reply('❌ Паль! Такого квитка не існує.');
            if (db[ticketId].used) return ctx.reply('⚠️ Увага! Квиток вже використано.');
            
            db[ticketId].used = true;
            saveDB(db);
            return ctx.reply('✅ Прохід дозволено! Квиток погашено.');
        }
        
        return ctx.reply(`Прийнято! Твій вибір: ${data}.\n\nТепер переказуй гроші на картку:\n💳 4149 6090 6948 0624\n\nІ кидай сюди скрін чека прямо в цей чат! Чекаємо.`);
    }
    return next();
});

bot.on('photo', async (ctx) => {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const userId = ctx.message.from.id;

    await ctx.telegram.sendPhoto(ADMIN_ID, fileId, {
        caption: `Новий чек від @${ctx.message.from.username || userId}\nUser ID: ${userId}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Підтвердити', callback_data: `confirm_${userId}` }],
                [{ text: '❌ Відхилити', callback_data: `reject_${userId}` }]
            ]
        }
    });

    ctx.reply('Чек полетів до оргів на перевірку! Зроби чайку, скоро скинемо квиток.');
});

bot.action(/confirm_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    const ticketId = `NYAKO_${userId}_${Math.random().toString(36).substring(7)}`;
    
    try {
        const db = loadDB();
        db[ticketId] = { used: false, owner: userId, date: new Date().toISOString() };
        saveDB(db);

        const qrBuffer = await QRCode.toBuffer(ticketId);
        await ctx.telegram.sendPhoto(userId, { source: qrBuffer }, {
            caption: 'Оплата підтверджена! 🎉 Ось твій QR-квиток. Збережи його, покажеш волонтерам на вході.'
        });
        await ctx.editMessageCaption('✅ Схвалено. Квиток відправлено.');
    } catch (err) {
        ctx.reply('Помилка генерації QR.');
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    const userId = ctx.match[1];
    await ctx.telegram.sendMessage(userId, 'Твій чек відхилено ❌. Напиши оргам, якщо це помилка.');
    await ctx.editMessageCaption('❌ Відхилено.');
});

bot.launch();
console.log('Бот на Railway стартував!');
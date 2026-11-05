// Налаштування конкретного івенту. Це ЄДИНИЙ файл (разом зі сторінками app.html / scanner.html),
// який відрізняється між ботами Nyako-kon і Dristic-con. Решта коду однакова в обох репозиторіях.
module.exports = {
    name: 'Nyako-kon',
    ticketPrefix: 'NYAKO', // початок ID квитка в QR-коді
    card: '4149 6090 6948 0624',
    // Ціни квитків. Назви мають збігатися з тими, що надсилає app.html.
    prices: {
        'Класичний': 300,
        'Для виступаючих': 250
    },
    // Адміни при першому запуску (далі список живе в admins.json і змінюється з бота).
    defaultAdminIds: ['789355423', '821782817', '678439277', '1672507362', '1089717768', '8595175426'],
    appUrl: 'https://zhutler.github.io/nyako-tickets/app.html?v=6',
    scannerUrl: 'https://zhutler.github.io/nyako-tickets/scanner.html?v=1'
};

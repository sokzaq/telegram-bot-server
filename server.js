const { Telegraf } = require('telegraf');
const express = require('express');
const fs = require('fs').promises;
const axios = require('axios');
const app = express();

const TELEGRAM_BOT_TOKEN = '7784941820:AAHRvrpswOAR0iEvtlRlh2rXLSU0_ZBIqSA';
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const CHAT_ID = '@AFK_Co1n';
const PORT = process.env.PORT || 3000;
const DATA_FILE = 'users.json';

app.use(express.json());

// CORS для всех запросов
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Инициализация или проверка файла данных
async function initializeData() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '{"users": {}}', 'utf8');
  }
}

// Чтение и запись данных
async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { users: {} };
  }
}

async function writeData(data) {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Write error:', error);
  }
}

// Обновление баллов и рефералов каждые 10 секунд
async function updatePoints() {
  const data = await readData();
  const now = Date.now();

  for (const userId in data.users) {
    const user = data.users[userId];
    const timeDiff = (now - (user.lastUpdate || now)) / 1000;
    const intervals = Math.floor(timeDiff / 10);
    if (intervals > 0 && user.isTelegramUser) { // Начисление только для Telegram-пользователей
      user.points = (user.points || 0) + (intervals * 0.001);
      user.lastUpdate = now - ((timeDiff % 10) * 1000);

      if (user.referrals) {
        for (const referralId of user.referrals) {
          if (data.users[referralId] && data.users[referralId].isTelegramUser) {
            const referral = data.users[referralId];
            const referralNewIncome = (referral.points || 0) - (referral.lastPoints || 0);
            const referralEarnings = referralNewIncome * 0.001;
            if (referralEarnings > 0) {
              user.points += referralEarnings;
              user.referralEarnings = (user.referralEarnings || 0) + referralEarnings;
            }
            referral.lastPoints = referral.points || 0;
          }
        }
      }
      user.lastPoints = user.points;
    }
  }

  await writeData(data);
}

// Обработка запуска Mini App
bot.on('web_app_data', async (ctx) => {
  const userId = ctx.from.id.toString();
  const data = await readData();
  if (data.users[userId]) {
    data.users[userId].isTelegramUser = true;
    await writeData(data);
  }
});

// Команда /start без отправки сообщений
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.username || 'Anonymous';
  const referralCode = ctx.message.text.split(' ')[1] || '';

  const data = await readData();
  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], referralEarnings: 0, isTelegramUser: false };
    if (referralCode && data.users[referralCode]) {
      data.users[referralCode].referrals.push(userId);
      data.users[userId].referredBy = referralCode;
    }
    await writeData(data);
  }
});

// Проверка подписки
async function checkSubscription(userId) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember`, {
      params: { chat_id: CHAT_ID, user_id: userId },
    });
    return response.data.ok && ['member', 'administrator', 'creator'].includes(response.data.result.status);
  } catch (error) {
    console.error('Subscription check error:', error.message);
    return false;
  }
}

// Эндпоинты API с ограничением
app.get('/user/:userId', async (req, res) => {
  const userId = req.params.userId;
  const data = await readData();
  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username: req.query.username || 'Anonymous', points: 0, lastUpdate: Date.now(), referrals: [], referralEarnings: 0, isTelegramUser: false };
    await writeData(data);
  }
  if (!data.users[userId].isTelegramUser) {
    return res.status(403).json({ error: 'Access denied. Use Telegram Mini App to earn points.' });
  }
  res.json(data.users[userId]);
});

app.get('/leaderboard', async (req, res) => {
  const data = await readData();
  const leaderboard = Object.entries(data.users)
    .filter(([, user]) => user.isTelegramUser)
    .map(([id, user]) => ({ username: user.username || id, points: user.points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
  res.json(leaderboard);
});

app.get('/referrals/:userId', async (req, res) => {
  const userId = req.params.userId;
  const data = await readData();
  const user = data.users[userId] || { referrals: [], referralEarnings: 0 };
  if (!user.isTelegramUser) {
    return res.status(403).json({ error: 'Access denied. Use Telegram Mini App to earn points.' });
  }
  const referrals = await Promise.all(
    user.referrals.map(async (referralId) => {
      const referral = data.users[referralId] || { points: 0, username: 'Unknown' };
      const referralEarnings = ((referral.points || 0) - (referral.lastPoints || 0)) * 0.001;
      return { referralId, username: referral.username, points: referral.points, expectations: referralEarnings };
    })
  );
  res.json({ referrals, totalReferralEarnings: user.referralEarnings || 0 });
});

app.get('/start/:referralCode', async (req, res) => {
  const referralCode = req.params.referralCode;
  const userId = req.query.userId || Date.now().toString();
  const username = req.query.username || 'Anonymous';
  const data = await readData();
  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], referralEarnings: 0, isTelegramUser: false };
    if (referralCode && data.users[referralCode]) {
      data.users[referralCode].referrals.push(userId);
      data.users[userId].referredBy = referralCode;
    }
    await writeData(data);
  }
  if (!data.users[userId].isTelegramUser) {
    return res.status(403).json({ error: 'Access denied. Use Telegram Mini App to earn points.' });
  }
  res.json({ userId, message: 'Referral activated' });
});

app.post('/check-subscription', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const subscribed = await checkSubscription(userId);
  res.json({ subscribed });
});

// Запуск
(async () => {
  await initializeData();
  bot.launch();
  setInterval(updatePoints, 10000); // 10 секунд
  app.listen(PORT, () => console.log(`Server on port ${PORT}`));
})();

// Остановка бота
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

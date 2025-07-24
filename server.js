const { Telegraf } = require('telegraf');
const express = require('express');
const fs = require('fs').promises;
const axios = require('axios');
const app = express();

const TELEGRAM_BOT_TOKEN = '7784941820:AAEGj1qqZsBaj-G9g3qVsAm7XcSRraJ-y8o';
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const CHAT_ID = '@AFK_Co1n';
const PORT = process.env.PORT || 10000;
const DATA_FILE = 'users.json';

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Инициализация данных
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
    console.error('Ошибка записи данных:', error);
  }
}

// Обновление баллов
async function updatePoints() {
  const data = await readData();
  const now = Date.now();
  for (const userId in data.users) {
    const user = data.users[userId];
    if (!user.isTelegramUser) continue; // Пропускаем неподписанных пользователей
    const timeDiff = (now - (user.lastUpdate || now)) / 1000;
    const intervals = Math.floor(timeDiff / 10);
    if (intervals > 0) {
      user.points = (user.points || 0) + intervals * 0.001;
      user.lastUpdate = now - ((timeDiff % 10) * 1000);
      if (user.referrals && user.referrals.length > 0) {
        let referralEarnings = 0;
        for (const referralId of user.referrals) {
          if (data.users[referralId]?.isTelegramUser) {
            const referral = data.users[referralId];
            const earnings = ((referral.points || 0) - (referral.lastPoints || 0)) * 0.1; // 10% от баллов реферала
            if (earnings > 0) {
              referralEarnings += earnings;
              referral.lastPoints = referral.points || 0;
            }
          }
        }
        user.referralEarnings = (user.referralEarnings || 0) + referralEarnings;
        user.points += referralEarnings;
      }
      user.lastPoints = user.points || 0;
    }
  }
  await writeData(data);
}

// Обработка рефералов
async function processReferral(userId, username, referralCode = '') {
  const data = await readData();
  console.log(`Обработка реферала: userId=${userId}, referralCode=${referralCode}, existingUser=${!!data.users[userId]}`);
  if (!data.users[userId]) {
    data.users[userId] = {
      telegramId: userId,
      username,
      points: 0,
      lastUpdate: Date.now(),
      referrals: [],
      referralEarnings: 0,
      isTelegramUser: false,
      referredBy: referralCode && referralCode !== userId ? referralCode : null
    };
    if (referralCode && data.users[referralCode] && referralCode !== userId) {
      data.users[referralCode].referrals.push(userId);
      console.log(`Реферал зарегистрирован: ${userId} для ${referralCode}`);
    }
    await writeData(data);
    return { success: true, message: 'Пользователь зарегистрирован' };
  } else if (referralCode && !data.users[userId].referredBy && data.users[referralCode] && referralCode !== userId) {
    data.users[userId].referredBy = referralCode;
    data.users[referralCode].referrals.push(userId);
    console.log(`Реферал привязан: ${userId} к ${referralCode}`);
    await writeData(data);
    return { success: true, message: 'Реферал активирован' };
  }
  return { success: false, message: 'Пользователь уже зарегистрирован или реферал недействителен' };
}

// Проверка подписки
async function checkSubscription(userId) {
  console.log(`Проверка подписки для userId=${userId}`);
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember`, {
      params: { chat_id: CHAT_ID, user_id: userId }
    });
    const data = response.data;
    if (data.ok && ['member', 'administrator', 'creator'].includes(data.result.status)) {
      const userData = await readData();
      if (userData.users[userId]) {
        userData.users[userId].isTelegramUser = true;
        await writeData(userData);
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('Ошибка проверки подписки:', error.message);
    return false;
  }
}

// Эндпоинты API
app.get('/user/:userId', async (req, res) => {
  const userId = req.params.userId;
  const username = req.query.username || 'Anonymous';
  const data = await readData();
  if (!data.users[userId]) {
    await processReferral(userId, username);
  }
  const user = data.users[userId] || {};
  if (!user.isTelegramUser) {
    return res.status(403).json({ error: 'Доступ запрещён. Подпишитесь, чтобы зарабатывать.' });
  }
  res.json(user);
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
    return res.status(403).json({ error: 'Доступ запрещён. Подпишитесь, чтобы зарабатывать.' });
  }
  const referrals = user.referrals.map(referralId => {
    const referral = data.users[referralId] || { points: 0, username: 'Unknown' };
    return { referralId, username: referral.username, points: referral.points };
  });
  res.json({ referrals, totalReferralEarnings: user.referralEarnings || 0 });
});

app.post('/start', async (req, res) => { // Изменяем маршрут на /start
  const { userId, username, referralCode } = req.body;
  console.log('Получен запрос на активацию реферала:', { userId, username, referralCode });

  if (!userId || !username || !referralCode) {
    return res.status(400).json({ error: 'Требуются userId, username и referralCode' });
  }

  const result = await processReferral(userId, username, referralCode);
  res.json(result);
});

app.post('/check-subscription', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Требуется userId' });
  const subscribed = await checkSubscription(userId);
  res.json({ subscribed });
});

// Webhook и запуск
const WEBHOOK_URL = 'https://telegram-bot-server-ixsp.onrender.com';
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`).catch(error => {
  console.error('Ошибка установки webhook:', error);
});

setInterval(updatePoints, 10000);

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  initializeData().catch(console.error);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

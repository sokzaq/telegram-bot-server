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
    console.error('Write error:', error);
  }
}

// Обновление баллов
async function updatePoints() {
  const data = await readData();
  const now = Date.now();
  for (const userId in data.users) {
    const user = data.users[userId];
    const timeDiff = (now - (user.lastUpdate || now)) / 1000;
    const intervals = Math.floor(timeDiff / 10);
    if (intervals > 0 && user.isTelegramUser) {
      user.points = (user.points || 0) + (intervals * 0.001);
      user.lastUpdate = now - ((timeDiff % 10) * 1000);
      if (user.referrals) {
        for (const referralId of user.referrals) {
          if (data.users[referralId]?.isTelegramUser) {
            const referral = data.users[referralId];
            const referralEarnings = ((referral.points || 0) - (referral.lastPoints || 0)) * 0.001;
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

// Обработка рефералов
async function processReferral(userId, username, referralCode = '') {
  const data = await readData();
  console.log(`Processing referral for userId: ${userId}, referralCode: ${referralCode}`);
  if (!data.users[userId]) {
    data.users[userId] = {
      telegramId: userId,
      username,
      points: 0,
      lastUpdate: Date.now(),
      referrals: [],
      referralEarnings: 0,
      isTelegramUser: false,
      referredBy: referralCode ? referralCode.replace('ref_', '') : null
    };
    if (referralCode && data.users[referralCode.replace('ref_', '')]) {
      if (!data.users[referralCode.replace('ref_', '')].referrals.includes(userId)) {
        data.users[referralCode.replace('ref_', '')].referrals.push(userId);
        console.log(`Referral activated: ${userId} referred by ${referralCode.replace('ref_', '')}`);
      }
    }
    await writeData(data);
    return { success: true, message: 'User registered' };
  }
  if (referralCode && !data.users[userId].referredBy && data.users[referralCode.replace('ref_', '')]) {
    if (!data.users[referralCode.replace('ref_', '')].referrals.includes(userId)) {
      data.users[referralCode.replace('ref_', '')].referrals.push(userId);
      data.users[userId].referredBy = referralCode.replace('ref_', '');
      await writeData(data);
      console.log(`Referral linked: ${userId} referred by ${referralCode.replace('ref_', '')}`);
      return { success: true, message: 'Referral activated' };
    }
  }
  return { success: false, message: 'User already registered' };
}

// Команда /start
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.username || 'Anonymous';
  const referralCode = ctx.startParam || (ctx.message.text.includes('/start ') ? ctx.message.text.split(' ')[1] : '');
  const result = await processReferral(userId, username, referralCode);
  await ctx.reply(result.message || 'Добро пожаловать! Используйте мини-приложение.');
});

// Проверка подписки
async function checkSubscription(userId) {
  console.log(`Checking subscription for userId: ${userId}`);
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember`, {
      params: { chat_id: CHAT_ID, user_id: userId }
    });
    const data = response.data;
    if (data.ok && ['member', 'administrator', 'creator'].includes(data.result.status)) {
      const userData = await readData();
      if (userData.users[userId] && !userData.users[userId].isTelegramUser) {
        userData.users[userId].isTelegramUser = true;
        await writeData(userData);
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('Subscription check error:', error.message);
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
    return res.status(403).json({ error: 'Access denied. Subscribe to earn points.' });
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
    return res.status(403).json({ error: 'Access denied. Subscribe to earn points.' });
  }
  const referrals = user.referrals.map(referralId => {
    const referral = data.users[referralId] || { points: 0, username: 'Unknown' };
    const referralEarnings = ((referral.points || 0) - (referral.lastPoints || 0)) * 0.001;
    return { referralId, username: referral.username, points: referral.points, earnings: referralEarnings };
  });
  res.json({ referrals, totalReferralEarnings: user.referralEarnings || 0 });
});

app.get('/referral/:refCode', async (req, res) => {
  console.log('Received referral request - params:', req.params, 'query:', req.query);
  const refCode = req.params.refCode;
  const userId = req.query.userId;
  const username = req.query.username || 'Anonymous';
  if (!userId || !refCode.startsWith('ref_')) {
    return res.status(400).json({ error: 'Invalid referral code or userId' });
  }
  const result = await processReferral(userId, username, refCode);
  if (result.success) {
    res.json({ userId, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.post('/check-subscription', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const subscribed = await checkSubscription(userId);
  res.json({ subscribed });
});

// Webhook и запуск
const WEBHOOK_URL = 'https://telegram-bot-server-ixsp.onrender.com';
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);

setInterval(updatePoints, 10000);

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  initializeData().catch(console.error);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

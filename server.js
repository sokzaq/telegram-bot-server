const { Telegraf } = require('telegraf');
const express = require('express');
const fs = require('fs').promises;
const app = express();
const dataFile = 'users.json';

// Токен бота
const TELEGRAM_BOT_TOKEN = '7784941820:AAHRvrpswOAR0iEvtlRlh2rXLSU0_ZBIqSA';
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

app.use(express.json());

// Middleware для CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Инициализация файла данных
async function initializeDataFile() {
  try {
    await fs.access(dataFile);
  } catch (error) {
    console.log('Creating users.json');
    await fs.writeFile(dataFile, '{"users": {}}', 'utf8');
  }
}

// Чтение данных
async function readData() {
  try {
    const data = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { users: {} };
  }
}

// Запись данных
async function writeData(data) {
  try {
    await fs.copyFile(dataFile, 'users_backup.json');
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing data:', error);
  }
}

// Обработка команды /start
bot.start(async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const userId = ctx.from.id.toString();
  const username = ctx.from.username || 'Anonymous';
  const referralCode = ctx.message.text.split(' ')[1] || '';

  const data = await readData();

  const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
  if (!existingUser) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], lastPoints: 0, referralEarnings: 0 };
    if (referralCode && data.users[referralCode]) {
      data.users[referralCode].referrals.push(userId);
      data.users[userId].referredBy = referralCode;
      console.log(`Registered referral: ${userId} for ${referralCode}`);
    }
    await writeData(data);
  }

  const webAppUrl = referralCode
    ? `https://sokzaq.github.io/telegram-bot-frontend/?start=${referralCode}`
    : 'https://sokzaq.github.io/telegram-bot-frontend/';

  await ctx.reply('Добро пожаловать! Нажмите "Open" для запуска.', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open', web_app: { url: webAppUrl } }]]
    }
  });
});

// Обновление баллов каждую секунду
setInterval(async () => {
  const data = await readData();
  const now = Date.now();

  for (const userId in data.users) {
    const user = data.users[userId];
    const lastUpdate = user.lastUpdate || now;
    const timeDiff = (now - lastUpdate) / 1000;

    const previousPoints = user.points || 0;
    user.points = (user.points || 0) + (timeDiff * 0.0001);
    user.lastUpdate = now;

    const newIncome = user.points - previousPoints;

    if (user.referrals) {
      for (const referralId of user.referrals) {
        if (data.users[referralId]) {
          const referral = data.users[referralId];
          const referralPreviousPoints = referral.lastPoints || 0;
          const referralNewPoints = referral.points || 0;
          const referralNewIncome = referralNewPoints - referralPreviousPoints;

          const referralEarnings = referralNewIncome * 0.001;
          if (referralEarnings > 0) {
            user.points += referralEarnings;
            user.referralEarnings = (user.referralEarnings || 0) + referralEarnings;
          }

          referral.lastPoints = referralNewPoints;
        }
      }
    }

    user.lastPoints = user.points;
  }

  await writeData(data);
}, 1000);

// Эндпоинт для получения баланса
app.get('/user/:userId', async (req, res) => {
  const userId = req.params.userId;
  const data = await readData();

  const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
  if (existingUser && existingUser !== userId) {
    res.status(400).json({ error: 'This Telegram ID is already registered' });
    return;
  }

  if (!data.users[userId]) {
    const username = req.query.username || 'Anonymous';
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], lastPoints: 0, referralEarnings: 0 };
    await writeData(data);
  }

  res.json(data.users[userId]);
});

// Эндпоинт для лидерборда
app.get('/leaderboard', async (req, res) => {
  const data = await readData();
  const leaderboard = Object.entries(data.users)
    .map(([userId, user]) => ({ username: user.username || userId, points: user.points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
  res.json(leaderboard);
});

// Эндпоинт для рефералов
app.get('/referrals/:userId', async (req, res) => {
  const userId = req.params.userId;
  const data = await readData();
  const user = data.users[userId] || { referrals: [], referralEarnings: 0 };
  const referralsData = await Promise.all(
    user.referrals.map(async (referralId) => {
      const referral = data.users[referralId] || { points: 0, lastPoints: 0 };
      const referralEarnings = ((referral.points || 0) - (referral.lastPoints || 0)) * 0.0001;
      return { referralId, points: referral.points, expectations: referralEarnings };
    })
  );
  res.json({ referrals: referralsData, totalReferralEarnings: user.referralEarnings || 0 });
});

// Эндпоинт для активации реферала
app.get('/start/:referralCode', async (req, res) => {
  const referralCode = req.params.referralCode;
  const userId = req.query.userId || Date.now().toString();
  const username = req.query.username || 'Anonymous';
  const data = await readData();

  const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
  if (existingUser) {
    res.status(400).json({ error: 'This Telegram ID is already registered' });
    return;
  }

  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], lastPoints: 0, referralEarnings: 0 };
  }

  if (referralCode && data.users[referralCode]) {
    data.users[referralCode].referrals.push(userId);
    data.users[userId].referredBy = referralCode;
  }

  await writeData(data);
  res.json({ userId, message: 'Referral activated via start' });
});

// Временный эндпоинт для сброса данных
app.get('/reset-users', async (req, res) => {
  await fs.writeFile(dataFile, '{"users": {}}', 'utf8');
  res.json({ message: 'users.json reset' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
initializeDataFile().then(() => {
  bot.launch();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

// Остановка бота при завершении процесса
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

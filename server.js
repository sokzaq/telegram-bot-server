const express = require('express');
const fs = require('fs').promises;
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const dataFile = 'users.json';

// Токен вашего бота
const TELEGRAM_BOT_TOKEN = '7784941820:AAHRvrpswOAR0iEvtlRlh2rXLSU0_ZBIqSA';

// Настройка бота
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

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
    console.log('users.json exists');
  } catch (error) {
    console.log('Creating users.json');
    await fs.writeFile(dataFile, '{"users": {}}', 'utf8');
  }
}

// Чтение данных
async function readData() {
  const data = await fs.readFile(dataFile, 'utf8');
  console.log('Raw data from file:', data);
  return JSON.parse(data);
}

// Запись данных с резервным копированием
async function writeData(data) {
  console.log('Writing data:', data);
  try {
    await fs.copyFile(dataFile, 'users_backup.json');
    console.log('Backup created: users_backup.json');
  } catch (error) {
    console.error('Error creating backup:', error);
  }
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

// Обновление баллов каждую секунду
setInterval(async () => {
  try {
    const data = await readData();
    const now = Date.now();

    console.log('Updating points at:', new Date(now).toISOString());
    for (const userId in data.users) {
      const user = data.users[userId];
      const lastUpdate = user.lastUpdate || now;
      const timeDiff = (now - lastUpdate) / 1000;
      user.points = (user.points || 0) + (timeDiff * 0.0001);
      user.lastUpdate = now;

      if (user.referrals) {
        for (const referralId of user.referrals) {
          if (data.users[referralId]) {
            const referralEarnings = (data.users[referralId].points || 0) * 0.0001;
            user.points += referralEarnings;
            console.log(`Added ${referralEarnings} to ${userId} from referral ${referralId}`);
          }
        }
      }
    }

    await writeData(data);
  } catch (error) {
    console.error('Error updating points:', error);
  }
}, 1000);

// Обработка команды /start
bot.onText(/\/start(?:\s+(\S+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1]; // Параметр после /start (например, userId)

  console.log(`Received /start from chatId=${chatId}, referralCode=${referralCode}`);

  const webAppUrl = referralCode
    ? `https://sokzaq.github.io/telegram-bot-frontend/?start=${referralCode}`
    : `https://sokzaq.github.io/telegram-bot-frontend/`;

  bot.sendMessage(chatId, 'Нажмите ниже, чтобы открыть приложение:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Open',
            web_app: { url: webAppUrl }
          }
        ]
      ]
    }
  });
});

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
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [] };
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
  const user = data.users[userId] || { referrals: [] };
  const referralsData = await Promise.all(
    user.referrals.map(async (referralId) => {
      const referral = data.users[referralId] || { points: 0 };
      const referralEarnings = (referral.points || 0) * 0.0001;
      return { referralId, points: referral.points, earnings: referralEarnings };
    })
  );
  res.json({ referrals: referralsData });
});

// Эндпоинт для активации реферала через start
app.get('/start/:referralCode', async (req, res) => {
  const referralCode = req.params.referralCode;
  const userId = req.query.userId || Date.now().toString();
  const username = req.query.username || 'Anonymous';
  const data = await readData();

  console.log(`Received /start request: referralCode=${referralCode}, userId=${userId}, username=${username}`);

  const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
  if (existingUser) {
    console.log(`User ${userId} already registered`);
    res.status(400).json({ error: 'This Telegram ID is already registered' });
    return;
  }

  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [] };
  }

  if (data.users[referralCode]) {
    data.users[referralCode].referrals.push(userId);
    data.users[userId].referredBy = referralCode;
    console.log(`Added referral: ${userId} to ${referralCode}`);
  }

  await writeData(data);

  res.json({ userId, message: 'Referral activated via start' });
});

// Временный эндпоинт для сброса данных (для тестирования)
app.get('/reset-users', async (req, res) => {
  await fs.writeFile(dataFile, '{"users": {}}', 'utf8');
  res.json({ message: 'users.json reset' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
initializeDataFile().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

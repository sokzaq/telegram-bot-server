const express = require('express');
const fs = require('fs').promises;
const axios = require('axios');
const app = express();
const dataFile = 'users.json';

// Токен вашего бота
const TELEGRAM_BOT_TOKEN = '7784941820:AAHRvrpswOAR0iEvtlRlh2rXLSU0_ZBIqSA';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Middleware для парсинга JSON
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

            const referralEarnings = referralNewIncome * 0.0001;
            if (referralEarnings > 0) {
              user.points += referralEarnings;
              user.referralEarnings = (user.referralEarnings || 0) + referralEarnings;
              console.log(`Added ${referralEarnings} to ${userId} from referral ${referralId}, total referral earnings: ${user.referralEarnings}`);
            }

            referral.lastPoints = referralNewPoints;
          }
        }
      }

      user.lastPoints = user.points;
    }

    await writeData(data);
  } catch (error) {
    console.error('Error updating points:', error);
  }
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
      return { referralId, points: referral.points, earnings: referralEarnings };
    })
  );
  res.json({ referrals: referralsData, totalReferralEarnings: user.referralEarnings || 0 });
});

// Эндпоинт для активации реферала через start
app.get('/start/:referralCode', async (req, res) => {
  const referralCode = req.params.referralCode;
  const userId = req.query.userId || Date.now().toString();
  const username = req.query.username || 'Anonymous';
  const chatId = userId;
  const data = await readData();

  const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
  if (existingUser) {
    res.status(400).json({ error: 'This Telegram ID is already registered' });
    return;
  }

  if (!data.users[userId]) {
    data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], lastPoints: 0, referralEarnings: 0 };
  }

  if (data.users[referralCode]) {
    data.users[referralCode].referrals.push(userId);
    data.users[userId].referredBy = referralCode;
  }

  await writeData(data);

  try {
    const webAppUrl = `https://sokzaq.github.io/telegram-bot-frontend/?start=${referralCode}`;
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: 'Добро пожаловать в AFK2earn_bot! Нажмите ниже, чтобы открыть приложение и начать зарабатывать.',
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
    console.log(`Sent inline button to user ${userId}`);
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }

  res.json({ userId, message: 'Referral activated via start' });
});

// Эндпоинт для вебхука
app.post('/webhook', async (req, res) => {
  const update = req.body;

  if (update.message && update.message.text) {
    const chatId = update.message.chat.id.toString();
    const text = update.message.text;
    const userId = update.message.from.id.toString();
    const username = update.message.from.username || 'Anonymous';

    if (text.startsWith('/start')) {
      const referralCode = text.split(' ')[1] || ''; // Извлекаем параметр start
      const data = await readData();

      const existingUser = Object.keys(data.users).find(id => data.users[id].telegramId === userId);
      if (!existingUser) {
        data.users[userId] = { telegramId: userId, username, points: 0, lastUpdate: Date.now(), referrals: [], lastPoints: 0, referralEarnings: 0 };
        if (referralCode && data.users[referralCode]) {
          data.users[referralCode].referrals.push(userId);
          data.users[userId].referredBy = referralCode;
        }
        await writeData(data);
      }

      const webAppUrl = referralCode
        ? `https://sokzaq.github.io/telegram-bot-frontend/?start=${referralCode}`
        : 'https://sokzaq.github.io/telegram-bot-frontend/';

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: 'Добро пожаловать в AFK2earn_bot! Нажмите ниже, чтобы открыть приложение и начать зарабатывать.',
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
    }
  }

  res.sendStatus(200);
});

// Временный эндпоинт для сброса данных (для тестирования)
app.get('/reset-users', async (req, res) => {
  await fs.writeFile(dataFile, '{"users": {}}', 'utf8');
  res.json({ message: 'users.json reset' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
initializeDataFile().then(async () => {
  // Устанавливаем вебхук
  const webhookUrl = 'https://telegram-bot-server-1xsp.onrender.com/webhook';
  try {
    await axios.post(`${TELEGRAM_API}/setWebhook`, {
      url: webhookUrl
    });
    console.log(`Webhook set to ${webhookUrl}`);
  } catch (error) {
    console.error('Error setting webhook:', error);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

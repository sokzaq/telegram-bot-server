const express = require('express');
     const fs = require('fs').promises;
     const app = express();
     const dataFile = 'users.json';

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
         await fs.writeFile(dataFile, JSON.stringify({ users: {} }, null, 2));
       }
     }

     // Чтение данных
     async function readData() {
       const data = await fs.readFile(dataFile, 'utf8');
       return JSON.parse(data);
     }

     // Запись данных
     async function writeData(data) {
       console.log('Writing data:', data);
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
           user.points = (user.points || 0) + (timeDiff * 0.0001); // 0.0001 балла в секунду
           user.lastUpdate = now;

           // Реферальная система: 0.01% от доходности рефералов
           if (user.referrals) {
             for (const referralId of user.referrals) {
               if (data.users[referralId]) {
                 const referralEarnings = (data.users[referralId].points || 0) * 0.0001; // 0.01%
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

     // Эндпоинт для получения баланса
     app.get('/user/:userId', async (req, res) => {
       const userId = req.params.userId;
       const data = await readData();

       if (!data.users[userId]) {
         data.users[userId] = { points: 0, lastUpdate: Date.now(), referrals: [] };
         await writeData(data);
       }

       console.log(`Returning data for user ${userId}:`, data.users[userId]);
       res.json(data.users[userId]);
     });

     // Эндпоинт для лидерборда
     app.get('/leaderboard', async (req, res) => {
       const data = await readData();
       const leaderboard = Object.entries(data.users)
         .map(([userId, user]) => ({ userId, points: user.points }))
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
           return { referralId, points: referral.points };
         })
       );
       res.json({ referrals: referralsData });
     });

     // Эндпоинт для активации реферала
     app.get('/refer/:referralCode', async (req, res) => {
       const referralCode = req.params.referralCode;
       const data = await readData();

       // Простая генерация userId (можно улучшить)
       const userId = Date.now().toString();
       if (!data.users[userId]) {
         data.users[userId] = { points: 0, lastUpdate: Date.now(), referrals: [] };
       }

       // Добавляем реферала к спонсору
       if (data.users[referralCode]) {
         data.users[referralCode].referrals.push(userId);
         data.users[userId].referredBy = referralCode;
       }

       await writeData(data);
       res.json({ userId, message: 'Referral activated' });
     });

     // Запуск сервера
     const PORT = process.env.PORT || 3000;
     initializeDataFile().then(() => {
       app.listen(PORT, () => {
         console.log(`Server running on port ${PORT}`);
       });
     });
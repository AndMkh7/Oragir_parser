require('dotenv').config();
const cron = require('node-cron');
const { scrapeGrades } = require('./scraper');
const { startBot, stopBot, setCheckHandler, sendGradeNotification, sendNoNewGrades, sendError } = require('./telegram');

let isRunning = false;

async function checkGrades(replyToChatId) {
  if (isRunning) {
    console.log('Already running, skipping...');
    return;
  }
  isRunning = true;
  console.log(`[${new Date().toLocaleString()}] Checking grades...`);
  try {
    const newGrades = await scrapeGrades();
    if (newGrades.length > 0) {
      await sendGradeNotification(newGrades, replyToChatId);
      console.log(`Found ${newGrades.length} new grade(s)`);
    } else {
      console.log('No new grades');
      if (replyToChatId) await sendNoNewGrades(replyToChatId);
    }
  } catch (err) {
    console.error('Error:', err.message);
    await sendError(err.message, replyToChatId);
  } finally {
    isRunning = false;
  }
}

// If --once flag, run once and exit
if (process.argv.includes('--once')) {
  checkGrades().then(() => process.exit(0));
} else {
  // Start Telegram bot with /check command
  startBot();
  setCheckHandler((chatId) => checkGrades(chatId));

  // Run 3 times a day: 10:00, 15:00, 20:00
  cron.schedule('0 10,15,20 * * *', () => checkGrades());
  console.log('Scheduler started. Checking grades at 10:00, 15:00, 20:00');
}

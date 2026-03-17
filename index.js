require('dotenv').config();
const cron = require('node-cron');
const { scrapeGrades } = require('./scraper');
const { startBot, setCheckHandler, sendGradeNotification, sendNoNewGrades, sendError } = require('./telegram');

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
      await sendNoNewGrades(replyToChatId);
    }
  } catch (err) {
    console.error('Error:', err.message);
    await sendError(err.message, replyToChatId);
  } finally {
    isRunning = false;
  }
}

// Start Telegram bot and wire up /check command
startBot();
setCheckHandler(checkGrades);

// Run initial check
checkGrades();

// Schedule automatic checks every 30 minutes
cron.schedule('*/30 * * * *', () => {
  checkGrades();
});

console.log('Running. Press Ctrl+C to stop.');

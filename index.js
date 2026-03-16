require('dotenv').config();
const { scrapeGrades } = require('./scraper');
const { sendGradeNotification, sendNoNewGrades, sendError } = require('./telegram');

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

// Run once and exit
checkGrades().then(() => process.exit(0));

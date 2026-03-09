const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const GRADES_FILE = path.join(__dirname, 'grades.json');
const chatIds = process.env.TELEGRAM_CHAT_ID.split(',').map((id) => id.trim());
let bot;
let onCheckCommand = null;

const ALL_SUBJECTS = [
  '\u0544\u0561\u0575\u0580\u0565\u0576\u056B',
  '\u0544\u0561\u0569\u0565\u0574\u0561\u057F\u056B\u056F\u0561',
  '\u0531\u0576\u0563\u056C\u0565\u0580\u0565\u0576',
  '\u054C\u0578\u0582\u057D\u0561\u0581 \u056C\u0565\u0566\u0578\u0582',
  '\u0532\u0576\u0578\u0582\u0569\u0575\u0578\u0582\u0576',
  '\u053B\u0574 \u0570\u0561\u0575\u0580\u0565\u0576\u056B\u0584',
  '\u053F\u0565\u0580\u057A\u0561\u0580\u057E\u0565\u057D\u057F',
  '\u0535\u0580\u0561\u056A\u0577\u057F\u0578\u0582\u0569\u0575\u0578\u0582\u0576',
  '\u0556\u056B\u0566\u056F\u0578\u0582\u056C\u057F\u0578\u0582\u0580\u0561',
  '\u0539\u057E\u0561\u0575\u056B\u0576 \u0563\u0580\u0561\u0563\u056B\u057F\u0578\u0582\u0569\u0575\u0578\u0582\u0576 \u0587 \u0570\u0561\u0574\u0561\u056F\u0561\u0580\u0563\u0579\u0561\u0575\u056B\u0576 \u0563\u056B\u057F\u0578\u0582\u0569\u0575\u0578\u0582\u0576',
  '\u054F\u0565\u056D\u0576\u0578\u056C\u0578\u0563\u056B\u0561',
];

function startBot() {
  const botStartTime = Math.floor(Date.now() / 1000);
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

  const OFFLINE_MSG = 'Խնդրում ենք ստուգեք սերվերի աշխատանքը, այն կարծես թե անջատված էր.';

  function isOldMessage(msg) {
    return msg.date < botStartTime;
  }

  bot.onText(/\/start/, (msg) => {
    if (isOldMessage(msg)) { bot.sendMessage(msg.chat.id, OFFLINE_MSG); return; }
    bot.sendMessage(msg.chat.id, `Привет! Твой chat ID: ${msg.chat.id}\n\nКоманды:\n/check — ստուգել նոր գնահատականները\n/mijin — միջին գնահատականները սըտ առարկաների\n/bolor — բոլոր գնահատականները ըստ առարկաների`);
  });

  bot.onText(/\/mijin/, (msg) => {
    if (isOldMessage(msg)) { bot.sendMessage(msg.chat.id, OFFLINE_MSG); return; }
    handleMijin(msg.chat.id);
  });

  bot.onText(/\/bolor/, (msg) => {
    if (isOldMessage(msg)) { bot.sendMessage(msg.chat.id, OFFLINE_MSG); return; }
    handleBolor(msg.chat.id);
  });

  bot.onText(/\/check/, async (msg) => {
    if (isOldMessage(msg)) { bot.sendMessage(msg.chat.id, OFFLINE_MSG); return; }
    if (onCheckCommand) {
      await bot.sendMessage(msg.chat.id, 'Ստուգում եմ նոր գնահատականները...');
      await onCheckCommand(msg.chat.id);
    }
  });

  console.log('Telegram bot started (polling mode)');
}

function setCheckHandler(handler) {
  onCheckCommand = handler;
}

async function sendGradeNotification(grades, targetChatId) {
  if (!grades.length) return;

  let message = `📚 <b>Նոր գնահատականները ֊ </b>\n\n`;
  for (const g of grades) {
    message += `📅 <i>${g.date}</i> | <b>${g.subject}</b> | Գնահատական ֊ <code>${g.grade}</code>\n`;
  }

  const targets = targetChatId ? [targetChatId] : chatIds;
  for (const id of targets) {
    await bot.sendMessage(id, message, { parse_mode: 'HTML' });
  }
  console.log(`Sent ${grades.length} grade(s) to Telegram`);
}

async function sendNoNewGrades(targetChatId) {
  const targets = targetChatId ? [targetChatId] : chatIds;
  for (const id of targets) {
    await bot.sendMessage(id, 'Նոր գնահատականներ չկան։');
  }
}

async function sendError(errorMsg, targetChatId) {
  try {
    const targets = targetChatId ? [targetChatId] : chatIds;
    for (const id of targets) {
      await bot.sendMessage(id, `Հայտնաբերվել է սխալ, փորձեք: ${errorMsg}`);
    }
  } catch (e) {
    console.error('Failed to send error to Telegram:', e.message);
  }
}

function handleMijin(chatId) {
  try {
    if (!fs.existsSync(GRADES_FILE)) {
      bot.sendMessage(chatId, 'Գնահատականներ դեռ չկան, սկզբից գործարկեք /check');
      return;
    }

    const saved = JSON.parse(fs.readFileSync(GRADES_FILE, 'utf8'));

    const bySubject = {};

    for (const key in saved) {
      const { subject, grade } = saved[key];
      const num = parseInt(grade, 10);
      if (isNaN(num)) continue;
      if (!bySubject[subject]) bySubject[subject] = [];
      bySubject[subject].push(num);
    }

    // Collect all known subjects: from ALL_SUBJECTS + any found in grades
    const allSubjects = [...new Set([...ALL_SUBJECTS, ...Object.keys(bySubject)])].sort();

    let message = '📊 <b>Միջին գնահատականներ ֊ </b>\n\n';
    for (const subj of allSubjects) {
      if (bySubject[subj] && bySubject[subj].length > 0) {
        const grades = bySubject[subj];
        const sum = grades.reduce((a, b) => a + b, 0);
        const avg = sum / grades.length;
        const rounded = Math.round(avg * 10) / 10;
        message += `📘 <b>${subj}:</b> <code>${rounded.toFixed(1)}</code> <i>(${grades.length} գն.)</i>\n`;
      } else {
        message += `📘 <b>${subj}:</b> <i>Գնահատականներ դեռ չկան</i>\n`;
      }
    }

    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, `Սխալ: ${e.message}`);
  }
}

function handleBolor(chatId) {
  try {
    if (!fs.existsSync(GRADES_FILE)) {
      bot.sendMessage(chatId, 'Գնահատականներ դեռ չկան, սկզբից գործարկեք /check');
      return;
    }

    const saved = JSON.parse(fs.readFileSync(GRADES_FILE, 'utf8'));

    const bySubject = {};

    for (const key in saved) {
      const { subject, grade, date } = saved[key];
      const num = parseInt(grade, 10);
      if (isNaN(num)) continue;
      if (!bySubject[subject]) bySubject[subject] = [];
      bySubject[subject].push({ grade: num, date });
    }

    const allSubjects = [...new Set([...ALL_SUBJECTS, ...Object.keys(bySubject)])].sort();

    let message = '📋 <b>Բոլոր գնահատականները:</b>\n\n';
    for (const subj of allSubjects) {
      if (bySubject[subj] && bySubject[subj].length > 0) {
        const items = bySubject[subj].map(g => `<code>${g.grade}</code> <i>(${g.date})</i>`);
        message += `📘 <b>${subj}:</b>\n${items.join(', ')}\n\n`;
      } else {
        message += `📘 <b>${subj}:</b> <i>Գնահատականներ դեռ չկան</i>\n\n`;
      }
    }

    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, `Սխալ: ${e.message}`);
  }
}

function stopBot() {
  if (bot) bot.stopPolling();
}

module.exports = { startBot, stopBot, setCheckHandler, sendGradeNotification, sendNoNewGrades, sendError };

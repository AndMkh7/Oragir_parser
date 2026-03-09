const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const GRADES_FILE = path.join(__dirname, 'grades.json');
const PROFILE_DIR = path.join(__dirname, 'chrome_profile');
const BASE_URL = 'https://e-diary.emis.am';

function loadSavedGrades() {
  if (fs.existsSync(GRADES_FILE)) {
    return JSON.parse(fs.readFileSync(GRADES_FILE, 'utf8'));
  }
  return {};
}

function saveGrades(grades) {
  fs.writeFileSync(GRADES_FILE, JSON.stringify(grades, null, 2), 'utf8');
}

async function scrapeGrades() {
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  let newGrades = [];

  try {
    const page = await browser.newPage();

    // Step 1: Check if already logged in
    console.log('Checking session...');
    await page.goto(`${BASE_URL}/children`, { waitUntil: 'networkidle2', timeout: 60000 });

    const currentUrl = page.url();
    const isLoggedIn = currentUrl.includes('/children') && !currentUrl.includes('/auth');

    if (!isLoggedIn) {
      console.log('Not logged in. Starting login...');
      await page.goto(`${BASE_URL}/auth`, { waitUntil: 'networkidle2', timeout: 60000 });

      // Fill login form slowly
      console.log('Filling login form...');
      await page.click('input[name="email"]');
      await new Promise((r) => setTimeout(r, 500));
      await page.type('input[name="email"]', process.env.EMAIL, { delay: 120 });

      await new Promise((r) => setTimeout(r, 800));
      await page.click('input[name="password"]');
      await new Promise((r) => setTimeout(r, 400));
      await page.type('input[name="password"]', process.env.PASSWORD, { delay: 100 });

      // Wait before captcha
      console.log('Waiting 10 seconds before reCAPTCHA...');
      await new Promise((r) => setTimeout(r, 10000));

      // Try clicking reCAPTCHA
      console.log('Clicking reCAPTCHA...');
      await page.waitForSelector('iframe[title*="reCAPTCHA"]', { timeout: 15000 });

      const recaptchaFrame = page.frames().find(
        (f) => f.url().includes('recaptcha/api2/anchor')
      );
      if (recaptchaFrame) {
        await recaptchaFrame.waitForSelector('#recaptcha-anchor', { timeout: 10000 });
        await recaptchaFrame.click('#recaptcha-anchor');

        // Wait for reCAPTCHA to resolve - give user time to solve manually if needed
        console.log('Waiting for reCAPTCHA (up to 120s - solve manually if image challenge appears)...');
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const checked = await recaptchaFrame.evaluate(() => {
            const anchor = document.querySelector('#recaptcha-anchor');
            return anchor && anchor.getAttribute('aria-checked') === 'true';
          });
          if (checked) {
            console.log('reCAPTCHA solved!');
            break;
          }
          if (i === 119) {
            throw new Error('reCAPTCHA not solved in 120 seconds');
          }
        }
      } else {
        throw new Error('reCAPTCHA frame not found');
      }

      // Submit login
      console.log('Submitting login...');
      await page.click('button[type="submit"]');

      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        await page.screenshot({ path: path.join(__dirname, 'debug_login.png') });
        const errorMsg = await page.evaluate(() => {
          const el = document.querySelector('.loginFaild');
          if (el && el.style.display !== 'none') return el.textContent;
          const err = document.querySelector('.log_errors');
          if (err) return err.textContent;
          return null;
        });
        throw new Error(`Login failed: ${errorMsg || 'timeout'}`);
      }

      console.log('Login successful!');
    } else {
      console.log('Already logged in (session active)');
    }

    // Step 2: Find child's diary link
    console.log('Looking for child:', process.env.CHILD_NAME);
    await page.waitForSelector('.user-card', { timeout: 15000 });

    const diaryUrl = await page.evaluate((childName) => {
      const cards = document.querySelectorAll('.user-card');
      for (const card of cards) {
        const h4 = card.querySelector('h4');
        if (h4 && h4.textContent.includes(childName)) {
          const diaryLink = card.querySelector('a[href*="/diary/index/"]');
          if (diaryLink) return diaryLink.href;
        }
      }
      return null;
    }, process.env.CHILD_NAME);

    if (!diaryUrl) {
      throw new Error(`Child "${process.env.CHILD_NAME}" diary link not found`);
    }

    // Step 3: Go to diary page
    console.log('Opening diary...');
    await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Step 4: Loop through months from January to current month
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const savedGrades = loadSavedGrades();

    for (let month = 1; month <= currentMonth; month++) {
      console.log(`\n--- Checking month ${month} ---`);
      await page.select('select[name="month"]', String(month));
      await page.click('input[name="diary_search"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      // Step 5: Click each week and parse grades
      const weekButtons = await page.$$('.card-header a[data-week]');
      console.log(`Found ${weekButtons.length} weeks`);

      for (const weekBtn of weekButtons) {
        const weekText = await page.evaluate((el) => el.textContent.trim(), weekBtn);
        console.log(`Checking week: ${weekText}`);

        await weekBtn.click();
        await new Promise((r) => setTimeout(r, 2500));
        await page.waitForSelector('.schedule_section .row.card-block', { timeout: 10000 });

        const weekGrades = await page.evaluate(() => {
        const grades = [];
        const dayCols = document.querySelectorAll('.schedule_section .col-md-12.col-lg-4');

        for (const dayCol of dayCols) {
          const dateHeader = dayCol.querySelector('h6.sub-title');
          if (!dateHeader) continue;
          const dateText = dateHeader.textContent.trim();
          const dateMatch = dateText.match(/(\d{2}\.\d{2}\.\d{4})/);
          const date = dateMatch ? dateMatch[1] : dateText;

          const lessons = dayCol.querySelectorAll('li');
          for (const lesson of lessons) {
            const badge = lesson.querySelector('label.badge');
            if (!badge) continue;
            const gradeText = badge.textContent.trim();
            if (!gradeText) continue;
            if (!/^\d+$/.test(gradeText)) continue; // only numeric grades

            const subjectLink = lesson.querySelector('.accordion-title a');
            if (!subjectLink) continue;
            const spanEl = subjectLink.querySelector('span');
            const fullText = subjectLink.textContent.trim();
            const spanText = spanEl ? spanEl.textContent.trim() : '';
            const subject = fullText.replace(spanText, '').trim();

            grades.push({ date, subject, grade: gradeText });
          }
        }
        return grades;
      });

      for (const g of weekGrades) {
        const key = `${g.date}_${g.subject}_${g.grade}`;
        if (!savedGrades[key]) {
          savedGrades[key] = { ...g, notifiedAt: new Date().toISOString() };
          newGrades.push(g);
          console.log(`New grade: ${g.date} | ${g.subject} | ${g.grade}`);
        }
      }
    } // end week loop
    } // end month loop

    saveGrades(savedGrades);

  } finally {
    await browser.close();
  }

  return newGrades;
}

module.exports = { scrapeGrades };

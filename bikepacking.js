#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, 'bikepacking-list.json');
const packingList = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = q => new Promise(resolve => rl.question(q + ' ', resolve));

function reopenRL() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function pickMonth() {
  const now = new Date();
  const months = Array.from({ length: 18 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  });

  let selected = 0;

  rl.close();
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');

  const render = () => {
    const arrows = selected === 0 ? ' ▼ ' : '▲▼';
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`  ${arrows}  ${months[selected]}`);
  };

  process.stdout.write('\n');
  render();

  return new Promise(resolve => {
    const onData = key => {
      if (key === '\x1B[A') {
        selected = Math.max(0, selected - 1);
        render();
      } else if (key === '\x1B[B') {
        selected = Math.min(months.length - 1, selected + 1);
        render();
      } else if (key === '\r' || key === '\n') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        reopenRL();
        resolve(months[selected]);
      } else if (key === '\x03') {
        process.exit();
      }
    };

    process.stdin.on('data', onData);
  });
}

async function pickNumber(defaultVal, min = 1, max = 30) {
  let selected = defaultVal;

  rl.close();
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');

  const render = () => {
    const arrows = selected <= min ? '▲ ' : '▲▼';
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`  ${arrows}  ${selected} day${selected !== 1 ? 's' : ''}`);
  };

  process.stdout.write('\n');
  render();

  return new Promise(resolve => {
    const onData = key => {
      if (key === '\x1B[A') {
        selected = Math.min(max, selected + 1);
        render();
      } else if (key === '\x1B[B') {
        selected = Math.max(min, selected - 1);
        render();
      } else if (key === '\r' || key === '\n') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        reopenRL();
        resolve(selected);
      } else if (key === '\x03') {
        process.exit();
      }
    };
    process.stdin.on('data', onData);
  });
}

async function pickBoolean(text) {
  process.stdout.write(`${text} (y/n) `);

  rl.close();
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');

  return new Promise(resolve => {
    const onData = key => {
      if (key === '\x03') process.exit();

      const isYes = key === '\r' || key === '\n' || key === 'y' || key === 'Y';
      const isNo  = key === 'n' || key === 'N';
      if (!isYes && !isNo) return;

      process.stdout.write((isYes ? 'y' : 'n') + '\n');
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onData);
      reopenRL();
      resolve(isYes);
    };
    process.stdin.on('data', onData);
  });
}

async function askQuestion(q) {
  switch (q.type) {
    case 'text':
      return (await prompt(q.text)).trim();

    case 'month': {
      process.stdout.write(q.text);
      return pickMonth();
    }

    case 'number': {
      process.stdout.write(q.text);
      return pickNumber(3);
    }

    case 'boolean':
      return pickBoolean(q.text);
  }
}

// --- CLI args ---

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key.startsWith('no-')) {
      result[key.slice(3)] = false;
    } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
      result[key] = args[i + 1];
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

// --- Main ---

async function main() {
  const cli = parseArgs();
  const answers = {};
  const activeTags = new Set();

  if (cli.month) {
    const year = cli.year ?? new Date().getFullYear();
    cli.trip_start = `${cli.month} ${year}`;
  }
  if (cli.destination) cli.trip_name = cli.destination;
  if (cli.days)        cli.trip_days = parseInt(cli.days, 10);
  if (cli.cooking !== undefined) cli.cooking = cli.cooking !== false && cli.cooking !== 'false';

  const fullyAutomated = cli.trip_name && cli.trip_start;
  if (!fullyAutomated) console.log('\n=== Bikepacking List Generator ===\n');

  for (const q of packingList.questions) {
    let answer;
    if (cli[q.id] !== undefined) {
      answer = cli[q.id];
      if (!fullyAutomated) console.log(`${q.text} ${answer}`);
    } else if (fullyAutomated && q.type === 'boolean') {
      answer = q.default ?? false;
      console.log(`${q.text} ${answer ? 'y' : 'n'}`);
    } else {
      answer = await askQuestion(q);
    }
    answers[q.id] = answer;

    if (q.type === 'boolean' && answer === true && q.activateTagsIfTrue) {
      q.activateTagsIfTrue.forEach(t => activeTags.add(t));
    }
  }

  const debugMode = cli.debug !== undefined ? !!cli.debug : fullyAutomated ? false : await pickBoolean('Debug mode (show omitted items in red)?');

  rl.close();

  const html = generateHTML(answers, activeTags, debugMode);
  const outFile = path.join(__dirname, 'bikepacking-output.html');
  fs.writeFileSync(outFile, html, 'utf8');

  console.log(`\nGenerated: ${outFile}`);
  console.log('Opening in browser — use Cmd+P to print to PDF.\n');
  execSync(`open "${outFile}"`);

  if (debugMode) {
    const parts = ['node bikepacking.js'];
    if (answers.trip_name) parts.push(`--destination "${answers.trip_name}"`);
    if (answers.trip_start) {
      const [month, year] = answers.trip_start.split(' ');
      if (month) parts.push(`--month ${month}`);
      if (year)  parts.push(`--year ${year}`);
    }
    if (answers.trip_days) parts.push(`--days ${answers.trip_days}`);
    if (answers.cooking != null) parts.push(answers.cooking ? '--cooking' : '--no-cooking');
    parts.push('--debug');
    console.log(`Repeat this run:\n  ${parts.join(' ')}\n`);
  }
}

// --- Filtering ---

function isVisible(conditions, activeTags) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.some(t => activeTags.has(t));
}

// --- Formatting ---

function formatTripMeta(answers) {
  const parts = [];
  if (answers.trip_start) parts.push(answers.trip_start);
  if (answers.trip_days) parts.push(`${answers.trip_days} days`);
  return parts.join(' – ');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatCreatedDate() {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

// --- HTML ---

function generateHTML(answers, activeTags, debugMode) {
  const tripName = (answers.trip_name || 'Bikepacking List').toUpperCase();
  const tripMeta = formatTripMeta(answers);

  const sections = (debugMode ? packingList.sections : packingList.sections.filter(s => isVisible(s.conditions, activeTags)))
    .map(s => {
      const sectionHidden = !isVisible(s.conditions, activeTags);
      const visibleItems = sectionHidden ? [] : s.items.filter(i => isVisible(i.conditions, activeTags));
      const hiddenItems  = debugMode
        ? (sectionHidden ? s.items : s.items.filter(i => !isVisible(i.conditions, activeTags)))
        : [];
      return { ...s, sectionHidden, visibleItems, hiddenItems };
    })
    .filter(s => debugMode || s.visibleItems.length > 0);

  const sectionsHTML = sections.map(s => {
    const itemsHTML = s.visibleItems.map(item =>
      `<div class="item"><input type="checkbox" class="cb" disabled><span class="item-text">${item.text}</span></div>`
    ).join('');

    const hiddenItemsHTML = s.hiddenItems.map(item =>
      `<div class="item omitted"><span class="item-text">${item.text}</span></div>`
    ).join('');

    const h2Class = s.sectionHidden ? ' class="omitted"' : '';
    return `<div class="section"><h2${h2Class}>${s.title}</h2>${itemsHTML}${hiddenItemsHTML}</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${tripName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,800&family=Inter:wght@400;500;700;800&family=Josefin+Sans:wght@400;600;700&family=Libre+Baskerville:wght@400;700&family=Merriweather:wght@400;700&family=Nunito:wght@400;600;700;800&family=Outfit:wght@400;500;700;800&family=Playfair+Display:wght@400;700;800&family=Raleway:wght@400;500;700;800&family=Source+Sans+3:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

:root { --font: -apple-system, 'Helvetica Neue', Arial, sans-serif; }

@page { size: letter portrait; margin: 0.5in; }

body {
  font-family: var(--font);
  background: #ddd;
  display: flex;
  justify-content: center;
  padding: 0.4in;
}

#page {
  width: 7.5in;
  height: 10in;
  background: white;
  padding: 0.3in 0.35in;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media print {
  body { background: white; padding: 0; }
  #page { width: 100%; height: 100%; margin: 0; }
}

#header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 2.5px solid #111;
  padding-bottom: 0.08in;
  margin-bottom: 0.08in;
  flex-shrink: 0;
}

#trip-name {
  font-weight: 800;
  font-size: 1.5em;
  letter-spacing: 0.06em;
}

#header-right {
  text-align: right;
}

#trip-meta {
  font-size: 0.9em;
  color: #444;
  font-weight: 500;
}

#content {
  flex: 1;
  columns: 2;
  column-gap: 0.2in;
  overflow: hidden;
}

.section { margin-bottom: 0.1in; }

h2 {
  font-size: 0.68em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #222;
  border-bottom: 1px solid #bbb;
  padding-bottom: 2px;
  margin-bottom: 3px;
  break-after: avoid;
}

.item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1.5px 0;
}

.item-text {
  flex: 1;
  font-size: 0.78em;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid #333;
  border-radius: 2px;
  flex-shrink: 0;
  display: block;
}

.omitted { color: #c0392b; opacity: 0.7; }
.item.omitted .item-text { font-style: italic; }

#footer {
  flex-shrink: 0;
  border-top: 1px solid #ccc;
  padding-top: 5px;
  margin-top: 5px;
  font-size: 0.6em;
  color: #aaa;
  text-align: center;
}
</style>
</head>
<body>
<div id="page">
  <div id="header">
    <div id="trip-name">${tripName}</div>
    <div id="header-right">
      <div id="trip-meta">${tripMeta}</div>
    </div>
  </div>

  <div id="content">
    ${sectionsHTML}
  </div>
  <div id="footer">Created on ${formatCreatedDate()} &mdash; version ${packingList.version}</div>
</div>

<div id="font-picker">
  <button id="prev-font">&#8592;</button>
  <span id="font-label"></span>
  <button id="next-font">&#8594;</button>
</div>

<style>
#font-picker {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 8px 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: -apple-system, sans-serif;
  font-size: 13px;
  z-index: 1000;
  user-select: none;
  backdrop-filter: blur(6px);
}
#font-picker button {
  background: none;
  border: none;
  color: white;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
}
#font-picker button:hover { opacity: 1; }
#font-label { min-width: 160px; text-align: center; letter-spacing: 0.02em; }
@media print { #font-picker { display: none; } }
</style>

<script>
(function () {
  const fonts = [
    { name: 'Inter',              stack: "'Inter', sans-serif" },
    { name: 'DM Sans',            stack: "'DM Sans', sans-serif" },
    { name: 'Outfit',             stack: "'Outfit', sans-serif" },
    { name: 'Nunito',             stack: "'Nunito', sans-serif" },
    { name: 'Raleway',            stack: "'Raleway', sans-serif" },
    { name: 'Source Sans 3',      stack: "'Source Sans 3', sans-serif" },
    { name: 'Josefin Sans',       stack: "'Josefin Sans', sans-serif" },
    { name: 'Merriweather',       stack: "'Merriweather', serif" },
    { name: 'Libre Baskerville',  stack: "'Libre Baskerville', serif" },
    { name: 'Playfair Display',   stack: "'Playfair Display', serif" },
    { name: 'Fraunces',           stack: "'Fraunces', serif" },
  ];

  let fi = 0;
  const content = document.getElementById('content');
  const label   = document.getElementById('font-label');

  function scale() {
    let lo = 5, hi = 18;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      document.documentElement.style.fontSize = mid + 'px';
      content.scrollWidth > content.clientWidth ? (hi = mid) : (lo = mid);
    }
    document.documentElement.style.fontSize = lo + 'px';
  }

  function applyFont(i) {
    fi = (i + fonts.length) % fonts.length;
    document.documentElement.style.setProperty('--font', fonts[fi].stack);
    label.textContent = fonts[fi].name;
    scale();
  }

  document.getElementById('prev-font').addEventListener('click', () => applyFont(fi - 1));
  document.getElementById('next-font').addEventListener('click', () => applyFont(fi + 1));
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  applyFont(fi - 1);
    if (e.key === 'ArrowRight') applyFont(fi + 1);
  });

  const defaultFont = fonts.findIndex(f => f.name === 'Source Sans 3');
  document.fonts.ready.then(() => applyFont(defaultFont));
})();
</script>
</body>
</html>`;
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node

require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const DATA_FILE = path.join(__dirname, 'packing-list.json');
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
    const arrows = selected === 0 ? ' \u25bc ' : '\u25b2\u25bc';
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

async function askQuestion(q) {
  switch (q.type) {
    case 'text':
      return (await prompt(q.text)).trim();

    case 'month': {
      process.stdout.write(q.text);
      return pickMonth();
    }

    case 'number': {
      const raw = await prompt(q.text);
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    }

    case 'boolean': {
      const hasDefault = q.default !== undefined;
      const hint = hasDefault
        ? (q.default ? '(Y/n)' : '(y/N)')
        : '(y/n)';
      const raw = (await prompt(`${q.text} ${hint}`)).trim().toLowerCase();
      if (!raw && hasDefault) return q.default;
      return raw.startsWith('y');
    }

    case 'select': {
      console.log(q.text);
      q.options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
      const raw = await prompt('>');
      const i = parseInt(raw.trim(), 10) - 1;
      return q.options[i]?.value ?? q.options[0].value;
    }
  }
}

// --- Claude inference ---

const WEATHER_TAGS = {
  warm: ['warm'],
  cold: ['cold'],
  snowy: ['cold', 'snow'],
  mixed: ['cold', 'warm'],
};

async function inferTripDetails(tripName, month) {
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `I'm traveling from Seattle, WA to "${tripName}" in ${month}.
Respond with ONLY a raw JSON object — no markdown, no explanation — with these exact fields:
- "weather": one of "warm", "cold", "snowy", or "mixed"
- "international": true or false
- "drive_hours": estimated drive time from Seattle in hours as a number (e.g. 2.5); use a large number like 999 if it's not driveable
- "distance_description": short human-readable string like "~850 miles" or "~2.5 hour drive"
- "rain_probability": integer 0–100 representing the historical likelihood of rain during this month at this destination
- "note": one casual sentence about what to expect`
      }]
    });

    return JSON.parse(message.content[0].text);
  } catch {
    return null;
  }
}

// --- Main ---

async function main() {
  const answers = {};
  const activeTags = new Set();
  let henryMode = false;

  console.log('\n=== Packing List Generator ===\n');

  for (const q of packingList.questions) {
    if (q.showIf && answers[q.showIf.questionId] !== q.showIf.value) continue;

    const answer = await askQuestion(q);
    answers[q.id] = answer;

    if (q.special === 'henry-column' && answer === true) {
      henryMode = true;
    } else if (q.type === 'boolean' && answer === true && q.activateTagsIfTrue) {
      q.activateTagsIfTrue.forEach(t => activeTags.add(t));
    }

    // After we have destination and month — call Claude to infer everything else
    if (q.id === 'trip_start' && answers.trip_name) {
      process.stdout.write('\nLooking up destination details...');
      const details = await inferTripDetails(answers.trip_name, answers.trip_start);
      if (details) {
        process.stdout.write('\r\x1b[K');
        const flying = details.drive_hours > 3;
        const transportEmoji = flying ? '✈️ ' : '🚗';
        activeTags.add(flying ? 'flying' : 'driving');
        if (flying) activeTags.add(details.international ? 'flying-international' : 'flying-domestic');
        answers._transport = flying ? 'flying' : 'driving';
        WEATHER_TAGS[details.weather]?.forEach(t => activeTags.add(t));
        if (details.international) activeTags.add('international');
        answers._inferred = details;
        console.log(`${transportEmoji} ${details.distance_description} from Seattle — ${flying ? 'flying' : 'driving'}. ${details.note}`);
      } else {
        process.stdout.write('\r\x1b[K');
        console.log('(Could not reach Claude — weather, transport, and international travel not inferred)');
      }
      console.log('');
    }
  }

  rl.close();

  const rainProbability = answers._inferred?.rain_probability ?? null;
  const html = generateHTML(answers, activeTags, henryMode, rainProbability);
  const outFile = path.join(__dirname, 'output.html');
  fs.writeFileSync(outFile, html, 'utf8');

  console.log(`\nGenerated: ${outFile}`);
  console.log('Opening in browser — use Cmd+P to print to PDF.\n');
  execSync(`open "${outFile}"`);
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
  return parts.join(' \u2013 ');
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

function generateHTML(answers, activeTags, henryMode, rainProbability) {
  const tripName = (answers.trip_name || 'Packing List').toUpperCase();
  const tripMeta = formatTripMeta(answers);

  const sections = packingList.sections
    .filter(s => isVisible(s.conditions, activeTags))
    .map(s => ({ ...s, items: s.items.filter(i => isVisible(i.conditions, activeTags)) }))
    .filter(s => s.items.length > 0);

  const sectionsHTML = sections.map(s => {
    const itemsHTML = s.items.map(item => {
      // Umbrella: hide if 0% rain, annotate otherwise
      if (item.id === 'umbrella') {
        if (rainProbability === 0) return '';
        const label = rainProbability !== null
          ? `Umbrella (${rainProbability}% chance of rain)`
          : 'Umbrella';
        const leftCb = henryMode ? `<span class="henry-spacer"></span>` : '';
        return `<div class="item">${leftCb}<input type="checkbox" class="cb" disabled><span class="item-text">${label}</span></div>`;
      }

      if (item.henry_only) {
        if (!henryMode) return '';
        return `<div class="item"><input type="checkbox" class="cb henry-cb" disabled><span class="adult-spacer"></span><span class="item-text">${item.text}</span></div>`;
      }

      const leftCb = henryMode
        ? (item.henry ? `<input type="checkbox" class="cb henry-cb" disabled>` : `<span class="henry-spacer"></span>`)
        : '';
      return `<div class="item">${leftCb}<input type="checkbox" class="cb" disabled><span class="item-text">${item.text}</span></div>`;
    }).filter(Boolean).join('');
    return `<div class="section"><h2>${s.title}</h2>${itemsHTML}</div>`;
  }).join('');

  const henryLegend = henryMode
    ? `<div id="henry-legend">H\u2003=\u2003Henry</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${tripName}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

@page { size: letter portrait; margin: 0.5in; }

body {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
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

#trip-meta {
  font-size: 0.9em;
  color: #444;
  font-weight: 500;
}

#henry-legend {
  text-align: right;
  font-size: 0.65em;
  color: #777;
  margin-bottom: 0.05in;
  flex-shrink: 0;
}

#content {
  flex: 1;
  columns: 3;
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

.henry-cb {
  border: 1.5px dashed #888;
  border-radius: 2px;
}

.henry-spacer, .adult-spacer {
  width: 14px;
  flex-shrink: 0;
  display: block;
}

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
    <div id="trip-meta">${tripMeta}</div>
  </div>
  ${henryLegend}
  <div id="content">
    ${sectionsHTML}
  </div>
  <div id="footer">Created on ${formatCreatedDate()} &mdash; version ${packingList.version}</div>
</div>
<script>
(function () {
  const content = document.getElementById('content');
  let lo = 5, hi = 30;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    document.documentElement.style.fontSize = mid + 'px';
    content.scrollWidth > content.clientWidth ? (hi = mid) : (lo = mid);
  }
  document.documentElement.style.fontSize = lo + 'px';
})();
</script>
</body>
</html>`;
}

main().catch(err => { console.error(err); process.exit(1); });

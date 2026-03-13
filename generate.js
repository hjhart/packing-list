#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

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

async function pickNumber(defaultVal, min = 1, max = 30) {
  let selected = defaultVal;

  rl.close();
  process.stdin.resume();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');

  const render = () => {
    const arrows = selected <= min ? '\u25b2 ' : '\u25b2\u25bc';
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
      const raw = await prompt(q.text);
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    }

    case 'boolean':
      return pickBoolean(q.text);

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
- "snow_probability": integer 0–100 representing the historical likelihood of snow during this month at this destination
- "temp_high_f": typical daytime high temperature in Fahrenheit for this destination and month
- "temp_low_f": typical nighttime low temperature in Fahrenheit for this destination and month
- "temp_source": either "forecast" if the trip is within ~10 days and you have reliable data, or "almanac" if it's based on historical averages
- "note": one casual sentence about what to expect`
      }]
    });

    return JSON.parse(message.content[0].text);
  } catch {
    return null;
  }
}

// --- Image generation ---

async function generateTripImage(tripName, isFamily, hasHenry) {
  try {
    const openai = new OpenAI();

    let people;
    if (isFamily) {
      people = 'a man in his late 30s with short brown hair buzzed on the sides, a petite woman with wavy brown hair and blue eyes, and a 10-year-old boy with brown hair and brown eyes';
    } else if (hasHenry) {
      people = 'a man in his late 30s with short brown hair buzzed on the sides and a 10-year-old boy with brown hair and brown eyes';
    } else {
      people = 'a man in his late 30s with short brown hair buzzed on the sides';
    }

    const imagePrompt = `A simple black and white line drawing or sketch of ${people} at ${tripName}. Clean, minimal, charming illustration with recognizable landmarks or scenery from ${tripName} in the background. Monochrome, sketch style, no color.`;

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: imagePrompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    return `data:image/png;base64,${response.data[0].b64_json}`;
  } catch {
    return null;
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
  let henryMode = false;

  // Build trip_start from --month / --year if provided
  if (cli.month) {
    const year = cli.year ?? new Date().getFullYear();
    cli.trip_start = `${cli.month} ${year}`;
  }
  if (cli.destination) cli.trip_name = cli.destination;
  if (cli.days)        cli.trip_days = parseInt(cli.days, 10);
  if (cli.family !== undefined) cli.family = cli.family !== false && cli.family !== 'false';
  if (cli.henry  !== undefined) cli.henry  = cli.henry  !== false && cli.henry  !== 'false';
  if (cli.swimming !== undefined) cli.swimming = cli.swimming !== false && cli.swimming !== 'false';

  const fullyAutomated = cli.trip_name && cli.trip_start;
  if (!fullyAutomated) console.log('\n=== Packing List Generator ===\n');

  for (const q of packingList.questions) {
    if (q.showIf && answers[q.showIf.questionId] !== q.showIf.value) continue;
    if (q.id === 'swimming' && activeTags.has('swimming')) continue;

    let answer;
    if (cli[q.id] !== undefined) {
      answer = cli[q.id];
      if (!fullyAutomated) console.log(`${q.text} ${answer}`);
    } else if (fullyAutomated && q.type === 'boolean') {
      answer = q.default ?? false;
      console.log(`${q.text} ${answer ? 'y' : 'n'}`);
    } else if (q.id === 'trip_days') {
      const driveHours = answers._inferred?.drive_hours ?? 999;
      const defaultDays = driveHours < 3 ? 3 : 6;
      process.stdout.write(q.text);
      answer = await pickNumber(defaultDays);
    } else {
      answer = await askQuestion(q);
    }
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
        if (details.weather === 'warm') activeTags.add('swimming');
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

  // Start image generation in parallel before debug question
  process.stdout.write('Generating trip illustration...');
  const imagePromise = generateTripImage(answers.trip_name, answers.family, henryMode);

  const debugMode = cli.debug !== undefined ? !!cli.debug : fullyAutomated ? false : await pickBoolean('Debug mode (show omitted items in red)?');

  rl.close();

  const imageDataUrl = await imagePromise;
  process.stdout.write('\r\x1b[K');

  const rainProbability = answers._inferred?.rain_probability ?? null;
  const snowProbability = answers._inferred?.snow_probability ?? null;
  const html = generateHTML(answers, activeTags, henryMode, rainProbability, snowProbability, debugMode, imageDataUrl);
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

function formatWeatherSummary(inferred, rainProbability, snowProbability) {
  if (!inferred) return '';
  const parts = [];
  if (inferred.weather) parts.push(inferred.weather.charAt(0).toUpperCase() + inferred.weather.slice(1));
  if (inferred.temp_high_f != null && inferred.temp_low_f != null) {
    const source = inferred.temp_source === 'forecast' ? 'forecast' : 'avg';
    parts.push(`${inferred.temp_low_f}\u00b0\u2013${inferred.temp_high_f}\u00b0F (${source})`);
  }
  if (rainProbability > 0) parts.push(`${rainProbability}% rain`);
  if (snowProbability > 0) parts.push(`${snowProbability}% snow`);
  return parts.join(' \u00b7 ');
}

function generateHTML(answers, activeTags, henryMode, rainProbability, snowProbability, debugMode, imageDataUrl) {
  const tripName = (answers.trip_name || 'Packing List').toUpperCase();
  const tripMeta = formatTripMeta(answers);
  const weatherSummary = formatWeatherSummary(answers._inferred, rainProbability, snowProbability);

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
    const itemsHTML = s.visibleItems.map(item => {
      // Umbrella: hide if 0% rain, annotate otherwise
      if (item.id === 'umbrella') {
        if (rainProbability === 0) return '';
        const label = rainProbability !== null
          ? `Umbrella (${rainProbability}% chance of rain)`
          : 'Umbrella';
        const leftCb = henryMode ? `<span class="henry-spacer"></span>` : '';
        return `<div class="item">${leftCb}<input type="checkbox" class="cb" disabled><span class="item-text">${label}</span></div>`;
      }

      if (item.id === 'gloves' && snowProbability !== null && snowProbability > 0) {
        const label = `Gloves (${snowProbability}% chance of snow)`;
        const leftCb = henryMode ? `<span class="henry-spacer"></span>` : '';
        return `<div class="item">${leftCb}<input type="checkbox" class="cb" disabled><span class="item-text">${label}</span></div>`;
      }

      if (item.henry_only) {
        if (henryMode) {
          return `<div class="item"><input type="checkbox" class="cb henry-cb" disabled><span class="adult-spacer"></span><span class="item-text">${item.text}</span></div>`;
        } else {
          return `<div class="item"><input type="checkbox" class="cb" disabled><span class="item-text">${item.text}</span></div>`;
        }
      }

      const leftCb = henryMode
        ? (item.henry ? `<input type="checkbox" class="cb henry-cb" disabled>` : `<span class="henry-spacer"></span>`)
        : '';
      return `<div class="item">${leftCb}<input type="checkbox" class="cb" disabled><span class="item-text">${item.text}</span></div>`;
    }).filter(Boolean).join('');

    const hiddenItemsHTML = s.hiddenItems.map(item =>
      `<div class="item omitted"><span class="item-text">${item.text}</span></div>`
    ).join('');

    const h2Class = s.sectionHidden ? ' class="omitted"' : '';
    return `<div class="section"><h2${h2Class}>${s.title}</h2>${itemsHTML}${hiddenItemsHTML}</div>`;
  }).join('');

  const henryLegend = henryMode
    ? `<div id="henry-legend"><span class="cb henry-cb" style="display:inline-block;vertical-align:middle;margin-right:5px"></span>= Henry</div>`
    : '';

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
  align-items: center;
  border-bottom: 2.5px solid #111;
  padding-bottom: 0.08in;
  margin-bottom: 0.08in;
  flex-shrink: 0;
}

#trip-image {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  margin-right: 0.1in;
}

#header-left {
  display: flex;
  align-items: center;
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

#weather-summary {
  font-size: 0.72em;
  color: #777;
  font-weight: 400;
  margin-top: 1px;
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

.henry-cb {
  border: 1.5px dashed #888;
  border-radius: 2px;
}

.henry-spacer, .adult-spacer {
  width: 14px;
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
    <div id="header-left">
      ${imageDataUrl ? `<img id="trip-image" src="${imageDataUrl}" alt="Trip illustration">` : ''}
      <div id="trip-name">${tripName}</div>
    </div>
    <div id="header-right">
      <div id="trip-meta">${tripMeta}</div>
      ${weatherSummary ? `<div id="weather-summary">${weatherSummary}</div>` : ''}
    </div>
  </div>
  ${henryLegend}

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

  document.fonts.ready.then(() => applyFont(0));
})();
</script>
</body>
</html>`;
}

main().catch(err => { console.error(err); process.exit(1); });

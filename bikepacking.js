#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { filterSections, renderHTML } = require('./render');

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
// --- Formatting ---

function formatTripMeta(answers) {
  const parts = [];
  if (answers.trip_start) parts.push(answers.trip_start);
  if (answers.trip_days) parts.push(`${answers.trip_days} days`);
  return parts.join(' – ');
}

// --- HTML ---

function generateHTML(answers, activeTags, debugMode) {
  return renderHTML({
    title: (answers.trip_name || 'Bikepacking List').toUpperCase(),
    meta: formatTripMeta(answers),
    sections: filterSections(packingList.sections, activeTags, debugMode),
    version: packingList.version,
  });
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node

// No prompts, no flags — reads boating-list.json and opens the printable page.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { filterSections, renderHTML } = require('./render');

const packingList = JSON.parse(fs.readFileSync(path.join(__dirname, 'boating-list.json'), 'utf8'));

const html = renderHTML({
  title: packingList.title.toUpperCase(),
  meta: packingList.meta,
  sections: filterSections(packingList.sections, new Set(), false),
  version: packingList.version,
});

const outFile = path.join(__dirname, 'boating-output.html');
fs.writeFileSync(outFile, html, 'utf8');

console.log(`\nGenerated: ${outFile}`);
console.log('Opening in browser — use Cmd+P to print to PDF.\n');
execSync(`open "${outFile}"`);

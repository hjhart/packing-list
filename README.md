# Packing List

An interactive CLI that generates a personalized, print-ready packing list PDF — one page, scaled to fill it.

## How it works

Answer a few questions in the terminal. The tool filters your packing list based on your answers, calls Claude to infer weather and whether you're traveling internationally, then opens a print-ready HTML page in your browser. Hit Cmd+P, save as PDF.

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=your_key_here
```

## Usage

```bash
node generate.js
```

You'll be asked:

- **Name of trip** — becomes the title on the PDF
- **Month of trip** — use ↑↓ to select
- **How many days** — shown in the header as "April 2026 – 7 days"
- **Flying or driving** — drives which items appear (snacks, entry keys, PS5, kitchen stuff, baseball mitt, etc.)
- **Packing for Henry?** — adds a second checkbox column for relevant items
- **Swimming?** — adds swimwear, towels, goggles, sunscreen, etc.

After you answer the transport question, Claude looks up the destination and infers weather (warm / cold / snowy / mixed) and whether it's international travel. This controls items like gloves, boots, sweaters, and the passport reminder.

## Output

A browser window opens with the list laid out in three columns, font scaled to fill exactly one letter-sized page. Print with Cmd+P → Save as PDF.

The footer shows the date generated and a version number that increments whenever the list itself changes.

## The old-style list

[DEFAULT.md](DEFAULT.md) is the original hand-maintained markdown checklist — comprehensive, suited for road trips. Print it directly from GitHub if you want something simpler.

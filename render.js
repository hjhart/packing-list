// Shared print-page renderer for the packing list generators.
//
// Takes an already-filtered set of sections and produces the one-page,
// font-scaled HTML that generate.js / bikepacking.js / boating.js all print from.

function isVisible(conditions, activeTags) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.some(t => activeTags.has(t));
}

// Splits each section into the items that survive the active tags and (in debug
// mode) the ones that were filtered out, so they can be shown struck in red.
function filterSections(sections, activeTags, debugMode) {
  return (debugMode ? sections : sections.filter(s => isVisible(s.conditions, activeTags)))
    .map(s => {
      const sectionHidden = !isVisible(s.conditions, activeTags);
      const visibleItems = sectionHidden ? [] : s.items.filter(i => isVisible(i.conditions, activeTags));
      const hiddenItems  = debugMode
        ? (sectionHidden ? s.items : s.items.filter(i => !isVisible(i.conditions, activeTags)))
        : [];
      return { ...s, sectionHidden, visibleItems, hiddenItems };
    })
    .filter(s => debugMode || s.visibleItems.length > 0);
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

function renderHTML({ title, meta, sections, version }) {
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
<title>${title}</title>
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
  /* @page margin of 0.5in leaves exactly 7.5in x 10in printable on letter, which
     is the size #page already is. Overriding to 100% resolves against an
     auto-height body and spills a second, blank page — so pin it instead. */
  html, body { background: white; margin: 0; padding: 0; display: block; height: auto; }
  #page { width: 7.5in; height: 10in; margin: 0; }
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
    <div id="trip-name">${title}</div>
    <div id="header-right">
      <div id="trip-meta">${meta}</div>
    </div>
  </div>

  <div id="content">
    ${sectionsHTML}
  </div>
  <div id="footer">Created on ${formatCreatedDate()} &mdash; version ${version}</div>
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

  const overflows = () => content.scrollWidth > content.clientWidth;

  function scale() {
    let lo = 5, hi = 18;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      document.documentElement.style.fontSize = mid + 'px';
      overflows() ? (hi = mid) : (lo = mid);
    }
    document.documentElement.style.fontSize = lo + 'px';

    // The search assumes fit is monotonic in font size, which column layout
    // does not guarantee. Verify the size we settled on and step down if the
    // content still spills into a clipped third column.
    while (lo > 5 && overflows()) {
      lo -= 0.25;
      document.documentElement.style.fontSize = lo + 'px';
    }
  }

  async function applyFont(i) {
    fi = (i + fonts.length) % fonts.length;
    const font = fonts[fi];
    document.documentElement.style.setProperty('--font', font.stack);
    label.textContent = font.name;

    // Measuring before the webfont loads sizes against fallback metrics, and
    // the real font is usually wider — which overflows the page and silently
    // clips the last items. Wait for the actual faces first.
    try {
      var spec = ' 16px "' + font.name + '"';
      await Promise.all([
        document.fonts.load('400' + spec),
        document.fonts.load('700' + spec),
        document.fonts.load('800' + spec),
      ]);
    } catch (e) { /* fall through and measure with whatever we have */ }

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

module.exports = { isVisible, filterSections, renderHTML, formatCreatedDate, ordinal };

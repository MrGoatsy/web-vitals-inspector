const tabId = browser.devtools.inspectedWindow.tabId;
const THRESHOLDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800] };
const siteEl = document.getElementById('site');
const metaEl = document.getElementById('meta');
const cardsEl = document.getElementById('cards');
const shiftsSection = document.getElementById('shifts-section');
const shiftsMetaEl = document.getElementById('shifts-meta');
const shiftsEl = document.getElementById('shifts');
const interactionsSection = document.getElementById('interactions-section');
const interactionsEl = document.getElementById('interactions');
const resetBtn = document.getElementById('reset');
const toggleBtn = document.getElementById('toggle');
let current = null;
let lastKey = '';

/**
 * Sends a message to the content script of the inspected tab.
 * @param {object} payload
 * @returns {Promise<any>}
 */
function send(payload) {
    return browser.runtime.sendMessage({ type: 'relay', tabId, payload });
}

/**
 * Returns the rating class for a metric value.
 * @param {string} metric
 * @param {number} value
 * @returns {string}
 */
function rating(metric, value) {
    const [good, poor] = THRESHOLDS[metric];
    return value <= good ? 'good' : value <= poor ? 'warn' : 'poor';
}

/**
 * Formats a duration in milliseconds.
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Creates an element with a class and text.
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function make(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

/**
 * Creates a button that outlines an element on the page.
 * @param {{id: number, selector: string}} source
 * @param {string} [suffix]
 * @returns {HTMLButtonElement}
 */
function sourceButton(source, suffix = '') {
    const btn = make('button', 'source', `${source.selector}${suffix}`);
    btn.type = 'button';
    btn.title = 'Scroll to and outline this element';
    btn.addEventListener('click', () => send({ type: 'highlight', id: source.id }).catch(() => { }));
    return btn;
}

/**
 * Creates a metric card.
 * @param {string} label
 * @param {string} metric
 * @param {number|null} value
 * @param {string} text
 * @param {{id: number, selector: string}|null} [source]
 * @param {string} [note]
 * @returns {HTMLElement}
 */
function card(label, metric, value, text, source, note) {
    const el = make('div', 'card');
    el.append(make('div', 'card-label', label), make('div', value === null ? 'card-value meta' : `card-value ${rating(metric, value)}`, text));
    if (note) el.append(make('div', 'card-note', note));
    if (source) el.append(sourceButton(source));
    return el;
}

/**
 * Renders the metric cards.
 * @param {object} data
 */
function renderCards(data) {
    const v = data.vitals;
    const inpNote = v.inpSupported ? (v.inp ? `${v.inp.name}, ${data.interactions.length} slowest listed below` : 'No interactions over 16 ms yet') : 'Needs Firefox 144 or later';
    cardsEl.append(
        card('Largest Contentful Paint (LCP)', 'lcp', v.lcp ? v.lcp.value : null, v.lcp ? formatMs(v.lcp.value) : '-', v.lcp && v.lcp.source),
        card('Interaction to Next Paint (INP)', 'inp', v.inp ? v.inp.duration : null, v.inp ? formatMs(v.inp.duration) : '-', v.inp && v.inp.source, inpNote),
        card('Cumulative Layout Shift (CLS)', 'cls', data.cls, data.cls.toFixed(3)),
        card('First Contentful Paint (FCP)', 'fcp', v.fcp, v.fcp === null ? '-' : formatMs(v.fcp)),
        card('Time to First Byte (TTFB)', 'ttfb', v.ttfb, v.ttfb === null ? '-' : formatMs(v.ttfb))
    );
}

/**
 * Renders the layout shift list.
 * @param {Array<object>} shifts
 */
function renderShifts(shifts) {
    const counted = shifts.filter(s => !s.input).length;
    shiftsMetaEl.textContent = `${counted} counted, ${shifts.length - counted} after input`;

    if (!shifts.length) {
        shiftsEl.append(make('div', 'empty', 'No layout shifts yet.'));
        return;
    }

    [...shifts].reverse().forEach(s => {
        const item = make('div', s.input ? 'shift input' : 'shift');
        const row = make('div', 'row');
        row.append(make('span', `score ${rating('cls', s.value)}`, s.value.toFixed(4)), make('span', 'meta', `${(s.t / 1000).toFixed(2)} s`));
        if (s.input) row.append(make('span', 'tag', 'after input'));
        item.append(row);
        s.sources.forEach(src => item.append(sourceButton(src, `  (${src.dx}, ${src.dy})`)));
        shiftsEl.append(item);
    });
}

/**
 * Renders the slowest interactions.
 * @param {Array<object>} interactions
 */
function renderInteractions(interactions) {
    if (!interactions.length) {
        interactionsEl.append(make('div', 'empty', 'No interactions over 16 ms yet.'));
        return;
    }

    interactions.forEach(i => {
        const item = make('div', 'interaction');
        const row = make('div', 'row');
        row.append(make('span', `score ${rating('inp', i.duration)}`, formatMs(i.duration)), make('span', '', i.name), make('span', 'meta', `${(i.t / 1000).toFixed(2)} s`));
        item.append(row);
        if (i.source) item.append(sourceButton(i.source));
        interactionsEl.append(item);
    });
}

/**
 * Renders the panel.
 * @param {object|null} data
 */
function render(data) {
    cardsEl.replaceChildren();
    shiftsEl.replaceChildren();
    interactionsEl.replaceChildren();
    resetBtn.hidden = !data || !data.enabled;
    toggleBtn.hidden = !data;
    siteEl.textContent = data ? data.site : '';
    shiftsSection.hidden = interactionsSection.hidden = !data || !data.enabled;

    if (!data) {
        metaEl.textContent = 'Not available on this page.';
        return;
    }

    toggleBtn.textContent = data.enabled ? 'Disable on this site' : 'Enable on this site';

    if (!data.enabled) {
        metaEl.textContent = 'Off for this site. Enabling reloads the page and measures from the first paint.';
        return;
    }

    metaEl.textContent = '';
    renderCards(data);
    renderShifts(data.shifts);
    if (data.vitals.inpSupported) renderInteractions(data.interactions);
    else interactionsSection.hidden = true;
}

/**
 * Fetches the latest data from the inspected tab.
 */
async function refresh() {
    let data = null;
    try {
        data = await send({ type: 'get' });
    } catch { }
    current = data || null;
    const key = JSON.stringify(current);
    if (key === lastKey) return;
    lastKey = key;
    render(current);
}

resetBtn.addEventListener('click', async () => {
    await send({ type: 'reset' }).catch(() => { });
    refresh();
});

toggleBtn.addEventListener('click', async () => {
    if (!current) return;
    lastKey = '';
    await browser.runtime.sendMessage({ type: 'toggle', tabId, site: current.site, enable: !current.enabled });
});

refresh();
setInterval(refresh, 1000);

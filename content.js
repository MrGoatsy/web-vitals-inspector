(() => {
    const MOVE_THRESHOLD = 3;
    const INPUT_EXCLUSION_MS = 500;
    const IDLE_POLL_MS = 500;
    const MAX_SHIFTS = 500;
    const MAX_ROOTS = 300;
    const SITE = location.origin === 'null' ? location.protocol : location.origin;

    const shifts = [];
    const interactions = new Map();
    const vitals = { lcp: null, fcp: null, ttfb: null, inp: null, inpSupported: false };
    let firstInput = null;
    const refs = new Map();
    const ids = new WeakMap();
    const scrolledContainers = new Set();
    let prev = new Map();
    let nextId = 1;
    let lastInput = -Infinity;
    let lastMeasure = 0;
    let loadPhase = true;
    let dirty = true;
    let rebase = false;
    let enabled = false;

    /**
     * Returns a short readable selector for an element.
     * @param {Element} el
     * @returns {string}
     */
    function describe(el) {
        const parts = [];
        for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
            if (node.id) {
                parts.unshift(`${node.localName}#${node.id}`);
                break;
            }
            const cls = [...node.classList].slice(0, 2);
            parts.unshift(cls.length ? `${node.localName}.${cls.join('.')}` : node.localName);
        }
        return parts.join(' > ');
    }

    /**
     * Returns a stable id for an element.
     * @param {Element} el
     * @returns {number}
     */
    function idFor(el) {
        let id = ids.get(el);
        if (!id) {
            id = nextId++;
            ids.set(el, id);
            refs.set(id, new WeakRef(el));
        }
        return id;
    }

    /**
     * Returns a highlightable reference for an element.
     * @param {Element|null} el
     * @returns {{id: number, selector: string}|null}
     */
    function sourceOf(el) {
        return el && el.nodeType === 1 ? { id: idFor(el), selector: describe(el) } : null;
    }

    /**
     * Observes a performance entry type when the browser supports it.
     * @param {string} type
     * @param {function(PerformanceEntry): void} callback
     * @param {object} [options]
     * @returns {boolean} Whether the type is supported.
     */
    function observe(type, callback, options = {}) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) return false;
        new PerformanceObserver(list => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...options });
        return true;
    }

    /**
     * Recomputes INP from the slowest interactions.
     */
    function updateInp() {
        const list = [...interactions.values()].sort((a, b) => b.duration - a.duration);
        vitals.inp = list[Math.min(list.length - 1, Math.floor(list.length / 50))] || null;
    }

    /**
     * Stores the longest event of an interaction.
     * @param {PerformanceEventTiming} entry
     */
    function recordInteraction(entry) {
        if (!entry.interactionId) return;
        const known = interactions.get(entry.interactionId);
        if (known && known.duration >= entry.duration) return;
        interactions.set(entry.interactionId, { duration: entry.duration, name: entry.name, t: entry.startTime, source: sourceOf(entry.target) });
        updateInp();
    }

    /**
     * Starts collecting LCP, FCP, TTFB and INP.
     */
    function startVitals() {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) vitals.ttfb = Math.max(0, nav.responseStart);

        observe('paint', entry => {
            if (entry.name === 'first-contentful-paint') vitals.fcp = entry.startTime;
        });

        observe('largest-contentful-paint', entry => {
            if (firstInput !== null && entry.startTime > firstInput) return;
            vitals.lcp = { value: entry.startTime, source: sourceOf(entry.element) };
        });

        vitals.inpSupported = typeof PerformanceEventTiming !== 'undefined' && 'interactionId' in PerformanceEventTiming.prototype;
        if (vitals.inpSupported) {
            observe('event', recordInteraction, { durationThreshold: 16 });
            observe('first-input', recordInteraction);
        }
    }

    /**
     * Returns the elements with a running animation or transition.
     * @returns {Element[]}
     */
    function animatingTargets() {
        return document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target).map(a => a.effect.target);
    }

    /**
     * Checks whether an element sits inside any of the given roots.
     * @param {Element} el
     * @param {Element[]} roots
     * @returns {boolean}
     */
    function insideAny(el, roots) {
        return roots.some(root => root === el || root.contains(el));
    }

    /**
     * Clips a rect to the viewport.
     * @param {{x: number, y: number, w: number, h: number}} r
     * @param {number} vw
     * @param {number} vh
     * @returns {{x0: number, y0: number, x1: number, y1: number}|null}
     */
    function clip(r, vw, vh) {
        const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
        const x1 = Math.min(vw, r.x + r.w), y1 = Math.min(vh, r.y + r.h);
        return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    }

    /**
     * Computes the session window CLS over the recorded shifts.
     * @returns {number}
     */
    function cls() {
        let max = 0, current = 0, start = 0, last = -Infinity;
        for (const s of shifts) {
            if (s.input) continue;
            if (s.t - last > 1000 || s.t - start > 5000) {
                current = 0;
                start = s.t;
            }
            current += s.value;
            last = s.t;
            max = Math.max(max, current);
        }
        return max;
    }

    /**
     * Scores the moved elements of one frame and stores the shift.
     * @param {Array<object>} moved
     * @param {number} now
     * @param {number} vw
     * @param {number} vh
     */
    function record(moved, now, vw, vh) {
        const byEl = new Map(moved.map(m => [m.el, m]));
        const roots = moved.filter(m => {
            const parent = byEl.get(m.el.parentElement);
            return !parent || Math.abs(parent.vdx - m.vdx) >= MOVE_THRESHOLD || Math.abs(parent.vdy - m.vdy) >= MOVE_THRESHOLD;
        });

        const cell = Math.max(4, Math.ceil(Math.max(vw, vh) / 160));
        const cols = Math.ceil(vw / cell), rows = Math.ceil(vh / cell);
        const grid = new Uint8Array(cols * rows);
        let marked = 0;

        const scored = roots.map(m => {
            const a = clip(m.old, vw, vh), b = clip(m.cur, vw, vh);
            const area = (a ? (a.x1 - a.x0) * (a.y1 - a.y0) : 0) + (b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0);
            return { m, a, b, area };
        }).filter(s => s.area > 0).sort((p, q) => q.area - p.area);

        for (const s of scored.slice(0, MAX_ROOTS)) {
            for (const r of [s.a, s.b]) {
                if (!r) continue;
                const c1 = Math.min(cols, Math.ceil(r.x1 / cell)), r1 = Math.min(rows, Math.ceil(r.y1 / cell));
                for (let row = Math.floor(r.y0 / cell); row < r1; row++) {
                    for (let col = Math.floor(r.x0 / cell); col < c1; col++) {
                        const i = row * cols + col;
                        if (!grid[i]) {
                            grid[i] = 1;
                            marked++;
                        }
                    }
                }
            }
        }

        if (!marked) return;

        const impact = marked / (cols * rows);
        const distance = moved.reduce((max, m) => Math.max(max, Math.abs(m.vdx), Math.abs(m.vdy)), 0) / Math.max(vw, vh);
        const sources = scored.slice(0, 5).map(s => ({ id: idFor(s.m.el), selector: describe(s.m.el), dx: Math.round(s.m.vdx), dy: Math.round(s.m.vdy) }));

        shifts.push({ t: now, value: impact * distance, input: now - lastInput < INPUT_EXCLUSION_MS, sources });
        if (shifts.length > MAX_SHIFTS) shifts.shift();
    }

    /**
     * Compares every rendered element with the previous measurement.
     */
    function measure() {
        const now = performance.now();
        lastMeasure = now;
        dirty = false;

        const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        const sx = window.scrollX, sy = window.scrollY;
        const animating = animatingTargets();
        const scrolled = [...scrolledContainers];
        scrolledContainers.clear();

        const next = new Map();
        const moved = [];
        const all = document.getElementsByTagName('*');

        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const r = el.getBoundingClientRect();
            if (r.width * r.height === 0) continue;

            const cur = { x: r.left, y: r.top, w: r.width, h: r.height, docX: r.left + sx, docY: r.top + sy };
            next.set(el, cur);

            const old = prev.get(el);
            if (!old || rebase) continue;

            const vdx = cur.x - old.x, vdy = cur.y - old.y;
            const ddx = cur.docX - old.docX, ddy = cur.docY - old.docY;
            if (Math.max(Math.abs(vdx), Math.abs(vdy)) < MOVE_THRESHOLD || Math.max(Math.abs(ddx), Math.abs(ddy)) < MOVE_THRESHOLD) continue;
            if (insideAny(el, animating) || insideAny(el, scrolled)) continue;

            moved.push({ el, old, cur, vdx, vdy });
        }

        prev = next;
        rebase = false;
        if (moved.length) record(moved, now, vw, vh);
    }

    /**
     * Runs a measurement each frame while something may have changed.
     */
    function tick() {
        const now = performance.now();
        if (loadPhase || dirty || rebase || animatingTargets().length || now - lastMeasure >= IDLE_POLL_MS) measure();
        requestAnimationFrame(tick);
    }

    /**
     * Attaches the listeners and starts measuring.
     */
    function start() {
        const markDirty = () => { dirty = true; };
        const markInput = () => {
            lastInput = performance.now();
            if (firstInput === null) firstInput = lastInput;
        };

        startVitals();

        window.addEventListener('pointerdown', markInput, true);
        window.addEventListener('keydown', markInput, true);
        window.addEventListener('resize', () => { rebase = true; });
        document.addEventListener('scroll', e => {
            if (e.target !== document && e.target.nodeType === 1) scrolledContainers.add(e.target);
        }, true);
        ['load', 'error', 'loadedmetadata', 'transitionend', 'animationend'].forEach(type => document.addEventListener(type, markDirty, true));

        if (document.readyState === 'complete') setTimeout(() => { loadPhase = false; }, 2000);
        else window.addEventListener('load', () => setTimeout(() => { loadPhase = false; }, 2000), { once: true });

        new MutationObserver(markDirty).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        document.fonts.addEventListener('loadingdone', markDirty);

        requestAnimationFrame(tick);
    }

    browser.runtime.onMessage.addListener(msg => {
        if (msg.type === 'get') {
            const slowest = [...interactions.values()].sort((a, b) => b.duration - a.duration).slice(0, 20);
            return Promise.resolve({ enabled, site: SITE, cls: cls(), shifts, vitals, interactions: slowest });
        }
        if (!enabled) return;
        if (msg.type === 'reset') {
            shifts.length = 0;
            interactions.clear();
            vitals.inp = null;
            rebase = true;
            return Promise.resolve(true);
        }
        if (msg.type === 'highlight') {
            const el = refs.get(msg.id)?.deref();
            if (!el || !el.isConnected) return Promise.resolve(false);
            el.scrollIntoView({ block: 'center' });
            const { outline, outlineOffset } = el.style;
            el.style.outline = '3px solid #ff2d55';
            el.style.outlineOffset = '2px';
            setTimeout(() => {
                el.style.outline = outline;
                el.style.outlineOffset = outlineOffset;
            }, 2000);
            return Promise.resolve(true);
        }
    });

    browser.storage.local.get('sites').then(({ sites = [] }) => {
        enabled = sites.includes(SITE);
        if (enabled) start();
    });
})();

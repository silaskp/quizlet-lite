/*
 * Quizlet Lite
 * Copyright (c) 2026 silaskp. MIT License, see LICENSE.
 *
 * A helper panel for Quizlet Live, pasted into the DevTools console on quizlet.com.
 * Where answers come from:
 *   - A set you load: paste its link and it reads the set through Quizlet itself (your login, this tab),
 *     or paste a word list.
 *   - The game page, if it holds the term list or says which set it is.
 *   - Learning: whenever a tile turns green or red after a click (yours or its own), it remembers.
 * Team mode: Quizlet Live splits the answer tiles across teammates, so the right one is often on someone
 * else's screen. Then it does NOT click (a wrong click resets the team); the hint line names the answer instead.
 * Run it again (or press \) to show/hide. ✕ (click twice) stops everything and removes it.
 */
(() => {
    const KEY = Symbol.for("ql.lite");
    if (window[KEY]) return window[KEY].toggle();

    // ---------- storage ----------
    // sets: id -> { title, terms: { term: definition }, from }   active: a set id or null
    // learned: set id (or "_" with no set) -> { prompt: answer }, from green tiles and Add Term
    const STORE = "ql.lite.v2";
    const SPEEDS = { human: () => 900 + Math.random() * 1600, fast: () => 250 + Math.random() * 350, instant: () => 0 };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch {}
    saved.sets ||= {};
    saved.learned ||= {};
    if (!SPEEDS[saved.speed]) saved.speed = "human";
    if (saved.active && !saved.sets[saved.active]) saved.active = null;
    let closed = false, saveWarned = false; // after ✕ a late set load must not write over a newer paste's data
    const save = () => {
        if (closed) return;
        try { localStorage.setItem(STORE, JSON.stringify(saved)); }
        catch { if (!saveWarned) { saveWarned = true; status("Browser storage is full: changes won't be kept. Remove a set you don't need.", true); } }
    };
    const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const bucket = () => (saved.learned[saved.active || "_"] ||= {});
    let cur = null, refresh = () => {}, status = () => {};

    // ---------- dictionary ----------
    // Both directions (the host picks whether terms or definitions are the prompt). Lookups go exact, normalised,
    // first part of a "word, forms, …" term, then loose containment.
    const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    const head = (s) => norm(String(s ?? "").split(",")[0]);
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    // alts: a prompt with several right answers (two terms with the same definition) -> all of them.
    let dict, byNorm, byHead, heads, alts;
    function rebuild() {
        dict = Object.create(null); byNorm = new Map(); byHead = new Map(); heads = new Set(); alts = new Map();
        const add = (t, d, fromSet) => {
            dict[t] = d; dict[d] = t;
            for (const [k, v] of [[norm(t), d], [norm(d), t]]) {
                const list = alts.get(k) || [];
                if (!list.some((x) => norm(x) === norm(v))) alts.set(k, [...list, v]);
            }
            byNorm.set(norm(t), d); byNorm.set(norm(d), t);
            // Terms like "amor, amōris, m." often show up as just "amor". Indexed only when the first part is unambiguous.
            if (fromSet && t.includes(",")) {
                heads.add(norm(t));
                const f = head(t);
                if (f.length >= 3) byHead.set(f, byHead.has(f) && byHead.get(f) !== d ? null : d);
            }
        };
        const set = saved.sets[saved.active];
        if (set) for (const [t, d] of Object.entries(set.terms)) add(t, d, true);
        for (const [t, d] of Object.entries(bucket())) add(t, d, false);
    }
    // Exact, normalised and first-part matches are "sure". A loose match ("consul" inside "proconsul") is only a guess:
    // it's shown in the hint but never auto-clicked, because a wrong click resets the team.
    let guessed = false;
    function lookup(q) {
        guessed = false;
        if (!q) return null;
        if (dict[q]) return dict[q];
        const n = norm(q);
        if (byNorm.has(n)) return byNorm.get(n);
        if (byHead.get(head(q))) return byHead.get(head(q));
        if (n.length < 3) return null;
        for (const [k, v] of byNorm) {
            if (k.length < 3) continue;
            if ((k.includes(n) && n.length >= k.length * 0.6) || (n.includes(k) && k.length >= n.length * 0.6)) return (guessed = true), v;
        }
        return null;
    }
    const answersFor = (q) => { const a = alts.get(norm(q)); return a && a.length > 1 ? (guessed = false, a) : [lookup(q)].filter(Boolean); };
    function learn(q, a) {
        q = clean(q); a = clean(a);
        if (!q || !a || q === a || q == "__proto__" || dict[q] === a) return false;
        bucket()[q] = a;
        save(); rebuild();
        return true;
    }
    function unlearn(q) {
        const b = bucket();
        if (!own(b, q)) return false;
        delete b[q];
        save(); rebuild();
        return true;
    }
    function addSet(id, title, pairs, from, activate = true) {
        if (closed) return 0;
        const terms = {};
        for (const [t, d] of pairs) { const a = clean(t), b = clean(d); if (a && b && a !== b && a != "__proto__") terms[a] = b; }
        const n = Object.keys(terms).length;
        if (!n) return 0;
        const isNew = !own(saved.sets, id);
        saved.sets[id] = { title: clean(title) || `Set ${id}`, terms, from };
        if (activate) saved.active = id;
        save(); rebuild();
        if (activate || saved.active == id) cur = null;
        if (isNew || activate) refresh(); // the pickers list the sets
        return n;
    }
    rebuild();

    // ---------- loading a set ----------
    // Term pairs out of any JSON Quizlet sends: studiable items ({cardSides: [{label: "word", media: [{plainText}]}, …]}),
    // or plain {word|term, definition}. JSON that sits inside a string (page data) is opened up too.
    function pairsIn(root) {
        const out = [], seen = new WeakSet();
        const text = (side) => (side?.media || []).map((m) => m?.plainText).find((x) => typeof x == "string" && x.trim());
        (function walk(o, d) {
            if (o == null || d > 60) return;
            if (typeof o == "string") {
                const s = o.trim();
                if (s.length > 20 && (s[0] == "{" || s[0] == "[") && /cardSides|definition/.test(s)) try { walk(JSON.parse(s), d + 1); } catch {}
                return;
            }
            if (typeof o != "object" || seen.has(o)) return;
            seen.add(o);
            if (Array.isArray(o.cardSides)) {
                const a = text(o.cardSides.find((s) => s?.label == "word") || o.cardSides[0]);
                const b = text(o.cardSides.find((s) => s?.label == "definition") || o.cardSides[1]);
                if (a && b) return void out.push([a, b]);
            }
            const t = typeof o.word == "string" ? o.word : typeof o.term == "string" ? o.term : null;
            if (t && typeof o.definition == "string" && t.trim() && o.definition.trim()) return void out.push([t, o.definition]);
            for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, d + 1);
        })(root, 0);
        const keys = new Set();
        return out.filter(([a, b]) => { const k = clean(a) + "\u0000" + clean(b); return !keys.has(k) && keys.add(k); });
    }
    // The set page: Next.js page data first, else the escaped card JSON in its scripts.
    function fromHtml(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const title = clean((doc.querySelector("meta[property='og:title']")?.content || doc.title || "").replace(/\s*[|·-]\s*Quizlet\s*$/i, "").replace(/\s*Flashcards\s*$/i, ""));
        let pairs = [];
        const data = doc.getElementById("__NEXT_DATA__");
        if (data) try { pairs = pairsIn(JSON.parse(data.textContent)); } catch {}
        if (!pairs.length) {
            const unescape = (s) => { for (let i = 0; i < 2 && s.includes("\\"); i++) try { s = JSON.parse(`"${s}"`); } catch { break; } return s; };
            // One card at a time: the gap between its word and definition may not cross into another card's sides.
            const re = /\\"label\\":\\"word\\",\\"media\\":\[\{\\"type\\":1,\\"plainText\\":\\"(.*?)\\",(?:(?!cardSides|\\"label\\":\\"word).)*?\\"label\\":\\"definition\\",\\"media\\":\[\{\\"type\\":1,\\"plainText\\":\\"(.*?)\\",/g;
            pairs = pairsIn([...html.matchAll(re)].map((m) => ({ word: unescape(m[1]), definition: unescape(m[2]) })));
        }
        return { title, pairs };
    }
    // "https://quizlet.com/123456789/some-title-flash-cards/", "quizlet.com/gb/123456789/…" or just "123456789".
    function setIdOf(s) {
        s = clean(s);
        if (/^\d{4,}$/.test(s)) return s;
        try {
            const u = new URL(/^https?:/i.test(s) ? s : `https://${s}`);
            if (!/(^|\.)quizlet\.com$/i.test(u.hostname)) return null;
            return u.pathname.split("/").find((p) => /^\d{4,}$/.test(p)) || null;
        } catch { return null; }
    }
    const ON_QUIZLET = /(^|\.)quizlet\.com$/i.test(location.hostname);
    const base = location.hostname == "quizlet.com" ? "" : "https://quizlet.com";
    // Reads a set the way the Quizlet site does (same login, same tab): its study-items API, else the set page.
    async function loadSet(input) {
        const id = setIdOf(input);
        if (!id) throw new Error("That isn't a Quizlet set link.");
        if (!ON_QUIZLET) throw new Error("Run this on a quizlet.com tab (it reads the set through your Quizlet login).");
        status(`Loading set ${id}…`);
        const pairs = [], keys = new Set(), errors = [];
        let title = "";
        const take = (list) => { let n = 0; for (const p of list) { const k = p.join("\u0000"); if (!keys.has(k)) { keys.add(k); pairs.push(p); n++; } } return n; };
        try {
            // Pages until one adds nothing new (also stops if the API ignores the page number).
            for (let page = 1; page <= 20; page++) {
                const r = await fetch(`${base}/webapi/3.4/studiable-item-documents?filters%5BstudiableContainerId%5D=${id}&filters%5BstudiableContainerType%5D=1&perPage=500&page=${page}`, { credentials: "include", headers: { Accept: "application/json" } });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                if (!take(pairsIn(await r.json()))) break;
            }
        } catch (e) { errors.push(`API ${e.message}`); }
        try {
            const r = await fetch(`${base}/${id}/`, { credentials: "include" }); // redirects to the set's own page
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const got = fromHtml(await r.text());
            title = got.title;
            if (!pairs.length) take(got.pairs);
        } catch (e) { errors.push(`set page ${e.message}`); }
        if (!pairs.length) throw new Error(`Couldn't read set ${id}${errors.length ? ` (${errors.join(", ")})` : ""}. If it's private, paste its word list instead.`);
        const n = addSet(id, title || `Set ${id}`, pairs, "link");
        if (!n) return 0; // closed while loading
        status(`Loaded "${saved.sets[id].title}": ${n} terms`);
        return n;
    }
    // One card per line: term<TAB>definition (Quizlet's export), or "term = definition", "term - definition", "term: definition".
    function parseList(text) {
        const pairs = [];
        let skipped = 0;
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            // Tab, then " = ", then ": ", then the LAST " - " ("fero - ferre - tuli - latum - to carry").
            const m = line.match(/^(.+?)\t+(.+)$/) || line.match(/^(.+?)\s+=\s+(.+)$/) || line.match(/^(.+?):\s+(.+)$/) || line.match(/^(.+)\s+[—–-]\s+(.+)$/);
            if (m) pairs.push([m[1], m[2]]); else skipped++;
        }
        return { pairs, skipped };
    }

    // ---------- the game page ----------
    // If the page's React state holds the term list, use it; if it names the set, load that set.
    const isTerm = (i) => i && typeof i == "object" && ((typeof i.word == "string" && typeof i.definition == "string") || (typeof i.term == "string" && typeof i.definition == "string") || Array.isArray(i.cardSides));
    let lastId = null, lastSig = "";
    function harvest() {
        const found = [], ids = new Set();
        try {
            const host = document.getElementById("__next") || document.body.firstElementChild;
            const k = host && Object.keys(host).find((x) => x.startsWith("__reactContainer") || x.startsWith("__reactFiber"));
            if (!k) return 0;
            const seen = new WeakSet();
            const scan = (o, d) => {
                if (!o || typeof o != "object" || seen.has(o) || d > 10 || o instanceof Node) return;
                seen.add(o);
                if (Array.isArray(o)) {
                    if (o.length >= 2 && isTerm(o[0])) found.push(...pairsIn(o));
                    else for (const i of o) scan(i, d + 1);
                    return;
                }
                for (const [key, v] of Object.entries(o)) {
                    if (/^(setId|studiableContainerId)$/.test(key) && /^\d{4,}$/.test(String(v))) ids.add(String(v));
                    if (key == "id" && "numTerms" in o && /^\d{4,}$/.test(String(v))) ids.add(String(v));
                    try { scan(v, d + 1); } catch {}
                }
            };
            const walk = (f, d) => {
                for (; f && d < 400; f = f.sibling, d++) {
                    if (seen.has(f)) return;
                    seen.add(f);
                    scan(f.memoizedProps, 0); scan(f.memoizedState, 0);
                    walk(f.child, d + 1);
                }
            };
            const r = host[k];
            walk(r?.stateNode?.current || r, 0);
        } catch {}
        // The game names its set: switch to it (loading it the first time). Only when it names exactly one,
        // so a list of other sets on the page never switches anything. Once per id per paste.
        const [id] = ids;
        if (ids.size == 1 && id !== lastId) {
            lastId = id;
            if (!saved.sets[id]) loadSet(id).catch((e) => status(`Found this game's set (${id}) but couldn't load it: ${e.message}`, true));
            else if (saved.active != id) { saved.active = id; save(); rebuild(); cur = null; refresh(); status(`Switched to this game's set: ${summary()}`); }
        }
        if (!found.length) return 0;
        // Same list as last time: nothing to do (no re-save, no panel rebuild every 3 s).
        const sig = found.map(([t, d]) => clean(t) + "\u0000" + clean(d)).sort().join("\u0001");
        if (sig === lastSig) return 0;
        lastSig = sig;
        return addSet("page", "Found in this game", found, "page", !saved.active || saved.active == "page"); // this game's list replaces the last game's
    }

    // ---------- reading the game screen ----------
    // Known Quizlet Live classes first; if they've rotated, fall back to "every FormattedText that sits
    // inside something clickable is a tile, the one that isn't is the prompt".
    const SEL = { text: ".FormattedText", tile: ".a142laeh" };
    let root; // the panel, excluded from every read
    const txt = (el) => String((el && (el.innerText ?? el.textContent)) || "").replace(/\s+/g, " ").trim();
    const shown = (el) => el.isConnected && getComputedStyle(el).display != "none" && getComputedStyle(el).visibility != "hidden";
    function clickable(el) {
        for (let p = el, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
            if (p.matches("button,[role=button],[tabindex]") || getComputedStyle(p).cursor == "pointer") return p;
        }
        return null;
    }
    function screen() {
        const texts = [...document.querySelectorAll(SEL.text)].filter((e) => !root?.contains(e) && shown(e));
        let tiles = [...document.querySelectorAll(SEL.tile)].filter((e) => !root?.contains(e) && shown(e));
        if (!tiles.length) tiles = [...new Set(texts.map(clickable).filter(Boolean))];
        const prompt = texts.find((e) => !tiles.some((t) => t.contains(e)));
        return { prompt, q: txt(prompt), tiles, names: tiles.map(txt) };
    }

    // Pick the tile that IS the answer. Needs a clear winner: a tie or a weak match counts as "not on my screen".
    function pickTile(tiles, answer, q) {
        const a = norm(answer), isHead = heads.has(a);
        const scored = tiles.map((t) => {
            const n = norm(txt(t));
            let s = 0;
            if (!n || (q && bad.has(badKey(q, txt(t))))) s = 0;
            else if (n === a) s = 100;
            // A tile that is some OTHER known term/definition is never ours ("throw" vs "throw in").
            else if (byNorm.has(n)) s = 0;
            else if (isHead && head(txt(t)) === head(answer)) s = 80;
            else if ((n.includes(a) || a.includes(n)) && Math.min(n.length, a.length) / Math.max(n.length, a.length) >= 0.75) s = 70;
            return { t, s };
        }).sort((x, y) => y.s - x.s);
        if (!scored.length || scored[0].s < 60) return null;
        if (scored[1] && scored[1].s === scored[0].s) return null;
        return scored[0].t;
    }

    // Full pointer sequence on whatever is under the tile's centre (a bare .click() isn't always enough).
    function hit(el) {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const under = document.elementFromPoint?.(x, y);
        const tgt = under && el.contains(under) ? under : el;
        const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };
        const P = window.PointerEvent || MouseEvent, p = { ...o, pointerId: 1, isPrimary: true, pointerType: "mouse" };
        tgt.dispatchEvent(new P("pointerover", p));
        tgt.dispatchEvent(new P("pointerdown", p));
        tgt.dispatchEvent(new MouseEvent("mousedown", o));
        tgt.dispatchEvent(new P("pointerup", { ...p, buttons: 0 }));
        tgt.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
        tgt.dispatchEvent(new MouseEvent("click", { ...o, buttons: 0, detail: 1 }));
    }

    // After any tile click, watch it for ~1.5s: green = right (learn it), red = wrong (forget a bad learned pair).
    const rgb = (el) => (getComputedStyle(el).backgroundColor.match(/\d+/g) || []).map(Number);
    const isGreen = ([r, g, b]) => g > 130 && g > r + 30 && g > b + 30;
    const isRed = ([r, g, b]) => r > 150 && r > g + 30 && r > b + 30;
    const stats = { right: 0, wrong: 0, clicks: 0 };
    const bad = new Set(); // prompt + tile pairs that turned red: never clicked again (even if a set says so)
    const badKey = (q, name) => norm(q) + "\u0000" + norm(name);
    function watch(q, tile) {
        const name = txt(tile), t0 = Date.now();
        const tick = () => {
            if (!tile.isConnected) return;
            const els = [tile, ...tile.querySelectorAll("*")].slice(0, 6);
            if (els.some((e) => isGreen(rgb(e)))) {
                stats.right++;
                if (screen().q === q) learn(q, name); // only while that question is still the one on screen
                if (cur?.q === q) cur.green = true;
                return;
            }
            if (els.some((e) => isRed(rgb(e)))) { stats.wrong++; bad.add(badKey(q, name)); if (bucket()[q] === name) unlearn(q); if (cur?.q === q) cur = null; return; }
            if (Date.now() - t0 < 1500) setTimeout(tick, 50);
        };
        setTimeout(tick, 50);
    }

    // ---------- engine ----------
    const opts = { auto: false, highlight: false };
    let hintEl, statusEl;
    function hint(msg, color) { if (hintEl) { hintEl.textContent = msg; hintEl.style.color = color || ""; } }
    function clearOutline() { document.querySelectorAll("[data-ql-lite]").forEach((e) => { e.style.outline = ""; e.removeAttribute("data-ql-lite"); }); }
    function step() {
        const s = screen();
        if (!s.q || s.tiles.length < 2) { if (cur) { cur = null; clearOutline(); hint("Waiting for a question…", C.dim); } return; }
        const key = s.q + "#" + s.names.slice().sort().join("|");
        const now = Date.now();
        // Same text again after a right answer, but new tile elements: that's the next question, not this one.
        if (cur && cur.key === key && cur.green && s.tiles[0] !== cur.first) cur = null;
        if (!cur || cur.key !== key) {
            clearOutline();
            const answers = answersFor(s.q), sure = !guessed;
            // Several right answers: use the one on my screen; none or more than one shown = don't click.
            const mine = answers.filter((a) => pickTile(s.tiles, a, s.q));
            const answer = mine.length === 1 ? mine[0] : answers.length === 1 ? answers[0] : null;
            const all = answers.join(" or ");
            cur = { key, q: s.q, answer: sure ? answer : null, at: now, clickAt: null, tries: 0, first: s.tiles[0] };
            if (!answers.length) hint(`Unknown: "${s.q.slice(0, 60)}". Answer it yourself (it'll learn).`, "#ffd479");
            else if (!sure) hint(`Maybe: ${all} (close match only, not clicking)`, "#ffd479");
            else if (mine.length > 1) hint(`Both shown, your call: ${all}`, "#ffd479");
            else if (!mine.length) hint(answers.some((a) => s.tiles.some((t) => bad.has(badKey(s.q, txt(t))) && norm(txt(t)) === norm(a))) ? `Marked wrong last time: ${all}. Your call.` : `On a teammate's screen: ${all}`, "#7fb2ff");
            else hint(`Answer: ${answer}`, "#9fe8b0");
        }
        if (!cur.answer) return;
        const tile = pickTile(s.tiles, cur.answer, s.q);
        if (!tile) return;
        if (opts.highlight && !tile.hasAttribute("data-ql-lite")) { tile.style.outline = "4px solid #2fd47a"; tile.setAttribute("data-ql-lite", ""); }
        if (!opts.auto) return;
        if (now - cur.at < 250) return; // the screen must hold still a moment (never click mid-transition)
        if (cur.clickAt == null) cur.clickAt = now + SPEEDS[saved.speed]();
        // One retry if the same question is still sitting there 4s after our click (click didn't register).
        if (now >= cur.clickAt && cur.tries < 2) {
            cur.tries++;
            cur.clickAt = now + 4000;
            stats.clicks++;
            hit(tile);
            watch(cur.q, tile);
        }
    }

    // Learn from your own clicks too (capture phase, so the game can't swallow it first).
    const onUserClick = (e) => {
        if (!e.isTrusted || root?.contains(e.target)) return;
        const s = screen();
        const tile = s.tiles.find((t) => t.contains(e.target));
        if (tile && s.q) watch(s.q, tile);
    };
    document.addEventListener("click", onUserClick, true);
    const engine = setInterval(() => { try { step(); } catch (e) { status(`Engine: ${e.message}`, true); } }, 100);
    const harvester = setInterval(() => { const n = harvest(); if (n) status(`Found ${n} terms in this game.`); }, 3000);

    // ---------- GUI (DOM only, no innerHTML: set titles and terms come from other people) ----------
    status = (msg, bad) => statusEl && ((statusEl.textContent = msg), (statusEl.style.color = bad ? "#ff8a8a" : "#9fe8b0"));
    // Destructive buttons ask twice in the panel instead of a browser dialog: the first click arms it for 3 s.
    const armed = new Map();
    function askTwice(key, question) {
        if (Date.now() - (armed.get(key) || 0) < 3000) return armed.delete(key), true;
        armed.set(key, Date.now());
        status(`${question} Click again to confirm.`, true);
        return false;
    }
    const h = (tag, style = {}, props = {}, ...kids) => {
        const el = Object.assign(document.createElement(tag), props);
        Object.assign(el.style, style);
        el.append(...kids);
        return el;
    };
    const C = { bg: "#1c1f26", panel: "#262a33", line: "#3a404c", text: "#e8eaf0", dim: "#9aa3b2", on: "#2f8f5b", accent: "#4c7cf0" };
    const inputStyle = { width: "100%", boxSizing: "border-box", marginTop: "6px", padding: "5px 6px", background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: "5px", font: "inherit" };
    const termCount = (id) => Object.keys(saved.sets[id]?.terms || {}).length;
    const summary = () => {
        const set = saved.sets[saved.active], n = Object.keys(bucket()).length;
        return set ? `${set.title}: ${termCount(saved.active)} terms + ${n} learned` : `No set loaded (Sets tab). ${n} learned answers.`;
    };

    const tabs = {
        Answers: [
            { name: "Auto Answer", desc: "Clicks the right tile when it's on your screen. Never clicks when it's on a teammate's.", toggle: true, on: () => (opts.auto = true), off: () => (opts.auto = false) },
            { name: "Highlight Answer", desc: "Outlines the right tile green so you can click it yourself", toggle: true, on: () => (opts.highlight = true), off: () => ((opts.highlight = false), clearOutline()) },
            {
                name: "Speed", desc: "Delay before Auto Answer clicks", inputs: [{ name: "speed", type: "select", value: () => saved.speed, options: () => [["human", "Human (0.9–2.5s)"], ["fast", "Fast (0.25–0.6s)"], ["instant", "Instant"]] }],
                run(v) { saved.speed = v; save(); status(`Speed: ${v}`); },
            },
        ],
        Sets: [
            {
                name: "Load Set", desc: "Paste a Quizlet set link and press Enter. Reads the whole set through Quizlet, as you.",
                inputs: [{ name: "https://quizlet.com/…", type: "text" }],
                run: (url) => loadSet(url),
            },
            {
                name: "Paste Word List", desc: "One card per line: term, Tab, definition (Quizlet's export), or term - definition. Then Ctrl/Cmd+Enter.",
                inputs: [{ name: "term\tdefinition", type: "textarea" }],
                run(text) {
                    const { pairs, skipped } = parseList(text);
                    if (!pairs.length) throw new Error("No term/definition pairs found. Put a Tab or \" - \" between them.");
                    let hash = 0; for (const c of pairs.map((p) => p.join("\t")).join("\n")) hash = (hash * 31 + c.charCodeAt(0)) | 0;
                    const id = "list-" + (hash >>> 0).toString(36); // the same list pasted again reuses its set
                    const n = addSet(id, `Pasted list (${pairs.length} terms)`, pairs, "list");
                    status(`Loaded ${n} terms${skipped ? ` · skipped ${skipped} line${skipped > 1 ? "s" : ""} with no separator` : ""}`);
                },
            },
            {
                name: "Active Set", desc: "Which loaded set to answer from (learned answers are kept per set)",
                inputs: [{ name: "set", type: "select", value: () => saved.active || "", options: () => [["", "None (learned answers only)"], ...Object.entries(saved.sets).map(([id, s]) => [id, `${s.title} (${termCount(id)})`])] }],
                run(v) { saved.active = v || null; save(); rebuild(); cur = null; status(summary()); },
            },
            {
                name: "Remove Set", desc: "Deletes the active set and what it learned for it",
                run() {
                    const id = saved.active;
                    if (!id) throw new Error("No set is active.");
                    if (!askTwice("remove", `Remove "${saved.sets[id].title}"?`)) return;
                    delete saved.sets[id]; delete saved.learned[id];
                    saved.active = null;
                    save(); rebuild(); cur = null; refresh(); status(summary());
                },
            },
            { name: "Re-scan Page", desc: "Looks for the term list (or the set's id) in the game page", run() { const n = harvest(); status(n ? `Found ${n} terms in this game.` : "Nothing new in the page."); } },
        ],
        Learned: [
            {
                name: "Add Term", desc: "Teach it a pair by hand (works either direction)", inputs: [{ name: "term", type: "text" }, { name: "definition", type: "text" }],
                run(t, d) { status(learn(t, d) ? `Learned: ${t} = ${d}` : "Already known."); cur = null; },
            },
            { name: "Learned Count", desc: "Answers learned from clicks or by hand, for the active set", run() { status(`${summary()} · ${stats.right} right / ${stats.wrong} wrong / ${stats.clicks} auto clicks this session`); } },
            { name: "Forget Learned", desc: "Deletes learned answers for the active set (the set itself stays)", run() { if (!askTwice("forget", "Delete learned answers for this set?")) return; saved.learned[saved.active || "_"] = {}; save(); rebuild(); cur = null; status(summary()); } },
            {
                name: "Diagnose", desc: "If nothing gets clicked: logs what it can see to the console",
                run() {
                    const s = screen();
                    const chain = (e) => { const c = []; for (let p = e, i = 0; p && i < 4; p = p.parentElement, i++) c.push(p.className || p.tagName); return c; };
                    console.log("[quizlet-lite] prompt:", s.q, "| tiles:", s.names, "| answer:", lookup(s.q));
                    console.log("[quizlet-lite] FormattedText chains:", [...document.querySelectorAll(SEL.text)].map((e) => ({ t: txt(e).slice(0, 30), chain: chain(e) })));
                    status(`prompt ${s.q ? "found" : "MISSING"} · ${s.tiles.length} tiles · details in console`, !s.q || s.tiles.length < 2);
                },
            },
        ],
    };

    root = h("div", {
        position: "fixed", top: "20px", right: "20px", width: "260px", zIndex: 2147483647, background: C.bg, color: C.text,
        border: `1px solid ${C.line}`, borderRadius: "10px", font: "13px/1.35 system-ui, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.45)", userSelect: "none",
    });
    const close = h("span", { cursor: "pointer", color: C.dim, padding: "0 4px" }, { textContent: "✕", title: "Close (stops everything)" });
    const header = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", cursor: "move", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, {}, "Quizlet Lite · Live", close);
    const tabBar = h("div", { display: "flex", flexWrap: "wrap", gap: "4px", padding: "8px 10px 0" });
    const list = h("div", { maxHeight: "60vh", overflowY: "auto", padding: "8px 10px" });
    hintEl = h("div", { margin: "0 10px 8px", padding: "6px 8px", fontSize: "13px", fontWeight: 600, background: C.panel, border: `1px solid ${C.line}`, borderRadius: "7px", userSelect: "text" });
    statusEl = h("div", { padding: "0 10px 8px", fontSize: "12px", minHeight: "14px" });
    root.append(header, tabBar, list, hintEl, statusEl);
    hint("Waiting for a question…", C.dim);

    function card(cheat) {
        const title = h("div", { fontWeight: 600 }, { textContent: cheat.name });
        const desc = h("div", { color: C.dim, fontSize: "12px" }, { textContent: cheat.desc });
        const box = h("div", { background: C.panel, border: `1px solid ${C.line}`, borderRadius: "7px", padding: "8px", marginBottom: "6px", cursor: "pointer" }, {}, title, desc);
        const fields = (cheat.inputs || []).map((inp) => {
            const el = inp.type == "select"
                ? h("select", inputStyle, {}, ...inp.options().map((o) => (Array.isArray(o) ? h("option", {}, { value: o[0], textContent: o[1] }) : h("option", {}, { value: o, textContent: o }))))
                : inp.type == "textarea"
                    ? h("textarea", { ...inputStyle, height: "70px", resize: "vertical", userSelect: "text" }, { placeholder: inp.name })
                    : h("input", { ...inputStyle, userSelect: "text" }, { type: "text", placeholder: inp.name });
            if (inp.value) el.value = inp.value();
            el.addEventListener("click", (e) => e.stopPropagation());
            el.addEventListener("mousedown", (e) => e.stopPropagation());
            el.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key == "Enter" && (inp.type != "textarea" || e.metaKey || e.ctrlKey)) { e.preventDefault(); fire(); }
            });
            if (inp.type == "select") el.addEventListener("change", () => fire());
            box.append(el);
            return { inp, el };
        });
        const paint = () => (box.style.background = cheat.active ? C.on : C.panel);
        async function fire() {
            try {
                if (cheat.toggle) {
                    cheat.active = !cheat.active;
                    cheat.active ? cheat.on() : cheat.off();
                    return paint();
                }
                const args = [];
                for (const { inp, el } of fields) {
                    if (el.value === "" && inp.type != "select") return status(`${cheat.name}: fill this in first.`, true);
                    args.push(el.value);
                }
                const before = statusEl.textContent;
                await cheat.run(...args);
                if (statusEl.textContent == before) status(`${cheat.name}: done.`);
                fields.forEach(({ inp, el }) => inp.type != "select" && (el.value = ""));
                if (box.isConnected) { box.style.background = C.accent; setTimeout(paint, 250); }
            } catch (e) {
                status(`${cheat.name}: ${e.message}`, true);
            }
        }
        box.addEventListener("click", fire);
        paint();
        return box;
    }

    const tabButtons = {};
    let showing = "Answers";
    function show(name) {
        showing = name;
        list.replaceChildren(...tabs[name].map(card));
        for (const [n, b] of Object.entries(tabButtons)) b.style.background = n == name ? C.accent : C.panel;
    }
    refresh = () => show(showing); // re-render after the set list changes (the pickers read it)
    for (const name of Object.keys(tabs)) {
        tabButtons[name] = h("div", { padding: "3px 7px", borderRadius: "5px", cursor: "pointer", fontSize: "12px", border: `1px solid ${C.line}` }, { textContent: name });
        tabButtons[name].addEventListener("click", () => show(name));
        tabBar.append(tabButtons[name]);
    }
    show(saved.active ? "Answers" : "Sets");
    status(summary());
    harvest();

    // Drag by header.
    header.addEventListener("mousedown", (e) => {
        if (e.target == close) return;
        const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = (m) => Object.assign(root.style, { left: `${Math.max(0, m.clientX - dx)}px`, top: `${Math.max(0, m.clientY - dy)}px`, right: "auto" });
        const up = () => (document.removeEventListener("mousemove", move), document.removeEventListener("mouseup", up));
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });

    const toggle = () => (root.style.display = root.style.display == "none" ? "" : "none");
    const onKey = (e) => e.key == "\\" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && toggle();
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", () => {
        if (!askTwice("close", "Close Quizlet Lite and stop everything?")) return;
        closed = true;
        clearInterval(engine);
        clearInterval(harvester);
        clearOutline();
        document.removeEventListener("click", onUserClick, true);
        document.removeEventListener("keydown", onKey);
        root.remove();
        delete window[KEY];
    });

    document.body.append(root);
    window[KEY] = { toggle };
})();

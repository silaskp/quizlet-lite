// Mock-DOM tests for quizlet-lite.js: a fake Quizlet Live screen, a fake set API and set page. Run: node test/test-quizlet-lite.js
const { JSDOM } = require("jsdom");
const fs = require("fs");
const code = fs.readFileSync(__dirname + "/../quizlet-lite.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : fail++, console.log((c ? "PASS " : "FAIL ") + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sample data (written for these tests).
const LATIN = [
  ["caelum, caelī, n.", "sky"], ["amor, amōris, m.", "love"], ["nox, noctis, f.", "night"], ["verbum, verbī, n.", "word"],
  ["hostis, hostis, m.", "enemy"], ["iactō, iactāre, iactāvī", "throw"], ["iniciō, inicere, iniēcī", "throw in"],
  ["ingressus, ingressa, ingressum", "having entered"], ["precātus, precāta, precātum", "having prayed to"],
  ["adeptus, adepta, adeptum", "having received, having obtained"], ["prūdentia, prūdentiae, f.", "prudence, good sense"],
  ["tūtus, tūta, tūtum", "safe"], ["magis", "more"], ["plūs", "more"], ["minus", "less"], ["multum", "much"],
];
const tsv = (pairs) => pairs.map(([a, b]) => `${a}\t${b}`).join("\n");
const apiItems = (pairs) => ({ responses: [{ models: { studiableItem: pairs.map(([w, d], i) => ({ id: i + 1, cardSides: [{ label: "word", media: [{ type: 1, plainText: w }] }, { label: "definition", media: [{ type: 1, plainText: d }] }] })) } }] });

function boot({ store, fetch, url = "https://quizlet.com/live/ABC123", known = true } = {}) {
  const dom = new JSDOM(`<body><div id=__next><div id=game></div></div></body>`, { runScripts: "outside-only", url });
  const w = dom.window, d = w.document;
  w.localStorage.setItem("ql.lite.v2", JSON.stringify(store || { speed: "instant" }));
  const calls = [];
  w.fetch = async (u, o) => { calls.push(String(u)); return (fetch || (() => ({ ok: false, status: 404 })))(String(u), o); };
  const game = d.getElementById("game");
  const clicks = [];
  // Renders a Live question. tiles = texts; correct = the right text; known=false uses unknown class names.
  const render = (prompt, tiles, correct) => {
    game.replaceChildren();
    const p = d.createElement("div"); p.className = "FormattedText"; p.textContent = prompt; game.append(p);
    for (const t of tiles) {
      const tile = d.createElement("div");
      if (known) tile.className = "a142laeh"; else tile.style.cursor = "pointer";
      const inner = d.createElement("div"); inner.className = "FormattedText"; inner.textContent = t; tile.append(inner);
      tile.addEventListener("click", () => { clicks.push(t); tile.style.backgroundColor = t === correct ? "rgb(46, 204, 113)" : "rgb(231, 76, 60)"; });
      game.append(tile);
    }
  };
  w.eval(code);
  const panel = [...d.body.children].find((e) => e.textContent.startsWith("Quizlet Lite"));
  const card = (n) => [...panel.querySelectorAll("div")].find((e) => e.firstChild?.textContent === n && e.style.cursor === "pointer");
  const tab = (n) => [...panel.querySelectorAll("div")].find((e) => e.textContent === n && e.children.length === 0 && e.style.cursor === "pointer");
  const hint = () => panel.children[3].textContent;
  const status = () => panel.lastChild.textContent;
  const saved = () => JSON.parse(w.localStorage.getItem("ql.lite.v2"));
  const enter = (el, extra = {}) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...extra }));
  const paste = async (text) => { tab("Sets").click(); const ta = card("Paste Word List").querySelector("textarea"); ta.value = text; enter(ta, { metaKey: true }); await sleep(20); };
  const loadLink = async (link) => { tab("Sets").click(); const i = card("Load Set").querySelector("input"); i.value = link; enter(i); await sleep(60); };
  return { w, d, game, clicks, render, panel, card, tab, hint, status, saved, paste, loadLink, calls, enter };
}

(async () => {
  // ---- No built-in sets: starts empty, on the Sets tab.
  let t = boot();
  ok(/No set loaded/.test(t.status()) && !!t.card("Load Set") && !!t.card("Paste Word List"), `fresh start: no set, Sets tab open (${t.status()})`);
  ok(Object.keys(t.saved().sets || {}).length === 0, "no built-in word lists");

  // ---- Paste a word list.
  await t.paste(tsv(LATIN) + "\nno separator here\n\n");
  ok(/Loaded 16 terms · skipped 1 line/.test(t.status()), `Tab-separated list loads, bad line reported (${t.status()})`);
  const typed = enterAgainNotNeeded(t);
  ok(typed, "Enter alone in the word-list box doesn't submit (only Ctrl/Cmd+Enter)");
  t.tab("Answers").click();

  t.render("caelum, caelī, n.", ["sky", "love", "night", "word"], "sky");
  await sleep(450);
  ok(t.hint() === "Answer: sky" && t.clicks.length === 0, `hint shows answer, no click while Auto is off (${t.hint()})`);
  t.card("Auto Answer").click();
  await sleep(500);
  ok(t.clicks.length === 1 && t.clicks[0] === "sky", `auto clicks the right tile exactly once (${JSON.stringify(t.clicks)})`);

  const cases = [
    ["having entered", ["adeptus, adepta, adeptum", "ingressus, ingressa, ingressum", "precātus, precāta, precātum", "nox, noctis, f."], "ingressus, ingressa, ingressum", "reverse direction, look-alike tiles"],
    ["ingressus, ingressa, ingressum", ["sky", "having entered", "having prayed to", "having received, having obtained"], "having entered", `"having ..." definitions don't confuse it`],
    ["more", ["magis", "minus", "multum", "nox, noctis, f."], "magis", "two terms share a definition: clicks the one on screen (magis)"],
    ["more", ["plūs", "minus", "multum", "amor, amōris, m."], "plūs", "…and plūs when that's the one shown"],
    ["prudentia prudentiae f", ["prudence, good sense", "love", "night", "safe"], "prudence, good sense", "prompt without macrons/commas still matches"],
    ["prūdentia", ["love", "prudence, good sense", "night", "safe"], "prudence, good sense", "first part of the term alone still matches"],
  ];
  for (const [q, tiles, want, what] of cases) {
    t.clicks.length = 0; t.render(q, tiles, want); await sleep(500);
    ok(t.clicks.length === 1 && t.clicks[0] === want, `${what} (${JSON.stringify(t.clicks)})`);
  }
  t.clicks.length = 0; t.render("more", ["magis", "plūs", "less", "much"], "magis"); await sleep(500);
  ok(t.clicks.length === 0 && /magis or plūs/.test(t.hint()), `both right answers shown -> no click (${t.hint()})`);

  t.clicks.length = 0;
  t.render("amor, amōris, m.", ["sky", "night", "word", "enemy"], null); await sleep(500);
  ok(t.clicks.length === 0 && t.hint() === "On a teammate's screen: love", `team mode: not on my tiles -> no click, hint names it (${t.hint()})`);
  t.render("iniciō, inicere, iniēcī", ["throw", "sky", "night", "love"], null); await sleep(500);
  ok(t.clicks.length === 0 && /teammate/.test(t.hint()), `"throw in" never clicks the "throw" tile (${JSON.stringify(t.clicks)})`);
  t.render("ingressus, ingressa, ingressum", ["having", "sky", "night", "love"], null); await sleep(500);
  ok(t.clicks.length === 0, `weak partial match ("having") -> no click (${JSON.stringify(t.clicks)})`);
  t.render("zzzunknown", ["sky", "night", "word", "enemy"], "sky"); await sleep(500);
  ok(t.clicks.length === 0 && /^Unknown/.test(t.hint()), `unknown prompt -> no click, says unknown (${t.hint()})`);
  t.render("caelum, caelī, n.", ["sky", "sky", "night", "word"], "sky"); await sleep(500);
  ok(t.clicks.length === 0, "two equally good tiles -> refuses to guess");

  t.clicks.length = 0;
  t.render("caelum, caelī, n.", ["sky", "love", "night", "word"], "sky"); await sleep(450);
  t.render("nox, noctis, f.", ["sky", "love", "night", "word"], "night"); await sleep(450);
  t.render("caelum, caelī, n.", ["sky", "love", "night", "word"], "sky"); await sleep(450);
  ok(JSON.stringify(t.clicks) === '["sky","night","sky"]', `repeat question answered again (${JSON.stringify(t.clicks)})`);

  // ---- Learning: hand-taught pairs, red forgets a bad one, green keeps a good one (per set).
  t.card("Auto Answer").click();
  t.tab("Learned").click();
  const add = t.card("Add Term"), [i1, i2] = add.querySelectorAll("input");
  i1.value = "testverbum"; i2.value = "wrongmeaning"; add.click();
  ok(/Learned: testverbum/.test(t.status()), "Add Term learns a pair");
  i1.value = "alpha"; i2.value = "big house"; add.click();
  i1.value = "beta"; i2.value = "big houses"; add.click();
  t.tab("Answers").click();
  t.card("Auto Answer").click();
  t.clicks.length = 0;
  t.render("alpha", ["big houses", "sky", "night", "love"], null); await sleep(500);
  ok(t.clicks.length === 0, `near-identical tile that's a different known answer -> no click (${JSON.stringify(t.clicks)})`);
  t.render("testverbum", ["wrongmeaning", "rightmeaning", "sky", "love"], "rightmeaning"); await sleep(500);
  ok(t.clicks[0] === "wrongmeaning", "clicks the taught (wrong) answer");
  const listId = t.saved().active;
  ok(!("testverbum" in (t.saved().learned[listId] || {})), "red tile -> bad pair forgotten");
  t.render("ghost prompt", ["ghost answer", "sky", "love", "night"], "ghost answer");
  // teach the right one, then confirm a green click keeps it
  t.tab("Learned").click();
  { const c = t.card("Add Term"), [a, b] = c.querySelectorAll("input"); a.value = "ghost prompt"; b.value = "ghost answer"; c.click(); }
  t.tab("Answers").click();
  t.render("ghost prompt", ["ghost answer", "sky", "love", "night"], "ghost answer"); await sleep(400);
  ok((t.saved().learned[listId] || {})["ghost prompt"] === "ghost answer", "green tile keeps a learned pair (stored under this set)");

  // Highlight only.
  t.card("Auto Answer").click();
  t.card("Highlight Answer").click();
  t.clicks.length = 0;
  t.render("verbum, verbī, n.", ["sky", "word", "night", "love"], "word"); await sleep(450);
  const lit = [...t.game.children].filter((e) => e.style.outline);
  ok(lit.length === 1 && lit[0].textContent === "word" && t.clicks.length === 0, "highlight outlines only the right tile, no click");
  t.card("Highlight Answer").click();
  ok(![...t.game.children].some((e) => e.style.outline), "highlight off clears outline");

  // ---- Sets are separate: a second list doesn't see the first one's answers or learned pairs.
  await t.paste("sol - sun\nluna - moon");
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("caelum, caelī, n.", ["sky", "love", "night", "word"], "sky"); await sleep(500);
  ok(/^Unknown/.test(t.hint()), `switching sets: the old set's answers don't apply (${t.hint()})`);
  t.render("luna", ["sun", "moon", "star", "sky"], "moon"); await sleep(500);
  ok(t.clicks.at(-1) === "moon", `" - " separated list works (${JSON.stringify(t.clicks.slice(-1))})`);
  t.card("Auto Answer").click();
  t.tab("Sets").click();
  const pick = t.card("Active Set").querySelector("select");
  ok(pick.options.length === 3, `Active Set lists None + both sets (${pick.options.length})`);
  pick.value = listId; pick.dispatchEvent(new t.w.Event("change"));
  ok(t.saved().active === listId && /16 terms/.test(t.status()), `Active Set switches back (${t.status()})`);
  t.card("Remove Set").click();
  ok(t.saved().sets[listId], "Remove Set: one click only asks");
  t.card("Remove Set").click();
  ok(!t.saved().sets[listId] && t.saved().active === null, "Remove Set: second click removes it");

  // Toggle + close.
  t.w.eval(code);
  ok(t.panel.style.display === "none", "running it again hides the panel");
  t.d.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "\\" }));
  ok(t.panel.style.display === "", "backslash shows it again");
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.panel.querySelector("span").click();
  ok(t.panel.isConnected, "close: one click only asks");
  t.panel.querySelector("span").click();
  t.clicks.length = 0;
  t.render("luna", ["sun", "moon", "star", "sky"], "moon"); await sleep(500);
  ok(!t.panel.isConnected && t.clicks.length === 0, "close removes panel and stops clicking");
  t.w.close();

  // ---- Load Set from a link: Quizlet's study-items API (paged), title from the set page.
  const page2 = [["sol", "sun"], ["luna", "moon"]];
  t = boot({
    fetch: (u) => {
      if (u.includes("/webapi/3.4/studiable-item-documents")) {
        const p = +new URL(u, "https://quizlet.com").searchParams.get("page");
        return { ok: true, json: async () => apiItems(p == 1 ? LATIN : page2) }; // ignores paging after page 2: must stop
      }
      if (u == "/987654321/") return { ok: true, text: async () => `<html><head><meta property="og:title" content="My Latin Set Flashcards | Quizlet"></head></html>` };
      return { ok: false, status: 404 };
    },
  });
  await t.loadLink("https://quizlet.com/gb/987654321/my-latin-set-flash-cards/?x=1");
  ok(/Loaded "My Latin Set": 18 terms/.test(t.status()), `link -> API -> all pages, title from set page (${t.status()})`);
  ok(t.calls.filter((u) => u.includes("studiable")).length === 3 && t.calls.every((u) => u.startsWith("/")), `stops when a page adds nothing; same-origin requests only (${t.calls.length} calls)`);
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("luna", ["sun", "moon", "star", "sky"], "moon"); await sleep(500);
  ok(t.clicks[0] === "moon", "a loaded set's answers get clicked");
  t.w.close();

  // API refused -> the set page's Next.js data.
  t = boot({
    fetch: (u) => {
      if (u.includes("studiable")) return { ok: false, status: 403 };
      if (u == "/555555/") return { ok: true, text: async () => `<html><head><title>Bio Ch. 3 | Quizlet</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dehydrated: JSON.stringify({ items: apiItems([["mitosis", "cell division"], ["ATP", "energy molecule"]]).responses[0].models.studiableItem }) } } })}</script></head></html>` };
      return { ok: false, status: 404 };
    },
  });
  await t.loadLink("555555");
  ok(/Loaded "Bio Ch\. 3": 2 terms/.test(t.status()), `API 403 -> set page data (JSON inside a string) (${t.status()})`);
  t.w.close();

  // API refused, page has only escaped card JSON in a script -> the regex fallback, unicode escapes decoded.
  const esc = (w, d) => `\\"label\\":\\"word\\",\\"media\\":[{\\"type\\":1,\\"plainText\\":\\"${w}\\",\\"x\\":1}],\\"label\\":\\"definition\\",\\"media\\":[{\\"type\\":1,\\"plainText\\":\\"${d}\\",`;
  t = boot({
    fetch: (u) => u.includes("studiable") ? { ok: false, status: 403 } : u == "/777777/" ? { ok: true, text: async () => `<script>self.__next_f.push([1,"${esc("cael\\\\u012b", "of the sky")}${esc("nox", "night")}"])</script>` } : { ok: false, status: 404 },
  });
  await t.loadLink("quizlet.com/777777/x");
  const s7 = t.saved().sets["777777"];
  ok(s7 && Object.keys(s7.terms).length === 2 && s7.terms["caelī"] === "of the sky", `escaped page JSON read, \\u escapes decoded (${JSON.stringify(s7?.terms)})`);
  t.w.close();

  // Everything refused -> a clear error that suggests pasting.
  t = boot({ fetch: () => ({ ok: false, status: 403 }) });
  await t.loadLink("https://quizlet.com/111111/private-set/");
  ok(/Couldn't read set 111111 \(API HTTP 403, set page HTTP 403\)\. If it's private, paste its word list/.test(t.status()), `private set -> clear error (${t.status()})`);
  await t.loadLink("https://example.com/123456/");
  ok(/isn't a Quizlet set link/.test(t.status()) && t.calls.length === 2, `non-Quizlet link refused, nothing fetched (${t.status()})`);
  t.w.close();

  // Not on quizlet.com -> says so instead of failing on CORS.
  t = boot({ url: "https://example.com/" });
  await t.loadLink("123456");
  ok(/Run this on a quizlet\.com tab/.test(t.status()), `off Quizlet -> explains (${t.status()})`);
  t.w.close();

  // ---- The game page names its set: loaded and switched to automatically.
  const autoFetch = (u) => u.includes("studiable") ? { ok: true, json: async () => apiItems([["rosa", "rose"], ["aqua", "water"]]) } : u == "/424242/" ? { ok: true, text: async () => "<title>Game Set | Quizlet</title>" } : { ok: false, status: 404 };
  t = boot({ fetch: autoFetch, store: { speed: "instant", sets: { "1000": { title: "Old set", terms: { a1: "b1" } } }, active: "1000" } });
  t.d.getElementById("__next").__reactContainer$x = { child: { memoizedProps: { game: { setId: 424242, title: "x" } } } };
  t.tab("Sets").click(); t.card("Re-scan Page").click(); await sleep(60);
  ok(t.saved().active === "424242" && /Game Set/.test(t.status()), `game's set id -> loaded and made active over an old set (${t.status()})`);
  t.w.close();
  t = boot({ fetch: autoFetch });
  t.d.getElementById("__next").__reactContainer$x = { child: { memoizedProps: { recs: [{ id: 111111, numTerms: 20, title: "a" }, { id: 222222, numTerms: 9, title: "b" }] } } };
  t.tab("Sets").click(); t.card("Re-scan Page").click(); await sleep(60);
  ok(!t.calls.length && !t.saved().active, "several set ids on the page -> nothing loaded");
  t.w.close();

  // Term list in the page's React state -> a "Found in this game" set.
  t = boot();
  t.d.getElementById("__next").__reactContainer$abc = { child: { memoizedProps: { set: { terms: [{ word: "novum", definition: "new thing" }, { word: "alterum", definition: "other thing" }] } } } };
  t.tab("Sets").click(); t.card("Re-scan Page").click();
  ok(/Found 2 terms/.test(t.status()) && t.saved().active === "page", `harvest pulls terms from React state (${t.status()})`);
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("new thing", ["novum", "alterum", "sky", "love"], "novum"); await sleep(500);
  ok(t.clicks[0] === "novum", "harvested term gets answered");
  t.w.close();

  // Class names rotated: fallback finds tiles by clickable ancestor.
  t = boot({ known: false });
  await t.paste(tsv(LATIN));
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("hostis, hostis, m.", ["enemy", "sky", "night", "love"], "enemy"); await sleep(500);
  ok(t.clicks[0] === "enemy", `fallback selectors work without .a142laeh (${JSON.stringify(t.clicks)})`);
  t.w.close();

  // Human speed waits.
  t = boot({ store: { speed: "human" } });
  await t.paste(tsv(LATIN));
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("tūtus, tūta, tūtum", ["safe", "sky", "night", "love"], "safe");
  await sleep(700);
  ok(t.clicks.length === 0, "human speed: no click before 0.7s");
  await sleep(2600);
  ok(t.clicks[0] === "safe" && t.clicks.length === 1, "human speed: clicked by 3.3s");
  t.w.close();

  // ---- Review fixes.
  // A close-but-not-exact match is shown, never clicked ("consul" is inside "proconsul").
  t = boot();
  await t.paste("proconsul - governor of a province\nconsulatus - consulship");
  t.tab("Answers").click(); t.card("Auto Answer").click();
  t.render("consul", ["governor of a province", "consulship", "sky", "love"], "nope"); await sleep(500);
  ok(t.clicks.length === 0 && /^Maybe: governor of a province/.test(t.hint()), `loose match -> hint only, no click (${t.hint()})`);
  t.render("constructor", ["sky", "love", "night", "word"], "sky"); await sleep(450);
  ok(/^Unknown/.test(t.hint()), `built-in names like "constructor" are just unknown prompts (${t.hint()})`);

  // A tile that turned red is never clicked again for that prompt, even if the set says it's right.
  await t.paste("quaero - wrong answer\nalius - other");
  t.tab("Answers").click();
  t.clicks.length = 0;
  t.render("quaero", ["wrong answer", "seek", "other", "sky"], "seek"); await sleep(600);
  ok(JSON.stringify(t.clicks) === '["wrong answer"]', `set's wrong pair clicked once (${JSON.stringify(t.clicks)})`);
  t.render("alius", ["other", "sky", "love", "night"], "other"); await sleep(500);
  t.render("quaero", ["seek", "wrong answer", "sky", "love"], "seek"); await sleep(600);
  ok(t.clicks.filter((c) => c == "wrong answer").length === 1 && /Marked wrong last time/.test(t.hint()), `red tile not clicked again (${JSON.stringify(t.clicks)} ${t.hint()})`);

  // The same question twice in a row (new tiles after a right answer) is answered both times.
  t.clicks.length = 0;
  t.render("alius", ["other", "sky", "love", "night"], "other"); await sleep(600);
  t.render("alius", ["other", "sky", "love", "night"], "other"); await sleep(600);
  ok(JSON.stringify(t.clicks) === '["other","other"]', `back-to-back identical question answered twice (${JSON.stringify(t.clicks)})`);
  t.card("Auto Answer").click();

  // Word lists: colon beats dashes, several dashes split at the last one, the same list twice is one set.
  const before = Object.keys(t.saved().sets).length;
  await t.paste("fero - ferre - tuli - latum: to carry\nporto - portare - portavi - to carry, bring");
  const id2 = t.saved().active, terms2 = t.saved().sets[id2].terms;
  ok(terms2["fero - ferre - tuli - latum"] === "to carry" && terms2["porto - portare - portavi"] === "to carry, bring", `dashed principal parts split right (${JSON.stringify(terms2)})`);
  await t.paste("fero - ferre - tuli - latum: to carry\nporto - portare - portavi - to carry, bring");
  ok(Object.keys(t.saved().sets).length === before + 1, "pasting the same list again reuses its set");
  t.w.close();

  // Page term list with a duplicate term: found once, not re-saved every scan.
  t = boot();
  t.d.getElementById("__next").__reactContainer$abc = { child: { memoizedProps: { set: { terms: [{ word: "dup", definition: "one" }, { word: "dup", definition: "two" }, { word: "solo", definition: "alone" }] } } } };
  t.tab("Sets").click(); t.card("Re-scan Page").click();
  const first = t.status();
  t.card("Re-scan Page").click();
  ok(/Found/.test(first) && /Nothing new/.test(t.status()), `same page list twice -> nothing new (${first} / ${t.status()})`);
  t.w.close();

  // The game's set changes and changes back in one tab: it follows each time.
  t = boot({ fetch: autoFetch, store: { speed: "instant", sets: { "1000": { title: "Other game", terms: { a1: "b1" } } }, active: null } });
  const nx = t.d.getElementById("__next");
  const name = (id) => { nx.__reactContainer$x = { child: { memoizedProps: { game: { setId: id } } } }; t.card("Re-scan Page").click(); };
  t.tab("Sets").click();
  name(424242); await sleep(60); const a1 = t.saved().active;
  t.tab("Sets").click(); name(1000); await sleep(20); const a2 = t.saved().active;
  t.tab("Sets").click(); name(424242); await sleep(20); const a3 = t.saved().active;
  ok(a1 == "424242" && a2 == "1000" && a3 == "424242", `follows the game's set A -> B -> A (${a1}, ${a2}, ${a3})`);
  t.w.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

// Plain Enter in the word-list box must not submit (it's a newline there).
function enterAgainNotNeeded(t) {
  const before = Object.keys(t.saved().sets).length;
  const ta = t.card("Paste Word List").querySelector("textarea");
  ta.value = "x - y";
  t.enter(ta);
  return Object.keys(t.saved().sets).length === before;
}

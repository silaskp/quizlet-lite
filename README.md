# Quizlet Lite

A small helper panel for [Quizlet Live](https://quizlet.com/live), pasted into the browser's DevTools console. One file, no install. It only talks to Quizlet, through your own logged-in tab.

## What it does

- **Answers from any set.** Paste a set's link and it reads the whole set through Quizlet, or paste a word list.
- **Finds the game's set** on its own when the game page says which set it is.
- **Learns as you play.** Every time a tile turns green or red after a click (yours or its own), it remembers. Learned answers are kept per set, in your browser.
- **Auto Answer** clicks the right tile (Human / Fast / Instant speed). **Highlight Answer** just outlines it.
- **Team-safe.** Quizlet Live splits the tiles across teammates, so the right one is often on someone else's screen, and a wrong click resets the team. It never guesses: if the answer isn't clearly on your screen it doesn't click, and the hint line tells you what to tell your teammate.

## Use

1. Join a Quizlet Live game in Chrome (the lobby is fine).
2. Open DevTools (`Cmd+Opt+J` on Mac, `Ctrl+Shift+J` on Windows).
3. Paste the contents of [`quizlet-lite.js`](quizlet-lite.js) and press Enter. (Chrome may ask you to type `allow pasting` first.)
4. **Sets** tab: paste the set link into **Load Set** and press Enter, or paste a list into **Paste Word List** and press Ctrl/Cmd+Enter.
5. **Answers** tab: turn on **Auto Answer** or **Highlight Answer**.

Press `\` (or paste again) to show or hide the panel. ✕ (click twice) stops everything and removes it.

### Word list format

One card per line, in any of these forms:

```
term<Tab>definition        (what Quizlet's Export gives you)
term = definition
term - definition
term: definition
```

## Status

Experimental. Quizlet changes its page and class names without notice. If nothing gets clicked, the **Diagnose** card (Learned tab) logs what the script can see.

## Tests

```sh
npm install
npm test
```

The tests run the script against a mocked Quizlet Live screen and mocked set API and set page (jsdom).

## Disclaimer

Not affiliated with Quizlet. Use at your own risk.

## License

[MIT](LICENSE)

# Axonix Clipper

MV3 browser extension. Clips pages and records research trails into your Axonix vault.

## Build

```
pnpm install
pnpm run build      # → dist/
pnpm run watch      # rebuild on change (adds inline sourcemaps)
```

`dist/` is the unpacked extension. `content.js` bundles
[defuddle](https://github.com/kepano/defuddle) (MIT) — the same extractor Obsidian's own
web clipper uses.

## Load it

1. Start the capture server:
   ```
   cargo run -p axonix-capture -- "D:/05 Notes/My Vault"
   ```
   It prints a bearer token and also writes it to
   `%LOCALAPPDATA%\Axonix\capture-token.txt`.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select `extension/dist`.
3. Open the extension's **Settings**, paste the token, **Save**, then **Test connection**.

## Use

- **Clip this page** — one page becomes one unverified note in `Captures/`.
- **Research session** — name a topic, add pages as you browse, then finish.
  *Finish & synthesise* hands the trail to Hermes for a cited synthesis;
  *Save raw* just writes the trail.

## Design notes

**On-demand injection.** There is no persistent content script. `defuddle` is injected
only when you click, so ordinary browsing is untouched and no page is read without an
explicit action.

**Loopback + token.** The server binds to `127.0.0.1` only and every endpoint except
`/health` requires the bearer token. The token lives in the service worker, never in the
popup or a content script.

**Captured content is untrusted.** Everything clipped is fenced under an
*Untrusted source material* callout, and the synthesis prompt explicitly tells the agent
that page content is data and that instructions inside it must be ignored. A page that
says "ignore previous instructions" is stored verbatim so you can see it — and not obeyed.

**Everything lands unverified.** Notes are written through `axonix-vault::draft_note`,
the single implementation of the draft invariant. There is no code path here that can
produce a note marked `status: verified`.

## Not done yet

- **No icon.** The manifest deliberately declares none: Chrome refuses to load an
  extension whose manifest references a missing icon file, so a placeholder entry would
  break `Load unpacked` entirely. Add `icons` back together with a real PNG rendered from
  `assets/logo-mark.svg`.
- Not packed or signed; unpacked developer load only.

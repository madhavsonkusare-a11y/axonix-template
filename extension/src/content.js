// Injected on demand — never as a persistent content script. Defuddle only runs
// on pages the user explicitly clips, so ordinary browsing is untouched.

// MUST be 'defuddle/full', not 'defuddle'.
//
// The base build exports the bare class with no markdown converter, yet
// `markdown?: boolean` is declared in its shared types — so `{ markdown: true }`
// type-checks, runs without error, and silently returns raw HTML. Only
// `defuddle/full` pulls in createMarkdownContent. Verified the hard way: the first
// real clip produced a note full of <body>, <img> and <svg> tags.
import Defuddle from 'defuddle/full';

// executeScript may inject this file more than once into the same tab.
if (!globalThis.__axonixClipperReady) {
  globalThis.__axonixClipperReady = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'axonix:extract') return false;
    try {
      const r = new Defuddle(document, { markdown: true }).parse();
      sendResponse({
        ok: true,
        page: {
          url: location.href,
          title: (r.title || document.title || location.hostname || '').trim(),
          content: r.content || '',
          author: r.author || null,
          published: r.published || null,
          description: r.description || null,
          site: r.site || null,
          word_count: typeof r.wordCount === 'number' ? r.wordCount : null,
        },
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
    return true; // keep the channel open for the async response
  });
}

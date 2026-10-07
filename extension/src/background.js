// Service worker: owns session state and all traffic to the capture server.
// The popup never talks to the server directly, so the token lives in exactly
// one place.

const DEFAULTS = { port: 8787, token: '' };

async function settings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

function base(port) {
  // Loopback only. Never a remote host — this writes to the vault.
  return `http://127.0.0.1:${port}`;
}

async function api(path, body) {
  const { port, token } = await settings();
  if (!token) throw new Error('No token set. Open the extension options.');

  let res;
  try {
    res = await fetch(base(port) + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Capture server unreachable. Is axonix-capture running?');
  }

  if (res.status === 401) throw new Error('Token rejected. Check options.');
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Inject the extractor and pull structured content out of the active tab. */
async function extractActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  if (!/^https?:/.test(tab.url || '')) {
    throw new Error('Only http(s) pages can be captured.');
  }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const reply = await chrome.tabs.sendMessage(tab.id, { type: 'axonix:extract' });
  if (!reply?.ok) throw new Error(reply?.error || 'Extraction failed.');
  return reply.page;
}

async function getSession() {
  const { session } = await chrome.storage.session.get({ session: null });
  return session;
}

async function setSession(session) {
  await chrome.storage.session.set({ session });
  await chrome.action.setBadgeText({ text: session ? String(session.pages) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#444444' });
}

const handlers = {
  async health() {
    return api('/health');
  },

  async clip() {
    const page = await extractActiveTab();
    const w = await api('/clip', page);
    return { path: w.path, title: page.title };
  },

  async sessionStart({ topic }) {
    if (!topic?.trim()) throw new Error('Give the session a topic.');
    const { session_id } = await api('/session/start', { topic: topic.trim() });
    await setSession({ id: session_id, topic: topic.trim(), pages: 0 });
    return { id: session_id };
  },

  async sessionAdd() {
    const session = await getSession();
    if (!session) throw new Error('No active session.');
    const page = await extractActiveTab();
    const r = await api('/session/visit', { session_id: session.id, ...page });
    await setSession({ ...session, pages: r.pages });
    return { pages: r.pages, title: page.title };
  },

  async sessionFinish({ raw }) {
    const session = await getSession();
    if (!session) throw new Error('No active session.');
    const w = await api('/session/finish', { session_id: session.id, raw: !!raw });
    await setSession(null);
    return { path: w.path };
  },

  async sessionState() {
    return { session: await getSession() };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  fn(msg.payload || {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

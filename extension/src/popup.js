const $ = (id) => document.getElementById(id);

function say(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = kind;
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!r?.ok) return reject(new Error(r?.error || 'Unknown error'));
      resolve(r.data);
    });
  });
}

async function refresh() {
  const { session } = await send('sessionState');
  const active = !!session;
  $('no-session').hidden = active;
  $('in-session').hidden = !active;
  if (active) {
    $('session-topic').textContent = session.topic;
    $('session-count').textContent = `${session.pages} page${session.pages === 1 ? '' : 's'}`;
  }
}

async function guarded(fn, busyText) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  say(busyText);
  try {
    await fn();
  } catch (e) {
    say(e.message, 'err');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$('clip').addEventListener('click', () =>
  guarded(async () => {
    const r = await send('clip');
    say(`Saved → ${r.path}`, 'ok');
  }, 'Clipping…'),
);

$('start').addEventListener('click', () =>
  guarded(async () => {
    await send('sessionStart', { topic: $('topic').value });
    await refresh();
    say('Session started. Add pages as you browse.', 'ok');
  }, 'Starting…'),
);

$('add').addEventListener('click', () =>
  guarded(async () => {
    const r = await send('sessionAdd');
    await refresh();
    say(`Added “${r.title}”`, 'ok');
  }, 'Adding…'),
);

$('finish').addEventListener('click', () =>
  guarded(async () => {
    const r = await send('sessionFinish', { raw: false });
    await refresh();
    say(`Saved → ${r.path}. Synthesis running in the background.`, 'ok');
  }, 'Finishing…'),
);

$('finish-raw').addEventListener('click', () =>
  guarded(async () => {
    const r = await send('sessionFinish', { raw: true });
    await refresh();
    say(`Saved → ${r.path}`, 'ok');
  }, 'Finishing…'),
);

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh().catch((e) => say(e.message, 'err'));
send('health')
  .then((h) => {
    if (!h.agent) say('Connected. Agent disabled — synthesis unavailable.', 'warn');
  })
  .catch((e) => say(e.message, 'err'));

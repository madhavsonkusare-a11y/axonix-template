const $ = (id) => document.getElementById(id);

function say(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = kind;
}

chrome.storage.local.get({ port: 8787, token: '' }).then((s) => {
  $('port').value = s.port;
  $('token').value = s.token;
});

$('save').addEventListener('click', async () => {
  const port = Number($('port').value);
  const token = $('token').value.trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return say('Port must be between 1 and 65535.', 'err');
  }
  if (token && token.length !== 64) {
    return say(`Token should be 64 characters; got ${token.length}.`, 'err');
  }
  await chrome.storage.local.set({ port, token });
  say('Saved.', 'ok');
});

$('test').addEventListener('click', async () => {
  const { port, token } = await chrome.storage.local.get({ port: 8787, token: '' });
  if (!token) return say('Set a token first.', 'err');
  say('Testing…');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return say(`Server replied ${res.status}.`, 'err');
    const h = await res.json();
    say(`Connected. Vault: ${h.vault}${h.agent ? '' : ' (agent disabled)'}`, 'ok');
  } catch {
    say('Unreachable. Is axonix-capture running?', 'err');
  }
});

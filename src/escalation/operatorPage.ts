// The operator console, one static page. This is the deliberately bare part, see
// docs/ESCALATION.md section 5. It polls the masked screenshot, shows the context the run sent,
// and lets a person act on the live session.
//
// A person is looking at a picture, so a click on the canvas is mapped back into page space
// before it is sent, which is the coordinate the hit test under the endpoint expects. Keystrokes
// go one at a time and are never read back. Clicking cannot reach a page nothing links to, so
// there is also a frame and a path, bounded by the same allowlist every request is bounded by
// and never able to move the top window.
//
// Approving and releasing are separate buttons on purpose. A run stopped for a write is asking
// one question, and a person who hands the session back without answering it has refused the
// write. Releasing with an approval attached must be a deliberate click, not the default.

export const OPERATOR_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MERIDIAN operator console</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 1fr 360px; height: 100vh; }
  #screen { background: #111; display: grid; place-items: center; }
  canvas { max-width: 100%; max-height: 100vh; cursor: crosshair; }
  canvas:focus { outline: 2px solid #4a90d9; }
  label { display: block; margin-top: 8px; font-size: 13px; }
  input { font: inherit; width: 100%; box-sizing: border-box; padding: 4px; }
  fieldset { border: 1px solid #ccc; margin: 12px 0; padding: 8px; }
  legend { font-size: 12px; color: #555; }
  aside { padding: 16px; border-left: 1px solid #ccc; overflow: auto; }
  h1 { font-size: 15px; margin: 0 0 12px; }
  dl { margin: 0 0 16px; }
  dt { font-weight: 600; margin-top: 8px; }
  dd { margin: 2px 0 0; }
  button { font: inherit; padding: 6px 10px; margin-right: 6px; }
  #status { margin-top: 12px; color: #444; }
</style>
</head>
<body>
<main id="screen"><canvas id="canvas" width="1024" height="700" tabindex="0"></canvas></main>
<aside>
  <h1>Operator console</h1>
  <dl id="context"></dl>
  <button id="claim">Claim</button>
  <button id="approve" disabled hidden>Approve and release</button>
  <button id="release" disabled>Release</button>
  <button id="abort" disabled>Abort</button>
  <fieldset>
    <legend>Send a frame somewhere</legend>
    <label>Frame <input id="frame" value="content"></label>
    <label>Path <input id="path" placeholder="/member/00000/subaccount"></label>
    <button id="go" disabled>Go</button>
  </fieldset>
  <p id="status">Loading the open interventions.</p>
</aside>
<script type="module">
  const canvas = document.getElementById('canvas');
  const paint = canvas.getContext('2d');
  const status = document.getElementById('status');
  let intervention = null;
  let token = null;

  const say = (text) => { status.textContent = text; };

  async function load() {
    const open = await fetch('/interventions').then((r) => r.json());
    intervention = open[0] ?? null;
    if (intervention === null) { say('No intervention is open.'); return; }
    const full = await fetch('/interventions/' + intervention.id).then((r) => r.json());
    intervention = full;
    document.getElementById('context').innerHTML = [
      ['Why it stopped', full.reason],
      ['What happened', full.explanation],
      ['What to do', full.suggestedAction],
      ['Capability', full.capability ? full.capability.id + ' ' + full.capability.version : full.goal],
      ['Step', full.atStep ? full.atStep.intent : 'before the first step'],
      ['Claim expires', full.expiresAt],
    ].map(([term, value]) => '<dt>' + term + '</dt><dd>' + String(value ?? '') + '</dd>').join('');
    if (full.reason === 'PolicyConfirmation') {
      const approve = document.getElementById('approve');
      approve.hidden = false;
      approve.title = 'The run performs this one action itself, once.';
    }
    say('Claim the session to take control.');
  }

  async function poll() {
    if (intervention === null) return;
    const bytes = await fetch('/sessions/' + intervention.sessionId + '/screenshot?at=' + Date.now());
    if (!bytes.ok) return;
    const image = new Image();
    image.src = URL.createObjectURL(await bytes.blob());
    await image.decode();
    canvas.width = image.width;
    canvas.height = image.height;
    paint.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);
  }

  // Where the person clicked on the picture, in the page's own coordinates. The canvas is
  // drawn at whatever size fits, so the ratio between the image and the element is what makes
  // a click land on the element a person was aiming at.
  function pointFrom(event) {
    const shown = canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - shown.left) * (canvas.width / shown.width)),
      y: Math.round((event.clientY - shown.top) * (canvas.height / shown.height)),
    };
  }

  // One at a time, in the order they were made. Typing fires a keydown per character and a
  // person expects them to arrive as a word, so letting the requests race would put the
  // characters into the live form in whatever order the network settled them.
  let sending = Promise.resolve();

  function forward(body, describe) {
    if (token === null) { say('Claim the session before acting on it.'); return sending; }
    sending = sending.then(async () => {
      const answer = await fetch('/sessions/' + intervention.sessionId + '/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-control-token': token },
        body: JSON.stringify(body),
      });
      if (!answer.ok) { say('The session refused that. ' + answer.status); return; }
      say('Sent ' + describe + '. What you do is recorded, and what you type is not.');
      await poll();
    });
    return sending;
  }

  canvas.addEventListener('click', (event) => forward({ kind: 'click', ...pointFrom(event) }, 'a click'));

  canvas.addEventListener('keydown', (event) => {
    // The console never scrolls or tabs away under a person who is typing into the session.
    event.preventDefault();
    void forward({ kind: 'press', key: event.key }, 'a keystroke');
  });

  document.getElementById('go').addEventListener('click', async () => {
    const path = document.getElementById('path').value.trim();
    const frame = document.getElementById('frame').value.trim();
    if (path === '') { say('Give a path to send the frame to.'); return; }
    const answer = await fetch('/sessions/' + intervention.sessionId + '/navigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-control-token': token },
      body: JSON.stringify({ path, framePath: frame === '' ? [] : frame.split('/') }),
    });
    if (!answer.ok) {
      const problem = await answer.json();
      say('That navigation was refused. ' + (problem.error ?? answer.status));
      return;
    }
    say('The frame moved.');
    await poll();
  });

  document.getElementById('claim').addEventListener('click', async () => {
    const claimed = await fetch('/interventions/' + intervention.id + '/claim', { method: 'POST' });
    if (!claimed.ok) { say('That intervention is already claimed.'); return; }
    token = (await claimed.json()).humanToken;
    document.getElementById('claim').disabled = true;
    document.getElementById('approve').disabled = false;
    document.getElementById('release').disabled = false;
    document.getElementById('abort').disabled = false;
    document.getElementById('go').disabled = false;
    canvas.focus();
    say('You hold the session. Click the picture, type into it, or send a frame somewhere. The automation cannot act until you release it.');
  });

  async function release(approval) {
    await fetch('/interventions/' + intervention.id + '/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-control-token': token },
      body: JSON.stringify({ outcome: 'resumed', approval }),
    });
    for (const id of ['approve', 'release', 'abort', 'go']) document.getElementById(id).disabled = true;
    token = null;
    say(approval
      ? 'Approved. The automation has the session back and performs that one action, once.'
      : 'Control is back with the automation, which will re observe before it acts. Nothing was approved.');
  }

  document.getElementById('approve').addEventListener('click', () => release(true));
  document.getElementById('release').addEventListener('click', () => release(false));

  document.getElementById('abort').addEventListener('click', async () => {
    await fetch('/interventions/' + intervention.id + '/abort', { method: 'POST', headers: { 'x-control-token': token } });
    say('The run is aborted.');
  });

  await load();
  await poll();
  setInterval(poll, 1000);
</script>
</body>
</html>
`;

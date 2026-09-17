// The operator console, one static page. This is the deliberately bare part, see
// docs/ESCALATION.md section 5. It polls the masked screenshot, shows the context the run sent,
// and offers the three things a person can do. The API beneath it is real and tested, and the
// same endpoints are driven headlessly by the integration suite.

export const OPERATOR_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MERIDIAN operator console</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 1fr 360px; height: 100vh; }
  #screen { background: #111; display: grid; place-items: center; }
  canvas { max-width: 100%; max-height: 100vh; cursor: crosshair; }
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
<main id="screen"><canvas id="canvas" width="1024" height="700"></canvas></main>
<aside>
  <h1>Operator console</h1>
  <dl id="context"></dl>
  <button id="claim">Claim</button>
  <button id="release" disabled>Release</button>
  <button id="abort" disabled>Abort</button>
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

  document.getElementById('claim').addEventListener('click', async () => {
    const claimed = await fetch('/interventions/' + intervention.id + '/claim', { method: 'POST' });
    if (!claimed.ok) { say('That intervention is already claimed.'); return; }
    token = (await claimed.json()).humanToken;
    document.getElementById('claim').disabled = true;
    document.getElementById('release').disabled = false;
    document.getElementById('abort').disabled = false;
    say('You hold the session. The automation cannot act until you release it.');
  });

  document.getElementById('release').addEventListener('click', async () => {
    await fetch('/interventions/' + intervention.id + '/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-control-token': token },
      body: JSON.stringify({ outcome: 'resumed' }),
    });
    say('Control is back with the automation, which will re observe before it acts.');
  });

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

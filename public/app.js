(async () => {
  const el = id => document.getElementById(id);
  const regBox = el('registerBox'), loginBox = el('loginBox'), adminBox = el('admin');
  const consoleEl = el('console');

  // Defensive: ensure admin is hidden on initial load unless explicitly shown by login flow
  if (adminBox && !adminBox.classList.contains('hidden')) {
    adminBox.classList.add('hidden');
  }

  function addLine(s) { if (!consoleEl) return; consoleEl.textContent += s + '\n'; consoleEl.scrollTop = consoleEl.scrollHeight; }

  // Helper to safely show/hide elements
  function show(elm) { if (!elm) return; elm.classList.remove('hidden'); }
  function hide(elm) { if (!elm) return; elm.classList.add('hidden'); }

  // If the API check fails, default to showing the login box so users can still attempt to login
  try {
    const resp = await fetch('/api/first');
    const first = await resp.json();
    if (first && first.allowRegister) {
      show(regBox); hide(loginBox);
    } else {
      show(loginBox); hide(regBox);
    }
  } catch (e) {
    console.error('Failed to check registration status', e);
    show(loginBox);
    hide(regBox);
  }

  // Wire up buttons (guard if elements missing)
  const doRegisterBtn = el('doRegister');
  if (doRegisterBtn) doRegisterBtn.addEventListener('click', async () => {
    const u = el('regUser')?.value, p = el('regPass')?.value;
    try {
      const r = await fetch('/api/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:u,password:p})});
      if (r.ok) {
        el('regMsg').textContent = 'Created. Please log in.';
        hide(regBox); show(loginBox);
      } else {
        const j = await r.json().catch(()=>({error:'bad'}));
        el('regMsg').textContent = j.error || 'error';
      }
    } catch (err) { el('regMsg').textContent = 'network error'; }
  });

  const doLoginBtn = el('doLogin');
  if (doLoginBtn) doLoginBtn.addEventListener('click', async () => {
    const u = el('loginUser')?.value, p = el('loginPass')?.value;
    try {
      const r = await fetch('/api/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:u,password:p})});
      if (r.ok) {
        const j = await r.json();
        const token = j.token;
        if (token) localStorage.setItem('mc_token', token);
        hide(loginBox); hide(regBox);
        showAdmin(token);
      } else {
        el('loginMsg').textContent = 'Login failed';
      }
    } catch (err) { el('loginMsg').textContent = 'network error'; }
  });

  function authHeaders() {
    const t = localStorage.getItem('mc_token');
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }

  async function showAdmin(token) {
    if (!adminBox) return;

    // hide auth UI and show admin console explicitly
    try { hide(regBox); hide(loginBox); } catch(e){}

    show(adminBox);

    // Ensure the deploy overlay is hidden when admin is shown
    try {
      const overlay = document.getElementById('deploy-anim');
      if (overlay) overlay.style.display = 'none';
    } catch(e) {}

    // Setup websocket
    const t = token || localStorage.getItem('mc_token');
    try {
      const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/ws/console?token=' + encodeURIComponent(t));
      ws.onopen = () => addLine('[WS connected]');
      ws.onmessage = (ev) => {
        try {
          const obj = JSON.parse(ev.data);
          if (obj.type === 'console') addLine(obj.line);
          else if (obj.type === 'info') addLine('[info] ' + (obj.msg||''));
        } catch(e) { addLine(ev.data); }
      };
      ws.onclose = () => addLine('[WS closed]');

      const startBtn = el('startBtn');
      if (startBtn) startBtn.onclick = async () => {
        await fetch('/api/start', { method: 'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }}).catch(e=>addLine('[start failed]'));
      };
      const stopBtn = el('stopBtn');
      if (stopBtn) stopBtn.onclick = async () => {
        await fetch('/api/stop', { method: 'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }}).catch(e=>addLine('[stop failed]'));
      };
      const sendBtn = el('sendCmd');
      if (sendBtn) sendBtn.onclick = () => {
        const c = el('cmdInput')?.value;
        if (!c) return;
        ws.send(JSON.stringify({ type:'cmd', cmd: c }));
        el('cmdInput').value = '';
      };
      const seedBtn = el('seedBtn');
      if (seedBtn) seedBtn.onclick = async () => {
        addLine('[requesting seed]');
        try {
          const r = await fetch('/api/seed', { method:'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }});
          const j = await r.json().catch(()=>null);
          if (j && j.seed) addLine('[seed] ' + j.seed);
          else addLine('[seed request failed]');
        } catch (e) { addLine('[seed request failed]'); }
      };
    } catch (e) {
      addLine('[ws error] ' + (e && e.message));
    }
  }

  // NOTE: Do NOT auto-open admin based solely based on localStorage token on page load.

})();

/* Deploy/start animation overlay — append after the main IIFE in public/app.js */
(function () {
  // create overlay DOM once
  if (!document.getElementById('deploy-anim')) {
    const container = document.createElement('div');
    container.id = 'deploy-anim';

    // build an 8x8 grid of cells for dirt spawn targets (64 cells)
    let gridCells = '';
    for (let i = 0; i < 64; i++) gridCells += '<div class="cell"></div>';

    container.innerHTML = `
      <div id="animStartChip" role="button" tabindex="0">Start Server</div>
      <div id="animConnector" aria-hidden="true"></div>
      <div id="animInfo" aria-hidden="true">
        <div class="panel-title">SERVER</div>
        <div class="panel-row"><span class="label">Uptime</span><span id="animUptime" class="value">0s</span></div>
        <div class="panel-row"><span class="label">CPU</span><span id="animCpu" class="value">0%</span></div>
        <div class="panel-row"><span class="label">Memory</span><span id="animMem" class="value">0MB</span></div>
      </div>
      <div id="animGrid" aria-hidden="true">
        ${gridCells}
      </div>
    `;
    document.body.appendChild(container);

    // initial visibility: only hide overlay when an auth token exists
    const token = localStorage.getItem('mc_token');
    if (token) {
      container.style.display = 'none';
    } else {
      container.style.display = 'block';
    }

    // listen for storage events (in case mc_token is set from other tab)
    window.addEventListener('storage', () => {
      const hasToken = !!localStorage.getItem('mc_token');
      container.style.display = hasToken ? 'none' : 'block';
    });

    const chip = document.getElementById('animStartChip');
    const conn = document.getElementById('animConnector');
    const info = document.getElementById('animInfo');
    const grid = document.getElementById('animGrid');
    const uptimeEl = document.getElementById('animUptime');
    const cpuEl = document.getElementById('animCpu');
    const memEl = document.getElementById('animMem');

    let metricsInterval = null;
    let startTimestamp = null;
    let animPlayed = false;

    function formatUptime(ms) {
      const s = Math.floor(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60), rem = s % 60;
      if (m < 60) return `${m}m ${rem}s`;
      const h = Math.floor(m / 60), rm = m % 60;
      return `${h}h ${rm}m`;
    }

    function startMetricsSimulation() {
      startTimestamp = Date.now();
      if (metricsInterval) clearInterval(metricsInterval);
      metricsInterval = setInterval(() => {
        const elapsed = Date.now() - startTimestamp;
        uptimeEl.textContent = formatUptime(elapsed);
        // simulated CPU/mem — replace with real data fetch if desired
        const cpu = Math.min(98, Math.round(20 + Math.random()*60));
        const memMb = Math.round(256 + Math.random()*1024);
        cpuEl.textContent = `${cpu}%`;
        memEl.textContent = `${memMb}MB`;
      }, 1000);
    }

    function stopMetricsSimulation() {
      if (metricsInterval) { clearInterval(metricsInterval); metricsInterval = null; }
    }

    function flashRandomCells(times = 28, interval = 90) {
      const cells = Array.from(grid.querySelectorAll('.cell'));
      for (let i = 0; i < times; i++) {
        setTimeout(() => {
          const idx = Math.floor(Math.random() * cells.length);
          const c = cells[idx];
          c.classList.remove('flash');
          // trigger reflow so animation restarts reliably
          void c.offsetWidth;
          c.classList.add('flash');
          // remove class after animation ends
          setTimeout(() => c.classList.remove('flash'), 1600);
        }, i * interval);
      }
    }

    async function callStartApi() {
      // try to call /api/start with existing token
      try {
        const token = localStorage.getItem('mc_token');
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        await fetch('/api/start', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }});
      } catch (e) {
        // ignore fetch errors — animation still runs
        console.debug('start API call failed', e);
      }
    }

    // animation sequence
    async function triggerAnimAndStart(forceRun = false) {
      // do not run if overlay hidden
      if (container.style.display === 'none' && !forceRun) return;
      if (animPlayed && !forceRun) return; // play only once automatically; clicking chip may force
      animPlayed = true;

      // visually activate chip
      chip.classList.add('glow');

      // expand connector to visually reach the info panel
      conn.style.width = '300px';

      // show info panel (ensure it's above grid)
      info.classList.add('visible');

      // start simulated metrics
      startMetricsSimulation();

      // flash grid cells to dirt blocks with sweep
      flashRandomCells(36, 70);

      // call start API (fire-and-forget)
      callStartApi();

      // keep glow for a few seconds, then fade
      setTimeout(() => {
        chip.classList.remove('glow');
      }, 3000);

      // shrink connector after a bit
      setTimeout(() => {
        conn.style.width = '0';
        info.classList.remove('visible');
        // stop metrics after panel hides
        setTimeout(stopMetricsSimulation, 400);
      }, 4200);
    }

    // wire the overlay chip to trigger the same behavior as the Start button
    chip.addEventListener('click', (e) => { triggerAnimAndStart(true); });

    // also wire existing in-page start button (if present) so clicking it also triggers the overlay animation
    function wireStartButton() {
      const pageStartBtn = document.getElementById('startBtn');
      if (pageStartBtn) {
        pageStartBtn.addEventListener('click', (e) => {
          // only run overlay animation if overlay is visible (i.e., before login)
          triggerAnimAndStart(false);
        });
      }
    }

    // attempt to wire immediately; if the admin UI is rendered later, observe for it
    wireStartButton();

    // Observe DOM in case #startBtn appears later (e.g., after login)
    const observer = new MutationObserver(() => {
      if (document.getElementById('startBtn')) {
        wireStartButton();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Automatically play animation once shortly after load if overlay is visible
    setTimeout(() => {
      if (container.style.display !== 'none') triggerAnimAndStart();
    }, 800);
  }
})();

(async () => {
  const el = id => document.getElementById(id);
  const regBox = el('registerBox'), loginBox = el('loginBox'), adminBox = el('admin');
  const consoleEl = el('console');
  const brandEl = el('brand');
  const publicInfoEl = el('publicInfo');

  function addLine(s) { consoleEl.textContent += s + '\n'; consoleEl.scrollTop = consoleEl.scrollHeight; }

  // Load public settings first (site name, public info boxes)
  async function loadPublicSettings() {
    try {
      const resp = await fetch('/api/public-settings');
      if (!resp.ok) return;
      const cfg = await resp.json();
      if (cfg.siteName) brandEl.textContent = cfg.siteName;
      renderPublicInfo(cfg.infoBoxes || []);
    } catch (e) {
      console.warn('failed to load public settings', e);
    }
  }

  function renderPublicInfo(boxes) {
    if (!publicInfoEl) return;
    if (!boxes || boxes.length === 0) { publicInfoEl.innerHTML = ''; return; }
    const html = ['<div class="info-grid">'];
    for (const b of boxes) {
      html.push(`<div class="info-card"><h4>${escapeHtml(b.title)}</h4><p>${escapeHtml(b.content)}</p></div>`);
    }
    html.push('</div>');
    publicInfoEl.innerHTML = html.join('');
  }

  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  await loadPublicSettings();

  const first = await fetch('/api/first').then(r=>r.json());
  if (first.allowRegister) regBox.style.display = 'block';
  else loginBox.style.display = 'block';

  el('doRegister').addEventListener('click', async () => {
    const u = el('regUser').value, p = el('regPass').value;
    const r = await fetch('/api/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:u,password:p})});
    if (r.ok) {
      el('regMsg').textContent = 'Created. Please log in.';
      regBox.style.display='none';
      loginBox.style.display='block';
      // reload public settings in case admin wants to update site name
      await loadPublicSettings();
    } else {
      const j = await r.json().catch(()=>({error:'bad'}));
      el('regMsg').textContent = j.error || 'error';
    }
  });

  el('doLogin').addEventListener('click', async () => {
    const u = el('loginUser').value, p = el('loginPass').value;
    const r = await fetch('/api/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:u,password:p})});
    if (r.ok) {
      const j = await r.json();
      const token = j.token;
      if (token) localStorage.setItem('mc_token', token);
      loginBox.style.display='none';
      showAdmin(token);
    } else {
      el('loginMsg').textContent = 'Login failed';
    }
  });

  function authHeaders() {
    const t = localStorage.getItem('mc_token');
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }

  async function showAdmin(token) {
    adminBox.style.display = 'block';
    // Setup websocket - we rely on cookie-based auth for the websocket so no token in query string
    const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/ws/console');
    ws.onopen = () => addLine('[WS connected]');
    ws.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        if (obj.type === 'console') addLine(obj.line);
        else if (obj.type === 'info') addLine('[info] ' + (obj.msg||''));
        else if (obj.type === 'cmdResponse') addLine('[cmd response] ' + (obj.response||''));
      } catch(e) { addLine(ev.data); }
    };
    ws.onclose = () => addLine('[WS closed]');
    el('startBtn').onclick = async () => {
      await fetch('/api/start', { method: 'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }});
    };
    el('stopBtn').onclick = async () => {
      await fetch('/api/stop', { method: 'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }});
    };
    el('sendCmd').onclick = async () => {
      const c = el('cmdInput').value;
      // Send command via WebSocket so we get response back
      ws.send(JSON.stringify({ type:'cmd', cmd: c }));
      el('cmdInput').value = '';
    };
    el('seedBtn').onclick = async () => {
      addLine('[requesting seed]');
      const r = await fetch('/api/seed', { method:'POST', headers: { ...(authHeaders()), 'content-type':'application/json' }});
      const j = await r.json().catch(()=>null);
      if (j && j.seed) addLine('[seed] ' + j.seed);
      else addLine('[seed request failed]');
    };

    // Load admin settings
    try {
      const r = await fetch('/api/settings', { headers: { ...(authHeaders()) }});
      if (r.ok) {
        const cfg = await r.json();
        el('siteName').value = cfg.siteName || '';
        renderBoxesList(cfg.infoBoxes || []);
      }
    } catch (e) { console.warn('failed loading settings', e); }

    el('addBox').onclick = () => {
      const t = el('newBoxTitle').value.trim();
      const c = el('newBoxContent').value.trim();
      if (!t || !c) return;
      const current = collectBoxesFromDOM();
      current.push({ title: t, content: c });
      renderBoxesList(current);
      el('newBoxTitle').value = '';
      el('newBoxContent').value = '';
    };

    el('saveSettings').onclick = async () => {
      const siteName = el('siteName').value.trim() || 'MCJAVASERVER';
      const infoBoxes = collectBoxesFromDOM();
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type':'application/json', ...(authHeaders()) }, body: JSON.stringify({ siteName, infoBoxes }) });
      if (r.ok) {
        addLine('[settings saved]');
        await loadPublicSettings();
      } else {
        addLine('[settings save failed]');
      }
    };
  }

  function collectBoxesFromDOM() {
    const container = el('boxesList');
    const boxes = [];
    if (!container) return boxes;
    const rows = container.querySelectorAll('.box-row');
    rows.forEach(r => {
      const title = r.querySelector('.box-title').value || '';
      const content = r.querySelector('.box-content').value || '';
      if (title || content) boxes.push({ title, content });
    });
    return boxes;
  }

  function renderBoxesList(boxes) {
    const container = el('boxesList');
    container.innerHTML = '';
    boxes.forEach((b, idx) => {
      const div = document.createElement('div');
      div.className = 'box-row';
      div.style.display = 'flex';
      div.style.gap = '8px';
      div.style.marginBottom = '8px';
      div.innerHTML = `<input class="input box-title" value="${escapeHtml(b.title)}" placeholder="Title" /> <input class="input box-content" value="${escapeHtml(b.content)}" placeholder="Content" /> <button class="btn remove-btn">Remove</button>`;
      container.appendChild(div);
      div.querySelector('.remove-btn').addEventListener('click', () => {
        div.remove();
      });
    });
  }

  // If token in storage, try to open admin directly
  const stored = localStorage.getItem('mc_token');
  if (stored) {
    loginBox.style.display = 'none';
    regBox.style.display = 'none';
    showAdmin(stored);
  }
})();

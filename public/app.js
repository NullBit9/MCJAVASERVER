(async () => {
  const el = id => document.getElementById(id);
  const regBox = el('registerBox'), loginBox = el('loginBox'), adminBox = el('admin');
  const consoleEl = el('console');

  function addLine(s) { consoleEl.textContent += s + '\n'; consoleEl.scrollTop = consoleEl.scrollHeight; }

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
  }

  // If token in storage, try to open admin directly
  const stored = localStorage.getItem('mc_token');
  if (stored) {
    loginBox.style.display = 'none';
    regBox.style.display = 'none';
    showAdmin(stored);
  }
})();

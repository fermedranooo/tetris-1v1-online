'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const W = 10, H = 20, CELL = 30;
  const COLORS = { I: '#55e3ef', O: '#ffda73', T: '#bb9aff', S: '#74eab3', Z: '#ff7d98', J: '#80a9ff', L: '#ffaa75' };
  const SHAPES = {
    I: [[1,1,1,1]], O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1]],
    S: [[0,1,1],[1,1,0]], Z: [[1,1,0],[0,1,1]], J: [[1,0,0],[1,1,1]], L: [[0,0,1],[1,1,1]]
  };
  const EMPTY = Array.from({ length: 20 }, () => Array(10).fill(null));
  const getName = () => localStorage.getItem('dueloName') || '';
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const urlCode = () => (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0, 8);
  let state = null, ws = null, online = false, reconnectTimer = null, joined = false, roomToken = null, toastTimer = null;
  let lastDialog = '', triedRestore = false;
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('dueloSession') || 'null'); } catch { return null; } })();

  function say(message, success = false) {
    const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); el.classList.toggle('success', success);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 6000);
  }
  function send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { say('No hay conexión con el servidor.'); return; }
    ws.send(JSON.stringify(data));
  }
  function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    online = false; setConnectivity(); render();
    ws.addEventListener('open', () => {
      online = true; setConnectivity();
      if (joined && roomToken) {
        send({ type: 'join', room: roomToken.room, token: roomToken.token, name: getName() });
      } else if (!triedRestore && saved && saved.room === urlCode() && saved.token) {
        triedRestore = true; send({ type: 'join', room: saved.room, token: saved.token, name: getName() });
      }
      render();
    });
    ws.addEventListener('message', event => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'joined') {
        joined = true;
        roomToken = { room: m.room, token: m.token };
        sessionStorage.setItem('dueloSession', JSON.stringify(roomToken));
        const u = new URL(location.href); u.searchParams.set('room', m.room);
        history.replaceState({}, '', u.pathname + u.search + u.hash);
        lastDialog = '';
      } else if (m.type === 'state') {
        state = m; joined = true;
      } else if (m.type === 'left') {
        joined = false; state = null; roomToken = null;
        sessionStorage.removeItem('dueloSession');
        const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState({},'',u.pathname + u.search + u.hash);
        lastDialog = ''; say('Saliste de la sala.', true);
      } else if (m.type === 'error') {
        say(m.message);
        if (joined && roomToken && m.message.includes('expiró')) {
          joined = false; roomToken = null; state = null; sessionStorage.removeItem('dueloSession');
        }
      }
      render();
    });
    ws.addEventListener('close', e => {
      online = false;
      if (e.code === 4001) { say('Esta sala se abrió en otra pestaña.'); joined = false; state = null; roomToken = null; sessionStorage.removeItem('dueloSession'); }
      else if (e.code === 4002) { say('La sala caducó. Creá una nueva.'); joined = false; state = null; roomToken = null; sessionStorage.removeItem('dueloSession'); }
      setConnectivity(); render(); reconnectTimer = setTimeout(connect, 2500);
    });
    ws.addEventListener('error', () => {});
  }
  function setConnectivity() {
    $('liveDot').classList.toggle('on', online);
    $('connectionText').textContent = online ? 'Servidor conectado' : 'Reconectando...';
  }
  function putDialog(html, key, events) {
    if (lastDialog === key) return;
    lastDialog = key; $('dialog').innerHTML = html;
    if (events) events();
  }
  function boardCollision(p, dy) {
    for (let y = 0; y < p.mat.length; y++) for (let x = 0; x < p.mat[y].length; x++) {
      if (!p.mat[y][x]) continue;
      const ny = p.y + dy + y, nx = p.x + x;
      if (ny >= H || nx < 0 || nx >= W || (ny >= 0 && state.board[ny][nx])) return true;
    }
    return false;
  }
  function cell(x, y, type, ghost = false) {
    if (y < 0) return;
    const px = x * CELL, py = y * CELL, color = COLORS[type] || '#fff';
    if (ghost) {
      ctx.fillStyle = color + '25'; ctx.fillRect(px+2,py+2,CELL-4,CELL-4);
      ctx.strokeStyle = color + 'a0'; ctx.lineWidth = 1.5; ctx.strokeRect(px+2,py+2,CELL-4,CELL-4); return;
    }
    ctx.fillStyle = color; ctx.fillRect(px+1.4,py+1.4,CELL-2.8,CELL-2.8);
    ctx.fillStyle = '#ffffff52'; ctx.fillRect(px+3,py+3,CELL-6,4);
    ctx.fillStyle = '#00000032'; ctx.fillRect(px+3,py+CELL-7,CELL-6,4);
  }
  function paint() {
    ctx.fillStyle = '#0b172b'; ctx.fillRect(0,0,300,600);
    ctx.strokeStyle = '#1c2e4a'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(x*CELL+.5,0);ctx.lineTo(x*CELL+.5,600);ctx.stroke(); }
    for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL+.5);ctx.lineTo(300,y*CELL+.5);ctx.stroke(); }
    const board = state?.board || EMPTY;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (board[y][x]) cell(x,y,board[y][x]);
    const p = state?.active;
    if (!p) return;
    let dy = 0; while (dy < H && !boardCollision(p,dy+1)) dy++;
    for (let y = 0; y < p.mat.length; y++) for (let x = 0; x < p.mat[y].length; x++) {
      if (p.mat[y][x]) cell(p.x+x,p.y+dy+y,p.type,true);
    }
    for (let y = 0; y < p.mat.length; y++) for (let x = 0; x < p.mat[y].length; x++) {
      if (p.mat[y][x]) cell(p.x+x,p.y+y,p.type);
    }
  }
  function renderDialog() {
    if (!online) {
      putDialog('<div class="dialog-icon">📡</div><h2>Conectando...</h2><p>Estamos conectando con el servidor. Si el servicio gratuito estaba en reposo, puede tardar en despertar.</p>', 'offline'); return;
    }
    if (!state || !joined) {
      const prefCode = urlCode();
      putDialog(`<div class="dialog-icon">🎮</div><h2>¡Que empiece el duelo!</h2><p>Uno elige las piezas y el otro juega Tetris. Luego cambian los papeles.</p><label>Tu nombre<input id="nickname" maxlength="20" placeholder="Ej. Fer" value="${esc(getName())}"></label><label>Piezas por ronda<select id="limit"><option value="16">16 · Rápida</option><option selected value="24">24 · Normal</option><option value="36">36 · Larga</option></select></label><button class="btn full" id="createRoom">CREAR SALA PRIVADA ⚡</button><div class="division">O UNIRME A UN AMIGO</div><label>Código de sala<input id="roomInput" maxlength="8" autocomplete="off" placeholder="ABCD2345" value="${esc(prefCode)}"></label><button class="btn alt full" id="joinRoom">ENTRAR A LA SALA →</button>`, 'home-' + prefCode, () => {
        function enteredName() { const n = $('nickname').value.trim().slice(0,20); localStorage.setItem('dueloName', n); return n; }
        $('createRoom').addEventListener('click', () => send({ type:'create', name:enteredName(), limit:Number($('limit').value) }));
        $('joinRoom').addEventListener('click', () => {
          const code = $('roomInput').value.trim().toUpperCase();
          if (!/^[A-Z2-9]{8}$/.test(code)) return say('Introducí el código de 8 caracteres.');
          send({ type:'join', room:code, name:enteredName() });
        });
        $('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinRoom').click(); });
      }); return;
    }
    if (state.stage === 'lobby') {
      const canStart = state.you === 0 && state.players.every(p=>p && p.connected);
      const others = state.players[1];
      putDialog(`<div class="dialog-icon">${others ? '⚡' : '🔗'}</div><h2>${others ? '¡Sala completa!' : 'Sala creada'}</h2><p>${others ? `${esc(state.players[0].name)} vs ${esc(others.name)}. ¡Todo listo para jugar!` : 'Compartí el enlace con tu amigo. Cuando entre, podrás comenzar la primera ronda.'}</p><div class="tag">${esc(state.room)}</div><button class="btn full" id="lobbyStart" ${canStart?'':'disabled'}>${canStart?'EMPEZAR PARTIDA →':state.you === 0 ? 'ESPERANDO AL RIVAL...' : 'ESPERANDO AL ANFITRIÓN...'}</button><button class="btn alt full" id="lobbyCopy" style="margin-top:9px">COPIAR INVITACIÓN 🔗</button>`, 'lobby-' + state.room + '-' + String(!!others) + '-' + canStart + '-' + state.you, () => {
        $('lobbyStart').addEventListener('click',()=>send({type:'start'}));
        $('lobbyCopy').addEventListener('click',copyInvite);
      }); return;
    }
    if (state.stage === 'roundEnd') {
      const b = state.builder, s = state.stats[b];
      putDialog(`<div class="dialog-icon">🔁</div><h2>¡Cambio de roles!</h2><p>${esc(state.players[b]?.name || 'El jugador')} consiguió <b>${s.score} puntos</b>, limpió ${s.lines} líneas y colocó ${s.placed} piezas.</p><div class="alert-note">Ahora ${esc(state.players[1]?.name || 'Jugador 2')} elige las piezas y ${esc(state.players[0]?.name || 'Jugador 1')} construye.</div><button class="btn full" id="nextRound" ${state.players.every(p=>p?.connected)?'':'disabled'}>EMPEZAR RONDA 2 →</button>`, 'roundEnd-' + state.you + '-' + state.players.map(p=>p?.connected).join(''), () => {
        $('nextRound').addEventListener('click',()=>send({type:'advance'}));
      }); return;
    }
    if (state.stage === 'final') {
      const a = state.stats[0], b = state.stats[1];
      let winner = -1;
      if (a.score !== b.score) winner = a.score > b.score ? 0 : 1;
      else if (a.placed !== b.placed) winner = a.placed > b.placed ? 0 : 1;
      putDialog(`<div class="dialog-icon">${winner < 0 ? '🤝':'🏆'}</div><h2>${winner < 0 ? '¡Empate!' : '¡Ganó ' + esc(state.players[winner].name) + '!'}</h2><p>Dos rondas, un campeón. ¿Quieren revancha?</p><div class="result-row"><span>${esc(state.players[0].name)}</span><b>${a.score} pts · ${a.lines} líneas</b></div><div class="result-row"><span>${esc(state.players[1].name)}</span><b>${b.score} pts · ${b.lines} líneas</b></div><button class="btn full" id="rematch" ${state.players.every(p=>p?.connected)?'':'disabled'}>JUGAR REVANCHA ⚡</button>`, 'final-' + state.you + '-' + state.players.map(p=>p?.connected).join(''),()=>{
        $('rematch').addEventListener('click',()=>send({type:'rematch'}));
      }); return;
    }
  }
  function render() {
    paint();
    $('inviteBar').classList.toggle('hidden', !joined || !state);
    if (!online || !state || !joined || ['lobby','roundEnd','final'].includes(state.stage)) {
      $('overlay').classList.remove('hidden'); renderDialog();
    } else { $('overlay').classList.add('hidden'); lastDialog = ''; }
    $('roomCode').textContent = state?.room || '--------';
    const st = state;
    for (let i = 0; i < 2; i++) {
      const p = st?.players[i], s = st?.stats[i] || { score:0,lines:0,placed:0 };
      $('playerName'+i).textContent = p?.name || 'Esperando rival...';
      $('playerScore'+i).textContent = s.score;
      $('playerExtra'+i).textContent = `${s.lines} líneas · ${s.placed} piezas`;
      const role = !p ? 'Sin conectar' : !p.connected ? 'Desconectado' : st.stage === 'lobby' ? i === 0 ? 'Anfitrión' : 'Invitado' : i === st.chooser ? '🧩 Elige piezas' : '🎮 Construye';
      $('playerRole'+i).textContent = role + (st?.you === i ? ' · TÚ' : '');
      $('playerCard'+i).classList.toggle('active',!!st && ['choose','playing'].includes(st.stage) && st.builder === i);
      $('playerDot'+i).classList.toggle('on', !!p?.connected);
    }
    $('roundLabel').textContent = `RONDA ${st ? st.round + 1 : 1} / 2`;
    $('piecesCount').textContent = `${st?.used || 0} / ${st?.limit || 24} piezas`;
    const percent = Math.min(100, Math.round(100*(st?.used || 0)/(st?.limit || 24)));
    $('progressPct').textContent = `${percent}%`; $('meterFill').style.width = percent+'%';
    const selecting = !!(online && st?.stage === 'choose' && st?.you === st.chooser && st.players.every(p=>p?.connected));
    const building = !!(online && st?.stage === 'playing' && st?.you === st.builder && st.players.every(p=>p?.connected));
    for (const b of $('pieceGrid').children) b.disabled = !selecting;
    for (const b of document.querySelectorAll('[data-act]')) b.disabled = !building;
    $('boardBadge').textContent = st ? `RONDA ${st.round+1} · ${st.used}/${st.limit}` : 'LISTO PARA JUGAR';
    if (!st) {
      $('boardHeading').textContent = 'TABLERO EN VIVO';
      $('turnMain').textContent = '👋 ¡Bienvenido al duelo!';
      $('turnSub').textContent = 'Creá una sala o entrá con un código para jugar por internet.';
      $('selectionDesc').textContent = 'Elegí qué figura recibe tu rival cuando sea tu turno.';
    } else if (!st.players.every(p=>p?.connected) && st.stage !== 'lobby') {
      $('boardHeading').textContent = 'PARTIDA EN PAUSA';
      $('turnMain').textContent = '📡 Esperando reconexión';
      $('turnSub').textContent = 'El juego se reanuda cuando ambos jugadores regresen.';
    } else if (st.stage === 'choose') {
      $('boardHeading').textContent = 'SIGUIENTE PIEZA';
      $('turnMain').textContent = selecting ? '🧩 ¡Elegí una pieza para tu rival!' : '🧩 Tu rival está eligiendo una pieza...';
      $('turnSub').textContent = selecting ? 'Presioná una figura del panel derecho.' : 'Tu próxima pieza aparecerá en cualquier momento.';
    } else if (st.stage === 'playing') {
      $('boardHeading').textContent = 'PIEZA EN MOVIMIENTO';
      $('turnMain').textContent = building ? '🎮 ¡Tu turno! Colocá la pieza.' : '🎮 Tu rival está colocando la pieza...';
      $('turnSub').textContent = building ? 'Flechas o WASD para mover · Espacio para soltar.' : 'Mirá cómo se mueve el tablero en tiempo real.';
    } else {
      $('boardHeading').textContent = st.stage === 'final' ? 'RESULTADO FINAL' : 'RONDA TERMINADA';
      $('turnMain').textContent = st.stage === 'final' ? '🏆 ¡Partida terminada!' : '🔁 ¡Hora de cambiar los roles!';
      $('turnSub').textContent = st.stage === 'final' ? 'Podés comenzar una revancha en la misma sala.' : 'El tablero se reinicia para la segunda ronda.';
    }
    $('selectionDesc').textContent = selecting ? '¡Te toca elegir! Mandá una de estas 7 piezas a tu rival.' : building ? 'Tu rival elige la próxima pieza cuando termines de colocar la actual.' : 'Solo quien tiene el rol de selector puede elegir piezas.';
  }
  function createPieces() {
    for (const [type, shape] of Object.entries(SHAPES)) {
      const b = document.createElement('button'); b.className = 'piece-button'; b.disabled = true; b.setAttribute('aria-label','Enviar pieza ' + type);
      const grid = document.createElement('span'); grid.className = 'mini-grid';
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
        const s = document.createElement('span'); s.className = 'mini-cell';
        if (shape[y]?.[x]) { s.style.background = COLORS[type]; s.style.boxShadow = `inset 0 2px #ffffff60`; }
        grid.appendChild(s);
      }
      const letter = document.createElement('span'); letter.className = 'letter'; letter.textContent = type;
      b.append(grid,letter); b.addEventListener('click',()=>send({type:'choose',piece:type})); $('pieceGrid').appendChild(b);
    }
  }
  async function copyInvite() {
    const code = state?.room;
    if (!code) return;
    const u = new URL(location.href); u.searchParams.set('room', code);
    const link = u.toString();
    try { await navigator.clipboard.writeText(link); say('¡Enlace copiado! Enviáselo a tu amigo.',true); }
    catch { window.prompt('Copiá este enlace y enviáselo a tu amigo:',link); }
  }
  function doAction(action) {
    if (state?.stage === 'playing' && state.you === state.builder && state.players.every(p=>p?.connected)) send({type:'act',action});
  }
  for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click',()=>doAction(b.dataset.act));
  $('copyInvite').addEventListener('click',copyInvite);
  $('leaveRoom').addEventListener('click',()=>send({type:'leave'}));
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const actions = { ArrowLeft:'left', ArrowRight:'right', ArrowDown:'down', ArrowUp:'rotate', ' ':'drop', a:'left', d:'right', s:'down', w:'rotate' };
    const act = actions[e.key] || actions[e.key.toLowerCase()];
    if (act && state?.stage === 'playing' && state?.you === state?.builder) {
      e.preventDefault(); if (!e.repeat || act !== 'drop') doAction(act);
    }
  });
  createPieces(); paint(); connect();
})();

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const W = 10, H = 20;
const TYPES = Object.freeze({
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
});
const ROOT = path.join(__dirname, 'public');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};
const cleanName = n => typeof n === 'string' ? n.replace(/[<>\x00-\x1f\x7f]/g, '').trim().slice(0, 20) : '';
const emptyBoard = () => Array.from({ length: H }, () => Array(W).fill(null));
const emptyStats = () => ({ score: 0, lines: 0, placed: 0, topOut: false });
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_STALE_MS = 15 * 60 * 1000;
const ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_ROOMS = 500;
const rooms = new Map();

function codeForRoom() {
  let code;
  do {
    const b = randomBytes(8);
    code = Array.from(b, v => ROOM_ALPHABET[v % ROOM_ALPHABET.length]).join('');
  } while (rooms.has(code));
  return code;
}
function makeRoom(name, limit, ws) {
  const code = codeForRoom();
  const room = {
    code, created: Date.now(), touched: Date.now(),
    players: [{ name, token: randomUUID(), ws }, null],
    limit, stage: 'lobby', round: 0,
    board: emptyBoard(), active: null, used: 0,
    stats: [emptyStats(), emptyStats()], lastGravity: Date.now()
  };
  rooms.set(code, room);
  return room;
}
function snapshot(room, you) {
  return {
    type: 'state', room: room.code, you, round: room.round, stage: room.stage,
    limit: room.limit, used: room.used, board: room.board, active: room.active,
    players: room.players.map(p => p ? { name: p.name, connected: !!(p.ws && p.ws.readyState === WebSocket.OPEN) } : null),
    stats: room.stats, chooser: room.round === 0 ? 0 : 1,
    builder: room.round === 0 ? 1 : 0
  };
}
function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(room) {
  room.touched = Date.now();
  for (let i = 0; i < 2; i++) {
    if (room.players[i]) send(room.players[i].ws, snapshot(room, i));
  }
}
function sendError(ws, message) { send(ws, { type: 'error', message }); }
function bothOnline(r) { return r.players.every(p => p && p.ws && p.ws.readyState === WebSocket.OPEN); }
function resetRound(r) {
  r.board = emptyBoard(); r.active = null; r.used = 0;
  r.lastGravity = Date.now(); r.stage = 'choose';
}
function collide(r, piece, dx = 0, dy = 0, mat = piece.mat) {
  for (let y = 0; y < mat.length; y++) for (let x = 0; x < mat[y].length; x++) {
    if (!mat[y][x]) continue;
    const nx = piece.x + dx + x, ny = piece.y + dy + y;
    if (nx < 0 || nx >= W || ny >= H || (ny >= 0 && r.board[ny][nx])) return true;
  }
  return false;
}
function finishRound(r) { r.active = null; r.stage = r.round === 0 ? 'roundEnd' : 'final'; }
function choose(r, kind) {
  if (r.stage !== 'choose' || !Object.hasOwn(TYPES, kind)) return false;
  const mat = TYPES[kind].map(a => a.slice());
  r.active = { type: kind, mat, x: Math.floor((W - mat[0].length) / 2), y: 0 };
  if (collide(r, r.active)) {
    r.stats[r.round === 0 ? 1 : 0].topOut = true;
    finishRound(r);
  } else { r.stage = 'playing'; r.lastGravity = Date.now(); }
  return true;
}
function lockPiece(r) {
  const p = r.active;
  if (!p) return;
  for (let y = 0; y < p.mat.length; y++) for (let x = 0; x < p.mat[y].length; x++) {
    if (p.mat[y][x]) r.board[p.y + y][p.x + x] = p.type;
  }
  r.active = null;
  let lines = 0;
  for (let y = H - 1; y >= 0; y--) {
    if (r.board[y].every(Boolean)) {
      r.board.splice(y, 1); r.board.unshift(Array(W).fill(null)); lines++; y++;
    }
  }
  const s = r.stats[r.round === 0 ? 1 : 0];
  s.placed++; s.lines += lines; s.score += ([0, 100, 300, 500, 800][lines] || 0);
  r.used++;
  if (r.used >= r.limit) finishRound(r);
  else r.stage = 'choose';
}
function act(r, action) {
  const p = r.active;
  if (r.stage !== 'playing' || !p) return false;
  if (action === 'left' || action === 'right') {
    const dx = action === 'left' ? -1 : 1;
    if (!collide(r, p, dx)) p.x += dx;
  } else if (action === 'down') {
    if (collide(r, p, 0, 1)) lockPiece(r); else p.y++;
  } else if (action === 'rotate') {
    const mat = p.mat[0].map((_, x) => p.mat.map(row => row[x]).reverse());
    for (const dx of [0, -1, 1, -2, 2]) {
      if (!collide(r, p, dx, 0, mat)) { p.x += dx; p.mat = mat; break; }
    }
  } else if (action === 'drop') {
    while (!collide(r, p, 0, 1)) p.y++;
    lockPiece(r);
  } else return false;
  return true;
}
function leave(ws, explicit) {
  const r = ws.room;
  if (!r) return;
  const i = r.players.findIndex(p => p && p.ws === ws);
  ws.room = null;
  if (i < 0) return;
  const p = r.players[i];
  p.ws = null;
  if (explicit) {
    r.players[i] = null;
    if (!r.players[0] && r.players[1]) {
      r.players[0] = r.players[1]; r.players[1] = null;
      const survivor = r.players[0];
      send(survivor.ws, { type: 'joined', room: r.code, seat: 0, token: survivor.token });
    }
    r.stage = 'lobby'; r.round = 0; r.used = 0; r.board = emptyBoard(); r.active = null;
    r.stats = [emptyStats(), emptyStats()];
  }
  if (r.players.every(x => x === null)) rooms.delete(r.code);
  else broadcast(r);
}
function isOwnTurn(ws, r, chooser) {
  return ws.room === r && r.players[chooser] && r.players[chooser].ws === ws;
}
function createServer(port = Number(process.env.PORT || 3000)) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    }
    const file = FILES[url];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    fs.createReadStream(path.join(ROOT, file[0])).pipe(res);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
  wss.on('connection', ws => {
    ws.room = null;
    ws.rate = { time: Date.now(), count: 0 };
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    send(ws, { type: 'hello' });
    ws.on('message', data => {
      const now = Date.now();
      if (now - ws.rate.time > 1000) ws.rate = { time: now, count: 0 };
      if (++ws.rate.count > 70) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return sendError(ws, 'Mensaje no válido.'); }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'create') {
        if (ws.room) return sendError(ws, 'Ya estás en una sala.');
        if (rooms.size >= MAX_ROOMS) return sendError(ws, 'Demasiadas salas activas. Intenta más tarde.');
        const name = cleanName(msg.name) || 'Jugador 1';
        const limit = [16, 24, 36].includes(msg.limit) ? msg.limit : 24;
        const r = makeRoom(name, limit, ws); ws.room = r;
        send(ws, { type: 'joined', room: r.code, seat: 0, token: r.players[0].token });
        broadcast(r);
        return;
      }
      if (msg.type === 'join') {
        if (ws.room) return sendError(ws, 'Salí de la sala actual antes de entrar a otra.');
        const code = String(msg.room || '').trim().toUpperCase().slice(0, 12);
        const r = rooms.get(code);
        if (!r) return sendError(ws, 'Esa sala no existe o ya expiró.');
        const name = cleanName(msg.name) || 'Jugador 2';
        let seat = -1;
        if (typeof msg.token === 'string') seat = r.players.findIndex(p => p && p.token === msg.token);
        if (seat >= 0) {
          const former = r.players[seat].ws;
          if (former && former !== ws && former.readyState === WebSocket.OPEN) {
            former.room = null; former.close(4001, 'Sesión restaurada en otra pestaña');
          }
          r.players[seat].ws = ws;
        } else {
          if (r.stage !== 'lobby' || r.players[1]) return sendError(ws, 'La sala está llena o la partida ya comenzó.');
          seat = 1;
          r.players[seat] = { name, token: randomUUID(), ws };
        }
        ws.room = r;
        send(ws, { type: 'joined', room: r.code, seat, token: r.players[seat].token });
        broadcast(r);
        return;
      }
      if (msg.type === 'leave') { leave(ws, true); send(ws, { type: 'left' }); return; }
      const r = ws.room;
      if (!r) return sendError(ws, 'Primero entrá en una sala.');
      if (!bothOnline(r)) return sendError(ws, 'Esperá a que se conecten los dos jugadores.');
      if (msg.type === 'start') {
        if (!isOwnTurn(ws, r, 0) || r.stage !== 'lobby') return;
        r.round = 0; r.stats = [emptyStats(), emptyStats()]; resetRound(r);
      } else if (msg.type === 'advance') {
        if (r.stage !== 'roundEnd') return;
        r.round = 1; resetRound(r);
      } else if (msg.type === 'rematch') {
        if (r.stage !== 'final') return;
        r.round = 0; r.stats = [emptyStats(), emptyStats()]; resetRound(r);
      } else if (msg.type === 'choose') {
        if (!isOwnTurn(ws, r, r.round === 0 ? 0 : 1) || !choose(r, msg.piece)) return;
      } else if (msg.type === 'act') {
        if (!isOwnTurn(ws, r, r.round === 0 ? 1 : 0) || !act(r, msg.action)) return;
      } else return;
      broadcast(r);
    });
    ws.on('close', () => leave(ws, false));
    ws.on('error', () => {});
  });
  const gravity = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (now - r.created > ROOM_MAX_AGE_MS || (!r.players.some(p => p && p.ws) && now - r.touched > ROOM_STALE_MS)) {
        for (const p of r.players) if (p && p.ws) { p.ws.room = null; p.ws.close(4002, 'Sala expirada'); }
        rooms.delete(r.code); continue;
      }
      if (r.stage === 'playing' && bothOnline(r) && now - r.lastGravity >= Math.max(250, 700 - Math.floor(r.used / 8) * 65)) {
        act(r, 'down'); r.lastGravity = now; broadcast(r);
      }
    }
  }, 80);
  const keepalive = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.alive) return ws.terminate();
      ws.alive = false; ws.ping();
    });
  }, 25000);
  server.on('close', () => { clearInterval(gravity); clearInterval(keepalive); wss.close(); });
  server.listen(port, '0.0.0.0');
  return server;
}
if (require.main === module) {
  const server = createServer();
  server.on('listening', () => console.log('Duelo de Piezas en http://localhost:' + server.address().port));
}
module.exports = { createServer, rooms, TYPES, collide, act, choose };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

const nativeLoad = Module._load;
class FakeWS extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.messages = []; }
  send(v) { this.messages.push(JSON.parse(v)); }
  ping() { this.emit('pong'); }
  close(code) { this.readyState = 3; this.emit('close', code); }
  receive(v) { this.emit('message', Buffer.from(JSON.stringify(v))); }
  latest(t) { return [...this.messages].reverse().find(x => x.type === t); }
}
FakeWS.OPEN = 1;
class FakeWebSocketServer extends EventEmitter {
  static instance;
  constructor() { super(); this.clients = new Set(); FakeWebSocketServer.instance = this; }
  connect() { const ws = new FakeWS(); this.clients.add(ws); this.emit('connection', ws); return ws; }
  close() { this.clients.clear(); }
}
Module._load = function(request, parent, isMain) {
  if (request === 'ws') return { WebSocketServer: FakeWebSocketServer, WebSocket: FakeWS };
  return nativeLoad.call(this, request, parent, isMain);
};
const { createServer, rooms, TYPES, act } = require('../server');
Module._load = nativeLoad;

function state(ws) { return ws.latest('state'); }
let server;

test('servidor sirve los archivos web sin exponer código privado', async () => {
  server = createServer(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const [page, js, health, blocked] = await Promise.all([
    fetch(`http://localhost:${port}/`), fetch(`http://localhost:${port}/app.js`),
    fetch(`http://localhost:${port}/health`), fetch(`http://localhost:${port}/server.js`)
  ]);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DUELO/);
  assert.match(await js.text(), /WebSocket/);
  assert.deepEqual((await health.json()).ok, true);
  assert.equal(blocked.status, 404);
});

test('crear, unirse, empezar, elegir piezas y solo permitir movimientos al constructor', () => {
  const wss = FakeWebSocketServer.instance;
  const alice = wss.connect();
  const bob = wss.connect();
  alice.receive({type:'create', name:'Ana',limit:16});
  const ticket = alice.latest('joined');
  assert.match(ticket.room, /^[A-Z2-9]{8}$/);
  assert.equal(ticket.seat, 0);
  bob.receive({type:'join', room:ticket.room, name:'Beto'});
  assert.equal(bob.latest('joined').seat, 1);
  assert.deepEqual(state(alice).players.map(p => p.name), ['Ana','Beto']);
  bob.receive({type:'start'}); // El invitado no puede iniciar
  assert.equal(state(alice).stage, 'lobby');
  alice.receive({type:'start'});
  assert.equal(state(alice).stage, 'choose');
  bob.receive({type:'choose',piece:'I'}); // El constructor no puede escoger
  assert.equal(state(alice).stage, 'choose');
  alice.receive({type:'choose',piece:'I'});
  assert.equal(state(bob).stage, 'playing');
  const before = state(bob).active.x;
  alice.receive({type:'act',action:'left'}); // El selector no mueve piezas
  assert.equal(state(bob).active.x, before);
  bob.receive({type:'act',action:'left'});
  assert.equal(state(bob).active.x, before-1);
  bob.receive({type:'act',action:'drop'});
  assert.equal(state(bob).used, 1);
  assert.equal(state(bob).stats[1].placed, 1);
  assert.equal(state(bob).stage, 'choose');
});

test('no permite una tercera persona ni revelar tokens en el estado', () => {
  const eve = FakeWebSocketServer.instance.connect();
  const room = [...rooms.values()][0];
  eve.receive({type:'join',room:room.code,name:'Eva'});
  assert.match(eve.latest('error').message, /llena/);
  assert.ok(!JSON.stringify(state(room.players[0].ws)).includes(room.players[0].token));
});

test('puntuación de una línea completa y fase de cambio de ronda', () => {
  const r = [...rooms.values()][0];
  r.board = Array.from({length:20},()=>Array(10).fill(null));
  r.board[19] = Array(10).fill('T');
  for (let x = 3; x <= 6; x++) r.board[19][x] = null;
  r.active = {type:'I',mat:TYPES.I,x:3,y:0};
  r.stage = 'playing';
  assert.equal(act(r,'drop'),true);
  assert.equal(r.stats[1].score,100);
  assert.equal(r.stats[1].lines,1);
  assert.equal(r.used,2);
  r.used = 16; r.stage = 'playing'; r.active = {type:'O',mat:TYPES.O,x:4,y:0};
  act(r,'drop');
  assert.equal(r.stage,'roundEnd');
  assert.equal(r.active,null);
  r.players[0].ws.receive({type:'advance'});
  assert.equal(r.stage,'choose');
  assert.equal(r.round,1);
  assert.equal(r.used,0);
  assert.equal(r.stats[1].score,100);
  // Intercambio: el jugador 2 elige y jugador 1 construye
  r.players[1].ws.receive({type:'choose',piece:'T'});
  assert.equal(r.stage,'playing');
  const used = r.used;
  r.players[1].ws.receive({type:'act',action:'drop'});
  assert.equal(r.used, used);
  r.players[0].ws.receive({type:'act',action:'drop'});
  assert.equal(r.used,used+1);
});

test('pausa al desconectarse y permite recuperar la sesión', () => {
  const r = [...rooms.values()][0];
  const token = r.players[1].token;
  const guest = r.players[1].ws;
  guest.close();
  assert.equal(r.players[1].ws, null);
  assert.equal(state(r.players[0].ws).players[1].connected, false);
  const next = FakeWebSocketServer.instance.connect();
  next.receive({type:'join',room:r.code,token,name:'Beto'});
  assert.equal(next.latest('joined').seat,1);
  assert.equal(state(next).players[1].connected,true);
});

test('cerrar el servidor de prueba', async () => {
  rooms.clear();
  await new Promise(resolve => server.close(resolve));
});

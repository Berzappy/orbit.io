// ORBIT.io multiplayer server
// Serves the website from /public AND runs the one true game world.
// Clients only send input; the server simulates everything and sends back what each player can see.

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const Orbit = require('../public/script.js'); // same game core the browser uses

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1024 });

const world = new Orbit.World();
const clients = new Map(); // ws -> { id }

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

world.onDeath = (victim, killer) => {
  for (const [ws, c] of clients) {
    if (c.id === victim.id) {
      c.id = null;
      send(ws, { t: 'dead', by: killer ? killer.name : '', mass: Math.floor(victim.best) });
    }
  }
};

function updateBotCount() {
  let humans = 0;
  for (const c of clients.values()) if (c.id) humans++;
  world.botCount = Math.max(4, Orbit.CFG.BOT_COUNT - humans); // fewer bots as real players join
}

wss.on('connection', ws => {
  const c = { id: null };
  clients.set(ws, c);
  send(ws, { t: 'welcome' });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'join' && !c.id) {
      c.id = world.addPlayer(String(msg.name || '')).id;
      send(ws, { t: 'joined', id: c.id });
      updateBotCount();
    } else if (msg.t === 'input' && c.id) {
      world.setInput(c.id, { a: Number(msg.a), th: Number(msg.th), p: !!msg.p });
    }
  });

  ws.on('close', () => {
    if (c.id) world.removePlayer(c.id);
    clients.delete(ws);
    updateBotCount();
  });
});

// Simulate at 30 ticks/sec, send updates at 15/sec (every other tick)
let last = Date.now(), tick = 0;
setInterval(() => {
  const now = Date.now();
  world.step(Math.min(0.1, (now - last) / 1000));
  last = now;
  if (++tick % 2 === 0) {
    for (const [ws, c] of clients) send(ws, world.snapshot(c.id));
  }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Orbit.io running at http://localhost:${PORT}`));

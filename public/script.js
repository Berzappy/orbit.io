(function() {
  "use strict";

  const CFG = {
    WORLD: 4000,
    ASTEROID_COUNT: 700,
    START_MASS: 20,
    MIN_PULSE_MASS: 24,
    PULSE_COST: 0.1,
    PULSE_COOLDOWN: 3,
    EAT_RATIO: 1.2,
    BOT_COUNT: 12
  };

  const radiusOf = m => 6 + Math.sqrt(m) * 4;
  const viewRadius = r => 650 * Math.sqrt(r / 24);
  const pullRange = r => r * 4 + 120;
  const pulseRange = r => r * 3 + 180;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const BOT_NAMES = ['Kepler', 'Nova', 'Titan', 'Io', 'Vega', 'Pluto', 'Halley', 'Ceres',
    'Rigel', 'Sirius', 'Europa', 'Lyra', 'Orion', 'Juno', 'Phobos', 'Deimos', 'Callisto', 'Atlas'];

  class World {
    constructor(opts = {}) {
      this.players = new Map();
      this.asteroids = [];
      this.nextId = 1;
      this.time = 0;
      this.botCount = opts.botCount ?? CFG.BOT_COUNT;
      this.botTimer = 0;
      this.onDeath = null;

      for (let i = 0; i < CFG.ASTEROID_COUNT; i++) {
        const a = {};

        this.respawnAsteroid(a);
        this.asteroids.push(a);
      }

      for (let i = 0; i < this.botCount; i++) this.addBot();
    }

    respawnAsteroid(a) {
      a.id = this.nextId++;
      a.x = rand(0, CFG.WORLD);
      a.y = rand(0, CFG.WORLD);
      a.vx = rand(-12, 12);
      a.vy = rand(-12, 12);
      a.m = Math.random() < 0.07 ? rand(4, 7) : rand(0.8, 2);
    }

    addPlayer(name, bot = false) {
      const p = {
        id: this.nextId++,
        name: String(name || "").trim().slice(0, 16) || "Planet",
        bot, alive: true,
        x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0,
        m: CFG.START_MASS, best: CFG.START_MASS,
        hue: Math.floor(rand(0, 360)),
        angle: 0, thrust: 0, wantPulse: false, cd: 0, pulseAt: -10,
        ai: {t: 0}
      };

      const s = this.findSpawn();
      p.x = s.x; p.y = s.y;

      this.players.set(p.id, p);

      return p;
    }

    addBot() {
      const b = this.addPlayer(BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], true);
      b.m = rand(20, 110);

      return b;
    }

    findSpawn() {
      let best = {x: CFG.WORLD / 2, y: CFG.WORLD / 2}, bestD = -Infinity;

      for (let i = 0; i < 12; i++) {
        const x = rand(200, CFG.WORLD - 200), y = rand(200, CFG.WORLD - 200);

        let md = Infinity;

        for (const q of this.players.values()) {
          const d = Math.hypot(q.x - x, q.y - y) - radiusOf(q.m) * 3;

          if (d < md) md = d;
        }

        if (md > bestD) {bestD = md; best = {x, y};}
      }

      return best;
    }

    removePlayer(id) {this.players.delete(id);}

    setInput(id, inp) {
      const p = this.players.get(id);

      if (!p || !inp) return;
      if (Number.isFinite(inp.a)) p.angle = inp.a;
      if (Number.isFinite(inp.th)) p.thrust = clamp(inp.th, 0, 1);
      if (inp.p) p.wantPulse = true;
    }

    kill(victim, killer) {
      victim.alive = false;

      this.players.delete(victim.id);

      if (this.onDeath) this.onDeath(victim, killer);
    }

    pulse(p, ps) {
      p.m *= 1 - CFG.PULSE_COST;
      p.cd = CFG.PULSE_COOLDOWN;
      p.pulseAt = this.time;

      const R = pulseRange(radiusOf(p.m));

      for (const a of this.asteroids) {
        const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy) || 1;

        if (d < R) {const f = (1 - d / R) * 600; a.vx += dx / d * f; a.vy += dy / d * f;}
      }

      for (const q of ps) {
        if (q === p || !q.alive) continue;

        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        const reach = R + radiusOf(q.m);

        if (d < reach) {
          const f = (1 - d / reach) * 750 * Math.min(2, p.m / q.m);
          q.kx += dx / d * f; q.ky += dy / d * f;
        }
      }
    }

    botThink(p, dt, ps) {
      const ai = p.ai;
      ai.t -= dt;

      if (ai.t > 0) return;

      ai.t = rand(0.2, 0.5);

      const r = radiusOf(p.m);

      let threat = null, td = Infinity, prey = null, pd = Infinity;

      for (const q of ps) {
        if (q === p) continue;

        const d = Math.hypot(q.x - p.x, q.y - p.y) - radiusOf(q.m) - r;

        if (q.m >= p.m * CFG.EAT_RATIO) {if (d < 350 && d < td) {threat = q; td = d;}}
        else if (p.m >= q.m * CFG.EAT_RATIO) {if (d < 450 && d < pd) {prey = q; pd = d;}}
      }

      if (threat) {
        p.angle = Math.atan2(p.y - threat.y, p.x - threat.x) + rand(-0.4, 0.4);
        p.thrust = 1;

        if (td < 120 && Math.random() < 0.5) p.wantPulse = true;

        return;
      }

      if (prey && Math.random() < 0.75) {
        p.angle = Math.atan2(prey.y - p.y, prey.x - p.x);
        p.thrust = 1;

        return;
      }

      let best = null, bd = Infinity;

      for (let i = 0; i < 25; i++) {
        const a = this.asteroids[(Math.random() * this.asteroids.length) | 0];
        const d = Math.hypot(a.x - p.x, a.y - p.y);

        if (d < bd) {bd = d; best = a;}
      }

      if (best) {p.angle = Math.atan2(best.y - p.y, best.x - p.x); p.thrust = 0.7;}
    }

    step(dt) {
      this.time += dt;

      const WORLD = CFG.WORLD;
      const ps = [...this.players.values()];

      for (const p of ps) if (p.bot) this.botThink(p, dt, ps);

      for (const p of ps) {
        const r = radiusOf(p.m);
        const speed = Math.max(70, 280 * Math.pow(p.m / CFG.START_MASS, -0.28));
        const tvx = Math.cos(p.angle) * speed * p.thrust;
        const tvy = Math.sin(p.angle) * speed * p.thrust;
        const k = Math.min(1, dt * 5);

        p.vx += (tvx - p.vx) * k;
        p.vy += (tvy - p.vy) * k;

        const kd = Math.exp(-dt * 3);

        p.kx *= kd; p.ky *= kd;
        p.x = clamp(p.x + (p.vx + p.kx) * dt, r, WORLD - r);
        p.y = clamp(p.y + (p.vy + p.ky) * dt, r, WORLD - r);
        p.cd = Math.max(0, p.cd - dt);

        if (p.m > 150) p.m -= p.m * 0.004 * dt;

        if (p.wantPulse) {
          p.wantPulse = false;

          if (p.cd <= 0 && p.m >= CFG.MIN_PULSE_MASS) this.pulse(p, ps);
        }
      }

      outer:

      for (const a of this.asteroids) {
        let ax = 0, ay = 0;

        for (const p of ps) {
          if (!p.alive) continue;

          const dx = p.x - a.x, dy = p.y - a.y;
          const r = radiusOf(p.m), range = pullRange(r);
          const d2 = dx * dx + dy * dy;

          if (d2 > range * range) continue;

          const d = Math.sqrt(d2) || 1;

          if (d < r) {p.m += a.m; this.respawnAsteroid(a); continue outer;}

          const g = (500 + p.m * 3) * (1 - d / range);

          ax += dx / d * g - dy / d * g * 0.25;
          ay += dy / d * g + dx / d * g * 0.25;
        }

        a.vx += ax * dt; a.vy += ay * dt;

        const damp = Math.exp(-dt * 1.5);
        a.vx *= damp; a.vy *= damp;
        a.x += a.vx * dt; a.y += a.vy * dt;

        if (a.x < 0 || a.x > WORLD) {a.vx *= -1; a.x = clamp(a.x, 0, WORLD);}
        if (a.y < 0 || a.y > WORLD) {a.vy *= -1; a.y = clamp(a.y, 0, WORLD);}
      }

      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          let a = ps[i], b = ps[j];

          if (!a.alive || !b.alive) continue;
          if (b.m > a.m) {const t = a; a = b; b = t;}

          const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
          const ra = radiusOf(a.m), rb = radiusOf(b.m);

          if (a.m >= b.m * CFG.EAT_RATIO) {
            if (d < ra - rb * 0.3) {
              a.m += b.m * 0.85;

              this.kill(b, a);

              continue;
            }

            const range = pulseRange(ra) + rb;

            if (d < range) {
              const pull = 80 * Math.min(3, a.m / b.m) * (1 - d / range);
              b.x += dx / d * pull * dt;
              b.y += dy / d * pull * dt;
            }
          } else if (d < ra + rb) {
            const o = (ra + rb - d) * 0.5;
            a.x += dx / d * o; a.y += dy / d * o;
            b.x -= dx / d * o; b.y -= dy / d * o;
          }
        }
      }

      for (const p of this.players.values()) if (p.m > p.best) p.best = p.m;

      this.botTimer -= dt;

      if (this.botTimer <= 0) {
        this.botTimer = 2;

        let bots = 0;

        for (const p of this.players.values()) if (p.bot) bots++;

        if (bots < this.botCount) this.addBot();
      }
    }

    snapshot(id) {
      const all = [...this.players.values()].sort((a, b) => b.m - a.m);
      const me = id != null ? this.players.get(id) : null;
      const focus = me || all[0] || {x: CFG.WORLD / 2, y: CFG.WORLD / 2, m: 60};
      const view = viewRadius(radiusOf(me ? me.m : 60)) + 150;
      const near = (x, y, pad) => Math.abs(x - focus.x) < view + pad && Math.abs(y - focus.y) < view + pad;

      const players = []

      for (const p of all) {
        if (near(p.x, p.y, radiusOf(p.m) * 4)) {
          players.push({id: p.id, x: Math.round(p.x), y: Math.round(p.y), m: +p.m.toFixed(1), h: p.hue, n: p.name, pa: +(this.time - p.pulseAt).toFixed(2)});
        }
      }

      const asteroids = [];

      for (const a of this.asteroids) {
        if (near(a.x, a.y, 20)) asteroids.push([a.id, Math.round(a.x), Math.round(a.y), +a.m.toFixed(1)]);
      }

      const lb = all.slice(0, 10).map(p => ({id: p.id, n: p.name, m: Math.floor(p.m), h: p.hue, x: Math.round(p.x), y: Math.round(p.y)}));

      return {
        t: "state",
        me: me ? {id: me.id, m: me.m, cd: +me.cd.toFixed(2), x: Math.round(me.x), y: Math.round(me.y)} : null,
        cam: {x: focus.x, y: focus.y, m: me ? me.m : 60},
        players, asteroids, lb, total: all.length
      };
    }
  }

  const Orbit = {CFG, World, radiusOf, viewRadius, pullRange, pulseRange};

  if (typeof module !== "undefined" && module.exports) module.exports = Orbit;
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d")
  const menu = $("menu"), nameInput = $("name"), playBtn = $("playBtn");
  const statusEl = $("status"), badge = $("badge"), deathInfo = $("deathInfo");
  const statsEl = $("stats"), massEl = $("mass"), rankEl = $("rank");
  const lbList = $("lbList"), pulseEl = $("pulse"), pulseFill = $("pulseFill"), pulseLabel = $("pulseLabel");
  const pulseBtn = $("pulseBtn");

  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
  }

  window.addEventListener("resize", resize);

  resize();

  let mode = "connecting";
  let ws = null, world = null;
  let state = null;
  let myId = null, playing = false;

  const disp = new Map();
  const cam = {x: CFG.WORLD / 2, y: CFG.WORLD / 2, z: 0.5};
  const mouse = {x: 0, y: 0};
  const input = {a: 0, th: 0, p: false};
  const isTouch = "ontouchstart" in window;

  const stars = Array.from({length: 260}, () => ({
    x: Math.random(), y: Math.random(), d: 0.03 + Math.random() * 0.3,
    s: 0.3 + Math.random() * 1.4, a: 0.25 + Math.random() * 0.75
  }));

  try {nameInput.value = localStorage.getItem("orbit-name") || "";} catch(e) {}

  function connect() {
    const httpPage = location.protocol === "http:" || location.protocol === "https:";

    if (!httpPage) return goOffline();

    let settled = false;

    const fail = () => {if (settled) return; settled = true; try {ws.close();} catch(e) {} ws = null; goOffline();};

    try {
      ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
    } catch(e) {return goOffline();}

    const timer = setTimeout(fail, 2500);
    ws.onerror = () => {clearTimeout(timer); fail();};
    ws.onmessage = ev => {
      let msg;

      try {msg = JSON.parse(ev.data);} catch(e) {return;}

      if (msg.t === "welcome" && !settled) {settled = true; clearTimeout(timer); mode = "online";}
      else if (msg.t === "state") state = msg;
      else if (msg.t === "joined") myId = msg.id;
      else if (msg.t === "dead") onDead(msg.by, msg.mass);
    };

    ws.onclose = () => {
      if (mode !== "online") return;

      ws = null;

      const wasPlaying = playing;

      playing = false; myId = null;

      goOffline();

      if (wasPlaying) showMenu("Lost connection to the server - switched to offline practice.");
    };
  }

  function goOffline() {
    mode = "offline";
    world = new World();
    world.onDeath = (victim, killer) => {
      if (victim.id === myId) onDead(killer ? killer.name : "", Math.floor(victim.best));
    };
  }

  setInterval(() => {
    if (mode === "online" && playing && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({t: "input", a: input.a, th: input.th, p: input.p}));
      input.p = false;
    }
  }, 50);

  function play() {
    if (mode === "connecting") return;

    const name = nameInput.value.trim();

    try {localStorage.setItem("orbit-name", name);} catch(e) {}

    if (mode === "online") ws.send(JSON.stringify({t: "join", name}));
    else myId = world.addPlayer(name).id;

    playing = true;
    menu.classList.add("hidden");
    statsEl.classList.remove("hidden");
    pulseEl.classList.remove("hidden");

    if (isTouch) pulseBtn.classList.remove("hidden");

    nameInput.blur();
  }

  function onDead(by, mass) {
    playing = false; myId = null;

    showMenu(by
      ? `Absorbed by <b>${escapeHtml(by)}</b><br>Peak mass: <b>${mass}</b>`
      : `Your planet was lost.<br>Peak mass: <b>${mass}</b>`);
  }

  function showMenu(html) {
    menu.classList.remove("hidden");
    statsEl.classList.add("hidden");
    pulseEl.classList.add("hidden");
    pulseBtn.classList.add("hidden");
    playBtn.textContent = "PLAY AGAIN";

    if (html) {deathInfo.innerHTML = html; deathInfo.classList.remove("hidden");}
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }

  playBtn.addEventListener("click", play);
  window.addEventListener("mousemove", e => {mouse.x = e.clientX; mouse.y = e.clientY;});

  const onTouch = e => {
    const t = e.touches[0];

    if (t) {mouse.x = t.clientX; mouse.y = t.clientY;}

    e.preventDefault();
  };

  canvas.addEventListener("touchstart", onTouch, {passive: false});
  canvas.addEventListener("touchmove", onTouch, {passive: false});
  pulseBtn.addEventListener("touchstart", e => {input.p = true; e.preventDefault();}, {passive: false});
  pulseBtn.addEventListener("click", () => {input.p = true;});

  window.addEventListener("keydown", e => {
    if (e.code === "Space" && playing) {input.p = true; e.preventDefault();}
    if (e.code === "Enter" && !playing) play();
  });

  function updateInput() {
    const dx = mouse.x - W / 2, dy = mouse.y - H / 2;
    const dist = Math.hypot(dx, dy);

    input.a = Math.atan2(dy, dx);
    input.th = dist < 12 ? 0 : clamp(dist / (Math.min(W, H) * 0.25), 0, 1);
  }

  function updateHud() {
    const label = mode === "online" ? `● Online · ${state ? state.total : 0} planets`
      : mode === "offline" ? `● Offline practice · bots` : "Connecting...";

    badge.textContent = label;
    badge.className = mode;

    statusEl.textContent = mode === "offline"
      ? "Offline practice mode (no game server found) - you vs bots"
      : label;

    if (!state) return;

    lbList.replaceChildren(...state.lb.map(e => {
      const li = document.createElement("li");

      if (e.id === myId) li.className = "me";

      const n = document.createElement("span"); n.className = "n"; n.textContent = e.n;
      const m = document.createElement("span"); m.className = "m"; m.textContent = e.m;

      li.append(n, m);

      return li;
    }));

    if (playing && state.me) {
      massEl.textContent = Math.floor(state.me.m);

      const idx = state.lb.findIndex(e => e.id === state.me.id);

      rankEl.textContent = idx >= 0 ? `Rank #${idx + 1} of ${state.total}` : `${state.total} planets`;

      const can = state.me.m >= CFG.MIN_PULSE_MASS;

      pulseFill.style.width = (can ? (1 - state.me.cd / CFG.PULSE_COOLDOWN) * 100 : 0) + "%";
      pulseLabel.textContent = !can ? `PULSE NEEDS ${CFG.MIN_PULSE_MASS} MASS`
        : state.me.cd > 0 ? "CHARGING..." : "PULSE READY · SPACE";
    }
  }

  setInterval(updateHud, 150);

  function hash(n) {
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);

    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  }

  function syncDisplay(dt) {
    const k = mode === "offline" ? 1 : 1 - Math.exp(-dt * 14);
    const seen = new Set();

    for (const p of state.players) {
      seen.add(p.id);

      let d = disp.get(p.id);

      if (!d) {d = {x: p.x, y: p.y, m: p.m}; disp.set(p.id, d);}
      else {d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k; d.m += (p.m - d.m) * k;}
      if (p.pa < 0.6 && (d.lastPa === undefined || p.pa < d.lastPa)) d.pulseStart = performance.now() - p.pa * 1000;

      d.lastPa = p.pa;
    }

    for (const a of state.asteroids) {
      const id = a[0]
      seen.add(id);

      let d = disp.get(id);

      if (!d) {d = {x: a[1], y: a[2], m: a[3]}; disp.set(id, d);}
      else {d.x += (a[1] - d.x) * k; d.y += (a[2] - d.y) * k; d.m = a[3];}
    }

    for (const id of disp.keys()) if (!seen.has(id)) disp.delete(id);
  }

  function drawBackground() {
    ctx.fillStyle = "#04050d";
    ctx.fillRect(0, 0, W, H);

    const neb = [[0.25, 0.3, "rgba(110, 70, 255, 0.10)"], [0.75, 0.7, "rgba(255, 110, 160, 0.07)"], [0.6, 0.15, "rgba(60, 170, 255, 0.07)"]];

    for (const [nx, ny, col] of neb) {
      const x = ((nx * W * 2 - cam.x * 0.02) % (W * 2) + W * 2) % (W * 2) - W * 0.5;
      const y = ((ny * H * 2 - cam.y * 0.02) % (H * 2) + H * 2) % (H * 2) - H * 0.5;
      const R = Math.max(W, H) * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);

      g.addColorStop(0, col); g.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    for (const s of stars) {
      const x = ((s.x * W - cam.x * s.d) % W + W) % W;
      const y = ((s.y * H - cam.y * s.d) % H + H) % H;

      ctx.globalAlpha = s.a;
      ctx.fillStyle = "#cfd8ff";
      ctx.fillRect(x, y, s.s, s.s);
    }

    ctx.globalAlpha = 1;
  }

  function drawGrid(hw, hh) {
    const step = 100;
    const x0 = Math.max(0, Math.floor((cam.x - hw) / step) * step), x1 = Math.min(CFG.WORLD, cam.x + hw);
    const y0 = Math.max(0, Math.floor((cam.y - hh) / step) * step), y1 = Math.min(CFG.WORLD, cam.y + hh);

    ctx.strokeStyle = "rgba(120, 140, 255, 0.05)";
    ctx.lineWidth = 1 / cam.z;
    ctx.beginPath();

    for (let x = x0; x <= x1; x += step) {ctx.moveTo(x, Math.max(0, cam.y - hh)); ctx.lineTo(x, y1);}
    for (let y = y0; y <= y1; y += step) {ctx.moveTo(Math.max(0, cam.x - hw), y); ctx.lineTo(x1, y);}

    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 90, 130, 0.45)";
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, CFG.WORLD, CFG.WORLD);
  }

  function drawAsteroid(id, d, t) {
    const r = 2.5 + d.m * 1.7;
    const rot = t * (hash(id) - 0.5) * 2;

    ctx.beginPath();

    for (let i = 0; i < 7; i++) {
      const ang = rot + (i / 7) * Math.PI * 2;
      const rr = r * (0.7 + hash(id * 13 + i) * 0.5);
      const x = d.x + Math.cos(ang) * rr, y = d.y + Math.sin(ang) * rr;

      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }

    ctx.closePath();

    if (d.m > 3) {
      ctx.fillStyle = "#ffcf5a";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 207, 90, 0.35)";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fillStyle = `hsl(${220 + hash(id * 7) * 40}, 14%, ${52 + hash(id * 3) * 22}%)`;
      ctx.fill();
    }
  }

  function drawWell(p, d) {
    const r = radiusOf(d.m), range = pullRange(r);
    const g = ctx.createRadialGradient(d.x, d.y, r, d.x, d.y, range);
    g.addColorStop(0, `hsla(${p.h}, 85%, 60%, 0.13)`);
    g.addColorStop(1, `hsla(${p.h}, 85%, 60%, 0)`);

    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(d.x, d.y, range, 0, Math.PI * 2); ctx.fill();
  }

  function drawPlanet(p, d, t, me) {
    const r = radiusOf(d.m), x = d.x, y = d.y, h = p.h;
    const hasRing = d.m > 120;
    const tilt = -0.35 + hash(p.id) * 0.3;

    const moons = clamp(Math.floor(Math.log2(d.m / 25)), 0, 5);

    for (let i = 0; i < moons; i++) {
      const orb = r * 1.45 + i * r * 0.22 + 8;
      ctx.strokeStyle = `hsla(${h}, 60%, 80%, 0.08)`;
      ctx.lineWidth = 1 / cam.z;
      ctx.beginPath(); ctx.arc(x, y, orb, 0, Math.PI * 2); ctx.stroke();

      const ang = t * (0.9 - i * 0.12) + i * 2.1 + p.id;
      ctx.fillStyle = `hsl(${h}, 25%, 82%)`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang) * orb, y + Math.sin(ang) * orb, Math.max(2.5, r * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }

    if (hasRing) {
      ctx.strokeStyle = `hsla(${(h + 40) % 360}, 70%, 75%, 0.55)`;
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.75, r * 0.45, tilt, Math.PI, Math.PI * 2); ctx.stroke();
    }

    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, `hsl(${h}, 85%, 72%)`);
    g.addColorStop(0.6, `hsl(${h}, 70%, 46%)`);
    g.addColorStop(1, `hsl(${h}, 70%, 18%)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = `hsla(${(h + 20) % 360}, 80%, 85%, 0.12)`;

    for (let i = 0; i < 3; i++) {
      const by = y - r + (0.25 + i * 0.25 + (hash(p.id * 5 + i) - 0.5) * 0.15) * 2 * r;
      ctx.fillRect(x - r, by, r * 2, r * (0.08 + hash(p.id * 9 + i) * 0.1));
    }

    ctx.restore();

    ctx.strokeStyle = `hsla(${h}, 90%, 75%, 0.5)`;
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();

    if (hasRing) {
      ctx.strokeStyle = `hsla(${(h + 40) % 360}, 70%, 78%, 0.7)`;
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.75, r * 0.45, tilt, 0, Math.PI); ctx.stroke();
    }

    if (d.pulseStart) {
      const age = (performance.now() - d.pulseStart) / 1000;

      if (age < 0.6) {
        const k = age / 0.6, ease = 1 - (1 - k) * (1 - k);
        ctx.strokeStyle = `hsla(${h}, 90%, 80%, ${1 - k})`;
        ctx.lineWidth = (5 * (1 - k) + 1) / Math.min(1, cam.z);
        ctx.beginPath(); ctx.arc(x, y, r + (pulseRange(r) - r) * ease, 0, Math.PI * 2); ctx.stroke();
      }
    }

    let col = "#ffffff";

    if (me && p.id !== me.id) {
      if (p.m >= me.m * CFG.EAT_RATIO) col = "#ff8a9a";
      else if (me.m >= p.m * CFG.EAT_RATIO) col = "#9dffb0";
    }

    const fs = Math.max(13, r * 0.38);
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = fs / 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.strokeText(p.n, x, y - fs * 0.15);
    ctx.fillStyle = col;
    ctx.fillText(p.n, x, y - fs * 0.15);
    ctx.font = `600 ${fs * 0.6}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.strokeText(Math.floor(p.m), x, y + fs * 0.65);
    ctx.fillText(Math.floor(p.m), x, y + fs * 0.65);
  }

  function drawMinimap() {
    const s = W < 600 ? 96 : 140, x0 = W - s - 16, y0 = H - s - 16, sc = s / CFG.WORLD;
    ctx.fillStyle = "rgba(10, 14, 35, 0.65)";
    ctx.strokeStyle = "rgba(140, 160, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    if (ctx.roundRect) ctx.roundRect(x0, y0, s, s, 10); else ctx.rect(x0, y0, s, s);

    ctx.fill(); ctx.stroke();

    for (const e of state.lb) {
      if (e.id === myId) continue

      ctx.fillStyle = `hsl(${e.h}, 80%, 65%)`;
      ctx.beginPath(); ctx.arc(x0 + e.x * sc, y0 + e.y * sc, 1.5 + Math.sqrt(e.m) / 6, 0, Math.PI * 2); ctx.fill();
    }

    if (playing && state.me) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x0 + state.me.x * sc, y0 + state.me.y * sc, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render(dt, now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (!state) {drawBackground(); return;}

    syncDisplay(dt);

    const md = myId != null ? disp.get(myId) : null;
    const target = md || state.cam;
    const tm = md ? md.m : state.cam.m;
    const ck = md ? 1 : 1 - Math.exp(-dt * 2);

    cam.x += (target.x - cam.x) * ck;
    cam.y += (target.y - cam.y) * ck;

    const tz = (Math.max(W, H) / 2) / viewRadius(radiusOf(tm));
    cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 3));

    drawBackground();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    const hw = W / 2 / cam.z + 40, hh = H / 2 / cam.z + 40;
    drawGrid(hw, hh)

    const t = now / 1000;

    for (const a of state.asteroids) {
      const d = disp.get(a[0]);

      if (Math.abs(d.x - cam.x) < hw && Math.abs(d.y - cam.y) < hh) drawAsteroid(a[0], d, t);
    }

    const me = state.me;
    const sorted = [...state.players].sort((a, b) => a.m - b.m);

    for (const p of sorted) drawWell(p, disp.get(p.id));
    for (const p of sorted) drawPlanet(p, disp.get(p.id), t, me);

    ctx.restore();

    drawMinimap();
  }

  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);

    last = now;

    if (playing) updateInput();

    if (mode === "offline" && world) {
      if (playing && myId != null) {world.setInput(myId, input), input.p = false;}

      world.step(dt);
      state = world.snapshot(myId);
    }

    render(dt, now);
    requestAnimationFrame(frame);
  }

  connect();
  requestAnimationFrame(frame);
;})();

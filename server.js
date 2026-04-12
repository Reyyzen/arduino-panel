const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT     = process.env.PORT || 3000;
const SIM_MODE = false;
const ESP_KEY  = 'reyy123';

app.use(express.static('public'));
app.use(express.json());

// ── State ────────────────────────────────────────────────────────
let state = {
  leds    : [false, false, false, false, false],
  sensor  : { raw: 0, voltage: 0.0 },
  simMode : SIM_MODE,
};

let espOnline   = false;
let lastSeen    = null;
let cmdQueue    = [];
let logs        = [];

// ── Helpers ──────────────────────────────────────────────────────
const LED_NAMES = ['Merah', 'Kuning', 'Hijau', 'Biru', 'Putih'];

function addLog(msg, type = 'info') {
  const entry = { time: new Date().toLocaleTimeString('id-ID'), msg, type };
  logs.unshift(entry);
  if (logs.length > 100) logs.pop();
  io.emit('log', entry);
}

function simSensor() {
  state.sensor.raw     = Math.floor(Math.random() * 1024);
  state.sensor.voltage = parseFloat((state.sensor.raw * 3.3 / 1023).toFixed(2));
}

function simCommand(cmd) {
  if (cmd === 'ALL_ON')  { state.leds = [true,true,true,true,true];     return 'Semua LED menyala'; }
  if (cmd === 'ALL_OFF') { state.leds = [false,false,false,false,false]; return 'Semua LED mati'; }
  const m = cmd.match(/^LED(\d)_(ON|OFF)$/);
  if (m) {
    const i = parseInt(m[1]) - 1;
    if (i >= 0 && i < 5) {
      state.leds[i] = m[2] === 'ON';
      return `LED ${LED_NAMES[i]} ${m[2]}`;
    }
  }
  return `Perintah diterima: ${cmd}`;
}

// ── Cek ESP8266 offline jika tidak polling > 8 detik ─────────────
setInterval(() => {
  if (!lastSeen) return;
  if (Date.now() - lastSeen > 8000 && espOnline) {
    espOnline = false;
    addLog('ESP8266 offline — koneksi terputus', 'err');
    io.emit('esp-status', { online: false });
  }
}, 3000);

// Simulasi sensor jika SIM_MODE
if (SIM_MODE) {
  setInterval(() => {
    simSensor();
    io.emit('sensor-data', state.sensor);
  }, 2000);
}

// ── API untuk Browser ────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    simMode : SIM_MODE,
    espOnline,
    leds    : state.leds,
    sensor  : state.sensor,
  });
});

app.post('/api/command', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Perintah kosong' });

  if (SIM_MODE) {
    const reply = simCommand(command);
    addLog(`→ ${command}  ←  ${reply}`, 'ok');
    io.emit('state-update', state);
    return res.json({ ok: true, reply });
  }

  if (!espOnline) {
    addLog(`✗ ${command} — ESP8266 offline`, 'err');
    return res.status(503).json({ error: 'ESP8266 tidak terhubung' });
  }

  cmdQueue.push(command);
  addLog(`→ ${command} (masuk antrian)`, 'info');
  res.json({ ok: true, queued: true });
});

app.get('/api/log', (req, res) => res.json(logs));

// ── API untuk ESP8266 (polling) ──────────────────────────────────

// Middleware cek kunci
function checkKey(req, res, next) {
  const key = req.headers['x-esp-key'] || req.query.key;
  if (key !== ESP_KEY) return res.status(403).json({ error: 'Kunci salah' });
  next();
}

// ESP8266 ambil perintah (dipanggil tiap ~1 detik oleh ESP8266)
app.get('/esp/poll', checkKey, (req, res) => {
  const wasOffline = !espOnline;
  lastSeen  = Date.now();
  espOnline = true;

  if (wasOffline) {
    addLog('ESP8266 terhubung ✓', 'ok');
    io.emit('esp-status', { online: true });
  }

  const cmd = cmdQueue.shift() || 'IDLE';
  res.json({ cmd });
});

// ESP8266 kirim data sensor & status LED
app.post('/esp/data', checkKey, (req, res) => {
  const { raw, voltage, leds } = req.body;
  if (raw     !== undefined) state.sensor.raw     = raw;
  if (voltage !== undefined) state.sensor.voltage = voltage;
  if (leds    !== undefined) state.leds           = leds;

  io.emit('sensor-data',  state.sensor);
  io.emit('state-update', state);
  res.json({ ok: true });
});

// ── Socket.IO ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('state-update', state);
  socket.emit('log-history', logs.slice(0, 20));

  socket.on('send-command', (cmd) => {
    if (SIM_MODE) {
      const reply = simCommand(cmd);
      addLog(`→ ${cmd}  ←  ${reply}`, 'ok');
      io.emit('state-update', state);
      socket.emit('esp-reply', reply);
      return;
    }
    if (!espOnline) {
      socket.emit('esp-reply', '✗ ESP8266 offline');
      addLog(`✗ ${cmd} — ESP8266 offline`, 'err');
      return;
    }
    cmdQueue.push(cmd);
    addLog(`→ ${cmd} (masuk antrian)`, 'info');
    socket.emit('esp-reply', `${cmd} dikirim ke ESP8266`);
  });
});

// ── Start ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('======================================');
  console.log('  ArduinoPanel — Web Server');
  console.log(`  Port    : ${PORT}`);
  console.log(`  Mode    : ${SIM_MODE ? 'SIMULASI' : 'LIVE (ESP8266)'}`);
  console.log(`  ESP Key : ${ESP_KEY}`);
  console.log('======================================');
  addLog('Server ArduinoPanel aktif ✓', 'ok');
});

// ============================================================
//  Arduino WiFi Web Server
//  Mode SIMULASI aktif saat ESP32 belum tersambung
// ============================================================

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const axios    = require('axios');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ─── Konfigurasi ────────────────────────────────────────────
const PORT       = 3000;
const SIM_MODE  = (process.env.SIM_MODE || 'true') !== 'false';   // Ganti FALSE setelah ESP32 siap
const ESP_IP     = 'http://192.168.1.105';  // Ganti dengan IP ESP32 kamu
const POLL_MS    = 2000;   // Interval baca sensor (ms)
// ─────────────────────────────────────────────────────────────

app.use(express.static('public'));
app.use(express.json());

// ─── State simulasi ──────────────────────────────────────────
let simState = {
  led     : false,
  relay   : false,
  buzzer  : false,
  sensor  : { raw: 0, voltage: 0.0, suhu: 27.5 },
  log     : []
};

function simSensor() {
  simState.sensor.raw     = Math.floor(Math.random() * 4096);
  simState.sensor.voltage = parseFloat((simState.sensor.raw * 3.3 / 4095).toFixed(2));
  simState.sensor.suhu    = parseFloat((25 + Math.random() * 10).toFixed(1));
}

function simCommand(cmd) {
  const map = {
    'LED_ON'     : () => { simState.led    = true;  return 'LED menyala ✓'; },
    'LED_OFF'    : () => { simState.led    = false; return 'LED mati ✓'; },
    'RELAY_ON'   : () => { simState.relay  = true;  return 'Relay ON ✓'; },
    'RELAY_OFF'  : () => { simState.relay  = false; return 'Relay OFF ✓'; },
    'BUZZER_ON'  : () => { simState.buzzer = true;  return 'Buzzer aktif ✓'; },
    'BUZZER_OFF' : () => { simState.buzzer = false; return 'Buzzer mati ✓'; },
  };
  return map[cmd] ? map[cmd]() : `Perintah "${cmd}" diterima ✓`;
}

function addLog(msg) {
  const entry = { time: new Date().toLocaleTimeString('id-ID'), msg };
  simState.log.unshift(entry);
  if (simState.log.length > 50) simState.log.pop();
  return entry;
}
// ─────────────────────────────────────────────────────────────

// ─── REST API ────────────────────────────────────────────────
app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ status: 'error', message: 'Perintah kosong' });

  if (SIM_MODE) {
    const reply = simCommand(command);
    const log   = addLog(`→ ${command}  ←  ${reply}`);
    io.emit('log', log);
    io.emit('state-update', simState);
    return res.json({ status: 'ok', reply, simMode: true });
  }

  try {
    const response = await axios.get(`${ESP_IP}/command?val=${command}`, { timeout: 3000 });
    const log = addLog(`→ ${command}  ←  ${response.data}`);
    io.emit('log', log);
    res.json({ status: 'ok', reply: response.data });
  } catch (err) {
    const log = addLog(`✗ ${command}  —  ESP tidak merespons`);
    io.emit('log', log);
    res.status(500).json({ status: 'error', message: 'ESP tidak merespons. Cek koneksi WiFi.' });
  }
});

app.get('/api/sensor', async (req, res) => {
  if (SIM_MODE) {
    simSensor();
    return res.json({ ...simState.sensor, simMode: true });
  }
  try {
    const response = await axios.get(`${ESP_IP}/sensor`, { timeout: 3000 });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Gagal ambil data sensor' });
  }
});

app.get('/api/status', async (req, res) => {
  if (SIM_MODE) {
    return res.json({ online: true, simMode: true, ip: 'Simulasi', uptime: process.uptime() });
  }
  try {
    await axios.get(`${ESP_IP}/status`, { timeout: 2000 });
    res.json({ online: true, simMode: false, ip: ESP_IP });
  } catch {
    res.json({ online: false, simMode: false, ip: ESP_IP });
  }
});

app.get('/api/log', (req, res) => res.json(simState.log));
// ─────────────────────────────────────────────────────────────

// ─── Socket.IO ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Client terhubung: ${socket.id}`);

  // Kirim state awal
  socket.emit('state-update', simState);
  socket.emit('log', addLog('Client baru terhubung'));

  // Terima perintah dari browser
  socket.on('send-command', async (command) => {
    if (SIM_MODE) {
      const reply = simCommand(command);
      const log   = addLog(`→ ${command}  ←  ${reply}`);
      io.emit('log', log);
      io.emit('state-update', simState);
      socket.emit('esp-reply', reply);
      return;
    }
    try {
      const response = await axios.get(`${ESP_IP}/command?val=${command}`, { timeout: 3000 });
      const log = addLog(`→ ${command}  ←  ${response.data}`);
      io.emit('log', log);
      socket.emit('esp-reply', response.data);
    } catch {
      socket.emit('esp-reply', '✗ ESP tidak merespons');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client terputus: ${socket.id}`);
  });
});

// Polling sensor otomatis → broadcast ke semua client
const sensorInterval = setInterval(async () => {
  if (SIM_MODE) {
    simSensor();
    io.emit('sensor-data', simState.sensor);
    return;
  }
  try {
    const res = await axios.get(`${ESP_IP}/sensor`, { timeout: 2000 });
    io.emit('sensor-data', res.data);
  } catch { /* skip */ }
}, POLL_MS);
// ─────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║      Arduino WiFi Web Server         ║');
  console.log(`║  Buka : http://localhost:${PORT}         ║`);
  console.log(`║  Mode : ${SIM_MODE ? 'SIMULASI (ESP32 belum ada)  ' : `LIVE → ${ESP_IP}         `}║`);
  console.log('╚══════════════════════════════════════╝');
});

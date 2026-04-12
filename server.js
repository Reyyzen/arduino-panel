const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const SIM_MODE = true;
const ESP_KEY = 'reyy123';
const LED_NAMES = ['Merah', 'Kuning', 'Hijau', 'Biru', 'Putih'];

app.use(express.static('public'));
app.use(express.json());

let state = {
  leds: [false, false, false, false, false],
  sensor: { raw: 0, voltage: 0.0 },
  simMode: true,
};

let logs = [];

function addLog(msg, type = 'info') {
  const entry = { time: new Date().toLocaleTimeString('id-ID'), msg, type };
  logs.unshift(entry);
  if (logs.length > 100) logs.pop();
  io.emit('log', entry);
  return entry;
}

function simSensor() {
  state.sensor.raw = Math.floor(Math.random() * 1024);
  state.sensor.voltage = parseFloat((state.sensor.raw * 3.3 / 1023).toFixed(2));
}

function simCommand(cmd) {
  if (cmd === 'ALL_ON')  { state.leds = [true,true,true,true,true];     return 'Semua LED menyala'; }
  if (cmd === 'ALL_OFF') { state.leds = [false,false,false,false,false]; return 'Semua LED mati'; }
  const match = cmd.match(/^LED(\d)_(ON|OFF)$/);
  if (match) {
    const idx = parseInt(match[1]) - 1;
    if (idx >= 0 && idx < 5) {
      state.leds[idx] = match[2] === 'ON';
      return 'LED ' + LED_NAMES[idx] + ' ' + match[2];
    }
  }
  return 'Perintah diterima: ' + cmd;
}

app.get('/api/status', (req, res) => {
  res.json({ simMode: SIM_MODE, espOnline: false, leds: state.leds, sensor: state.sensor });
});

app.post('/api/command', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Kosong' });
  const reply = simCommand(command);
  addLog('→ ' + command + '  ←  ' + reply, 'ok');
  io.emit('state-update', state);
  res.json({ ok: true, reply });
});

app.get('/api/log', (req, res) => res.json(logs));

setInterval(() => {
  simSensor();
  io.emit('sensor-data', state.sensor);
}, 2000);

io.on('connection', (socket) => {
  socket.emit('state-update', state);
  socket.emit('log-history', logs.slice(0, 20));
  socket.on('send-command', (cmd) => {
    const reply = simCommand(cmd);
    addLog('→ ' + cmd + '  ←  ' + reply, 'ok');
    io.emit('state-update', state);
    socket.emit('esp-reply', reply);
  });
});

server.listen(PORT, () => {
  console.log('Server jalan di port ' + PORT);
  addLog('Server ArduinoPanel aktif', 'ok');
});

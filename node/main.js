const express = require('express');
const mqtt    = require('mqtt');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');

const app  = express();
const PORT = 80;

app.use(cors());
app.use(express.json());

// ── Serve React frontend ──
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// ── Find own IP dynamically ──
function getOwnIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const BROKER_IP  = getOwnIP();
const BROKER_URI = `mqtt://${BROKER_IP}:1883`;
console.log(`[MQTT] Connecting to broker at ${BROKER_URI}`);

// ── Topics matching the React client ──
const ROOMS          = ['room1', 'room2'];
const SENSOR_TOPICS  = ['temp', 'humidity', 'mq2', 'mq135', 'flame', 'ldr', 'occupancy', 'magnet', 'emergency'];
const CONTROL_TOPICS = ['fan', 'led'];

// ── In-memory state ──
let robotLocation = 'home';
const sensorData   = {};
const controlState = {};

ROOMS.forEach(room => {
  sensorData[room]   = {};
  controlState[room] = {};
  SENSOR_TOPICS.forEach(s  => { sensorData[room][s]   = null; });
  CONTROL_TOPICS.forEach(c => { controlState[room][c] = false; });
});

// ── MQTT Client ──
const client = mqtt.connect(BROKER_URI);

client.on('connect', () => {
  console.log('[MQTT] Connected to broker');

  // Robot location
  client.subscribe('esp32/location', err => {
    if (!err) console.log('[MQTT] Subscribed to esp32/location');
  });

  // Per-room sensors + control status
  ROOMS.forEach(room => {
    SENSOR_TOPICS.forEach(t  => client.subscribe(`${room}/${t}`));
    CONTROL_TOPICS.forEach(t => client.subscribe(`${room}/${t}/status`));
  });
  console.log('[MQTT] Subscribed to all room topics');
});

client.on('message', (topic, message) => {
  const msg = message.toString();

  // Robot location
  if (topic === 'esp32/location') {
    robotLocation = msg;
    console.log(`[MQTT] Robot arrived at: ${robotLocation}`);
    return;
  }

  const parts = topic.split('/');

  // Control status: room1/fan/status
  if (parts.length === 3 && parts[2] === 'status') {
    const [room, ctrl] = parts;
    if (controlState[room] && CONTROL_TOPICS.includes(ctrl)) {
      controlState[room][ctrl] = msg === '1' || msg === 'on' || msg === 'true';
      console.log(`[CTRL] ${room}/${ctrl} → ${controlState[room][ctrl] ? 'ON' : 'OFF'}`);
    }
    return;
  }

  // Sensor data: room1/temp
  if (parts.length === 2) {
    const [room, sensor] = parts;
    if (sensorData[room] && SENSOR_TOPICS.includes(sensor)) {
      sensorData[room][sensor] = msg;
    }
  }
});

client.on('error', err => console.error('[MQTT] Error:', err.message));

// ── API: move robot ──
app.get('/move/:room', (req, res) => {
  const { room } = req.params;
  const valid = ['home', 'room1', 'room2'];

  if (!valid.includes(room)) {
    return res.status(400).json({ error: 'Invalid room. Use: home, room1, room2' });
  }

  client.publish('esp32/location', room, { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] Publish error:', err);
      return res.status(500).json({ error: 'MQTT publish failed' });
    }
    console.log(`[CMD] Dispatching robot → ${room}`);
    res.json({ success: true, dispatched: room });
  });
});

// ── API: full status (robot + sensors + controls) ──
app.get('/status', (req, res) => {
  res.json({
    location: robotLocation,
    sensors:  sensorData,
    controls: controlState,
  });
});

// ── API: per-room sensor data ──
app.get('/sensors/:room', (req, res) => {
  const { room } = req.params;
  if (!sensorData[room]) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(sensorData[room]);
});

// ── API: toggle control (fan/led) ──
app.post('/control/:room/:device', (req, res) => {
  const { room, device } = req.params;

  if (!controlState[room]) {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (!CONTROL_TOPICS.includes(device)) {
    return res.status(400).json({ error: 'Invalid device. Use: fan, led' });
  }

  const state = req.body.state ? '1' : '0';
  client.publish(`${room}/${device}/set`, state, { qos: 1 }, (err) => {
    if (err) {
      return res.status(500).json({ error: 'MQTT publish failed' });
    }
    controlState[room][device] = !!req.body.state;
    console.log(`[CTRL] ${room}/${device}/set → ${state}`);
    res.json({ success: true, room, device, state: !!req.body.state });
  });
});

// ── API: health check ──
app.get('/health', (req, res) => {
  res.json({ ok: true, mqtt: client.connected, broker: BROKER_IP });
});

// ── Catch-all: serve React for any route ──
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});




// ── Start server ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Running at http://${BROKER_IP}:${PORT}`);
  console.log(`[SERVER] Health: http://${BROKER_IP}:${PORT}/health`);
});

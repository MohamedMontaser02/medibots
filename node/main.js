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
app.use(express.static('/home/respberry/medibots/dist'));

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

// ── MQTT Client ──
const client = mqtt.connect(BROKER_URI);
let robotLocation = 'home';

client.on('connect', () => {
  console.log('[MQTT] Connected to broker');
  client.subscribe('esp32/location', err => {
    if (!err) console.log('[MQTT] Subscribed to esp32/location');
  });
});

client.on('message', (topic, message) => {
  if (topic === 'esp32/location') {
    robotLocation = message.toString();
    console.log(`[MQTT] Robot arrived at: ${robotLocation}`);
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

  client.publish('esp32', room, { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] Publish error:', err);
      return res.status(500).json({ error: 'MQTT publish failed' });
    }
    console.log(`[CMD] Dispatching robot → ${room}`);
    res.json({ success: true, dispatched: room });
  });
});

// ── API: robot status ──
app.get('/status', (req, res) => {
  res.json({ location: robotLocation });
});

// ── API: health check ──
app.get('/health', (req, res) => {
  res.json({ ok: true, mqtt: client.connected, broker: BROKER_IP });
});

// ── Catch-all: serve React for any route ──
app.get('*', (req, res) => {
  res.sendFile('/home/respberry/medibots/dist/index.html');
});

// ── Start server ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Running at http://${BROKER_IP}:${PORT}`);
  console.log(`[SERVER] Health: http://${BROKER_IP}:${PORT}/health`);
});

#!/bin/bash
echo "--- Smart Hospital Starting ---"

# 1. Start hotspot
sudo nmcli dev wifi hotspot ifname wlan0 ssid raspberry password 12345678

sleep 3

# 2. Restart Mosquitto
sudo systemctl restart mosquitto
echo "[OK] Mosquitto started"

sleep 1

# 3. Start the server (serves website + handles robot commands)
sudo node ~/medibots/node/main.js

const { WebSocketServer } = require('ws');
const prisma = require('../config/database');

// mac_address → WebSocket 实例
const connections = new Map();

function setup(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/device' });

  wss.on('connection', async (ws, req) => {
    const auth = (req.headers['authorization'] || '').trim();
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    let device;
    try {
      device = await prisma.device.findFirst({ where: { device_key: token } });
    } catch {
      ws.close(4001, 'DB error');
      return;
    }
    if (!device) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const mac = device.mac_address;
    // 踢掉同一设备的旧连接
    const old = connections.get(mac);
    if (old && old.readyState === 1) old.close(4000, 'replaced');
    connections.set(mac, ws);

    try {
      await prisma.device.update({
        where: { mac_address: mac },
        data: { is_online: true, last_seen: new Date() },
      });
    } catch {}

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'hello') {
        try {
          await prisma.device.update({
            where: { mac_address: mac },
            data: {
              firmware: msg.firmware_version || device.firmware,
              capabilities: msg.capabilities ? JSON.stringify(msg.capabilities) : device.capabilities,
              last_seen: new Date(),
            },
          });
        } catch {}
        const latest = await prisma.device.findUnique({ where: { mac_address: mac } });
        ws.send(JSON.stringify({ type: 'hello_ack', is_bound: latest?.wechat_user_id != null }));

      } else if (msg.type === 'ping') {
        try {
          await prisma.device.update({
            where: { mac_address: mac },
            data: { last_seen: new Date() },
          });
        } catch {}
        ws.send(JSON.stringify({ type: 'pong' }));

      } else if (msg.type === 'status' || msg.type === 'event') {
        console.log(`[WS] ${mac} ${msg.type}:`, JSON.stringify(msg.payload));
      }
    });

    ws.on('close', async () => {
      if (connections.get(mac) === ws) connections.delete(mac);
      try {
        await prisma.device.update({
          where: { mac_address: mac },
          data: { is_online: false },
        });
      } catch {}
    });

    ws.on('error', (err) => {
      console.error(`[WS] ${mac} error:`, err.message);
    });

    console.log(`[WS] device connected: ${mac}`);
  });

  console.log('[WS] WebSocket 服务已启动，路径 /ws/device');
  return wss;
}

// 向设备推送指令，返回是否成功
function sendCommand(mac, payload) {
  const ws = connections.get(mac);
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type: 'command', payload }));
  return true;
}

function isConnected(mac) {
  const ws = connections.get(mac);
  return !!(ws && ws.readyState === 1);
}

module.exports = { setup, sendCommand, isConnected };

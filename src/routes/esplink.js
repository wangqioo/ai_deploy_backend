const router = require('express').Router();
const wechatAuth = require('../middleware/wechatAuth');
const svc = require('../services/wechatService');
const prisma = require('../config/database');
const policy = require('../services/deviceCommandPolicy');
const commandRouter = require('../services/deviceCommandRouter');

// ── 微信登录 ──────────────────────────────────────────────
// POST /api/auth/wechat  { code }
router.post('/auth/wechat', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ detail: 'code 不能为空' });
    const result = await svc.wechatLogin(code);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── 固件启动注册（无需认证）────────────────────────────────
// POST /api/ota/check  { mac, sn, board_type, firmware_version }
router.post('/ota/check', async (req, res, next) => {
  try {
    const { mac, board_type, firmware_version } = req.body;
    if (!mac) return res.status(400).json({ detail: 'mac 不能为空' });
    const { device_key } = await svc.bootRegister({ mac, board_type, firmware_version });
    const wsBase = process.env.WS_BASE_URL || `ws://localhost:${process.env.PORT || 8088}`;
    res.json({
      token: device_key,
      websocket_url: `${wsBase}/ws/device`,
      is_bound: false,
    });
  } catch (err) {
    next(err);
  }
});

// ── 设备接口（需要微信登录）──────────────────────────────
// GET /api/device/list
router.get('/device/list', wechatAuth, async (req, res, next) => {
  try {
    const devices = await svc.getDeviceList(req.wechatUser.userId);
    res.json({ devices });
  } catch (err) {
    next(err);
  }
});

// GET /api/device/lookup?mac_suffix=AABBCC
router.get('/device/lookup', wechatAuth, async (req, res, next) => {
  try {
    const { mac_suffix } = req.query;
    if (!mac_suffix || mac_suffix.length !== 6) {
      return res.status(400).json({ detail: 'mac_suffix 需为 6 位十六进制' });
    }
    const device = await svc.lookupDevice(mac_suffix);
    res.json(device);
  } catch (err) {
    if (err.message === 'device not found or not online') {
      return res.status(404).json({ detail: err.message });
    }
    next(err);
  }
});

// POST /api/device/bind  { mac }
router.post('/device/bind', wechatAuth, async (req, res, next) => {
  try {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ detail: 'mac 不能为空' });
    await svc.bindDevice(mac, req.wechatUser.userId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'device already bound to another user') {
      return res.status(409).json({ detail: err.message });
    }
    next(err);
  }
});

// POST /api/device/:mac/command  { payload }
// :mac 为 AA-BB-CC-DD-EE-FF 形式（冒号替换为连字符）
router.post('/device/:mac/command', wechatAuth, async (req, res, next) => {
  try {
    const mac = req.params.mac.replace(/-/g, ':');
    const { payload } = req.body;
    const device = await prisma.device.findUnique({ where: { mac_address: mac } });
    const decision = policy.canSendCommand({
      actor: { type: 'wechat', userId: req.wechatUser.userId },
      device,
      payload,
    });

    if (!decision.allowed) {
      return res.status(decision.statusCode).json({ detail: decision.reason });
    }

    const result = await commandRouter.send(mac, payload);
    if (result.status === 'offline') return res.status(503).json({ detail: '设备当前不在线' });
    if (result.status !== 'delivered') {
      return res.status(502).json({ detail: result.reason || 'command_delivery_failed' });
    }
    res.json({ ok: true, status: 'delivered' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

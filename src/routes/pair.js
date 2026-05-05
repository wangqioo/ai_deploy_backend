const express = require('express');
const prisma = require('../config/database');
const deviceVerifier = require('../middleware/deviceVerifier');
const { generatePairToken } = require('../utils/uuid');
const { success, error } = require('../utils/response');
const router = express.Router();

/**
 * POST /api/v1/pair/verify
 * 微信小程序扫描设备二维码后，发起配对流程
 * Body: { device_id }
 */
router.post('/verify', deviceVerifier, async (req, res, next) => {
  try {
    const { device_id } = req.body || {};
    if (!device_id) return res.status(400).json(error(40000, 'device_id不能为空'));

    // 检查是否已经配对过
    const existingDevice = await prisma.device.findFirst({ where: { device_id } });
    if (existingDevice?.is_paired) {
      return res.json(success({
        status: 'already_paired',
        device_name: existingDevice.name || '小智AI设备',
        paired_at: existingDevice.paired_at,
      }, '设备已配对'));
    }

    // 作废之前所有 pending 的 token
    await prisma.pairRecord.updateMany({
      where: { device_id, status: 'pending' },
      data: { status: 'failed' },
    });

    // 创建新的配对令牌（5分钟有效）
    const pair_token = generatePairToken();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.pairRecord.create({
      data: {
        device_id,
        mac_address: existingDevice?.mac_address || null,
        status: 'pending',
        pair_token,
        pair_token_expires_at: expires_at,
      },
    });

    res.json(success({
      device_id,
      pair_token,
      expires_at: expires_at.toISOString(),
      device_name: existingDevice?.name || '小智AI设备',
      firmware: existingDevice?.firmware || null,
    }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/pair/confirm
 * 用户在小程序确认配对
 * Body: { device_id, pair_token, openid }
 */
router.post('/confirm', async (req, res, next) => {
  try {
    const { device_id, pair_token, openid } = req.body || {};
    if (!device_id || !pair_token || !openid) {
      return res.status(400).json(error(40000, '缺少必要参数: device_id, pair_token, openid'));
    }

    // 查找有效的配对记录
    const pairRecord = await prisma.pairRecord.findFirst({
      where: {
        device_id,
        pair_token,
        status: 'pending',
        pair_token_expires_at: { gt: new Date() },
      },
    });

    if (!pairRecord) {
      return res.status(400).json(error(40001, '配对令牌无效或已过期'));
    }

    const now = new Date();

    // 更新配对记录为已完成
    await prisma.pairRecord.update({
      where: { id: pairRecord.id },
      data: { status: 'paired', openid },
    });

    // 如果设备已经注册（有 MAC 地址），同步更新设备状态
    if (pairRecord.mac_address) {
      await prisma.device.update({
        where: { mac_address: pairRecord.mac_address },
        data: { is_paired: true, paired_at: now },
      });
    }

    res.json(success({
      device_id,
      status: 'paired',
      paired_at: now.toISOString(),
    }, '配对成功'));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/pair/status/:deviceId
 * 设备或小程序轮询配对状态
 */
router.get('/status/:deviceId', async (req, res, next) => {
  try {
    const device = await prisma.device.findFirst({
      where: { device_id: req.params.deviceId },
      select: { is_paired: true, paired_at: true, api_key_id: true },
    });

    if (!device) {
      const record = await prisma.pairRecord.findFirst({
        where: { device_id: req.params.deviceId },
        orderBy: { created_at: 'desc' },
      });
      return res.json(success({ status: record?.status || 'unknown' }));
    }

    res.json(success({
      status: device.is_paired ? 'paired' : 'pending',
      paired_at: device.paired_at,
      has_api_key: !!device.api_key_id,
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

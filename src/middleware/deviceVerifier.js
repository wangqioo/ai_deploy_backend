const { verifyDeviceSign } = require('../utils/cert');

module.exports = (req, res, next) => {
  const { device_id, mac, sign } = req.body || {};

  // 签名字段全部存在才验证，缺失则跳过（可选安全加固）
  if (device_id && mac && sign) {
    try {
      if (!verifyDeviceSign(device_id, mac, sign)) {
        return res.status(403).json({ code: 40303, message: '设备签名验证失败' });
      }
    } catch {
      return res.status(403).json({ code: 40303, message: '设备签名验证失败' });
    }
  }

  next();
};

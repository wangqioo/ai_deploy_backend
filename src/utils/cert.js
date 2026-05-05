const crypto = require('crypto');

function verifyDeviceSign(deviceId, mac, sign) {
  const secret = process.env.DEVICE_SIGN_SECRET || 'default-dev-secret';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${deviceId}:${mac}`)
    .digest('hex');
  try {
    const signBuf = Buffer.from(sign);
    const expectedBuf = Buffer.from(expected);
    // timingSafeEqual throws when lengths differ, so guard first
    if (signBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(signBuf, expectedBuf);
  } catch {
    return false;
  }
}

module.exports = { verifyDeviceSign };

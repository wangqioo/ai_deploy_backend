const { bootRegister } = require('./wechatService');
const { normalizeVersion } = require('./firmwareVersionPolicy');

function getWebSocketBaseUrl() {
  return process.env.WS_BASE_URL || `ws://localhost:${process.env.PORT || 8088}`;
}

async function checkBootReport({ mac, board_type, firmware_version }) {
  const { device, device_key } = await bootRegister({
    mac,
    board_type,
    firmware_version: normalizeVersion(firmware_version),
  });
  const wsBase = getWebSocketBaseUrl();

  return {
    token: device_key,
    websocket_url: `${wsBase}/ws/device`,
    is_bound: device?.wechat_user_id != null,
    update_available: false,
    ota: null,
    retry_policy: {
      retry_after_seconds: 30,
    },
  };
}

module.exports = { checkBootReport, getWebSocketBaseUrl };

const defaultTransport = require('../ws/deviceWsManager');

function send(mac, payload, { transport = defaultTransport } = {}) {
  try {
    const delivered = transport.sendCommand(mac, payload);
    if (delivered) {
      return { delivered: true, status: 'delivered' };
    }

    return {
      delivered: false,
      status: 'offline',
      reason: 'device_offline',
    };
  } catch (error) {
    return {
      delivered: false,
      status: 'failed',
      reason: 'transport_error',
      error,
    };
  }
}

module.exports = { send };

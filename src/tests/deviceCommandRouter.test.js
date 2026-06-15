jest.mock('../ws/deviceWsManager', () => ({
  sendCommand: jest.fn(),
}));

const defaultTransport = require('../ws/deviceWsManager');

describe('DeviceCommandRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns delivered when default transport sendCommand succeeds', () => {
    defaultTransport.sendCommand.mockReturnValue(true);
    const router = require('../services/deviceCommandRouter');

    const result = router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' });

    expect(result).toEqual({ delivered: true, status: 'delivered' });
    expect(defaultTransport.sendCommand).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { type: 'reboot' }
    );
  });

  test('returns offline when default transport sendCommand returns false', () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const router = require('../services/deviceCommandRouter');

    const result = router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' });

    expect(result).toEqual({
      delivered: false,
      status: 'offline',
      reason: 'device_offline',
    });
  });

  test('returns failed when transport throws', () => {
    const error = new Error('ws failed');
    defaultTransport.sendCommand.mockImplementation(() => {
      throw error;
    });
    const router = require('../services/deviceCommandRouter');

    const result = router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' });

    expect(result).toEqual({
      delivered: false,
      status: 'failed',
      reason: 'transport_error',
      error,
    });
  });

  test('uses injected transport instead of the default ws manager', () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const transport = {
      sendCommand: jest.fn(() => true),
    };
    const router = require('../services/deviceCommandRouter');

    const result = router.send(
      'AA:BB:CC:DD:EE:FF',
      { type: 'volume', value: 30 },
      { transport }
    );

    expect(result).toEqual({ delivered: true, status: 'delivered' });
    expect(transport.sendCommand).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { type: 'volume', value: 30 }
    );
    expect(defaultTransport.sendCommand).not.toHaveBeenCalled();
  });
});

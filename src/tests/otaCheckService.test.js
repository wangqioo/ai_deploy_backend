jest.mock('../services/wechatService', () => ({
  bootRegister: jest.fn(),
}));

const wechatService = require('../services/wechatService');

describe('otaCheckService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('registers the boot report and returns backward-compatible websocket auth fields', async () => {
    process.env.WS_BASE_URL = 'ws://device.example.test';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        wechat_user_id: 42,
      },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    const result = await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });

    expect(wechatService.bootRegister).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
    expect(result).toEqual({
      token: 'device-token',
      websocket_url: 'ws://device.example.test/ws/device',
      is_bound: true,
      update_available: false,
      ota: null,
      retry_policy: {
        retry_after_seconds: 30,
      },
    });
  });

  test('uses localhost websocket base URL when WS_BASE_URL is not configured', async () => {
    delete process.env.WS_BASE_URL;
    process.env.PORT = '9090';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toMatchObject({
      websocket_url: 'ws://localhost:9090/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
    });
  });
});

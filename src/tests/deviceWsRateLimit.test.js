jest.mock('../services/rateLimiter', () => ({
  consume: jest.fn(),
}));

jest.mock('../config/database', () => ({
  device: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../services/devicePresence', () => ({
  markConnected: jest.fn(() => Promise.resolve()),
  markHeartbeat: jest.fn(() => Promise.resolve()),
  markDisconnected: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const { consume } = require('../services/rateLimiter');

describe('device WS AI rate limit helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns false when shared rate limiter denies the device', async () => {
    consume.mockResolvedValue(false);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    const allowed = await checkAiRateLimit('AA:BB:CC:DD:EE:FF');

    expect(allowed).toBe(false);
    expect(consume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      limit: 20,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:device-ai',
    });
  });

  test('returns true when shared rate limiter allows the device', async () => {
    consume.mockResolvedValue(true);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF')).resolves.toBe(true);
  });
});

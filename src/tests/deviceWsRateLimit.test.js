jest.mock('../config/redis', () => ({
  eval: jest.fn(),
}));

jest.mock('../config/database', () => ({
  device: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../utils/dbTime', () => ({
  touchDevice: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const redis = require('../config/redis');

describe('device WS AI rate limit helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns false when Redis token bucket denies the device', async () => {
    redis.eval.mockResolvedValue(0);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    const allowed = await checkAiRateLimit('AA:BB:CC:DD:EE:FF');

    expect(allowed).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:device-ai:AA:BB:CC:DD:EE:FF',
      20,
      60
    );
  });

  test('fails open when Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF')).resolves.toBe(true);
  });
});

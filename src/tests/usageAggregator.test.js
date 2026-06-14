jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../config/database', () => ({
  usageLog: {
    groupBy: jest.fn(),
  },
  apiKey: {
    findMany: jest.fn(),
  },
  usageHourly: {
    upsert: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { aggregateHour } = require('../jobs/usageAggregator');

describe('aggregateHour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('excludes usage logs with null api_key_id from key lookup and hourly upsert', async () => {
    prisma.usageLog.groupBy
      .mockResolvedValueOnce([
        {
          api_key_id: null,
          _count: { id: 2 },
          _sum: { input_tokens: 10, output_tokens: 4 },
        },
        {
          api_key_id: 'sk-real',
          _count: { id: 1 },
          _sum: { input_tokens: 3, output_tokens: 7 },
        },
      ])
      .mockResolvedValueOnce([
        { api_key_id: 'sk-real', success: true, _count: { id: 1 } },
      ]);
    prisma.apiKey.findMany.mockResolvedValue([
      { id: 'sk-real', tenant_id: 123 },
    ]);

    await aggregateHour(new Date('2026-06-14T08:00:00.000Z'));

    expect(prisma.usageLog.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          api_key_id: { not: null },
        }),
      })
    );
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['sk-real'] } },
      select: { id: true, tenant_id: true },
    });
    expect(prisma.usageHourly.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.usageHourly.upsert.mock.calls[0][0].create.api_key_id).toBe('sk-real');
  });
});

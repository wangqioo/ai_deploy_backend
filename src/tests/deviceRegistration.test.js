jest.mock('../config/database', () => ({
  device: {
    upsert: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { registerDevice } = require('../services/deviceService');

describe('registerDevice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers device metadata without consulting legacy pairing records', async () => {
    prisma.device.upsert.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      is_paired: false,
      tenant_id: null,
    });

    await registerDevice({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      firmware: '1.0.0',
      name: 'Desk Device',
    });

    expect(prisma.device.upsert).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      create: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
      update: {
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
    });
  });
});

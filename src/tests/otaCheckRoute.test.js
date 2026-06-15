const express = require('express');
const request = require('supertest');

jest.mock('../services/otaCheckService', () => ({
  checkBootReport: jest.fn(),
}));

const otaCheckService = require('../services/otaCheckService');
const esplinkRoutes = require('../routes/esplink');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', esplinkRoutes);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ detail: err.message });
  });
  return app;
}

describe('POST /api/ota/check', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('delegates boot report handling to otaCheckService', async () => {
    otaCheckService.checkBootReport.mockResolvedValue({
      token: 'device-token',
      websocket_url: 'ws://localhost:8088/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
      retry_policy: { retry_after_seconds: 30 },
    });

    const res = await request(app)
      .post('/api/ota/check')
      .send({
        mac: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esp32-s3-box',
        firmware_version: '2.4.1',
      });

    expect(res.status).toBe(200);
    expect(otaCheckService.checkBootReport).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
    expect(res.body).toEqual({
      token: 'device-token',
      websocket_url: 'ws://localhost:8088/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
      retry_policy: { retry_after_seconds: 30 },
    });
  });

  test('rejects boot reports without mac before calling the service', async () => {
    const res = await request(app).post('/api/ota/check').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'mac 不能为空' });
    expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
  });
});

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/adminAuth', () => (req, _res, next) => {
  req.admin = { username: 'admin', type: 'admin', role: 'admin' };
  next();
});

jest.mock('../services/firmwareReleaseService', () => ({
  createRelease: jest.fn(),
  listReleases: jest.fn(),
  setReleaseActive: jest.fn(),
}));

const firmwareReleaseService = require('../services/firmwareReleaseService');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/firmware', require('../routes/firmware'));
  app.use((err, _req, res, _next) => {
    res.status(err.code === 40000 ? 400 : err.code === 40900 ? 409 : 500).json({
      code: err.code || 50000,
      message: err.message,
    });
  });
  return app;
}

describe('firmware admin routes', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists firmware releases', async () => {
    firmwareReleaseService.listReleases.mockResolvedValue({
      list: [{ id: 1, board_type: 'esp32-s3-box', version: '2.5.0' }],
      total: 1,
    });

    const res = await request(app)
      .get('/api/v1/firmware/releases')
      .query({ boardType: 'esp32-s3-box', channel: 'stable', page: 2, pageSize: 10 });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.listReleases).toHaveBeenCalledWith({
      boardType: 'esp32-s3-box',
      channel: 'stable',
      page: 2,
      pageSize: 10,
    });
    expect(res.body.data.pagination.total).toBe(1);
  });

  test('clamps invalid pagination values when listing firmware releases', async () => {
    firmwareReleaseService.listReleases.mockResolvedValue({ list: [], total: 0 });

    const res = await request(app)
      .get('/api/v1/firmware/releases')
      .query({ page: -3, pageSize: -1 });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.listReleases).toHaveBeenCalledWith({
      boardType: undefined,
      channel: undefined,
      page: 1,
      pageSize: 1,
    });
  });

  test('creates firmware release', async () => {
    firmwareReleaseService.createRelease.mockResolvedValue({
      id: 1,
      board_type: 'esp32-s3-box',
      version: '2.5.0',
    });

    const payload = {
      board_type: 'esp32-s3-box',
      version: 'v2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    };
    const res = await request(app).post('/api/v1/firmware/releases').send(payload);

    expect(res.status).toBe(201);
    expect(firmwareReleaseService.createRelease).toHaveBeenCalledWith(payload);
    expect(res.body.data.version).toBe('2.5.0');
  });

  test('validates required create fields before service call', async () => {
    const res = await request(app).post('/api/v1/firmware/releases').send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('board_type/version/artifact_url/sha256 are required');
    expect(firmwareReleaseService.createRelease).not.toHaveBeenCalled();
  });

  test('toggles firmware release active state', async () => {
    firmwareReleaseService.setReleaseActive.mockResolvedValue({ id: 1, is_active: false });

    const res = await request(app)
      .patch('/api/v1/firmware/releases/1/active')
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.setReleaseActive).toHaveBeenCalledWith(1, false);
    expect(res.body.data.is_active).toBe(false);
  });

  test('rejects invalid active toggle payloads', async () => {
    const res = await request(app)
      .patch('/api/v1/firmware/releases/1/active')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('is_active must be boolean');
    expect(firmwareReleaseService.setReleaseActive).not.toHaveBeenCalled();
  });

  test('rejects invalid release ids when toggling active state', async () => {
    const res = await request(app)
      .patch('/api/v1/firmware/releases/foo/active')
      .send({ is_active: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('invalid release id');
    expect(firmwareReleaseService.setReleaseActive).not.toHaveBeenCalled();
  });
});

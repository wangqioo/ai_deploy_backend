const serverInstances = [];

jest.mock('ws', () => ({
  WebSocketServer: jest.fn(function WebSocketServer() {
    this.handlers = {};
    this.on = jest.fn((event, handler) => {
      this.handlers[event] = handler;
    });
    serverInstances.push(this);
  }),
}));

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

jest.mock('../services/devicePresence', () => ({
  markConnected: jest.fn(() => Promise.resolve()),
  markHeartbeat: jest.fn(() => Promise.resolve()),
  markDisconnected: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const prisma = require('../config/database');
const devicePresence = require('../services/devicePresence');

function createFakeSocket() {
  const handlers = {};
  return {
    readyState: 1,
    on: jest.fn((event, handler) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: jest.fn((event, handler) => {
      handlers[event] = (handlers[event] || []).filter((item) => item !== handler);
    }),
    emit: jest.fn((event, ...args) => {
      for (const handler of handlers[event] || []) handler(...args);
    }),
    emitClose: async function emitClose() {
      for (const handler of handlers.close || []) await handler();
    },
    close: jest.fn(),
    send: jest.fn(),
  };
}

describe('device WS presence integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverInstances.length = 0;
    prisma.device.findFirst.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_key: 'device-token',
    });
  });

  test('does not mark device offline when a replaced socket closes after a newer connection exists', async () => {
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const firstSocket = createFakeSocket();
    const secondSocket = createFakeSocket();

    await wss.handlers.connection(firstSocket, req);
    await wss.handlers.connection(secondSocket, req);
    devicePresence.markDisconnected.mockClear();

    await firstSocket.emitClose();

    expect(firstSocket.close).toHaveBeenCalledWith(4000, 'replaced');
    expect(devicePresence.markDisconnected).not.toHaveBeenCalled();

    await secondSocket.emitClose();

    expect(devicePresence.markDisconnected).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });
});

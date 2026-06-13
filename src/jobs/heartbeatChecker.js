const cron = require('node-cron');
const prisma = require('../config/database');

function start() {
  // 每60秒：把超过2分钟未心跳的设备标记为离线
  cron.schedule('* * * * *', async () => {
    try {
      const count = await prisma.$executeRaw`
        UPDATE devices
        SET is_online = false
        WHERE is_online = true
          AND last_seen < (NOW() - INTERVAL 2 MINUTE)
      `;
      if (count > 0) console.log(`[HeartbeatChecker] 标记 ${count} 台设备为离线`);
    } catch (err) {
      console.error('[HeartbeatChecker] 错误:', err.message);
    }
  });
}

module.exports = { start };

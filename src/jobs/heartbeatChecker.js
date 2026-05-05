const cron = require('node-cron');
const prisma = require('../config/database');

function start() {
  // 每60秒：把超过2分钟未心跳的设备标记为离线
  cron.schedule('* * * * *', async () => {
    try {
      const threshold = new Date(Date.now() - 2 * 60 * 1000);
      const { count } = await prisma.device.updateMany({
        where: { last_seen: { lt: threshold }, is_online: true },
        data: { is_online: false },
      });
      if (count > 0) console.log(`[HeartbeatChecker] 标记 ${count} 台设备为离线`);
    } catch (err) {
      console.error('[HeartbeatChecker] 错误:', err.message);
    }
  });
}

module.exports = { start };

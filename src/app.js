require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
}));

app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(requestId);

app.use('/api/v1', routes);

app.use(errorHandler);

const PORT = parseInt(process.env.PORT) || 8088;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] 小智AI后台API 启动，端口 ${PORT}`);
    console.log(`[Server] 环境: ${process.env.NODE_ENV || 'development'}`);

    // 启动定时任务
    require('./jobs/heartbeatChecker').start();
    require('./jobs/usageAggregator').start();
    require('./jobs/cleanupOldUsageLogs').start();
    console.log('[Jobs] 定时任务已启动');
  });
}

module.exports = app;

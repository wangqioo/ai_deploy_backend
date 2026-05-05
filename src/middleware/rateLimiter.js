const redis = require('../config/redis');

const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local current = tonumber(redis.call('GET', key) or 0)
  if current >= limit then return 0 end
  redis.call('INCR', key)
  if current == 0 then redis.call('EXPIRE', key, window) end
  return 1
`;

module.exports = (limit = 60, windowSec = 60) => {
  return async (req, res, next) => {
    const identifier = req.apiKey?.id || req.ip;
    const rkey = `ratelimit:${identifier}`;

    try {
      const result = await redis.eval(RATE_LIMIT_SCRIPT, 1, rkey, limit, windowSec);
      if (result === 0) {
        return res.status(429).json({ code: 42900, message: '请求过于频繁，请稍后再试' });
      }
    } catch {
      // Redis 不可用时放行，不阻断业务
    }

    next();
  };
};

const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);

  if (!token) {
    return res.status(401).json({ code: 40100, message: '未登录或登录已过期' });
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || 'xiaozhi-secret');
    next();
  } catch {
    res.status(401).json({ code: 40101, message: '登录令牌无效' });
  }
};

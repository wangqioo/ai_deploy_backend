# 小智AI后台管理系统 - 开发方案 v2

> 本文档供 AI Agent（Claude/Cloud）执行使用
> 负责范围：后端API + 管理后台前端
> 协作者：ESP32固件（其他人）、微信小程序（其他人）
>
> 版本：v2.0 | 更新：2026-05-04

---

## 1. 项目概述

### 1.1 项目背景

小智AI设备生态的运营管理平台，目标：
- **简化配网**：用户扫码配对，取代原有复杂配网流程
- **运营管控**：API Key管理 + 用量统计 + 多租户隔离
- **商业化基础**：为设备销售提供完整的SaaS管控能力

### 1.2 系统边界

```
┌─────────────────────────────────────────────────────────────┐
│                     ESP32设备群                              │
│               (固件由其他人负责)                              │
└────────────────────────┬────────────────────────────────┘
                         │  WebSocket / HTTP（设备直连或透传）
┌────────────────────────┴────────────────────────────────┐
│                     你们负责的部分                          │
│  ┌─────────────────┐         ┌────────────────────────┐  │
│  │  后端API        │         │  管理后台                │  │
│  │  (Node.js/      │         │  (React + Ant Design)   │  │
│  │   Express)      │         │  :8080                  │  │
│  │  :8088          │         │                         │  │
│  └─────────────────┘         └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  官方 xiaozhi-esp32-server                  │
│                  (MySQL + Redis)                           │
│         仅使用官方数据库，扩展自己的业务表                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈

| 模块 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 后端框架 | Express.js | **^4.22.1** | Node.js，锁定小版本，**禁止升级到Express 5** |
| 数据库 | MySQL | 8.x | 共用官方xiaozhi数据库，自己建扩展表 |
| ORM | Prisma | ^5.x | 类型安全，支持迁移 |
| Redis | redis / ioredis | ^5.x | Key缓存 + 分布式限流 |
| 管理后台 | React | 18.x | Vite 构建 |
| UI组件 | Ant Design | ^5.x | 经典后台模板 |
| 状态管理 | Zustand | ^4.x | 轻量 |
| HTTP客户端 | Axios | ^1.x | 管理后台调用后端API |
| 构建工具 | Vite | ^5.x | 前端构建 |
| 图表 | Ant Design Charts / ECharts | latest | 仪表盘图表 |
| 测试 | Jest + Supertest | latest | 后端单元/集成测试 |
| 包管理 | npm | — | 统一 |

> ⚠️ 经验教训：Express 必须锁定 `^4.22.1`，禁止自动升级到 Express 5（破坏性变更）
> ⚠️ account-manager 项目踩过此坑，详见 MEMORY.md

---

## 3. 数据库设计

### 3.1 扩展表结构（在官方xiaozhi数据库中新建）

```sql
-- ============================================
-- 租户表（多租户隔离）
-- ============================================
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL COMMENT '租户/客户名称',
  level ENUM('free', 'pro', 'enterprise') DEFAULT 'free' COMMENT '客户等级',
  daily_limit INTEGER DEFAULT 1000 COMMENT '每日API调用限额',
  monthly_limit INTEGER DEFAULT 10000 COMMENT '每月API调用限额',
  usage_alert_webhook TEXT COMMENT '用量告警Webhook URL',
  alert_threshold FLOAT DEFAULT 0.8 COMMENT '告警阈值（80%）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- API Key表
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(64) PRIMARY KEY COMMENT 'UUID格式API Key',
  tenant_id INTEGER NOT NULL COMMENT '所属租户',
  name VARCHAR(255) COMMENT 'Key名称，如"测试设备1"',
  mac_address VARCHAR(64) COMMENT '绑定MAC地址（可选）',
  device_limit INTEGER DEFAULT 1 COMMENT '允许绑定设备数量',
  daily_limit INTEGER COMMENT '单日额度限制',
  monthly_limit INTEGER COMMENT '单月额度限制',
  used_today INTEGER DEFAULT 0 COMMENT '今日已用',
  used_month INTEGER DEFAULT 0 COMMENT '本月已用',
  is_active BOOLEAN DEFAULT true COMMENT '是否启用',
  expires_at DATETIME COMMENT '过期时间（可选）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ============================================
-- 设备表（扩展官方设备表）
-- ============================================
CREATE TABLE IF NOT EXISTS devices (
  mac_address VARCHAR(64) PRIMARY KEY COMMENT '设备MAC地址',
  api_key_id VARCHAR(64) COMMENT '绑定的API Key',
  tenant_id INTEGER COMMENT '所属租户',
  device_id VARCHAR(128) COMMENT '设备唯一ID（二维码内容）',
  device_cert TEXT COMMENT '设备公钥证书（安全加固用）',
  name VARCHAR(255) COMMENT '设备名称',
  firmware VARCHAR(64) COMMENT '固件版本',
  last_seen DATETIME COMMENT '最后在线时间',
  is_online BOOLEAN DEFAULT false COMMENT '是否在线',
  is_paired BOOLEAN DEFAULT false COMMENT '是否已完成配对',
  paired_at DATETIME COMMENT '配对时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

-- ============================================
-- 调用记录表（用量统计）
-- ============================================
CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  api_key_id VARCHAR(64) NOT NULL COMMENT '使用的API Key',
  device_mac VARCHAR(64) COMMENT '设备MAC',
  device_id VARCHAR(128) COMMENT '设备唯一ID',
  model VARCHAR(64) COMMENT '调用的模型',
  input_tokens INTEGER DEFAULT 0 COMMENT '输入Token数',
  output_tokens INTEGER DEFAULT 0 COMMENT '输出Token数',
  latency_ms INTEGER COMMENT '响应延迟ms',
  success BOOLEAN DEFAULT true COMMENT '是否成功',
  error_msg TEXT COMMENT '错误信息（失败时）',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
  FOREIGN KEY (device_mac) REFERENCES devices(mac_address) ON DELETE SET NULL,
  INDEX idx_timestamp (timestamp),
  INDEX idx_api_key (api_key_id),
  INDEX idx_device (device_id)
) PARTITION BY RANGE (YEAR(timestamp) * 100 + MONTH(timestamp)) (
  PARTITION p202505 VALUES LESS THAN (202506),
  PARTITION p202506 VALUES LESS THAN (202507),
  PARTITION p202507 VALUES LESS THAN (202508),
  PARTITION p202508 VALUES LESS THAN (202509),
  PARTITION p202509 VALUES LESS THAN (202510),
  PARTITION p202510 VALUES LESS THAN (202511),
  PARTITION p202511 VALUES LESS THAN (202512),
  PARTITION p202512 VALUES LESS THAN (202601),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
-- ⚠️ 每月初需手动创建新分区，或使用存储过程自动管理

-- ============================================
-- 用量聚合表（每小时预计算汇总）
-- ============================================
CREATE TABLE IF NOT EXISTS usage_hourly (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  api_key_id VARCHAR(64) NOT NULL,
  tenant_id INTEGER NOT NULL,
  hour_timestamp DATETIME NOT NULL COMMENT '整点时间',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  UNIQUE KEY uk_key_hour (api_key_id, hour_timestamp),
  INDEX idx_tenant_hour (tenant_id, hour_timestamp),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);

-- ============================================
-- 配对记录表（小程序配对用）
-- ============================================
CREATE TABLE IF NOT EXISTS pair_records (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  device_id VARCHAR(128) NOT NULL COMMENT '设备唯一ID（二维码内容）',
  mac_address VARCHAR(64) COMMENT '配对后获得的MAC',
  openid VARCHAR(128) COMMENT '微信用户openid',
  tenant_id INTEGER COMMENT '分配给的租户',
  status ENUM('pending', 'paired', 'failed') DEFAULT 'pending' COMMENT '配对状态',
  pair_token VARCHAR(128) COMMENT '配对Token（一次性）',
  pair_token_expires_at DATETIME COMMENT '配对Token过期时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_device_id (device_id),
  INDEX idx_pair_token (pair_token),
  INDEX idx_openid (openid)
);
```

### 3.2 数据维护策略

| 策略 | 说明 |
|------|------|
| **分区表** | `usage_logs` 按月分区，到期直接 `DROP PARTITION` 删除旧数据 |
| **聚合预计算** | 每小时将明细数据聚合写入 `usage_hourly`，统计查询永远不扫明细表 |
| **定期归档** | 每天凌晨定时任务：聚合昨日数据 + 删除超过7天的明细记录 |
| **索引策略** | 主查询字段（timestamp、api_key_id、device_id）均建索引，避免全表扫描 |

---

## 4. 后端API设计

### 4.1 项目结构

```
xiaozhi-admin-backend/
├── src/
│   ├── app.js                    # Express 入口（v2版本路由前缀）
│   ├── config/
│   │   ├── database.js          # Prisma / MySQL 配置
│   │   └── redis.js            # Redis 客户端配置
│   ├── routes/
│   │   ├── index.js             # 路由汇总
│   │   ├── keys.js              # API Key管理
│   │   ├── tenants.js           # 租户管理
│   │   ├── devices.js          # 设备管理
│   │   ├── usage.js            # 用量统计
│   │   └── pair.js             # 配对接口（小程序用）
│   ├── services/
│   │   ├── keyService.js       # Key业务逻辑
│   │   ├── deviceService.js    # 设备业务逻辑
│   │   ├── usageService.js     # 用量业务逻辑
│   │   └── alertService.js     # 用量告警Webhook
│   ├── middleware/
│   │   ├── rateLimiter.js      # 分布式限流（Redis令牌桶）
│   │   ├── keyValidator.js     # Key验证中间件（带缓存）
│   │   ├── deviceVerifier.js   # 设备证书验签中间件
│   │   └── errorHandler.js     # 全局错误处理
│   ├── jobs/
│   │   ├── usageAggregator.js  # 用量聚合定时任务
│   │   ├── partitionManager.js # 分区管理定时任务
│   │   └── heartbeatChecker.js # 设备心跳检查
│   ├── utils/
│   │   ├── uuid.js             # UUID生成
│   │   ├── response.js          # 统一响应格式
│   │   └── cert.js             # 设备证书验签工具
│   └── tests/
│       ├── keys.test.js        # Key相关测试
│       ├── devices.test.js      # 设备相关测试
│       └── usage.test.js        # 用量相关测试
├── prisma/
│   └── schema.prisma           # Prisma schema
├── package.json
└── .env.example
```

### 4.2 API路由（v2，所有路由带版本前缀）

> ⚠️ 所有路径使用 `/api/v1/` 前缀，便于未来升级到 `/api/v2/` 不影响已有客户端

#### 租户管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tenants` | 租户列表（分页） |
| GET | `/api/v1/tenants/:id` | 租户详情 |
| POST | `/api/v1/tenants` | 创建租户 |
| PATCH | `/api/v1/tenants/:id` | 更新租户（含告警Webhook配置） |
| DELETE | `/api/v1/tenants/:id` | 删除租户 |

#### API Key管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/keys` | Key列表（分页，支持按租户/状态筛选） |
| GET | `/api/v1/keys/:id` | Key详情 |
| POST | `/api/v1/keys` | 生成新Key |
| PATCH | `/api/v1/keys/:id` | 更新Key权限/额度 |
| DELETE | `/api/v1/keys/:id` | 删除Key |
| POST | `/api/v1/keys/:id/reset-usage` | 重置用量计数 |

#### 设备管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/devices` | 设备列表（分页） |
| GET | `/api/v1/devices/:mac` | 设备详情 |
| POST | `/api/v1/devices/:mac/kick` | 强制设备下线 |
| POST | `/api/v1/devices/:mac/unbind` | 解绑设备 |
| GET | `/api/v1/devices/:mac/stats` | 设备调用统计 |

#### 用量统计
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/usage/summary` | 用量总览（今日/本月/总调用） |
| GET | `/api/v1/usage/daily` | 按日统计（折线图数据） |
| GET | `/api/v1/usage/monthly` | 按月统计 |
| GET | `/api/v1/usage/by-key/:keyId` | 按Key统计 |
| GET | `/api/v1/usage/by-model` | 按模型统计占比 |
| GET | `/api/v1/usage/logs` | 调用明细记录（分页，最多查7天） |

#### 运营数据（新增）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/operation/overview` | 运营概览（老板看板） |
| GET | `/api/v1/operation/top-tenants` | Top客户排行 |
| GET | `/api/v1/operation/active-devices` | 月活设备统计 |

#### 配对接口（小程序调用，无需认证）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/pair/verify` | 验证配对Token，查询设备信息 |
| POST | `/api/v1/pair/confirm` | 小程序确认配对，绑定设备 |

#### 健康检查
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 后端健康状态 |
| GET | `/api/v1/health/ready` | 就绪检查（含数据库 + Redis连通性） |

### 4.3 统一响应格式（v2）

```json
// 成功
{
  "code": 0,
  "data": { ... },
  "message": "success",
  "requestId": "req_abc123"  // 请求追踪ID
}

// 分页
{
  "code": 0,
  "data": {
    "list": [...],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100
    }
  },
  "message": "success",
  "requestId": "req_abc123"
}

// 错误
{
  "code": 40001,
  "message": "API Key已禁用",
  "requestId": "req_abc123",
  "details": {}  // 可选的详细错误信息
}
```

### 4.4 Key验证中间件 v2（含Redis缓存）

```javascript
// 缓存TTL=60秒，大幅减少数据库压力
const keyCache = new Map(); // 生产环境换用 Redis

async function validateApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ code: 40101, message: '缺少API Key', requestId: req.requestId });

  // 缓存查询
  let keyRecord = keyCache.get(key);
  if (!keyRecord || Date.now() > keyRecord._cachedAt + 60000) {
    keyRecord = await prisma.apiKeys.findUnique({ where: { id: key } });
    if (keyRecord) {
      keyRecord._cachedAt = Date.now();
      keyCache.set(key, keyRecord);
    }
  }

  if (!keyRecord) return res.status(401).json({ code: 40102, message: '无效的API Key', requestId: req.requestId });
  if (!keyRecord.is_active) return res.status(403).json({ code: 40301, message: 'API Key已禁用', requestId: req.requestId });
  if (keyRecord.expires_at && new Date() > keyRecord.expires_at) {
    return res.status(403).json({ code: 40302, message: 'API Key已过期', requestId: req.requestId });
  }
  if (keyRecord.used_today >= keyRecord.daily_limit) {
    return res.status(429).json({ code: 42901, message: '今日额度已用完', requestId: req.requestId });
  }
  if (keyRecord.used_month >= keyRecord.monthly_limit) {
    return res.status(429).json({ code: 42902, message: '本月额度已用完', requestId: req.requestId });
  }

  req.apiKey = keyRecord;
  next();
}
```

### 4.5 分布式限流（Redis令牌桶）

```javascript
// /src/middleware/rateLimiter.js
// 多进程/多实例共享限流计数，基于Redis原子操作
async function rateLimiter(key, limit = 10, windowSec = 60) {
  const redisKey = `ratelimit:${key}`;
  const now = Date.now();

  const script = `
    local current = redis.call('GET', KEYS[1])
    if current == false then
      redis.call('SET', KEYS[1], 1 .. '|' .. ARGV[1])
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return 1
    end
    local count = tonumber(string.match(current, '^%d+'))
    local lastTime = tonumber(string.match(current, '|%d+$'))
    local elapsed = (ARGV[1] - lastTime) / 1000
    local refillTokens = elapsed * ARGV[3] / ARGV[2]
    local tokens = math.min(ARGV[4], count + refillTokens)
    if tokens >= 1 then
      rediscall('SET', KEYS[1], math.floor(tokens) .. '|' .. ARGV[1])
      return 1
    end
    return 0
  `;

  const result = await redis.eval(script, 1, redisKey, now, windowSec, limit, limit, now);
  return result === 1;
}
```

### 4.6 设备在线心跳机制

```javascript
// 设备每次请求时，更新 last_seen，标记为在线
async function updateHeartbeat(deviceMac) {
  await prisma.devices.update({
    where: { mac_address: deviceMac },
    data: { last_seen: new Date(), is_online: true }
  });
}

// 后台定时任务：每60秒检查一次，last_seen > 120秒标记离线
// /src/jobs/heartbeatChecker.js
async function checkDeviceHeartbeat() {
  const threshold = new Date(Date.now() - 120000); // 2分钟
  await prisma.devices.updateMany({
    where: { last_seen: { lt: threshold }, is_online: true },
    data: { is_online: false }
  });
}
```

### 4.7 用量告警Webhook

```javascript
// /src/services/alertService.js
async function checkAndAlert(tenant, todayUsed) {
  const threshold = tenant.daily_limit * tenant.alert_threshold;
  if (todayUsed >= threshold && tenant.usage_alert_webhook) {
    await fetch(tenant.usage_alert_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        today_used: todayUsed,
        daily_limit: tenant.daily_limit,
        percentage: Math.round((todayUsed / tenant.daily_limit) * 100),
        alert_type: todayUsed >= tenant.daily_limit ? 'over_limit' : 'warning'
      })
    });
  }
}
```

### 4.8 设备证书验签（安全加固）

```javascript
// /src/middleware/deviceVerifier.js
// 简化版：验证 device_id + mac 的签名一致性（生产环境用设备证书）
async function verifyDeviceSignature(req, res, next) {
  const { device_id, mac, sign } = req.body;
  if (!device_id || !mac || !sign) return next(); // 可选字段，不强制

  const expectedSign = crypto
    .createHmac('sha256', process.env.DEVICE_SIGN_SECRET)
    .update(`${device_id}:${mac}`)
    .digest('hex');

  if (sign !== expectedSign) {
    return res.status(403).json({ code: 40303, message: '设备签名验证失败' });
  }
  next();
}
```

### 4.9 定时任务清单

| 任务 | 频率 | 说明 |
|------|------|------|
| `usageAggregator` | 每小时 | 将上一小时明细聚合到 `usage_hourly` |
| `partitionManager` | 每月初 | 自动创建新分区、删除过期分区 |
| `heartbeatChecker` | 每60秒 | 标记离线设备 |
| `cleanupOldUsageLogs` | 每天凌晨 | 删除7天前明细数据（保留聚合表） |

---

## 5. 管理后台设计

### 5.1 项目结构

```
xiaozhi-admin-frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── api/
│   │   └── index.js            # Axios 实例 + API方法（/api/v1/前缀）
│   ├── pages/
│   │   ├── Dashboard/          # 总览仪表盘
│   │   ├── Tenants/            # 租户管理
│   │   ├── ApiKeys/            # API Key管理
│   │   ├── Devices/           # 设备管理
│   │   ├── Usage/              # 用量统计
│   │   └── Login/              # 登录页
│   ├── components/
│   │   ├── Layout/             # 后台布局框架
│   │   └── common/             # 通用表格/表单组件
│   └── store/
│       └── index.js            # Zustand 状态
├── package.json
└── vite.config.js
```

### 5.2 页面功能

#### 仪表盘（首页）
- 今日调用量 / 本月调用量 / 总设备数 / 在线设备数（4个数字卡片）
- 近7天调用量折线图
- 调用量Top5 Key
- 设备在线状态分布（饼图）
- **新增**：今日新增配对设备数
- **新增**：收入估算（按调用量×单价简单估算）

#### 租户管理
- 租户列表（表格 + 分页 + 搜索）
- 新建/编辑租户（表单弹窗，含告警Webhook配置）
- 删除租户（二次确认）

#### API Key管理
- Key列表（表格 + 分页 + 按租户/状态筛选）
- 生成新Key（选择租户、设置额度）
- 编辑Key（额度调整、启用/禁用）
- 删除Key
- 查看Key调用统计

#### 设备管理
- 设备列表（MAC、设备名、固件版本、在线状态、绑定Key）
- 设备在线状态实时显示（每30秒刷新）
- 强制下线 / 解绑设备
- 设备调用排名

#### 用量统计
- 时间范围筛选
- 按日/按月切换
- 折线图展示趋势
- 按模型占比饼图
- 调用明细表格（可导出CSV）

#### 运营概览（新增）
- 今日新增设备趋势折线图
- 月活设备数量
- Top3 客户调用量排行
- 收入估算趋势

### 5.3 UI规范

- 主题：Ant Design 深色/浅色（跟随系统）
- 布局：侧边栏导航 + 顶部面包屑
- 表格：统一分页、统一操作列
- 表单：弹窗式编辑
- 图表：Ant Design Charts（基于 G2Plot）
- 请求：统一带 `requestId`，错误时方便定位问题

### 5.4 SDK封装（供小程序/设备厂商使用）

```javascript
// /sdk/xiaozhi-sdk.js
class XiaozhiSDK {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async pair(deviceId) {
    return this.request('/api/v1/pair/verify', { device_id: deviceId });
  }

  async getUsage(keyId) {
    return this.request(`/api/v1/usage/by-key/${keyId}`);
  }

  async request(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message);
    return json.data;
  }
}
```

---

## 6. 开发计划

### Phase 1：后端基础设施（2-3天）
1. 搭建 Express 项目骨架，锁定 `^4.22.1`
2. Prisma 配置 + MySQL 建表（含分区）
3. Redis 连接配置
4. 统一响应格式 + 全局错误处理
5. `requestId` 中间件（请求追踪）
6. Jest 测试骨架

### Phase 2：核心业务 + 性能优化（3-4天）
1. API Key CRUD + Redis 缓存验证
2. Redis 分布式令牌桶限流
3. 用量记录写入 + 聚合定时任务
4. 用量告警 Webhook
5. 设备心跳机制
6. 单元测试覆盖

### Phase 3：安全加固（1-2天）
1. 设备签名验证中间件
2. 配对接口安全性加强
3. Key 绑定 MAC 逻辑强化

### Phase 4：管理后台（4-5天）
1. React 项目骨架 + Ant Design 配置
2. 仪表盘（含运营概览）
3. 租户管理页面（含告警配置）
4. API Key管理页面
5. 设备管理页面（含在线状态刷新）
6. 用量统计页面（含CSV导出）
7. API 版本前缀统一

### Phase 5：运营增强（1-2天）
1. 运营概览页面
2. 多语言SDK示例文档
3. 自动化冒烟测试

### Phase 6：部署（1-2天）
1. 后端部署到 Spark2（PM2 或 Docker）
2. 前端构建 + 部署
3. FRP 穿透配置（:8088 / :8080）
4. 每日数据备份策略

---

## 7. 部署信息

| 环境 | 地址 | 说明 |
|------|------|------|
| 后端API | `http://150.158.146.192:6002:8088` | Spark2 |
| 管理后台 | `http://150.158.146.192:6002:8080` | 同Spark2 |
| 数据库 | 官方xiaozhi MySQL（复用） | :3306 |
| Redis | 官方xiaozhi Redis（复用） | :6379 |
| FRP管理 | http://150.158.146.192:6128 | 隧道穿透 |

---

## 8. 关键设计决策汇总

| 决策 | 选择 | 原因 |
|------|------|------|
| Express版本 | 锁定 `^4.22.1` | 踩过 Express 5 破坏性变更的坑 |
| 数据库 | 复用官方 MySQL | 不重复搭建，节省资源 |
| 用量日志 | 分区表 + 聚合预计算 | 不做会因数据量爆炸导致查询卡顿 |
| 限流 | Redis令牌桶 | 多进程部署必备，内存Map不共享 |
| Key缓存 | Redis TTL=60s | 高并发下减少数据库IO，命中率>95% |
| API版本 | `/api/v1/` 前缀 | 未来可平滑升级接口，不破坏已有客户端 |
| SDK | 多语言封装 | 降低第三方对接成本 |
| 设备安全 | 签名验签 | MAC可伪造，密码学签名伪造不了 |
| 告警 | Webhook方式 | 可对接任何告警渠道（钉钉/企微/飞书） |
| 测试 | Jest + Supertest | 防止改一处挂三处，长期质量保障 |

---

## 9. 参考文档

- [account-manager 项目经验](/C:\Users\19051\Desktop\ai_deploy\account manager) — Express 4.22.1 锁定经验
- [xinnan-tech/xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) — 官方后端参考
- [xiaozhi通信协议](https://ccnphfhqs21z.feishu.cn/wiki/M0XiwldO9iJwHikpXD5cEx71nKh) — 飞书Wiki

---

*文档版本：v2.0 | 最后更新：2026-05-04*

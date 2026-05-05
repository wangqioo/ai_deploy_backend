# 小智AI后台管理系统 - 开发方案

> 本文档供 AI Agent（Claude/Cloud）执行使用
> 负责范围：后端API + 管理后台前端
> 协作者：ESP32固件（其他人）、微信小程序（其他人）

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
| 后端框架 | Express.js | ^4.22.1 | Node.js，参考 account-manager 项目的经验 |
| 数据库 | MySQL | 8.x | 共用官方xiaozhi数据库，自己建扩展表 |
| ORM | Prisma | ^5.x | 类型安全，支持迁移 |
| 管理后台 | React | 18.x | Vite 构建 |
| UI组件 | Ant Design | ^5.x | 经典后台模板 |
| 状态管理 | Zustand | ^4.x | 轻量 |
| HTTP客户端 | Axios | ^1.x | 管理后台调用后端API |
| 构建工具 | Vite | ^5.x | 前端构建 |
| 包管理 | npm | — | 统一 |

> ⚠️ 经验教训：Express 必须锁定 `^4.22.1`，禁止自动升级到 Express 5（破坏性变更）

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
  expires_at DATETIME COMMENT '配对Token过期时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_device_id (device_id),
  INDEX idx_pair_token (pair_token),
  INDEX idx_openid (openid)
);
```

---

## 4. 后端API设计

### 4.1 项目结构

```
xiaozhi-admin-backend/
├── src/
│   ├── app.js                    # Express 入口
│   ├── config/
│   │   └── database.js          # Prisma / MySQL 配置
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
│   │   └── usageService.js     # 用量业务逻辑
│   ├── middleware/
│   │   ├── rateLimiter.js      # 并发限流
│   │   ├── keyValidator.js     # Key验证中间件
│   │   └── errorHandler.js     # 全局错误处理
│   └── utils/
│       ├── uuid.js             # UUID生成
│       └── response.js          # 统一响应格式
├── prisma/
│   └── schema.prisma           # Prisma schema
├── package.json
└── .env.example
```

### 4.2 API路由

#### 租户管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tenants | 租户列表（分页） |
| GET | /api/tenants/:id | 租户详情 |
| POST | /api/tenants | 创建租户 |
| PATCH | /api/tenants/:id | 更新租户 |
| DELETE | /api/tenants/:id | 删除租户 |

#### API Key管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/keys | Key列表（分页，支持按租户筛选） |
| GET | /api/keys/:id | Key详情 |
| POST | /api/keys | 生成新Key |
| PATCH | /api/keys/:id | 更新Key权限/额度 |
| DELETE | /api/keys/:id | 删除Key |
| POST | /api/keys/:id/reset-usage | 重置用量计数 |

#### 设备管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/devices | 设备列表（分页） |
| GET | /api/devices/:mac | 设备详情 |
| POST | /api/devices/:mac/kick | 强制设备下线 |
| POST | /api/devices/:mac/unbind | 解绑设备 |

#### 用量统计
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/usage/summary | 用量总览（今日/本月/总调用） |
| GET | /api/usage/daily | 按日统计（折线图数据） |
| GET | /api/usage/monthly | 按月统计 |
| GET | /api/usage/by-key/:keyId | 按Key统计 |
| GET | /api/usage/by-model | 按模型统计占比 |
| GET | /api/usage/logs | 调用明细记录（分页） |

#### 配对接口（小程序调用，无需认证）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/pair/verify | 验证配对Token，查询设备信息 |
| POST | /api/pair/confirm | 小程序确认配对，绑定设备 |

#### 健康检查
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 后端健康状态 |

### 4.3 统一响应格式

```json
// 成功
{
  "code": 0,
  "data": { ... },
  "message": "success"
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
  "message": "success"
}

// 错误
{
  "code": 40001,
  "message": "API Key已禁用"
}
```

### 4.4 Key验证中间件（核心）

```javascript
// 设备请求时验证
async function validateApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ code: 40101, message: '缺少API Key' });

  const keyRecord = await prisma.apiKeys.findUnique({ where: { id: key } });
  if (!keyRecord) return res.status(401).json({ code: 40102, message: '无效的API Key' });
  if (!keyRecord.is_active) return res.status(403).json({ code: 40301, message: 'API Key已禁用' });
  if (keyRecord.expires_at && new Date() > keyRecord.expires_at) {
    return res.status(403).json({ code: 40302, message: 'API Key已过期' });
  }
  if (keyRecord.used_today >= keyRecord.daily_limit) {
    return res.status(429).json({ code: 42901, message: '今日额度已用完' });
  }
  if (keyRecord.used_month >= keyRecord.monthly_limit) {
    return res.status(429).json({ code: 42902, message: '本月额度已用完' });
  }

  req.apiKey = keyRecord;
  next();
}
```

### 4.5 并发限流（令牌桶）

```javascript
// 基于内存的简单限流（生产环境建议用 Redis）
const tokenBuckets = new Map(); // key → { tokens, lastRefill }

function rateLimiter(key, limit = 10, refillRate = 1) {
  const now = Date.now();
  const bucket = tokenBuckets.get(key) || { tokens: limit, lastRefill: now };
  
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;
  tokenBuckets.set(key, bucket);

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
```

---

## 5. 管理后台设计

### 5.1 项目结构

```
xiaozhi-admin-frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── api/
│   │   └── index.js            # Axios 实例 + API方法
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

#### 租户管理
- 租户列表（表格 + 分页 + 搜索）
- 新建/编辑租户（表单弹窗）
- 删除租户（二次确认）

#### API Key管理
- Key列表（表格 + 分页 + 按租户/状态筛选）
- 生成新Key（选择租户、设置额度）
- 编辑Key（额度调整、启用/禁用）
- 删除Key
- 查看Key调用统计

#### 设备管理
- 设备列表（MAC、设备名、固件版本、在线状态、绑定Key）
- 设备在线状态实时显示
- 强制下线 / 解绑设备

#### 用量统计
- 时间范围筛选
- 按日/按月切换
- 折线图展示趋势
- 按模型占比饼图
- 调用明细表格（可导出CSV）

### 5.3 UI规范

- 主题：Ant Design 深色/浅色（跟随系统）
- 布局：侧边栏导航 + 顶部面包屑
- 表格：统一分页、统一操作列
- 表单：弹窗式编辑
- 图表：Ant Design Charts（基于 G2Plot）

---

## 6. 开发计划

### Phase 1：后端基础（1-2天）
1. 搭建 Express 项目骨架
2. Prisma 配置 + 建表
3. 基础 CRUD（租户、Key）
4. 统一响应格式 + 错误处理

### Phase 2：核心业务（2-3天）
1. API Key 验证中间件
2. 并发限流（令牌桶）
3. 用量记录写入
4. 用量统计 API

### Phase 3：设备与配对（1-2天）
1. 设备管理 API
2. 配对接口 API
3. 心跳保活机制

### Phase 4：管理后台（3-4天）
1. React 项目骨架 + Ant Design 配置
2. 仪表盘（ECharts 图表）
3. 租户管理页面
4. API Key管理页面
5. 设备管理页面
6. 用量统计页面

### Phase 5：部署（1天）
1. 后端部署到 Spark2（PM2 / Docker）
2. 前端构建 + 部署
3. FRP 穿透配置
4. 域名/证书配置

---

## 7. 部署信息

| 环境 | 地址 | 说明 |
|------|------|------|
| 后端API | `http://150.158.146.192:6002:8088` | Spark2 |
| 管理后台 | `http://150.158.146.192:6002:8080` | 同Spark2 |
| 数据库 | 官方xiaozhi MySQL（复用） | :3306 |
| FRP管理 | http://150.158.146.192:6128 | 隧道穿透 |

---

## 8. 参考文档

- [account-manager 项目经验](/C:\Users\19051\Desktop\ai_deploy\account manager) — Express 4.22.1 锁定经验
- [xinnan-tech/xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) — 官方后端参考
- [xiaozhi通信协议](https://ccnphfhqs21z.feishu.cn/wiki/M0XiwldO9iJwHikpXD5cEx71nKh) — 飞书Wiki

---

*文档版本：v1.0 | 最后更新：2026-05-04*

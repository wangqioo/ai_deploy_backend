# 小智AI 后台管理系统

基于 ESP32 的 AI 硬件设备运营管控平台。用户购买设备后，通过微信小程序扫描设备二维码即可完成配对，无需手动配网。平台提供 API Key 管理、用量统计、多租户隔离等完整 SaaS 管控能力。

---

## 功能特性

- **扫码配对** — 微信小程序扫描设备二维码，一键完成设备与用户的绑定，取代繁琐的 WiFi 配网流程
- **多租户管理** — 支持按客户/团队隔离，每个租户独立的 API Key 池和用量配额
- **API Key 管控** — 生成、启停、限额、过期时间，支持 Redis 缓存加速验证（命中率 >95%）
- **设备管理** — 实时在线状态、心跳检测、强制下线、设备解绑、手动分配 Key
- **用量统计** — 今日/本月调用量、趋势图、模型占比、调用明细（支持导出 CSV）
- **用量告警** — 达到阈值时向租户配置的 Webhook 推送告警（支持钉钉/企微/飞书）
- **分布式限流** — 基于 Redis 令牌桶，多进程部署下共享限流计数
- **数据分层** — 明细日志按月分区，每小时预聚合，统计查询永远不扫全表

---

## 系统架构

```
微信小程序                    ESP32 设备
    │  扫码 → pair/verify        │  注册 → devices/register
    │  确认 → pair/confirm       │  心跳 → last_seen 更新
    └──────────────┬─────────────┘
                   ▼
        ┌─────────────────────┐
        │   后端 API (8088)   │  Express 4.x + Prisma + Redis
        │   /api/v1/...       │
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │  管理后台 (5173)    │  React 18 + Ant Design 5
        │  仪表盘/租户/Key/   │
        │  设备/用量统计      │
        └─────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  官方 xiaozhi DB    │  MySQL 8 + Redis（复用）
        │  + 扩展业务表       │
        └─────────────────────┘
```

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 后端框架 | Express.js | ^4.22.1（锁定，禁止升级至 v5） |
| ORM | Prisma | ^5.x |
| 缓存 / 限流 | Redis (ioredis) | ^5.x |
| 数据库 | MySQL | 8.x |
| 前端框架 | React + Vite | 18.x / ^5.x |
| UI 组件库 | Ant Design | ^5.x |
| 图表 | Recharts | ^2.x |
| 状态管理 | Zustand | ^4.x |
| HTTP 客户端 | Axios | ^1.x |

---

## 数据库表结构

| 表名 | 说明 |
|---|---|
| `tenants` | 租户，含每日/月限额和告警 Webhook |
| `api_keys` | API Key，含用量计数和过期时间 |
| `devices` | 设备，以 MAC 地址为主键，记录在线状态和配对信息 |
| `pair_records` | 配对记录，存储二维码 device_id 与用户 openid 的绑定过程 |
| `usage_logs` | 调用明细，按月分区，保留 7 天 |
| `usage_hourly` | 每小时预聚合，统计查询的主要数据源 |

---

## API 概览

> 所有路由均带 `/api/v1/` 版本前缀。管理接口需在 `Authorization: Bearer <token>` 头中携带登录令牌；配对接口无需认证。

| 模块 | 路径 | 说明 |
|---|---|---|
| 认证 | `POST /auth/login` | 管理员登录 |
| 租户 | `GET/POST/PATCH/DELETE /tenants` | 租户 CRUD |
| API Key | `GET/POST/PATCH/DELETE /keys` | Key 管理 |
| 设备 | `GET /devices` | 设备列表 |
| 设备 | `POST /devices/register` | 固件自注册（无需认证） |
| 设备 | `POST /devices/:mac/kick` | 强制下线 |
| 设备 | `POST /devices/:mac/unbind` | 解绑 |
| 配对 | `POST /pair/verify` | 小程序发起配对（无需认证） |
| 配对 | `POST /pair/confirm` | 小程序确认配对（无需认证） |
| 配对 | `GET /pair/status/:deviceId` | 查询配对状态 |
| 用量 | `GET /usage/summary` | 汇总统计 |
| 用量 | `GET /usage/daily` | 按天趋势 |
| 用量 | `GET /usage/logs` | 调用明细（7天内） |
| 运营 | `GET /operation/overview` | 运营大盘 |
| 健康 | `GET /health/ready` | 就绪检查（含 DB + Redis） |

---

## 设备配对流程

```
1. 设备出厂时二维码内含唯一 device_id
2. 用户微信扫码 → 小程序获得 device_id
3. 小程序调用 POST /api/v1/pair/verify  →  返回 pair_token（5分钟有效）
4. 用户在小程序确认绑定
5. 小程序调用 POST /api/v1/pair/confirm  →  配对完成，openid 与设备绑定
6. 设备开机后调用 POST /api/v1/devices/register（携带 mac_address + device_id）
7. 后端自动关联配对记录，设备进入已配对状态
```

---

## 定时任务

| 任务 | 频率 | 说明 |
|---|---|---|
| 心跳检测 | 每分钟 | 超过 2 分钟无心跳的设备标记为离线 |
| 用量聚合 | 每小时第5分钟 | 将上一小时明细聚合到 `usage_hourly` |
| 明细清理 | 每天凌晨2点 | 删除 7 天前的 `usage_logs` 明细 |

---

## 项目结构

```
backend/
├── src/
│   ├── app.js              # 入口
│   ├── config/             # Prisma + Redis 客户端
│   ├── middleware/         # requestId / adminAuth / keyValidator / rateLimiter
│   ├── routes/             # auth / tenants / keys / devices / usage / pair / operation
│   ├── services/           # 业务逻辑层
│   └── jobs/               # 定时任务
├── prisma/
│   └── schema.prisma
├── admin-frontend/         # React 管理后台
│   └── src/
│       ├── pages/          # Dashboard / Tenants / ApiKeys / Devices / Usage / Login
│       ├── api/            # Axios 封装
│       └── store/          # Zustand 全局状态
└── .env.example
```

---

## License

MIT

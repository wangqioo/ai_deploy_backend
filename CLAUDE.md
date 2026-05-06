# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

小氧AI (XiaoZhi AI) backend management system — a SaaS operations platform for ESP32 AI device fleets. This repo owns the **backend API** (`src/`, Express.js on port 8088) and the **admin frontend** (`admin-frontend/`, React + Ant Design on port 5173 dev / 8080 prod). ESP32 firmware and WeChat mini-program are owned by other teams.

The system extends the official `xiaozhi-esp32-server` database (MySQL + Redis) with custom tables — it does **not** run its own database server.

**EspLink 集成（2026-05-05 完成）**：已与团队的 EspLink BLE 配网系统打通。ESP32 固件通过 `/api/ota/check` 注册并获取 WebSocket 地址；微信小程序通过 `/api/auth/wechat`、`/api/device/*` 完成登录、设备发现和绑定；后端提供 `/ws/device` WebSocket 长连接供固件使用。EspLink 路由挂载在 `/api/`（无 v1 前缀），与管理路由 `/api/v1/` 并存。

**LLM 代理（2026-05-06 完成）**：后端现在是多厂商大模型代理。管理员在 `llm_providers` 表中配置各厂商 API Key，每个租户分配一个 `ai_model`（即套餐）。设备通过 WebSocket 发送 `ai_chat` 消息，后端流式调用对应厂商 API，逐 chunk 推回设备。支持 DeepSeek、GLM、MiniMax、Moonshot、通义千问、火山引擎、OpenAI，均通过 `openai` npm 包 + 自定义 `baseURL` 驱动。

## 当前环境状态（2026-05-06）✅ 全部完成

> **本地环境已全部配置完成，前后端均已验证可登录。**

| 服务 | 状态 | 说明 |
|---|---|---|
| MySQL 9.7.0 | ✅ 运行中 | Scoop 安装，port 3306，root/xiaozhi123 |
| Redis 8.6.2 | ✅ 运行中 | Scoop 安装，port 6379，无密码 |
| 数据库表 | ✅ 完成 | `npm run db:push` 已建 8 张扩展表（含 llm_providers） |
| 后端 API | ✅ 运行中 | `npm run dev`，port 8088 |
| 管理前端 | ✅ 运行中 | `npm run dev`，port 5173，已验证可登录 |

**管理后台登录：** http://localhost:5173 — 用户名 `admin` / 密码 `xiaozhi123`

> **注意：** 系统代理（Clash，port 7897）不影响浏览器访问 localhost，但会导致 curl 出现 502，属正常现象。

## 下次开机重启服务

MySQL 和 Redis 不是系统服务，重启电脑后需手动重启：

```powershell
# 刷新 PATH（每次新开终端都需要）
$env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"

# 启动 Redis（后台）
Start-Process -FilePath "redis-server" -WindowStyle Hidden

# 启动 MySQL（后台）
Start-Process -FilePath "mysqld" -ArgumentList "--standalone" -WindowStyle Hidden

# 等几秒，然后启动后端
cd C:\Users\19051\Desktop\ai_deploy\backend
npm run dev

# 另开终端启动前端
cd C:\Users\19051\Desktop\ai_deploy\backend\admin-frontend
npm run dev
```

## 当前 .env 配置
```
DATABASE_URL="mysql://root:xiaozhi123@localhost:3306/xiaozhi"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
DEFAULT_AI_MODEL=deepseek-chat
```

---

## Critical Constraints

- **Express must stay at `^4.22.1`** — never upgrade to Express 5. Breaking changes burned us in `account-manager`. Already pinned in `package.json`.
- Management API routes use the `/api/v1/` prefix. **EspLink-compatible routes use `/api/` (no v1)** — this is intentional for firmware/mini-program compatibility.
- Rate limiting **must** use Redis — multi-process deploys share no in-memory state.
- **Prisma `groupBy` does not support relation filters in `where`** — always resolve related IDs first (e.g. fetch `api_key_id` list for a tenant), then filter with `{ api_key_id: { in: [...] } }`. Affected functions: `getStatsByModel`, `getDailyStats` fallback.
- **WebSocket requires `http.createServer`** — `app.listen()` was replaced with `http.createServer(app)` + `wsManager.setup(server)`. Do not revert to `app.listen()` or WebSocket will break.
- **Device MAC in URLs** — EspLink routes encode MAC as `AA-BB-CC-DD-EE-FF` (dashes, not colons) to avoid Express route-param conflicts. Always `replace(/-/g, ':')` when querying the DB.
- **LLM provider registry is static** — `src/config/llmProviders.js` is the source of truth for supported providers and models. Adding a new vendor requires editing this file; the DB only stores the API key, not the baseURL.
- **`usage_logs.api_key_id` is nullable** — AI chat via WebSocket doesn't go through keyValidator, so devices may have no api_key_id. Usage logging is skipped when api_key_id is null.
- **Stopping backend required before `db:push`** — Prisma regenerates the DLL client which is locked by the running process. Always stop `npm run dev` before running `npx prisma db push`.

## Development Commands

```bash
# Backend (run in repo root)
npm run dev          # nodemon, port 8088
npm start            # node, production
npm test             # jest --runInBand
npm run db:push      # sync schema to DB (no migration history) — stop backend first
npm run db:migrate   # prisma migrate dev
npm run db:studio    # Prisma Studio GUI

# Frontend (run in admin-frontend/)
npm run dev          # vite dev server, port 5173
npm run build        # output → admin-frontend/dist/
npm run preview      # preview built output
```

## Actual Project Structure

```
backend/
├── src/
│   ├── app.js                   # Express entry; http.createServer + WS setup; mounts /api/v1 and /api routers
│   ├── config/
│   │   ├── database.js          # Singleton PrismaClient (global.__prisma in dev)
│   │   ├── redis.js             # ioredis client, lazyConnect, graceful error handling
│   │   └── llmProviders.js      # Static registry: provider → baseURL + model list; MODEL_TO_PROVIDER index
│   ├── middleware/
│   │   ├── requestId.js         # Injects req.requestId; overrides res.json with spread to add requestId
│   │   ├── adminAuth.js         # JWT Bearer token verification for management routes
│   │   ├── wechatAuth.js        # JWT Bearer token verification for EspLink mini-program routes
│   │   ├── keyValidator.js      # API Key check with Redis TTL=60s cache
│   │   ├── rateLimiter.js       # Redis Lua token-bucket factory → returns middleware
│   │   ├── deviceVerifier.js    # Optional HMAC-SHA256 signature check (skips if fields absent)
│   │   └── errorHandler.js      # Maps Prisma P2025→404, P2002→409; hides stack in prod
│   ├── routes/
│   │   ├── index.js             # Mounts all sub-routers under /api/v1
│   │   ├── auth.js              # POST /auth/login, GET /auth/me (no adminAuth)
│   │   ├── health.js            # GET /health, GET /health/ready (DB + Redis ping)
│   │   ├── tenants.js           # CRUD; all behind adminAuth; includes ai_model field
│   │   ├── keys.js              # CRUD + reset-usage; all behind adminAuth
│   │   ├── devices.js           # POST /register (public); rest behind adminAuth
│   │   ├── usage.js             # summary/daily/by-key/by-model/logs; behind adminAuth
│   │   ├── pair.js              # verify/confirm/status — public, no auth required
│   │   ├── operation.js         # overview/top-tenants/active-devices; behind adminAuth
│   │   ├── llm.js               # GET /models; GET/PUT /providers/:p; PATCH /providers/:p/toggle
│   │   └── esplink.js           # EspLink 兼容路由（/api/ 前缀）：ota/check, auth/wechat, device/*
│   ├── services/
│   │   ├── keyService.js        # Key CRUD; invalidates Redis cache on write
│   │   ├── deviceService.js     # Device CRUD; registerDevice links pair_records on first boot
│   │   ├── usageService.js      # Stats queries; groupBy uses direct field filters only
│   │   ├── alertService.js      # Webhook POST when tenant usage ≥ alert_threshold
│   │   ├── operationService.js  # Overview + top-tenant + active-device aggregations
│   │   ├── wechatService.js     # WeChat code2session, bootRegister, lookupDevice, bindDevice
│   │   └── llmService.js        # streamChat() — OpenAI-SDK proxy with streaming; getModelForDevice()
│   ├── ws/
│   │   └── deviceWsManager.js   # WebSocket server on /ws/device; handles hello/ping/ai_chat/command
│   ├── jobs/
│   │   ├── heartbeatChecker.js  # Cron every minute; marks is_online=false after 2 min silence
│   │   ├── usageAggregator.js   # Cron 5 * * * *; rolls usage_logs → usage_hourly
│   │   └── cleanupOldUsageLogs.js # Cron 0 2 * * *; deletes logs older than 7 days
│   └── utils/
│       ├── uuid.js              # generateApiKey / generatePairToken / generateRequestId
│       ├── response.js          # success(data) / paginated(list,page,pageSize,total) / error(code,msg)
│       └── cert.js              # verifyDeviceSign — timingSafeEqual with length guard
├── prisma/schema.prisma         # 9 models: Tenant ApiKey Device UsageLog UsageHourly PairRecord WechatUser LlmProvider
├── admin-frontend/
│   ├── vite.config.js           # Proxies /api → http://localhost:8088
│   └── src/
│       ├── api/index.js         # Axios instance; auto-injects Bearer token; redirects on 401
│       ├── store/index.js       # Zustand persist: { token, username }
│       ├── components/Layout/   # Ant Design Sider + Header with user dropdown
│       └── pages/
│           ├── Login/           # POST /auth/login → stores token
│           ├── Dashboard/       # Summary cards + 7-day line chart + model pie + top-5 tenants
│           ├── Tenants/         # CRUD table; modal includes ai_model selector (grouped by provider)
│           ├── ApiKeys/         # CRUD table; toggle is_active via Switch; copy key button
│           ├── Devices/         # Table with online badge; 30s auto-refresh toggle; assign-key modal
│           ├── Usage/           # Stats cards + line chart + pie + paginated log table + CSV export
│           └── LlmConfig/       # Provider table; configure API Key modal; enable/disable toggle
└── .env.example
```

## API Response Format

`requestId` is injected automatically by `requestId.js` middleware into every `res.json()` call — routes do not need to add it manually.

```json
{ "code": 0, "data": { ... }, "message": "success", "requestId": "req_abc123" }
{ "code": 40001, "message": "API Key已禁用", "requestId": "req_abc123" }
{ "code": 0, "data": { "list": [...], "pagination": { "page": 1, "pageSize": 20, "total": 100 } }, "message": "success" }
```

## Device Pairing Flow

```
1. Device QR code encodes a unique device_id
2. User scans → mini-program calls POST /api/v1/pair/verify { device_id }
   → invalidates old pending tokens → creates pair_record with pair_token (5 min TTL)
3. User confirms → mini-program calls POST /api/v1/pair/confirm { device_id, pair_token, openid }
   → pair_record.status = 'paired'; updates device.is_paired if MAC already known
4. Device boots → calls POST /api/v1/devices/register { mac_address, device_id, firmware }
   → links to paired pair_record; sets is_paired = true
5. Poll status via GET /api/v1/pair/status/:deviceId
```

## EspLink 集成接口

EspLink 路由挂载在 `/api/`（无 v1 前缀），与管理路由并存。

| 方法 | 路径 | 认证 | 调用方 | 说明 |
|---|---|---|---|---|
| POST | `/api/auth/wechat` | 无 | 小程序 | 微信 code 换 JWT |
| POST | `/api/ota/check` | 无 | 固件 | 设备启动注册，返回 `token` + `websocket_url` |
| GET | `/api/device/list` | wechatAuth | 小程序 | 用户已绑定设备列表 |
| GET | `/api/device/lookup?mac_suffix=AABBCC` | wechatAuth | 小程序 | 按 MAC 后三字节查找刚上线设备 |
| POST | `/api/device/bind` | wechatAuth | 小程序 | 绑定设备到当前微信用户 |
| POST | `/api/device/:mac/command` | wechatAuth | 小程序 | 通过 WebSocket 下发指令（`:mac` 用 `-` 代替 `:`） |
| WS | `/ws/device` | device_key | 固件 | 设备长连接，支持 hello/ping/ai_chat/command |

## LLM 代理接口

管理接口挂载在 `/api/v1/llm/`，均需 adminAuth。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/llm/models` | 所有支持模型列表（含厂商分组） |
| GET | `/api/v1/llm/providers` | 所有厂商配置状态（API Key 脱敏） |
| PUT | `/api/v1/llm/providers/:provider` | 新增或覆盖厂商 API Key |
| PATCH | `/api/v1/llm/providers/:provider/toggle` | 启用 / 禁用厂商 |

## WebSocket 消息格式（完整）

```
固件 → 服务器: { type: "hello", capabilities, firmware_version, session_id }
服务器 → 固件: { type: "hello_ack", is_bound: bool }

固件 → 服务器: { type: "ping" }
服务器 → 固件: { type: "pong" }

固件 → 服务器: { type: "ai_chat", session_id: "abc", messages: [{role, content}, ...] }
服务器 → 固件: { type: "ai_chunk", session_id: "abc", delta: "你好" }   ← 流式，多条
服务器 → 固件: { type: "ai_done",  session_id: "abc", usage: { input_tokens, output_tokens } }
服务器 → 固件: { type: "ai_error", session_id: "abc", error: "..." }

服务器 → 固件: { type: "command", payload: {...} }
```

**device_key 生命周期**：首次 `POST /api/ota/check` 时生成 64 位随机 hex，存入 `devices.device_key`，后续同一 MAC 复用同一 key。固件将其存入 NVS，WebSocket 连接时放入 `Authorization: Bearer` 头。

## LLM 支持厂商

| 厂商 | provider key | baseURL | 示例模型 |
|---|---|---|---|
| DeepSeek | `deepseek` | api.deepseek.com | deepseek-chat, deepseek-reasoner |
| 智谱 GLM | `glm` | open.bigmodel.cn/api/paas/v4/ | glm-4-flash, glm-4-plus |
| MiniMax | `minimax` | api.minimax.chat/v1 | MiniMax-Text-01 |
| Moonshot/Kimi | `moonshot` | api.moonshot.cn/v1 | moonshot-v1-8k |
| 通义千问 | `qwen` | dashscope.aliyuncs.com/compatible-mode/v1 | qwen-turbo, qwen-max |
| 火山引擎 | `volcano` | ark.cn-beijing.volces.com/api/v3 | doubao-pro-4k |
| OpenAI | `openai` | api.openai.com/v1 | gpt-4o-mini, gpt-4o |

所有厂商均通过 `openai` npm 包驱动（OpenAI 兼容接口），无需额外 SDK。新增厂商只需在 `src/config/llmProviders.js` 中添加条目。

## Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| Express version | Lock `^4.22.1` | Prior incident with Express 5 breaking changes |
| HTTP server | `http.createServer(app)` | Required for WebSocket (`ws` lib) to attach to same port |
| Stats queries | `usage_hourly` first, fallback to `usage_logs` | Aggregation table empty on fresh deploy; fallback prevents blank charts |
| `groupBy` tenant filter | Pre-fetch key IDs, use `api_key_id: { in }` | Prisma `groupBy` rejects relation filters at runtime |
| Rate limiting | Redis Lua token-bucket | Shared state across processes |
| Key cache | Redis TTL=60s | Reduces DB I/O; invalidated on every write |
| Device signature | HMAC-SHA256 `device_id:mac`, optional | MAC is spoofable; signature optional so unpatched firmware still works |
| Alert delivery | Webhook POST to per-tenant URL | Decoupled from notification channel |
| `requestId` injection | Middleware overrides `res.json` with spread | Routes stay clean; no manual threading of requestId |
| WeChat JWT | Same `JWT_SECRET`, `type: 'wechat'` claim | Reuse secret; `wechatAuth` middleware rejects `type: 'admin'` tokens |
| MAC in URL | Dashes `AA-BB-CC-DD-EE-FF` | Colons break Express `:param` parsing |
| LLM driver | `openai` npm + custom `baseURL` | All 7 supported vendors are OpenAI-compatible; one package covers all |
| LLM provider config | DB table `llm_providers`, static registry in code | Keys in DB (sensitive); URL/model list in code (versioned) |
| LLM model per tenant | `tenants.ai_model` field | Model selection = package differentiation; no extra tables needed |
| LLM streaming | WebSocket `ai_chunk` messages | Device already has persistent WS; avoids second HTTP connection |
| `usage_logs.api_key_id` nullable | Changed to `String?` | AI chat bypasses keyValidator; devices may have no api_key assigned |

## Database Tables

| Table | Key detail |
|---|---|
| `tenants` | PK: `id` (int). Has `usage_alert_webhook` + `alert_threshold` + `ai_model` (which LLM model this tenant uses) |
| `api_keys` | PK: `id` (varchar 64, `sk-` prefix UUID). FK → tenants |
| `devices` | PK: `mac_address`. `device_id` = QR-code identifier. `device_key` = 64-hex WebSocket auth token. `board_type`/`capabilities` = EspLink 设备元数据. `wechat_user_id` = FK → wechat_users |
| `usage_logs` | Kept 7 days only. `api_key_id` is nullable (AI chat via WS has no key). Relation filters work in `findMany`/`count` but NOT in `groupBy` |
| `usage_hourly` | Unique on `(api_key_id, hour_timestamp)`. Primary stats source |
| `pair_records` | Tracks QR-code pairing lifecycle: `pending → paired / failed` |
| `wechat_users` | PK: `id` (int). `openid` UNIQUE. 微信用户，通过 EspLink 小程序登录创建 |
| `llm_providers` | PK: `id` (int). `provider` UNIQUE (e.g. "deepseek"). Stores API Key per vendor. Admin-managed. |

## Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `heartbeatChecker` | `* * * * *` | `is_online=false` if `last_seen` > 2 min ago |
| `usageAggregator` | `5 * * * *` | Rolls last hour of `usage_logs` → `usage_hourly` |
| `cleanupOldUsageLogs` | `0 2 * * *` | Deletes `usage_logs` older than 7 days |

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string |
| `REDIS_HOST` / `REDIS_PORT` | Yes | Redis connection |
| `JWT_SECRET` | Yes | Shared by admin JWT and WeChat JWT (different `type` claim) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Yes | Management console login |
| `DEVICE_SIGN_SECRET` | No | If absent, device signatures are skipped |
| `CORS_ORIGIN` | No | Comma-separated allowed origins; defaults to `*` |
| `PORT` | No | Defaults to 8088 |
| `WX_APPID` | No | 微信小程序 AppID；留空则启用 dev 模式（code 直接当 openid） |
| `WX_SECRET` | No | 微信小程序 AppSecret；生产必填 |
| `WS_BASE_URL` | No | 返回给固件的 WebSocket 基础地址，默认 `ws://localhost:8088`；生产改为 `wss://your-domain` |
| `DEFAULT_AI_MODEL` | No | 租户未分配模型时的全局默认，默认 `deepseek-chat` |

## Deployment Target

- **Spark2 server**: `150.158.146.192` via FRP tunnel
- Backend: port 8088 | Admin frontend: port 8080 (prod build served by nginx/serve)
- Shares MySQL (:3306) and Redis (:6379) with official xiaozhi-esp32-server

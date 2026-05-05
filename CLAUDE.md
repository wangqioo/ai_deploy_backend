# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

小智AI (XiaoZhi AI) backend management system — a SaaS operations platform for ESP32 AI device fleets. This repo owns the **backend API** (`src/`, Express.js on port 8088) and the **admin frontend** (`admin-frontend/`, React + Ant Design on port 5173 dev / 8080 prod). ESP32 firmware and WeChat mini-program are owned by other teams.

The system extends the official `xiaozhi-esp32-server` database (MySQL + Redis) with custom tables — it does **not** run its own database server.

## Critical Constraints

- **Express must stay at `^4.22.1`** — never upgrade to Express 5. Breaking changes burned us in `account-manager`. Already pinned in `package.json`.
- All API routes use the `/api/v1/` prefix.
- Rate limiting **must** use Redis — multi-process deploys share no in-memory state.
- **Prisma `groupBy` does not support relation filters in `where`** — always resolve related IDs first (e.g. fetch `api_key_id` list for a tenant), then filter with `{ api_key_id: { in: [...] } }`. Affected functions: `getStatsByModel`, `getDailyStats` fallback.

## Development Commands

```bash
# Backend (run in repo root)
npm run dev          # nodemon, port 8088
npm start            # node, production
npm test             # jest --runInBand
npm run db:push      # sync schema to DB (no migration history)
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
│   ├── app.js                   # Express entry; mounts /api/v1 router; starts cron jobs
│   ├── config/
│   │   ├── database.js          # Singleton PrismaClient (global.__prisma in dev)
│   │   └── redis.js             # ioredis client, lazyConnect, graceful error handling
│   ├── middleware/
│   │   ├── requestId.js         # Injects req.requestId; overrides res.json with spread to add requestId
│   │   ├── adminAuth.js         # JWT Bearer token verification for management routes
│   │   ├── keyValidator.js      # API Key check with Redis TTL=60s cache
│   │   ├── rateLimiter.js       # Redis Lua token-bucket factory → returns middleware
│   │   ├── deviceVerifier.js    # Optional HMAC-SHA256 signature check (skips if fields absent)
│   │   └── errorHandler.js      # Maps Prisma P2025→404, P2002→409; hides stack in prod
│   ├── routes/
│   │   ├── index.js             # Mounts all sub-routers under /api/v1
│   │   ├── auth.js              # POST /auth/login, GET /auth/me (no adminAuth)
│   │   ├── health.js            # GET /health, GET /health/ready (DB + Redis ping)
│   │   ├── tenants.js           # CRUD; all behind adminAuth
│   │   ├── keys.js              # CRUD + reset-usage; all behind adminAuth
│   │   ├── devices.js           # POST /register (public); rest behind adminAuth
│   │   ├── usage.js             # summary/daily/by-key/by-model/logs; behind adminAuth
│   │   ├── pair.js              # verify/confirm/status — public, no auth required
│   │   └── operation.js         # overview/top-tenants/active-devices; behind adminAuth
│   ├── services/
│   │   ├── keyService.js        # Key CRUD; invalidates Redis cache on write
│   │   ├── deviceService.js     # Device CRUD; registerDevice links pair_records on first boot
│   │   ├── usageService.js      # Stats queries; groupBy uses direct field filters only
│   │   ├── alertService.js      # Webhook POST when tenant usage ≥ alert_threshold
│   │   └── operationService.js  # Overview + top-tenant + active-device aggregations
│   ├── jobs/
│   │   ├── heartbeatChecker.js  # Cron every minute; marks is_online=false after 2 min silence
│   │   ├── usageAggregator.js   # Cron 5 * * * *; rolls usage_logs → usage_hourly
│   │   └── cleanupOldUsageLogs.js # Cron 0 2 * * *; deletes logs older than 7 days
│   └── utils/
│       ├── uuid.js              # generateApiKey / generatePairToken / generateRequestId
│       ├── response.js          # success(data) / paginated(list,page,pageSize,total) / error(code,msg)
│       └── cert.js              # verifyDeviceSign — timingSafeEqual with length guard
├── prisma/schema.prisma         # 6 models: Tenant ApiKey Device UsageLog UsageHourly PairRecord
├── admin-frontend/
│   ├── vite.config.js           # Proxies /api → http://localhost:8088
│   └── src/
│       ├── api/index.js         # Axios instance; auto-injects Bearer token; redirects on 401
│       ├── store/index.js       # Zustand persist: { token, username }
│       ├── components/Layout/   # Ant Design Sider + Header with user dropdown
│       └── pages/
│           ├── Login/           # POST /auth/login → stores token
│           ├── Dashboard/       # Summary cards + 7-day line chart + model pie + top-5 tenants
│           ├── Tenants/         # CRUD table with modal form
│           ├── ApiKeys/         # CRUD table; toggle is_active via Switch; copy key button
│           ├── Devices/         # Table with online badge; 30s auto-refresh toggle; assign-key modal
│           └── Usage/           # Stats cards + line chart + pie + paginated log table + CSV export
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

## Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| Express version | Lock `^4.22.1` | Prior incident with Express 5 breaking changes |
| Stats queries | `usage_hourly` first, fallback to `usage_logs` | Aggregation table empty on fresh deploy; fallback prevents blank charts |
| `groupBy` tenant filter | Pre-fetch key IDs, use `api_key_id: { in }` | Prisma `groupBy` rejects relation filters at runtime |
| Rate limiting | Redis Lua token-bucket | Shared state across processes |
| Key cache | Redis TTL=60s | Reduces DB I/O; invalidated on every write |
| Device signature | HMAC-SHA256 `device_id:mac`, optional | MAC is spoofable; signature optional so unpatched firmware still works |
| Alert delivery | Webhook POST to per-tenant URL | Decoupled from notification channel |
| `requestId` injection | Middleware overrides `res.json` with spread | Routes stay clean; no manual threading of requestId |

## Database Tables

| Table | Key detail |
|---|---|
| `tenants` | PK: `id` (int). Has `usage_alert_webhook` + `alert_threshold` |
| `api_keys` | PK: `id` (varchar 64, `sk-` prefix UUID). FK → tenants |
| `devices` | PK: `mac_address`. `device_id` is the QR-code identifier (not PK) |
| `usage_logs` | Kept 7 days only. Relation filters work in `findMany`/`count` but NOT in `groupBy` |
| `usage_hourly` | Unique on `(api_key_id, hour_timestamp)`. Primary stats source |
| `pair_records` | Tracks pairing lifecycle: `pending → paired / failed` |

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
| `JWT_SECRET` | Yes | Change from default in production |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Yes | Management console login |
| `DEVICE_SIGN_SECRET` | No | If absent, device signatures are skipped |
| `CORS_ORIGIN` | No | Comma-separated allowed origins; defaults to `*` |
| `PORT` | No | Defaults to 8088 |

## Deployment Target

- **Spark2 server**: `150.158.146.192` via FRP tunnel
- Backend: port 8088 | Admin frontend: port 8080 (prod build served by nginx/serve)
- Shares MySQL (:3306) and Redis (:6379) with official xiaozhi-esp32-server

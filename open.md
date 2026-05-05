# 项目启动指南

## 前置要求

- Node.js 18+
- MySQL 8.x（复用官方 xiaozhi-esp32-server 的数据库）
- Redis（复用官方 xiaozhi-esp32-server 的 Redis）
- npm

---

## 第一步：配置环境变量

```bash
# 复制模板
cp .env.example .env
```

打开 `.env`，填入真实连接信息：

```env
# 数据库（改成你的 MySQL 地址/账号/密码）
DATABASE_URL="mysql://root:你的密码@localhost:3306/xiaozhi"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # 没有密码留空

# 管理员登录账号（自定义）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=xiaozhi123

# JWT 密钥（改成随机字符串）
JWT_SECRET=换一个随机字符串

# 设备签名密钥（改成随机字符串）
DEVICE_SIGN_SECRET=换一个随机字符串

# 前端地址（开发时默认 5173）
CORS_ORIGIN=http://localhost:5173
```

---

## 第二步：初始化数据库

在官方 xiaozhi 数据库中创建扩展表：

```bash
# 在 backend/ 目录下执行
npm run db:push
```

> 这会在你连接的 MySQL 数据库里新建 `tenants`、`api_keys`、`devices`、`usage_logs`、`usage_hourly`、`pair_records` 六张表，**不影响官方已有的表**。

---

## 第三步：启动后端

```bash
# 在 backend/ 目录下

# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

后端启动后监听 **http://localhost:8088**

看到以下输出说明启动成功：
```
[Server] 小智AI后台API 启动，端口 8088
[Redis] connected
[Jobs] 定时任务已启动
```

---

## 第四步：启动前端

**新开一个终端窗口**，进入前端目录：

```bash
cd admin-frontend

# 开发模式
npm run dev
```

前端启动后访问 **http://localhost:5173**

---

## 登录后台

打开浏览器访问 http://localhost:5173

默认账号（在 `.env` 中配置）：
- 用户名：`admin`
- 密码：`xiaozhi123`

---

## 生产部署（Spark2 服务器）

### 后端

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start src/app.js --name xiaozhi-backend

# 开机自启
pm2 save && pm2 startup
```

### 前端

```bash
cd admin-frontend

# 打包
npm run build

# 用 nginx 或 serve 托管 dist/ 目录
npx serve dist -p 8080
```

### nginx 反向代理参考配置

```nginx
server {
    listen 8080;

    # 前端静态文件
    location / {
        root /path/to/admin-frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 常用命令速查

| 命令 | 说明 |
|---|---|
| `npm run dev` | 后端开发模式启动 |
| `npm start` | 后端生产模式启动 |
| `npm test` | 运行测试 |
| `npm run db:push` | 同步数据库表结构 |
| `npm run db:studio` | 打开 Prisma Studio 可视化数据库 |
| `cd admin-frontend && npm run dev` | 前端开发模式 |
| `cd admin-frontend && npm run build` | 前端打包 |

---

## 常见问题

**Q: `npm run db:push` 报错 "Can't reach database server"**
检查 `.env` 里 `DATABASE_URL` 的 host/端口/密码是否正确，以及 MySQL 是否在运行。

**Q: Redis 连接失败但后端仍然启动**
Redis 断线时限流和 Key 缓存会自动降级（放行请求），不影响核心功能。检查 `REDIS_HOST` 配置。

**Q: 前端页面空白 / 接口 404**
确认后端已在 8088 端口运行。开发模式下 Vite 会自动把 `/api` 请求代理到 8088，无需额外配置。

**Q: 登录提示"用户名或密码错误"**
检查 `.env` 中 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 与你输入的是否一致，修改后需重启后端。

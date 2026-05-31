# JiahaoDrop 轻量快传

适合 2c2G 云服务器的小型私有文件快传服务。登录后上传文件生成接收码和分享链接，未登录用户可直接输入接收码或打开链接下载。

## 功能特性

- 登录后上传文件，生成 6 位接收码和分享链接
- 未登录用户在首页输入接收码或打开分享链接直接下载
- 文件默认 48 小时过期自动清理，支持自定义保留时长（1-720 小时或永久保留）
- 支持设置下载次数限制，达到上限后自动拒绝
- 多文件上传自动打包为 ZIP
- 管理后台：用户管理、系统设置、审计日志、SMTP 邮件
- 三级角色体系：超级管理员 / 管理员 / 普通用户
- 支持 SMTP 邮箱验证码登录和用户注册
- 响应式 UI，支持暗色/亮色主题切换

## 页面路由

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | `/` | 公开取件码输入 + 登录入口 |
| 发送 | `/app/send` | 登录后上传文件 |
| 接收 | `/app/receive` | 登录后输入接收码下载 |
| 我的文件 | `/app/files` | 文件管理（设置有效期、下载次数、删除） |
| 账号 | `/app/account` | 邮箱绑定 |
| 管理后台 | `/admin` | 系统管理（仅管理员） |
| 公开接收 | `/r/:code` | 分享链接落地页，无需登录 |

---

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                    Nginx 反向代理                      │
│            HTTPS · gzip · client_max_body_size        │
└──────────────────────┬───────────────────────────────┘
                       │ http://127.0.0.1:3000
┌──────────────────────▼───────────────────────────────┐
│                  Node.js (Express)                    │
│                                                      │
│  中间件栈:                                            │
│  helmet → compression → json → originGuard           │
│  → attachSession → csrfGuard → rateLimit → routes    │
│                                                      │
│  定时任务: 每 15 分钟清理过期文件/会话/日志             │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               文件系统 (零数据库)                      │
│                                                      │
│  data/                                               │
│  ├── state.json      用户·文件·会话·日志·设置          │
│  ├── .session-secret 会话签名密钥                     │
│  ├── storage/        上传文件实体 (随机化文件名)       │
│  └── tmp/            multer 临时文件                  │
└──────────────────────────────────────────────────────┘
```

### 后端

单文件 `server.js`，零框架依赖，仅 7 个 npm 包：

| 包 | 用途 |
|---|---|
| express | Web 框架 |
| multer | 文件上传 |
| helmet | 安全 HTTP 头 |
| compression | gzip 压缩 |
| express-rate-limit | 接口限流 |
| nodemailer | SMTP 邮件 |
| archiver | 多文件打包 ZIP |

### 前端

纯原生 HTML/CSS/JS，无构建步骤，无前端框架：

| 文件 | 说明 |
|---|---|
| `index.html` + `home.js` | 首页（取件码输入） |
| `login.html` + `login.js` | 登录/注册 |
| `app.html` + `app.js` | 主应用（上传、文件管理） |
| `receive.html` + `receive.js` | 公开接收页 |
| `admin.html` + `admin.js` | 管理后台 |
| `shared.js` | 共享工具（API、toast、格式化） |
| `theme.js` | 主题切换持久化 |
| `styles.css` | 全局样式（明/暗双主题） |

### 数据存储

所有状态存储在单个 `state.json` 中，采用原子写入（先写 `.tmp` 再 `rename`），防止写入中断导致数据损坏。

---

## 安全设计

| 层级 | 措施 |
|------|------|
| 传输 | HTTPS、HSTS、`X-Content-Type-Options: nosniff` |
| CSRF | Origin/Referer 校验 + `X-CSRF-Token` 请求头 |
| CSP | `default-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'` |
| 认证 | scrypt 密码哈希、HttpOnly + SameSite=Strict Cookie |
| 限流 | 登录 20次/15分钟、API 180次/分钟、公开下载 20次/分钟 |
| 暴力破解 | 5 次失败锁定（递增 1/5/15 分钟）、时序攻击防护 |
| 验证码 | 自绘 SVG、HMAC-SHA256 哈希、5 分钟过期 |
| 文件 | 禁止可执行文件上传、路径遍历防护、文件名消毒 |
| 存储 | SMTP 密码 AES-256-GCM 加密、目录权限 0o700 |
| 下载 | 原子 check-and-increment 防 TOCTOU 竞态 |

---

## 项目结构

```
├── server.js              后端主文件
├── package.json
├── .env.example           环境变量模板
├── nginx/
│   └── baota.conf.example 宝塔 Nginx 配置模板
├── public/                前端静态文件
│   ├── *.html             页面
│   ├── styles.css         样式
│   ├── *.js               脚本
│   └── favicon.svg        图标
└── data/                  运行时数据 (gitignore)
    ├── state.json
    ├── storage/
    └── tmp/
```

---

## 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | >= 20.x（推荐 LTS） |
| 操作系统 | Linux / Windows / macOS |
| 内存 | >= 512MB（推荐 2GB+） |
| 磁盘 | 根据上传文件量决定 |

---

## 快速开始

```bash
git clone https://github.com/jycf001/File-Transfer-Platform.git
cd File-Transfer-Platform
npm install
npm start
```

浏览器打开 `http://localhost:3000`，首次访问会进入初始化页面创建管理员。

### Linux 一键部署

项目内置 `deploy.sh` 脚本，自动完成依赖安装、环境配置、systemd 服务创建：

```bash
git clone https://github.com/jycf001/File-Transfer-Platform.git jiahaodrop
cd jiahaodrop
bash deploy.sh
```

脚本会自动检测 Node.js 版本、从 `.env.example` 生成 `.env` 并创建 `SESSION_SECRET`、生成 systemd 服务文件。执行完成后按提示编辑 `.env` 并启动：

```bash
nano .env                          # 设置域名、文件大小等
systemctl start jiahaodrop         # 启动服务
systemctl status jiahaodrop        # 查看状态
journalctl -u jiahaodrop -f        # 查看日志
```

> 详细部署文档见 [deploy.md](./deploy.md)，包含宝塔面板、Linux、Windows、macOS 的完整部署指南。

浏览器打开 `http://localhost:3000`，首次访问会进入初始化页面创建管理员。

---

## 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `PUBLIC_BASE_URL` | 空 | 公网域名（分享链接用） |
| `SESSION_SECRET` | 自动生成 | 会话密钥（生产环境必须设置） |
| `SESSION_HOURS` | 12 | 会话绝对有效期 |
| `SESSION_IDLE_MINUTES` | 30 | 会话空闲超时 |
| `MAX_FILE_SIZE_MB` | 512 | 单文件大小上限 (MB) |
| `MAX_FILES_PER_UPLOAD` | 10 | 单次最大上传文件数 |
| `RETENTION_HOURS` | 48 | 文件默认保留时长 |
| `STORAGE_QUOTA_MB` | 0 | 总存储限制 (MB)，0 不限 |
| `COOKIE_SECURE` | false | HTTPS 时设为 true |
| `TRUST_PROXY` | false | 反向代理时设为 true |

---

## 数据备份

所有运行时数据在 `data/` 目录下：

```
data/
├── state.json          用户、文件记录、设置、日志
├── .session-secret     会话密钥
├── storage/            上传的文件实体
└── tmp/                临时文件（可忽略）
```

备份整个 `data/` 目录即可。迁移时在新服务器执行 `npm install` 后将 `data/` 复制过去。

---

## 许可证

MIT

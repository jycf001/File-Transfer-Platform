# JiahaoDrop 轻量快传

适合 2c2G 云服务器的小型私有文件快传服务。登录后上传文件生成接收码和分享链接，未登录用户可直接输入接收码或打开链接下载。

## 功能

- 普通用户登录后上传和接收文件
- 管理员后台管理用户、系统设置、日志和邮件
- 上传后生成接收码和分享链接，支持二维码扫描
- 未登录用户可在首页输入接收码或打开分享链接直接下载
- 文件默认 48 小时过期自动清理
- 支持 SMTP 邮件通知、邮箱验证码登录
- 审计日志记录登录、上传、下载、删除、用户管理和设置变更
- 三级角色体系：超级管理员 / 管理员 / 普通用户

## 页面地址

| 页面 | 路径 |
|------|------|
| 首页（登录/公开接收） | `http://服务器IP:3000` |
| 登录后使用页 | `http://服务器IP:3000/app/send` |
| 管理后台 | `http://服务器IP:3000/admin` |
| 分享链接示例 | `https://你的域名/r/ABC123` |

---

## 环境要求

| 项目 | 最低要求 |
|------|---------|
| Node.js | >= 20.x（推荐 LTS） |
| 操作系统 | Linux / Windows / macOS |
| 内存 | >= 512MB（推荐 2GB+） |
| 磁盘 | 根据上传文件量决定 |

---

## 快速开始（本地体验）

### 1. 安装 Node.js

前往 https://nodejs.org 下载安装 **Node.js 20 LTS** 或更高版本。

安装完成后验证：

```bash
node -v   # 应输出 v20.x.x 或更高
npm -v
```

### 2. 下载项目

```bash
git clone https://github.com/jycf001/File-Transfer-Platform.git
cd File-Transfer-Platform
```

### 3. 安装依赖

```bash
npm install
```

这会根据 `package.json` 自动安装以下依赖：

| 包名 | 作用 |
|------|------|
| `express` | Web 框架，处理 HTTP 请求和路由 |
| `multer` | 处理文件上传（multipart/form-data） |
| `helmet` | 设置安全 HTTP 头（CSP、XSS 防护等） |
| `compression` | gzip 压缩响应，减少传输体积 |
| `express-rate-limit` | 接口限流，防止暴力破解和滥用 |
| `nodemailer` | 发送邮件（验证码、日志推送） |
| `archiver` | 打包多文件为 zip 供下载 |

安装完成后会生成 `node_modules/` 目录和 `package-lock.json` 文件。

### 4. 启动服务

```bash
npm start
```

看到类似输出即启动成功：

```
[JiahaoDrop] listening on 0.0.0.0:3000
```

浏览器打开 `http://localhost:3000` 即可访问。

---

## 首次部署：创建管理员

服务首次启动时没有任何用户，需要创建管理员账号。有三种方式：

### 方式一：Web 页面初始化（推荐）

1. 在项目根目录创建 `.env` 文件，添加初始化令牌：

```bash
INIT_TOKEN=你的初始化令牌（随意填写一个复杂字符串）
```

2. 启动服务：`npm start`
3. 浏览器打开 `http://服务器IP:3000`，会显示初始化页面
4. 输入你设置的 `INIT_TOKEN`，填写用户名、密码、邮箱，点击创建

> 设置 `INIT_TOKEN` 可防止公网暴露时被他人抢先创建管理员。

### 方式二：命令行初始化

```bash
node server.js --init
```

按提示输入用户名、密码、邮箱即可。无需公网访问。

### 方式三：环境变量自动初始化

在 `.env` 中设置以下变量，服务首次启动时会自动创建管理员：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码至少8位
ADMIN_EMAIL=admin@example.com
```

> 适合自动化部署。建议创建成功后删除这三个环境变量。

---

## 环境变量配置

在项目根目录创建 `.env` 文件（可参考 `.env.example`）：

```bash
# 服务监听
PORT=3000
HOST=0.0.0.0

# 数据目录
DATA_DIR=./data
STORAGE_DIR=./data/storage

# 公网访问域名（分享链接使用）
PUBLIC_BASE_URL=https://send.example.com

# 会话密钥（生产环境必须设置，至少 32 位随机字符串）
SESSION_SECRET=

# 会话有效期
SESSION_HOURS=12
SESSION_IDLE_MINUTES=30

# 文件限制
MAX_FILE_SIZE_MB=512
MAX_FILES_PER_UPLOAD=10

# 文件保留时间（小时）
RETENTION_HOURS=48

# 总存储空间限制（MB），0 表示不限制
STORAGE_QUOTA_MB=0

# 安全选项（HTTPS 反代后启用）
COOKIE_SECURE=false
TRUST_PROXY=false

# 管理员初始化（首次启动使用，创建后可删除）
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_EMAIL=
INIT_TOKEN=
```

生成随机密钥：

```bash
openssl rand -hex 32
```

---

## 生产部署

### 方式一：宝塔面板

1. 宝塔安装 **Node.js 版本管理器**，选择 Node.js 20.x
2. 上传项目到 `/www/wwwroot/jiahaodrop/`
3. 终端执行 `cd /www/wwwroot/jiahaodrop && npm install --production`
4. 创建 `.env` 配置文件，设置 `COOKIE_SECURE=true` 和 `TRUST_PROXY=true`
5. 宝塔 → **网站** → **Node项目** → **添加Node项目**，项目目录选 `/www/wwwroot/jiahaodrop`，启动文件填 `server.js`，端口填 `3000`
6. 宝塔 → **网站** → 找到你绑定域名的站点 → 点击**设置** → **反向代理** → **添加反向代理**：

| 配置项 | 填写内容 |
|-------|---------|
| 代理名称 | `jiahaodrop` |
| 目标URL | `http://127.0.0.1:3000` |
| 发送域名 | `$host` |

7. 提交后宝塔会自动生成 Nginx 配置，域名流量将转发到 Node 项目
8. 在站点设置中申请 SSL 证书，开启强制 HTTPS
9. 重启 Node 项目使 `.env` 生效

> **注意**：反向代理是在**网站站点**中配置，不是在 Node 项目中配置。两者是独立的，需要通过反向代理把域名和 Node 项目关联起来。

> **如果域名访问不生效**：宝塔自动生成的 Nginx 配置可能有问题（见下方说明）。可参考 `nginx/baota.conf.example` 手动替换站点配置。

#### 宝塔自动生成配置的常见问题

宝塔生成的 Nginx 配置可能存在以下问题，导致域名无法正常访问：

| 问题 | 说明 | 后果 |
|------|------|------|
| `listen 3000;` | Nginx 和 Node 项目同时监听 3000 端口 | 端口冲突，反向代理死循环 |
| 缺少 `X-Forwarded-Proto` | 应用无法识别客户端是否使用 HTTPS | Cookie 会话异常，HTTPS 下无法登录 |
| `Host` 头带端口 | `proxy_set_header Host $host:$server_port` | 应用生成的链接可能带多余端口号 |

**解决方式**：在站点设置 → 反向代理中删除自动生成的配置，参考项目中 `nginx/baota.conf.example` 手动填写 Nginx 配置文件。配置文件路径：

```
/www/server/panel/vhost/nginx/你的站点名.conf
```

替换后执行：

```bash
nginx -t && systemctl reload nginx
```

### 方式二：Linux 手动部署

```bash
# 1. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. 上传项目并安装依赖
cd /www/wwwroot/jiahaodrop
npm install --production

# 3. 创建 .env 并配置
cp .env.example .env
nano .env   # 编辑配置

# 4. 创建 systemd 服务
sudo tee /etc/systemd/system/jiahaodrop.service << 'EOF'
[Unit]
Description=JiahaoDrop File Transfer
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/www/wwwroot/jiahaodrop
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-/www/wwwroot/jiahaodrop/.env

[Install]
WantedBy=multi-user.target
EOF

# 5. 启动并设置开机自启
sudo systemctl daemon-reload
sudo systemctl enable jiahaodrop
sudo systemctl start jiahaodrop

# 6. 查看状态和日志
sudo systemctl status jiahaodrop
sudo journalctl -u jiahaodrop -f
```

### Nginx 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name send.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

server {
    listen 80;
    server_name send.example.com;
    return 301 https://$host$request_uri;
}
```

重载 Nginx：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> 更多部署细节见 [DEPLOY.md](./DEPLOY.md)

---

## 数据备份与迁移

所有运行时数据都在 `data/` 目录下：

```
data/
├── state.json          ← 用户、文件记录、设置、日志
├── .session-secret     ← 会话密钥
├── storage/            ← 上传的文件实体
└── tmp/                ← 临时文件（可忽略）
```

备份或迁移时，复制整个 `data/` 目录到新服务器即可保留所有账户和文件：

```bash
rsync -avz /旧路径/data/ 新服务器:/新路径/data/
```

> `.env` 需要在新服务器重新配置（域名/IP 不同）。`node_modules/` 不需要复制，在新服务器执行 `npm install` 即可。

---

## 常见问题

### 服务启动后打不开

1. 检查防火墙是否放行端口（默认 3000）
2. 云服务器需在安全组中放行端口
3. 检查服务是否正常：`curl http://127.0.0.1:3000/api/health`

### 域名访问显示其他页面或 502

1. 确认宝塔**网站**列表中有绑定该域名的站点
2. 进入该站点 → 设置 → 反向代理，确认已添加且目标为 `http://127.0.0.1:3000`
3. 确认 Node 项目正在运行（宝塔 Node 项目列表显示「运行中」）
4. 确认 `.env` 中 `PORT` 与反向代理目标端口一致（默认 3000）
5. 如果 Nginx 配置被覆盖，尝试删除反向代理后重新添加

### 上传文件失败

1. 检查 Nginx 的 `client_max_body_size` 是否足够
2. 检查 `.env` 中的 `MAX_FILE_SIZE_MB`
3. 检查磁盘空间是否充足

### 忘记管理员密码

- 有其他管理员：登录后台直接重置密码
- 无可用管理员：停止服务，备份 `data/state.json`，删除后重新初始化

### SMTP 邮件发送失败

1. 后台 → 设置 → SMTP 配置中填写正确的邮件服务器信息
2. 点击「发送测试邮件」验证
3. 检查服务器防火墙是否放行 SMTP 端口（465/587）

---

## 许可证

MIT

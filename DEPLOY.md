# JiahaoDrop 部署指南

## 目录

- [环境要求](#环境要求)
- [方式一：宝塔面板部署](#方式一宝塔面板部署)
- [方式二：Linux 手动部署](#方式二linux-手动部署)
- [Nginx 反向代理](#nginx-反向代理)
- [初始化管理员](#初始化管理员)
- [环境变量参考](#环境变量参考)
- [常见问题](#常见问题)

---

## 环境要求

| 项目 | 最低要求 |
|------|---------|
| 操作系统 | Linux / Windows / macOS |
| Node.js | >= 20.x（推荐 LTS） |
| 内存 | >= 512MB（推荐 2GB+） |
| 磁盘 | 根据上传文件量决定 |
| 端口 | 默认 3000（可自定义） |

---

## 方式一：宝塔面板部署

### 1. 安装 Node.js 版本管理器

登录宝塔面板 → **软件商店** → 搜索 **Node.js 版本管理器** → 安装

安装完成后打开，选择安装 **Node.js 20.x LTS**。

### 2. 上传项目文件

通过宝塔 **文件** 功能，将项目上传到服务器，例如：

```
/www/wwwroot/jiahaodrop/
```

上传后目录结构应为：

```
/www/wwwroot/jiahaodrop/
├── server.js
├── package.json
├── package-lock.json
├── public/
│   ├── index.html
│   ├── styles.css
│   └── ...
├── data/          ← 运行时自动创建
└── .env           ← 手动创建（可选）
```

### 3. 安装依赖

宝塔面板 → **终端**（或 SSH），执行：

```bash
cd /www/wwwroot/jiahaodrop
npm install --production
```

### 4. 创建 .env 配置文件（可选）

在项目根目录创建 `.env` 文件：

```bash
# 服务端口
PORT=3000
HOST=0.0.0.0

# 公网访问域名（分享链接使用）
PUBLIC_BASE_URL=https://send.example.com

# 会话密钥（必须设置，至少 32 位随机字符串）
SESSION_SECRET=你的随机密钥至少32位以上

# 文件限制
MAX_FILE_SIZE_MB=512
MAX_FILES_PER_UPLOAD=10

# 文件保留时间（小时）
RETENTION_HOURS=48

# HTTPS 反代后设置
COOKIE_SECURE=true
TRUST_PROXY=true
```

生成随机密钥的命令：

```bash
openssl rand -hex 32
```

### 5. 添加 Node 项目

宝塔面板 → **网站** → **Node项目** → **添加Node项目**

| 配置项 | 填写内容 |
|-------|---------|
| 项目目录 | `/www/wwwroot/jiahaodrop` |
| 启动选项 | `启动文件` |
| 启动文件 | `server.js` |
| Node版本 | 选择已安装的 20.x |
| 包管理器 | `npm` |
| 运行用户 | `www` |
| 端口 | `3000` |
| 项目备注 | `JiahaoDrop 快传` |

点击 **提交**，宝塔会自动安装依赖并启动服务。

> 如果已在终端手动 `npm install`，宝塔会跳过依赖安装直接启动。

### 6. 配置反向代理

在宝塔 **网站** 列表中找到你绑定域名的站点，点击 **设置** → **反向代理** → **添加反向代理**：

| 配置项 | 填写内容 |
|-------|---------|
| 代理名称 | `jiahaodrop` |
| 目标URL | `http://127.0.0.1:3000` |
| 发送域名 | `$host` |

提交后，宝塔会自动生成 Nginx 配置。

> **注意**：反向代理是在**网站站点**中配置，不是在 Node 项目中配置。

#### 宝塔自动生成配置的常见问题

宝塔生成的 Nginx 配置可能存在以下问题，导致域名无法正常访问：

| 问题 | 说明 | 后果 |
|------|------|------|
| `listen 3000;` | Nginx 和 Node 项目同时监听 3000 端口 | 端口冲突，反向代理死循环 |
| 缺少 `X-Forwarded-Proto` | 应用无法识别客户端是否使用 HTTPS | Cookie 会话异常，HTTPS 下无法登录 |
| `Host` 头带端口 | `proxy_set_header Host $host:$server_port` | 应用生成的链接可能带多余端口号 |

**解决方式**：在站点设置 → 反向代理中删除自动生成的配置，参考项目中 `nginx/baota.conf.example` 手动替换站点的 Nginx 配置文件。配置文件路径：

```
/www/server/panel/vhost/nginx/你的站点名.conf
```

替换后执行：

```bash
nginx -t && systemctl reload nginx
```

### 7. 配置 HTTPS

在宝塔 **网站** 列表中找到对应的站点 → **设置** → **SSL**：

- 选择 **Let's Encrypt** 免费申请证书
- 勾选 **强制HTTPS**

申请成功后，回到 `.env` 文件确认：

```
COOKIE_SECURE=true
TRUST_PROXY=true
```

然后重启 Node 项目。

### 8. 开放防火墙

宝塔面板 → **安全** → **防火墙**，确保放行以下端口：

- `80`（HTTP）
- `443`（HTTPS）

如果使用云服务器（阿里云、腾讯云等），还需在云控制台的安全组中放行端口。

---

## 方式二：Linux 手动部署

### 1. 安装 Node.js

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 验证
node -v   # 应输出 v20.x.x
npm -v
```

### 2. 上传并解压项目

```bash
cd /www/wwwroot
# 通过 scp / sftp / git 上传项目文件
git clone <你的仓库地址> jiahaodrop
cd jiahaodrop
```

### 3. 安装依赖

```bash
npm install --production
```

### 4. 创建 .env 文件

```bash
cat > .env << 'EOF'
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://send.example.com
SESSION_SECRET=替换为你的随机密钥至少32位以上
MAX_FILE_SIZE_MB=512
RETENTION_HOURS=48
COOKIE_SECURE=true
TRUST_PROXY=true
EOF
```

### 5. 使用 systemd 管理进程

创建服务文件：

```bash
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

[Install]
WantedBy=multi-user.target
EOF
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable jiahaodrop
sudo systemctl start jiahaodrop
sudo systemctl status jiahaodrop
```

查看日志：

```bash
sudo journalctl -u jiahaodrop -f
```

### 6. 配置 Nginx 反向代理

见下方 [Nginx 反向代理](#nginx-反向代理) 章节。

---

## Nginx 反向代理

### 宝塔用户

宝塔会自动生成 Nginx 配置，但可能存在端口冲突和缺少 `X-Forwarded-Proto` 头的问题。建议参考 `nginx/baota.conf.example` 手动配置。

关键配置项（必须包含）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

> 完整配置见 `nginx/baota.conf.example`，包含 SSL、HTTP 跳转、敏感文件屏蔽等。

### 手动配置

```nginx
server {
    listen 80;
    server_name send.example.com;

    # 上传大小限制（与管理后台「单文件大小限制」保持一致）
    client_max_body_size 8g;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

HTTPS 版本：

```nginx
server {
    listen 443 ssl http2;
    server_name send.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 8g;

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
sudo nginx -t
sudo systemctl reload nginx
```

---

## 初始化管理员

有三种方式创建第一个管理员账号：

### 方式一：Web 页面初始化（推荐）

1. 启动服务后，浏览器打开 `http://服务器IP:3000`
2. 如果没有管理员账号，会显示初始化页面
3. 需要输入 **初始化令牌**（`INIT_TOKEN` 环境变量）
4. 填写用户名、密码、邮箱，点击创建

> 设置 `INIT_TOKEN` 环境变量后才允许 Web 初始化，防止公网暴露时被他人创建管理员。

```bash
# 在 .env 中添加
INIT_TOKEN=你的初始化令牌
```

### 方式二：命令行初始化

```bash
cd /www/wwwroot/jiahaodrop
node server.js --init
```

按提示输入用户名、密码、邮箱即可。

### 方式三：环境变量自动初始化

服务首次启动时，如果没有任何用户且设置了以下环境变量，会自动创建管理员：

```bash
# 在 .env 中添加
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码至少8位
ADMIN_EMAIL=admin@example.com
```

> 此方式适合云服务器自动化部署，建议创建完成后删除这三个环境变量。

---

## 环境变量参考

| 变量名 | 默认值 | 说明 |
|-------|-------|------|
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录（状态文件、临时文件） |
| `STORAGE_DIR` | `./data/storage` | 文件存储目录 |
| `PUBLIC_BASE_URL` | 空 | 公网访问域名，用于生成分享链接 |
| `SESSION_SECRET` | 空 | 会话密钥，**生产环境必须设置**，至少 32 位 |
| `SESSION_HOURS` | `12` | 会话绝对有效期（小时） |
| `SESSION_IDLE_MINUTES` | `30` | 会话空闲超时（分钟） |
| `MAX_FILE_SIZE_MB` | `512` | 单文件大小上限（MB） |
| `MAX_FILES_PER_UPLOAD` | `10` | 单次上传文件数量上限 |
| `RETENTION_HOURS` | `48` | 文件保留时间（小时） |
| `STORAGE_QUOTA_MB` | `0` | 总存储空间限制（MB），0 表示不限制 |
| `COOKIE_SECURE` | `false` | HTTPS 时设为 `true` |
| `TRUST_PROXY` | `false` | 使用反向代理时设为 `true` |
| `ADMIN_USERNAME` | 空 | 环境变量自动初始化用户名 |
| `ADMIN_PASSWORD` | 空 | 环境变量自动初始化密码 |
| `ADMIN_EMAIL` | 空 | 环境变量自动初始化邮箱 |
| `INIT_TOKEN` | 空 | Web 初始化令牌，设置后才允许浏览器初始化 |

---

## 常见问题

### 服务启动后打不开

1. 检查防火墙是否放行端口
2. 检查云服务器安全组是否放行端口
3. 检查服务是否正常运行：`curl http://127.0.0.1:3000/api/health`

### 域名访问显示其他页面或 502

1. 确认宝塔**网站**列表中有绑定该域名的站点
2. 进入该站点 → 设置 → 反向代理，确认已添加且目标为 `http://127.0.0.1:3000`
3. 确认 Node 项目正在运行（宝塔 Node 项目列表显示「运行中」）
4. 确认 `.env` 中 `PORT` 与反向代理目标端口一致（默认 3000）
5. 检查 Nginx 配置是否包含 `listen 3000;`（应该删除，会和 Node 端口冲突）
6. 检查 Nginx 配置是否包含 `proxy_set_header X-Forwarded-Proto $scheme;`（必须有）
7. 参考 `nginx/baota.conf.example` 手动替换站点 Nginx 配置

### 上传文件失败

1. 检查 Nginx 的 `client_max_body_size` 是否足够大
2. 检查 `MAX_FILE_SIZE_MB` 环境变量
3. 检查磁盘空间是否充足

### 忘记管理员密码

1. 如果还有其他管理员账号，登录后台直接重置该用户密码。
2. 如果没有可用管理员账号，先停止服务并备份 `data/state.json`。
3. 最简单的重置方式是删除 `data/state.json` 后重新初始化，但这会丢失所有用户和文件记录。

> 不要把管理员的 `passwordHash` 字段清空。当前版本不会因为清空该字段而进入安全的重设密码流程，反而可能造成账号异常或误判。

### SMTP 邮件发送失败

1. 在后台 → 设置 → SMTP 配置中填写正确的邮件服务器信息
2. 点击 **发送测试邮件** 验证配置
3. 检查服务器防火墙是否放行 SMTP 端口（465/587）

### 宝塔 Node 项目启动失败

1. 检查 Node.js 版本是否 >= 20
2. 在终端手动运行 `node server.js` 查看报错信息
3. 确认 `npm install --production` 已成功执行
4. 检查项目目录权限：`chown -R www:www /www/wwwroot/jiahaodrop`

### 分享链接域名不对

在后台 → 设置 → 公网访问域名 中修改，或在 `.env` 中设置 `PUBLIC_BASE_URL`。

### 如何备份

备份以下目录即可：

```bash
/www/wwwroot/jiahaodrop/data/
```

其中包含：
- `state.json` — 用户、文件记录、设置
- `storage/` — 上传的文件
- `.session-secret` — 会话密钥（不要丢失，否则所有已登录用户需要重新登录）

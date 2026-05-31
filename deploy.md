# JiahaoDrop 部署指南

本文档涵盖所有部署方式，推荐使用宝塔面板部署（最简单）。

---

## 目录

1. [宝塔面板部署（推荐）](#1-宝塔面板部署推荐)
2. [Linux 手动部署](#2-linux-手动部署)
3. [Windows 部署](#3-windows-部署)
4. [macOS 部署](#4-macos-部署)
5. [一键部署脚本](#5-一键部署脚本)
6. [HTTPS 配置](#6-https-配置)
7. [常见问题](#7-常见问题)

---

## 1. 宝塔面板部署（推荐）

### 1.1 安装宝塔面板

如果服务器尚未安装宝塔，执行：

```bash
# CentOS / Ubuntu / Debian
curl -sSO https://download.bt.cn/install/install_panel.sh && bash install_panel.sh
```

安装完成后登录宝塔面板，在 **软件商店** 中安装：
- **Nginx**（任意版本）
- **Node.js 版本管理器**（在软件商店搜索 "Node"）

### 1.2 安装 Node.js

打开 **Node.js 版本管理器**，安装 Node.js **v20.x LTS** 或更高版本，安装完成后在命令行验证：

```bash
node -v   # 应显示 v20.x.x 或更高
```

### 1.3 部署项目

```bash
cd /www/wwwroot
git clone https://github.com/jycf001/File-Transfer-Platform.git jiahaodrop
cd jiahaodrop
npm install
```

### 1.4 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，修改以下关键项：

```ini
# 你的域名（不带 https://）
PUBLIC_BASE_URL=https://send.example.com

# 自动生成一个随机密钥（可选，或手动输入任意长字符串）
SESSION_SECRET=随机生成的32位以上字符串

# HTTPS 时必须设为 true
COOKIE_SECURE=true
TRUST_PROXY=true
```

### 1.5 创建 systemd 服务

```bash
cat > /etc/systemd/system/jiahaodrop.service << 'EOF'
[Unit]
Description=JiahaoDrop File Transfer
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/www/wwwroot/jiahaodrop
ExecStart=$(which node) server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-/www/wwwroot/jiahaodrop/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jiahaodrop
systemctl start jiahaodrop
```

验证服务运行：

```bash
systemctl status jiahaodrop
curl http://127.0.0.1:3000   # 应返回 HTML
```

### 1.6 配置 Nginx 反向代理

在宝塔面板中：

1. **网站** -> **添加站点**
2. 填入域名，选择一个目录（仅用于存放 SSL 证书）
3. 点击站点名 -> **反向代理** -> **添加反向代理**
4. 填写：
   - 代理名称：`jiahaodrop`
   - 目标 URL：`http://127.0.0.1:3000`
5. 点击 **配置文件**，替换为以下内容：

```nginx
server {
    listen 443 ssl http2;
    server_name send.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    client_max_body_size 8g;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 30s;
    }
}

server {
    listen 80;
    server_name send.example.com;
    return 301 https://$host$request_uri;
}
```

> **注意**：将 `server_name` 和 SSL 证书路径替换为你的实际值。`client_max_body_size 8g` 允许上传最大 8GB 文件。

6. 在宝塔中申请 SSL 证书（Let's Encrypt 免费证书）

### 1.7 完成

浏览器打开你的域名，首次访问会进入初始化页面创建管理员账号。

---

## 2. Linux 手动部署

适用于不使用宝塔面板的 Linux 服务器（Ubuntu / Debian / CentOS）。

### 2.1 安装 Node.js

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

验证：`node -v` 应 >= v20.x

### 2.2 安装 Nginx

```bash
# Ubuntu / Debian
sudo apt install nginx

# CentOS
sudo yum install nginx
```

### 2.3 部署项目

```bash
sudo mkdir -p /opt/jiahaodrop
sudo chown $USER:$USER /opt/jiahaodrop
cd /opt/jiahaodrop
git clone https://github.com/jycf001/File-Transfer-Platform.git .
npm install
cp .env.example .env
```

编辑 `.env` 设置你的域名和配置。

### 2.4 创建 systemd 服务

```bash
NODE_BIN=$(which node)
sudo tee /etc/systemd/system/jiahaodrop.service > /dev/null <<EOF
[Unit]
Description=JiahaoDrop File Transfer
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/opt/jiahaodrop
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-/opt/jiahaodrop/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable jiahaodrop
sudo systemctl start jiahaodrop
```

### 2.5 配置 Nginx

```bash
sudo tee /etc/nginx/sites-available/jiahaodrop > /dev/null << 'EOF'
server {
    listen 443 ssl http2;
    server_name send.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    client_max_body_size 8g;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 30s;
    }
}

server {
    listen 80;
    server_name send.example.com;
    return 301 https://$host$request_uri;
}
EOF

sudo ln -sf /etc/nginx/sites-available/jiahaodrop /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> CentOS 用户请将配置放在 `/etc/nginx/conf.d/jiahaodrop.conf`。

### 2.6 配置防火墙

```bash
# Ubuntu (ufw)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

### 2.7 申请 SSL 证书

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx   # Ubuntu/Debian
sudo yum install certbot python3-certbot-nginx   # CentOS

# 申请证书
sudo certbot --nginx -d send.example.com
```

证书会自动续期。完成后在 `.env` 中设置 `COOKIE_SECURE=true` 和 `TRUST_PROXY=true`。

---

## 3. Windows 部署

### 3.1 安装 Node.js

从 [nodejs.org](https://nodejs.org/) 下载并安装 Node.js v20 LTS 或更高版本。

### 3.2 部署项目

```powershell
cd C:\www
git clone https://github.com/jycf001/File-Transfer-Platform.git jiahaodrop
cd jiahaodrop
npm install
copy .env.example .env
```

编辑 `.env` 设置域名等配置。

### 3.3 启动服务

```powershell
npm start
```

浏览器打开 `http://localhost:3000`。

### 3.4 设置开机自启（可选）

使用 [NSSM](https://nssm.cc/) 将 Node.js 注册为 Windows 服务：

```powershell
# 下载 nssm 后
nssm install JiahaoDrop "C:\Program Files\nodejs\node.exe" "C:\www\jiahaodrop\server.js"
nssm set JiahaoDrop AppDirectory "C:\www\jiahaodrop"
nssm set JiahaoDrop AppEnvironmentExtra NODE_ENV=production
nssm start JiahaoDrop
```

### 3.5 Nginx（可选）

如需 Nginx 反向代理，下载 [nginx for Windows](https://nginx.org/en/download.html)，在 `conf/nginx.conf` 中添加：

```nginx
server {
    listen 443 ssl http2;
    server_name send.example.com;

    ssl_certificate     cert.pem;
    ssl_certificate_key key.pem;
    client_max_body_size 8g;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}
```

---

## 4. macOS 部署

### 4.1 安装 Node.js

```bash
brew install node@20
```

### 4.2 部署项目

```bash
cd ~/www
git clone https://github.com/jycf001/File-Transfer-Platform.git jiahaodrop
cd jiahaodrop
npm install
cp .env.example .env
```

编辑 `.env` 设置配置。

### 4.3 启动服务

```bash
npm start
```

浏览器打开 `http://localhost:3000`。

### 4.4 设置开机自启（可选）

使用 launchd 创建服务：

```bash
cat > ~/Library/LaunchAgents/com.jiahaodrop.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jiahaodrop</string>
    <key>WorkingDirectory</key>
    <string>/Users/你的用户名/www/jiahaodrop</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.jiahaodrop.plist
```

---

## 5. 一键部署脚本

项目内置 `deploy.sh` 脚本，适用于 Linux 和 macOS，自动完成：

- Node.js 版本检查
- npm 依赖安装
- `.env` 自动生成（含 SESSION_SECRET）
- systemd 服务配置（Linux）
- Nginx 配置参考输出
- 防火墙提示

使用方法：

```bash
git clone https://github.com/jycf001/File-Transfer-Platform.git jiahaodrop
cd jiahaodrop
bash deploy.sh
```

执行完成后按提示：

```bash
nano .env                    # 编辑配置（域名、文件大小等）
systemctl start jiahaodrop   # 启动服务
systemctl status jiahaodrop  # 查看状态
journalctl -u jiahaodrop -f  # 查看日志
```

> macOS 下脚本会跳过 systemd 配置，需手动启动或使用 launchd。

---

## 6. HTTPS 配置

生产环境必须启用 HTTPS。在 `.env` 中设置：

```ini
COOKIE_SECURE=true
TRUST_PROXY=true
PUBLIC_BASE_URL=https://你的域名
```

SSL 证书获取方式：
- **宝塔面板**：一键申请 Let's Encrypt 证书
- **certbot**：`sudo certbot --nginx -d 你的域名`
- **云服务商**：在云控制台申请免费 SSL 证书

---

## 7. 常见问题

### 上传大文件失败

检查 Nginx 配置中的 `client_max_body_size`，默认已设为 `8g`。如需更大，修改后 reload Nginx。

### 服务无法启动

```bash
# 查看错误日志
journalctl -u jiahaodrop -n 50 --no-pager

# 手动启动查看报错
cd /path/to/jiahaodrop
node server.js
```

### 端口被占用

```bash
# 查看 3000 端口占用
lsof -i :3000        # Linux/macOS
netstat -ano | findstr :3000   # Windows
```

在 `.env` 中修改 `PORT` 使用其他端口。

### 忘记管理员密码

```bash
cd /path/to/jiahaodrop
node server.js --reset-admin
```

### 数据迁移

将整个 `data/` 目录复制到新服务器即可。包含：
- `state.json` — 用户、文件记录、设置
- `storage/` — 上传的文件
- `.session-secret` — 会话密钥

新服务器执行 `npm install` 后将 `data/` 复制过去，启动即可。

# JiahaoDrop 轻量快传

适合 2c2G 云服务器的小型私有文件快传服务。首页只提供登录和“不登录仅接收”，登录后进入 `/app`，后台独立在 `/admin`。

## 快速开始

```bash
npm install
npm start
```

服务健康检查：

```text
/api/health
```

第一次部署需要先创建管理员账号，没有默认密码。推荐设置 `INIT_TOKEN` 后在浏览器初始化，也可以运行 `node server.js --init`，或通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量自动初始化。初始化管理员拥有全部设置权限。

## 地址

```text
首页登录和公开接收：http://服务器IP:3000
登录后使用页：http://服务器IP:3000/app
管理后台：http://服务器IP:3000/admin
分享链接示例：https://你的域名/r/ABC123
```

## 功能

- 普通用户登录后只有发送和接收权限。
- 管理员拥有全部设置权限，可进入后台管理用户、系统设置、日志和邮件。
- 上传后生成接收码和分享链接。
- 未登录用户可在首页输入接收码，或打开分享链接直接下载。
- 文件默认 48 小时过期，启动和定时任务都会清理。
- 后台可配置公网访问域名、文件存放目录、SMTP 邮件服务器。
- 审计日志记录登录、上传、下载、删除、用户管理和设置变更，可发送到邮箱。

## 常用环境变量

```bash
PORT=3000
HOST=0.0.0.0
DATA_DIR=./data
STORAGE_DIR=./data/storage
PUBLIC_BASE_URL=https://send.example.com
SESSION_SECRET=请改成至少32位随机字符串
MAX_FILE_SIZE_MB=512
MAX_FILES_PER_UPLOAD=10
RETENTION_HOURS=48
COOKIE_SECURE=false
TRUST_PROXY=false
```

说明：

- `PUBLIC_BASE_URL` 是分享链接使用的公网域名，也可以在后台“设置”里修改。
- `DATA_DIR` 保存状态文件、临时上传目录和日志状态。
- `STORAGE_DIR` 是默认上传文件目录，也可以在后台修改。
- SMTP 密码会用 `SESSION_SECRET` 派生密钥加密后保存；生产环境必须固定设置 `SESSION_SECRET`。

## 生产部署建议

- 用 Nginx 或 Caddy 反向代理并开启 HTTPS。
- 设置强随机 `SESSION_SECRET`，至少 32 位。
- HTTPS 反代后设置 `COOKIE_SECURE=true` 和 `TRUST_PROXY=true`。
- 在后台设置公网访问域名，例如 `https://send.example.com`。
- 给 `DATA_DIR` 和文件存放目录设置磁盘配额、备份和监控。
- Nginx 层同步设置上传大小限制，例如 `client_max_body_size 512m;`。

## 常用命令

```bash
npm run check
npm audit
npm start
```

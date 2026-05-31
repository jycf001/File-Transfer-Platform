#!/usr/bin/env bash
set -euo pipefail

# ─── 颜色 ───
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ─── 配置 ───
APP_NAME="jiahaodrop"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
APP_USER="${APP_USER:-www}"
APP_PORT="${APP_PORT:-3000}"
NODE_VERSION_MIN=20
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

# ─── 1. 检查 Node.js ───
info "检查 Node.js 版本..."
if ! command -v node &>/dev/null; then
  fail "未找到 Node.js，请先安装 Node.js >= ${NODE_VERSION_MIN}"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt "$NODE_VERSION_MIN" ]; then
  fail "Node.js 版本过低 ($(node -v))，需要 >= ${NODE_VERSION_MIN}"
fi
ok "Node.js $(node -v)"

# ─── 2. 安装依赖 ───
info "安装生产依赖..."
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --production --ignore-scripts 2>&1 | tail -1
else
  npm install --production --ignore-scripts 2>&1 | tail -1
fi
ok "依赖安装完成"

# ─── 3. 创建 .env（如不存在） ───
if [ ! -f .env ]; then
  info "未检测到 .env，从 .env.example 生成..."
  if [ -f .env.example ]; then
    cp .env.example .env
    # 自动生成 SESSION_SECRET
    if command -v openssl &>/dev/null; then
      SECRET=$(openssl rand -hex 32)
      sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SECRET}/" .env
      info "已自动生成 SESSION_SECRET"
    else
      warn "未找到 openssl，请手动编辑 .env 设置 SESSION_SECRET"
    fi
    ok ".env 已创建，请根据实际情况编辑：${APP_DIR}/.env"
  else
    warn ".env.example 不存在，跳过"
  fi
else
  ok ".env 已存在，跳过"
fi

# ─── 4. 确保数据目录存在 ───
mkdir -p "${APP_DIR}/data"
mkdir -p "${APP_DIR}/data/storage"
ok "数据目录就绪"

# ─── 5. 初始化管理员（首次运行） ───
if [ ! -f "${APP_DIR}/data/state.json" ]; then
  info "首次运行，检测初始化方式..."
  # 优先使用环境变量自动初始化
  if [ -n "${ADMIN_USERNAME:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
    info "检测到 ADMIN_USERNAME/ADMIN_PASSWORD 环境变量，将自动初始化管理员"
  elif [ -n "${INIT_TOKEN:-}" ]; then
    info "检测到 INIT_TOKEN，请在浏览器中访问 http://服务器IP:${APP_PORT} 完成初始化"
  else
    info "未设置初始化环境变量，启动后请执行: node server.js --init"
    info "或在 .env 中设置 INIT_TOKEN 后通过浏览器初始化"
  fi
else
  ok "检测到已有数据 (state.json)，保留现有配置"
fi

# ─── 6. systemd 服务（仅 Linux） ───
setup_systemd() {
  if [ "$(uname)" != "Linux" ]; then
    warn "非 Linux 系统，跳过 systemd 配置"
    return
  fi
  if [ ! -d /etc/systemd/system ]; then
    warn "systemd 不可用，跳过服务配置"
    return
  fi

  info "配置 systemd 服务..."

  # 检测 node 绝对路径
  NODE_BIN=$(which node)

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=JiahaoDrop File Transfer
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
# 从 .env 加载环境变量
EnvironmentFile=-${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}" 2>/dev/null
  ok "systemd 服务已配置: ${SERVICE_FILE}"
  info "启动服务: systemctl start ${APP_NAME}"
  info "查看日志: journalctl -u ${APP_NAME} -f"
}

# ─── 7. Nginx 配置提示 ───
print_nginx_hint() {
  local DOMAIN="send.example.com"
  if [ -f .env ]; then
    local env_domain
    env_domain=$(grep -E '^PUBLIC_BASE_URL=' .env | cut -d= -f2- | sed 's|https\?://||;s|/.*||')
    [ -n "$env_domain" ] && DOMAIN="$env_domain"
  fi

  echo ""
  info "── Nginx 反向代理参考配置 ──"
  cat <<EOF
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    client_max_body_size 8g;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
EOF
  echo ""
  info "HTTPS 启用后，请在 .env 中设置:"
  echo "  COOKIE_SECURE=true"
  echo "  TRUST_PROXY=true"
}

# ─── 8. 防火墙提示 ───
print_firewall_hint() {
  echo ""
  info "── 防火墙 ──"
  echo "确保放行以下端口:"
  echo "  - 80  (HTTP)"
  echo "  - 443 (HTTPS)"
  if command -v ufw &>/dev/null; then
    echo ""
    echo "  ufw allow 80/tcp"
    echo "  ufw allow 443/tcp"
  fi
  if command -v firewall-cmd &>/dev/null; then
    echo ""
    echo "  firewall-cmd --permanent --add-port=80/tcp"
    echo "  firewall-cmd --permanent --add-port=443/tcp"
    echo "  firewall-cmd --reload"
  fi
}

# ─── 主流程 ───
echo ""
echo "═══════════════════════════════════════"
echo "  JiahaoDrop 部署脚本"
echo "═══════════════════════════════════════"
echo ""

setup_systemd
print_nginx_hint
print_firewall_hint

echo ""
echo "═══════════════════════════════════════"
ok "部署准备完成！"
echo ""
echo "  项目目录: ${APP_DIR}"
echo "  数据目录: ${APP_DIR}/data"
echo "  配置文件: ${APP_DIR}/.env"
echo ""
echo "  快速启动:"
echo "    cd ${APP_DIR}"
echo "    npm start"
echo ""
echo "  或使用 systemd:"
echo "    systemctl start ${APP_NAME}"
echo "═══════════════════════════════════════"

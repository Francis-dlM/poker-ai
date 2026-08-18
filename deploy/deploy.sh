#!/usr/bin/env bash
#
# 德州扑克游戏一键部署脚本
# 用法:
#   ./deploy.sh <user@host> [ssh-key-path]
# 示例:
#   ./deploy.sh ubuntu@1.2.3.4 ~/.ssh/tencent.pem
#   ./deploy.sh root@texas.francisdlm.cn        # 用默认 ~/.ssh/id_rsa
#
# 说明:
#   - 仅部署 HTTP(80)。需要 HTTPS 时再跑 enable-https.sh 或手动申请证书。
#   - 脚本在本机运行（私钥留在本地，不涉及聊天/第三方）。
#   - 自动检测 apt / yum / dnf 安装 nginx，写站点配置并放行 80 端口。
#
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: ./deploy.sh <user@host> [ssh-key-path]" >&2
  exit 1
fi

TARGET="$1"
KEY="${2:-}"
REMOTE_DIR="/var/www/texas"
DOMAIN="texas.francisdlm.cn"
CONF_NAME="texas.francisdlm.cn.conf"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR/site"
CONF_SRC="$SCRIPT_DIR/nginx-${CONF_NAME}"

if [ ! -d "$SITE_DIR" ]; then
  echo "找不到站点目录: $SITE_DIR" >&2; exit 1
fi
if [ ! -f "$CONF_SRC" ]; then
  echo "找不到 nginx 配置: $CONF_SRC" >&2; exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15)
if [ -n "$KEY" ]; then SSH_OPTS+=(-i "$KEY"); fi
SSH_CMD=(ssh "${SSH_OPTS[@]}" "$TARGET")
SCP_CMD=(scp "${SSH_OPTS[@]}")

echo "==> [1/5] 测试 SSH 连接 $TARGET"
"${SSH_CMD[@]}" "echo OK; uname -a"

echo "==> [2/5] 复制游戏文件到 $TARGET:$REMOTE_DIR"
"${SSH_CMD[@]}" "sudo mkdir -p $REMOTE_DIR && sudo chown -R \$(id -u):\$(id -g) $REMOTE_DIR"
"${SCP_CMD[@]}" -r "$SITE_DIR/." "$TARGET:$REMOTE_DIR/"
# 注入构建版本号，破坏浏览器缓存（避免用户看到旧版）
BUILD="$(date +%s)"
"${SSH_CMD[@]}" "sed -i 's/%%V%%/$BUILD/g' $REMOTE_DIR/index.html && echo \"缓存破坏版本号: $BUILD\""

echo "==> [3/5] 检测系统并安装 nginx（若未安装）"
"${SSH_CMD[@]}" bash -s <<'REMOTE'
set -e
if command -v nginx >/dev/null 2>&1; then
  echo "nginx 已安装: $(nginx -v 2>&1)"
else
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y nginx
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nginx && sudo systemctl enable --now nginx
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nginx && sudo systemctl enable --now nginx
  else
    echo "未能识别包管理器，请手动安装 nginx 后重试" >&2; exit 1
  fi
fi
REMOTE

echo "==> [4/5] 写入站点配置并校验"
"${SCP_CMD[@]}" "$CONF_SRC" "$TARGET:/tmp/$CONF_NAME"
"${SSH_CMD[@]}" "sudo mv /tmp/$CONF_NAME /etc/nginx/conf.d/$CONF_NAME && sudo nginx -t"

echo "==> [5/5] 放行 80 端口并重新加载 nginx"
"${SSH_CMD[@]}" bash -s <<'REMOTE'
set -e
sudo nginx -s reload 2>/dev/null || sudo systemctl restart nginx
# 防火墙放行（按系统自适应）
if command -v ufw >/dev/null 2>&1; then sudo ufw allow 80/tcp; fi
if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-service=http && sudo firewall-cmd --reload || true
fi
echo "部署完成 ✓"
REMOTE

echo
echo "============================================"
echo " 部署完成！请确认："
echo " 1) 腾讯云解析: A 记录 $DOMAIN -> 你的 CVM 公网 IP"
echo " 2) 安全组: 入站放行 TCP 80"
echo " 3) 浏览器访问 http://$DOMAIN"
echo "============================================"

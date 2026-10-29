#!/bin/bash
# 学习空间 - 静态页面 CGI 入口 + 服务端数据 API
# 页面:     /cgi/ThirdParty/xuexikongjian/index.cgi/...
# 数据API:  GET  ?action=load  → 返回 {ok, data}
#           POST ?action=save  → 保存 {data: {...}} 到服务端 JSON 文件
# 注意：CGI 环境没有 TRIM_* 变量，安装路径固定；数据目录固定为 var

# 全局抑制 stderr，避免污染 CGI 响应
exec 2>/dev/null

BASE_PATH="/var/apps/xuexikongjian/target/www"
DATA_DIR="${TRIM_PKGVAR:-/var/apps/xuexikongjian/var}"
DATA_FILE="$DATA_DIR/data.json"
MAX_SIZE=3145728   # 3MB 上限

# 解析 query 参数（支持 action= 与 api= 两种写法）
action=""
IFS='&' read -ra qs <<< "${QUERY_STRING:-}"
for kv in "${qs[@]}"; do
  case "$kv" in
    action=*) action="${kv#action=}" ;;
    api=*)    action="${kv#api=}" ;;
  esac
done

# ============ 数据 API ============
case "$action" in
  load)
    echo "Content-Type: application/json; charset=utf-8"
    echo "Cache-Control: no-store"
    echo ""
    if [ -s "$DATA_FILE" ]; then
      printf '{"ok":true,"data":'
      cat "$DATA_FILE"
      echo "}"
    else
      echo '{"ok":true,"data":null}'
    fi
    exit 0
    ;;
  save)
    # 读取 POST 请求体（CONTENT_LENGTH 字节）
    body=""
    len="${CONTENT_LENGTH:-0}"
    if [ "$len" -gt 0 ] 2>/dev/null && [ "$len" -le "$MAX_SIZE" ]; then
      body=$(dd bs=1 count="$len" 2>/dev/null)
    fi
    # 简单校验：必须是以 { 开头、} 结尾的 JSON 对象
    first=$(printf '%s' "$body" | head -c 1)
    last=$(printf '%s' "$body" | tail -c 1)
    if [ "$first" != "{" ] || [ "$last" != "}" ]; then
      echo "Content-Type: application/json; charset=utf-8"
      echo "Cache-Control: no-store"
      echo ""
      echo '{"ok":false,"msg":"invalid json"}'
      exit 0
    fi
    mkdir -p "$DATA_DIR"
    if printf '%s' "$body" > "$DATA_DIR/data.json.tmp" && mv "$DATA_DIR/data.json.tmp" "$DATA_FILE"; then
      chmod 666 "$DATA_FILE" 2>/dev/null
      echo "Content-Type: application/json; charset=utf-8"
      echo "Cache-Control: no-store"
      echo ""
      echo '{"ok":true}'
    else
      echo "Content-Type: application/json; charset=utf-8"
      echo "Cache-Control: no-store"
      echo ""
      echo '{"ok":false,"msg":"write failed"}'
    fi
    exit 0
    ;;
esac

# ============ 静态文件服务 ============
URI_NO_QUERY="${REQUEST_URI%%\?*}"
if [ -z "$URI_NO_QUERY" ]; then
  URI_NO_QUERY="${PATH_INFO:-/}"
fi
REL_PATH="/"

case "$URI_NO_QUERY" in
  *index.cgi*)
    REL_PATH="${URI_NO_QUERY#*index.cgi}"
    ;;
esac

if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
  REL_PATH="/index.html"
fi

# URL 解码（处理 %20 等）
REL_PATH=$(printf '%b' "${REL_PATH//%/\\x}")

# 路径安全：拒绝目录穿越与异常字符
case "$REL_PATH" in
  *..*|*"\\"*|*"//"*)
    echo "Status: 400 Bad Request"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "Bad Request"
    exit 0
    ;;
esac

TARGET_FILE="${BASE_PATH}${REL_PATH}"

if [ ! -f "$TARGET_FILE" ]; then
  echo "Status: 404 Not Found"
  echo "Content-Type: text/plain; charset=utf-8"
  echo ""
  echo "404 Not Found"
  exit 0
fi

case "${TARGET_FILE##*.}" in
  html|htm) mime="text/html; charset=utf-8" ;;
  css)      mime="text/css; charset=utf-8" ;;
  js|mjs)   mime="application/javascript; charset=utf-8" ;;
  json|webmanifest) mime="application/json; charset=utf-8" ;;
  png)      mime="image/png" ;;
  jpg|jpeg) mime="image/jpeg" ;;
  gif)      mime="image/gif" ;;
  svg)      mime="image/svg+xml" ;;
  ico)      mime="image/x-icon" ;;
  woff)     mime="font/woff" ;;
  woff2)    mime="font/woff2" ;;
  mp3)      mime="audio/mpeg" ;;
  *)        mime="application/octet-stream" ;;
esac

echo "Content-Type: $mime"
echo ""
cat "$TARGET_FILE"

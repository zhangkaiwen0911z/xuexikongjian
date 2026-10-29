#!/bin/bash
# =====================================================================
# 学习空间 fnOS FPK 打包脚本
# 布局对齐真实上架应用：ui/ 在 FPK 顶层（桌面入口），app.tgz 装应用内容
# 依赖: bash, tar, md5sum
# 用法:
#   ./tools/build-fpk.sh <输出路径> [platform] [arch]
#   示例:
#   ./tools/build-fpk.sh xuexikongjian-1.0.4-x86.fpk x86 x86_64
#   ./tools/build-fpk.sh xuexikongjian-1.0.4-arm.fpk arm aarch64
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")/.."   # 项目根目录
OUT="${1:-xuexikongjian.fpk}"
PLATFORM="${2:-x86}"
ARCH="${3:-x86_64}"

PKG=$(mktemp -d)
trap 'rm -rf "$PKG"' EXIT

echo "==> 1/6 打包 app.tgz（app/ 内容 + 顶层 config/，对齐真实应用布局）"
TMP_TGZ=$(mktemp -d)
cp -a app/. "$TMP_TGZ/"
cp -a config "$TMP_TGZ/config"
tar -czf "$PKG/app.tgz" -C "$TMP_TGZ" .
rm -rf "$TMP_TGZ"

echo "==> 2/6 复制顶层 ui/（桌面入口：config + images + index.cgi）"
cp -a app/ui "$PKG/ui"
mkdir -p "$PKG/ui/images"
# 兼容不同图标命名约定：同时提供 icon_64/icon_256 与 64/256
cp app/ui/images/icon_64.png "$PKG/ui/images/64.png"
cp app/ui/images/icon_256.png "$PKG/ui/images/256.png"

echo "==> 3/6 复制 cmd/ config/ wizard/"
cp -a cmd "$PKG/cmd"
cp -a config "$PKG/config"
cp -a wizard "$PKG/wizard"
chmod 755 "$PKG"/cmd/*

echo "==> 4/6 复制图标"
cp ICON.PNG ICON_256.PNG "$PKG/"

echo "==> 5/6 写入 manifest（platform=${PLATFORM} arch=${ARCH}）与 checksum"
cp manifest "$PKG/manifest"
sed -i "s/^platform.*/platform              = ${PLATFORM}/" "$PKG/manifest"
if grep -q "^arch" "$PKG/manifest"; then
  sed -i "s/^arch.*/arch                  = ${ARCH}/" "$PKG/manifest"
else
  echo "arch                  = ${ARCH}" >> "$PKG/manifest"
fi
CHECKSUM=$(md5sum "$PKG/app.tgz" | awk '{print $1}')
if grep -q "^checksum" "$PKG/manifest"; then
  sed -i "s/^checksum.*/checksum        = ${CHECKSUM}/" "$PKG/manifest"
else
  echo "checksum        = ${CHECKSUM}" >> "$PKG/manifest"
fi
echo "    checksum = ${CHECKSUM}"

echo "==> 6/6 生成 FPK"
tar -czf "$OUT" -C "$PKG" .
echo "✅ 已生成: $OUT"
ls -l "$OUT"

#!/bin/sh

set -eu

. /usr/share/djonehub/lib.sh

PLUGIN_REPO="Demogorgon314/luci-app-djonehub"
DOWNLOAD_DIR="/tmp/djonehub/download"

fail() {
	printf '{"ok":false,"message":"%s"}\n' "$(json_escape "$*")"
	exit 1
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

need_cmd curl
need_cmd jsonfilter
need_cmd opkg
need_cmd sha256sum

tmp_avail="$(df -kP /tmp 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"
[ "${tmp_avail:-0}" -ge 2048 ] || fail "/tmp 临时空间不足，至少需要 2 MB"

mkdir -p "$DOWNLOAD_DIR"

json="$(curl -fsSL --show-error --connect-timeout 15 --retry 2 "https://api.github.com/repos/$PLUGIN_REPO/releases/latest" 2>/tmp/djonehub-plugin-update.err)" || {
	msg="$(cat /tmp/djonehub-plugin-update.err 2>/dev/null || true)"
	fail "查询插件最新版本失败: $msg"
}

tag="$(printf '%s' "$json" | jsonfilter -e '@.tag_name' 2>/dev/null || true)"
[ -n "$tag" ] || fail "无法解析插件最新版本"
tag_norm="${tag#v}"

asset=""
asset_any=""
i=0
while :; do
	name="$(printf '%s' "$json" | jsonfilter -e "@.assets[$i].name" 2>/dev/null || true)"
	[ -n "$name" ] || break
	case "$name" in
		luci-app-djonehub_*_all.ipk)
			asset="$name"
			break
			;;
		luci-app-djonehub_*_*.ipk)
			[ -n "$asset_any" ] || asset_any="$name"
			;;
	esac
	i=$((i + 1))
done

[ -n "$asset" ] || asset="$asset_any"
[ -n "$asset" ] || fail "最新 Release 未找到 luci-app-djonehub_*.ipk"

base="https://github.com/$PLUGIN_REPO/releases/download/$tag"
ipk="$DOWNLOAD_DIR/$asset"
sums="$DOWNLOAD_DIR/sha256sums.txt"

rm -f "$ipk" "$sums"
curl -fsSL --show-error --connect-timeout 15 --retry 2 "$base/$asset" -o "$ipk" || fail "下载插件安装包失败"
curl -fsSL --show-error --connect-timeout 15 --retry 2 "$base/sha256sums.txt" -o "$sums" || fail "下载 sha256sums.txt 失败"

[ -s "$ipk" ] || fail "插件安装包为空"
[ -s "$sums" ] || fail "sha256sums.txt 为空"

expected="$(awk -v f="$asset" '$2 == f {print $1}' "$sums" | head -n 1)"
[ -n "$expected" ] || fail "sha256sums.txt 中未找到 $asset"
actual="$(sha256sum "$ipk" | awk '{print $1}')"
[ "$actual" = "$expected" ] || fail "SHA256 校验失败"

opkg install "$ipk" >/tmp/djonehub-plugin-opkg.log 2>&1 || {
	msg="$(tail -n 20 /tmp/djonehub-plugin-opkg.log 2>/dev/null || true)"
	fail "安装 LuCI 插件失败: $msg"
}

installed_version="$(opkg status luci-app-djonehub 2>/dev/null | awk '/^Version:/ {print $2; exit}' || true)"
installed_norm="${installed_version#v}"
installed_norm="${installed_norm%-r*}"
installed_norm="${installed_norm%-[0-9]*}"
[ "$installed_norm" = "$tag_norm" ] || {
	msg="$(tail -n 20 /tmp/djonehub-plugin-opkg.log 2>/dev/null || true)"
	fail "安装后版本仍为 ${installed_version:-unknown}，期望 $tag。$msg"
}

printf '%s\n' "$tag_norm" > /usr/share/djonehub/plugin_version 2>/dev/null || true
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache

printf '{"ok":true,"message":"%s"}\n' "$(json_escape "LuCI 插件已更新到 $tag，页面即将刷新。")"

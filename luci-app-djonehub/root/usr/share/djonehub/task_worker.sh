#!/bin/sh

set -eu

. /usr/share/djonehub/task_lib.sh

id="${1:-}"
type="${2:-}"
shift 2 || true

BIN_DIR="/etc/djonehub/bin"
BIN="$BIN_DIR/djonehub"
VERSION_FILE="$BIN_DIR/version"
BACKUP_VERSION_FILE="$BIN_DIR/version.bak"
ARCH_FILE="$BIN_DIR/arch"
BACKUP_ARCH_FILE="$BIN_DIR/arch.bak"
TEMP_BACKUP="$DOWNLOAD_DIR/djonehub.prev"
TEMP_CURRENT="$DOWNLOAD_DIR/djonehub.current"
PLUGIN_REPO="Demogorgon314/luci-app-djonehub"

[ -n "$id" ] || exit 1
[ -n "$type" ] || exit 1

finish_ok() {
	task_finish "$id" "$type" 1 "$1"
	exit 0
}

fail() {
	task_fail "$id" "$type" "$1"
}

release_json_for_version() {
	local repo="$1"
	local version="$2"

	if [ "$version" = "latest" ] || [ "$version" = "stable" ]; then
		curl -fsSL --show-error --connect-timeout 15 --retry 2 "https://api.github.com/repos/$repo/releases/latest"
	else
		curl -fsSL --show-error --connect-timeout 15 --retry 2 "https://api.github.com/repos/$repo/releases/tags/$version"
	fi
}

install_core() {
	local repo repo_input version selected_version core_arch core_arch_input asset_arch release_json asset url downloaded total was_running

	repo_input="${2:-}"
	if [ -n "$repo_input" ]; then
		repo="$(github_repo_slug "$repo_input")"
	else
		repo="$(github_repo_slug "$(uci_get release_repo 'https://github.com/563617356/djonehub-release')")"
	fi
	validate_github_repo "$repo" || fail "Invalid GitHub repository: $repo"

	version="${1:-}"
	[ -n "$version" ] || version="$(uci_get version 'latest')"
	[ -n "$version" ] || version="latest"
	selected_version="$version"
	core_arch_input="${3:-}"
	if [ -n "$core_arch_input" ]; then
		core_arch="$core_arch_input"
	else
		core_arch="$(uci_get core_arch '')"
	fi
	asset_arch="$(resolve_asset_arch "$core_arch")" || fail "Unsupported configured architecture: $core_arch"

	uci set djonehub.main.release_repo="https://github.com/$repo" 2>/dev/null || true
	uci set djonehub.main.version="$selected_version" 2>/dev/null || true
	[ -z "$core_arch" ] || uci set djonehub.main.core_arch="$core_arch" 2>/dev/null || true
	uci commit djonehub 2>/dev/null || true

	task_log "$id" "查询 DJOneHub Release"
	task_write_status "$id" "$type" "running" "prepare" "正在查询 DJOneHub Release" "" 0 0 0 0
	release_json="$(release_json_for_version "$repo" "$version")" || fail "Failed to query release"
	version="$(printf '%s' "$release_json" | jsonfilter -e '@.tag_name' 2>/dev/null || true)"
	[ -n "$version" ] || fail "Failed to parse release"

	asset="djonehub_${version}_linux_${asset_arch}"
	url="https://github.com/$repo/releases/download/$version/$asset"
	downloaded="$DOWNLOAD_DIR/$asset"
	total="$(task_asset_size "$release_json" "$asset")"

	mkdir -p "$BIN_DIR" "$DOWNLOAD_DIR"
	rm -f "$downloaded"
	task_download "$id" "$type" "$url" "$downloaded" "$asset" "$total"
	[ -s "$downloaded" ] || fail "Downloaded file is empty"

	task_log "$id" "校验核心文件"
	task_write_status "$id" "$type" "running" "verify" "正在校验核心文件" "$asset" "$(wc -c < "$downloaded" 2>/dev/null || echo 0)" "$total" 0 0
	chmod +x "$downloaded"
	if command -v file >/dev/null 2>&1; then
		file "$downloaded" | grep -Eq 'ELF|executable' || {
			rm -f "$downloaded"
			fail "Downloaded file is not an executable"
		}
	fi

	was_running=0
	/etc/init.d/djonehub running >/dev/null 2>&1 && was_running=1
	task_write_status "$id" "$type" "running" "install" "正在安装核心" "" 0 0 0 0
	[ "$was_running" = "0" ] || /etc/init.d/djonehub stop || true

	if [ -x "$BIN" ]; then
		cp -f "$BIN" "$TEMP_BACKUP"
		if [ -s "$VERSION_FILE" ]; then
			cp -f "$VERSION_FILE" "$BACKUP_VERSION_FILE"
		else
			printf '已安装，版本未知\n' > "$BACKUP_VERSION_FILE"
		fi
		if [ -s "$ARCH_FILE" ]; then
			cp -f "$ARCH_FILE" "$BACKUP_ARCH_FILE"
		else
			printf 'unknown\n' > "$BACKUP_ARCH_FILE"
		fi
	fi

	cp -f "$downloaded" "$BIN"
	chmod 0755 "$BIN"
	printf '%s\n' "$version" > "$VERSION_FILE"
	printf '%s\n' "$asset_arch" > "$ARCH_FILE"

	if [ "$was_running" = "1" ]; then
		task_write_status "$id" "$type" "running" "restart" "正在重启 DJOneHub 服务" "" 0 0 0 0
		if ! /etc/init.d/djonehub start >/tmp/djonehub-start.log 2>&1; then
			if [ -f "$TEMP_BACKUP" ]; then
				cp -f "$TEMP_BACKUP" "$BIN"
				[ -s "$BACKUP_VERSION_FILE" ] && cp -f "$BACKUP_VERSION_FILE" "$VERSION_FILE"
				[ -s "$BACKUP_ARCH_FILE" ] && cp -f "$BACKUP_ARCH_FILE" "$ARCH_FILE"
				/etc/init.d/djonehub start >/dev/null 2>&1 || true
			fi
			fail "Core installed but service failed to start; rolled back when possible"
		fi
	fi

	rm -f "$TEMP_BACKUP" "$downloaded" "$BIN_DIR/djonehub.bak"
	finish_ok "已安装 DJOneHub 核心 $version"
}

rollback_core() {
	local repo rollback_version rollback_arch asset url downloaded total release_json was_running current_version current_arch

	repo="$(github_repo_slug "$(uci_get release_repo 'https://github.com/563617356/djonehub-release')")"
	validate_github_repo "$repo" || fail "Invalid GitHub repository: $repo"

	rollback_version="$(cat "$BACKUP_VERSION_FILE" 2>/dev/null || true)"
	[ -n "$rollback_version" ] && [ "$rollback_version" != "已安装，版本未知" ] && [ "$rollback_version" != "版本未知" ] || fail "No rollback version recorded"

	rollback_arch="$(cat "$BACKUP_ARCH_FILE" 2>/dev/null || true)"
	if [ -z "$rollback_arch" ] || [ "$rollback_arch" = "unknown" ]; then
		rollback_arch="$(resolve_asset_arch "$(uci_get core_arch '')")" || fail "No rollback architecture recorded"
	fi

	task_log "$id" "查询回滚版本 $rollback_version"
	task_write_status "$id" "$type" "running" "prepare" "正在查询回滚版本" "" 0 0 0 0
	release_json="$(release_json_for_version "$repo" "$rollback_version")" || fail "Failed to query rollback release"

	asset="djonehub_${rollback_version}_linux_${rollback_arch}"
	url="https://github.com/$repo/releases/download/$rollback_version/$asset"
	downloaded="$DOWNLOAD_DIR/$asset"
	total="$(task_asset_size "$release_json" "$asset")"
	current_version="$(cat "$VERSION_FILE" 2>/dev/null || true)"
	current_arch="$(cat "$ARCH_FILE" 2>/dev/null || true)"

	mkdir -p "$BIN_DIR" "$DOWNLOAD_DIR"
	rm -f "$downloaded" "$TEMP_CURRENT"
	task_download "$id" "$type" "$url" "$downloaded" "$asset" "$total"
	[ -s "$downloaded" ] || fail "Downloaded rollback core is empty"

	task_log "$id" "校验回滚核心文件"
	task_write_status "$id" "$type" "running" "verify" "正在校验回滚核心文件" "$asset" "$(wc -c < "$downloaded" 2>/dev/null || echo 0)" "$total" 0 0
	chmod +x "$downloaded"
	if command -v file >/dev/null 2>&1; then
		file "$downloaded" | grep -Eq 'ELF|executable' || {
			rm -f "$downloaded"
			fail "Downloaded rollback core is not an executable"
		}
	fi

	was_running=0
	/etc/init.d/djonehub running >/dev/null 2>&1 && was_running=1
	task_write_status "$id" "$type" "running" "install" "正在回滚核心" "" 0 0 0 0
	[ "$was_running" = "0" ] || /etc/init.d/djonehub stop || true

	[ ! -x "$BIN" ] || cp -f "$BIN" "$TEMP_CURRENT"
	cp -f "$downloaded" "$BIN"
	chmod 0755 "$BIN"
	printf '%s\n' "$rollback_version" > "$VERSION_FILE"
	printf '%s\n' "$rollback_arch" > "$ARCH_FILE"

	if [ "$was_running" = "1" ]; then
		task_write_status "$id" "$type" "running" "restart" "正在重启 DJOneHub 服务" "" 0 0 0 0
		if ! /etc/init.d/djonehub start >/tmp/djonehub-rollback-start.log 2>&1; then
			if [ -f "$TEMP_CURRENT" ]; then
				cp -f "$TEMP_CURRENT" "$BIN"
				[ -n "$current_version" ] && printf '%s\n' "$current_version" > "$VERSION_FILE"
				[ -n "$current_arch" ] && printf '%s\n' "$current_arch" > "$ARCH_FILE"
				/etc/init.d/djonehub start >/dev/null 2>&1 || true
			fi
			fail "Rolled back core, but service failed to start; restored current core when possible"
		fi
	fi

	[ -n "$current_version" ] && printf '%s\n' "$current_version" > "$BACKUP_VERSION_FILE"
	[ -n "$current_arch" ] && printf '%s\n' "$current_arch" > "$BACKUP_ARCH_FILE"
	rm -f "$TEMP_CURRENT" "$downloaded" "$BIN_DIR/djonehub.bak"
	finish_ok "已回滚到 $rollback_version"
}

update_plugin() {
	local json tag tag_norm asset asset_any i name base ipk sums total expected actual installed_version installed_norm msg

	command -v curl >/dev/null 2>&1 || fail "缺少命令: curl"
	command -v jsonfilter >/dev/null 2>&1 || fail "缺少命令: jsonfilter"
	command -v opkg >/dev/null 2>&1 || fail "缺少命令: opkg"
	command -v sha256sum >/dev/null 2>&1 || fail "缺少命令: sha256sum"

	tmp_avail="$(df -kP /tmp 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"
	[ "${tmp_avail:-0}" -ge 2048 ] || fail "/tmp 临时空间不足，至少需要 2 MB"

	task_log "$id" "查询 LuCI 插件最新版本"
	task_write_status "$id" "$type" "running" "prepare" "正在查询 LuCI 插件最新版本" "" 0 0 0 0
	json="$(curl -fsSL --show-error --connect-timeout 15 --retry 2 "https://api.github.com/repos/$PLUGIN_REPO/releases/latest")" || fail "查询插件最新版本失败"
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
	total="$(task_asset_size "$json" "$asset")"

	rm -f "$ipk" "$sums"
	task_download "$id" "$type" "$base/$asset" "$ipk" "$asset" "$total"
	task_download "$id" "$type" "$base/sha256sums.txt" "$sums" "sha256sums.txt" "$(task_asset_size "$json" "sha256sums.txt")"

	[ -s "$ipk" ] || fail "插件安装包为空"
	[ -s "$sums" ] || fail "sha256sums.txt 为空"

	task_log "$id" "校验插件安装包"
	task_write_status "$id" "$type" "running" "verify" "正在校验插件安装包" "$asset" "$(wc -c < "$ipk" 2>/dev/null || echo 0)" "$total" 0 0
	expected="$(awk -v f="$asset" '$2 == f {print $1}' "$sums" | head -n 1)"
	[ -n "$expected" ] || {
		rm -f "$ipk" "$sums"
		fail "sha256sums.txt 中未找到 $asset"
	}
	actual="$(sha256sum "$ipk" | awk '{print $1}')"
	[ "$actual" = "$expected" ] || {
		rm -f "$ipk" "$sums"
		fail "SHA256 校验失败"
	}

	task_log "$id" "安装 LuCI 插件"
	task_write_status "$id" "$type" "running" "install" "正在安装 LuCI 插件" "" 0 0 0 0
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
	finish_ok "LuCI 插件已更新到 $tag，页面即将刷新。"
}

convert_identity() {
	local port="${1:-}"
	local target="${2:-}"
	local result message

	[ -n "$port" ] || fail "缺少串口参数"
	[ -n "$target" ] || fail "缺少目标身份"

	task_write_status "$id" "$type" "running" "prepare" "准备转换 USB 身份" "" 0 0 0 0
	if result="$(DJONEHUB_TASK_ID="$id" DJONEHUB_TASK_TYPE="$type" /usr/share/djonehub/device_tools.sh convert "$port" "$target" 2>&1)"; then
		message="$(printf '%s' "$result" | jsonfilter -e '@.message' 2>/dev/null || true)"
		finish_ok "${message:-设备身份转换已完成}"
	else
		message="$(printf '%s' "$result" | jsonfilter -e '@.message' 2>/dev/null || true)"
		fail "${message:-$result}"
	fi
}

switch_usbnet() {
	local port="${1:-}"
	local target="${2:-}"
	local result message

	[ -n "$port" ] || fail "缺少串口参数"
	[ -n "$target" ] || fail "缺少目标模式"

	task_write_status "$id" "$type" "running" "prepare" "准备切换 USB 网络模式" "" 0 0 0 0
	if result="$(DJONEHUB_TASK_ID="$id" DJONEHUB_TASK_TYPE="$type" /usr/share/djonehub/device_tools.sh switch_usbnet "$port" "$target" 2>&1)"; then
		message="$(printf '%s' "$result" | jsonfilter -e '@.message' 2>/dev/null || true)"
		finish_ok "${message:-USB 网络模式切换已完成}"
	else
		message="$(printf '%s' "$result" | jsonfilter -e '@.message' 2>/dev/null || true)"
		fail "${message:-$result}"
	fi
}

probe_device() {
	local tmp="/tmp/djonehub/device-probe.json.tmp"
	local cache="/tmp/djonehub/device-probe.json"
	local result message

	task_write_status "$id" "$type" "running" "probe" "正在探测 USB 串口设备" "" 0 0 0 0
	if result="$(DJONEHUB_TASK_ID="$id" DJONEHUB_TASK_TYPE="$type" /usr/share/djonehub/device_tools.sh probe 2>&1)"; then
		mkdir -p /tmp/djonehub
		printf '%s\n' "$result" > "$tmp"
		mv -f "$tmp" "$cache"
		finish_ok "设备探测完成"
	else
		message="$(printf '%s' "$result" | jsonfilter -e '@.message' 2>/dev/null || true)"
		fail "${message:-$result}"
	fi
}

task_mkdirs
task_log "$id" "任务启动"

case "$type" in
	install_core) install_core "$@" ;;
	rollback_core) rollback_core ;;
	update_plugin) update_plugin ;;
	convert_identity) convert_identity "$@" ;;
	switch_usbnet) switch_usbnet "$@" ;;
	probe_device) probe_device ;;
	*) fail "不支持的任务类型: $type" ;;
esac

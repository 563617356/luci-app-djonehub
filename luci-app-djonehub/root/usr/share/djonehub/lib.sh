#!/bin/sh

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r//g; :a; N; $!ba; s/\n/\\n/g'
}

uci_get() {
	local key="$1"
	local default="$2"
	local value

	value="$(uci -q get "djonehub.main.$key" 2>/dev/null || true)"
	[ -n "$value" ] && printf '%s' "$value" || printf '%s' "$default"
}

github_repo_slug() {
	local repo="$1"

	repo="${repo#https://github.com/}"
	repo="${repo#http://github.com/}"
	repo="${repo#git@github.com:}"
	repo="${repo%/}"
	repo="${repo%.git}"

	printf '%s' "$repo"
}

validate_github_repo() {
	printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
}

resolve_asset_arch() {
	local configured="$1"
	local machine

	case "$configured" in
		'')
			machine="$(uname -m)"
			case "$machine" in
				aarch64|arm64) printf 'arm64' ;;
				x86_64|amd64) printf 'amd64' ;;
				armv7l|armv7) printf 'armv7' ;;
				*) return 1 ;;
			esac
			;;
		arm64|amd64|armv7)
			printf '%s' "$configured"
			;;
		*)
			return 1
			;;
	esac
}

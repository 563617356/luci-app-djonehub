#!/bin/sh

set -eu

action="${1:-}"

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

run_action() {
	case "$action" in
		start)
			[ -x /etc/djonehub/bin/djonehub ] || {
				printf '%s\n' "DJOneHub core is not installed"
				return 1
			}
			/usr/share/djonehub/render_config.sh
			uci set djonehub.main.enabled='1'
			uci commit djonehub
			/etc/init.d/djonehub enable
			/etc/init.d/djonehub start
			;;
		stop)
			uci set djonehub.main.enabled='0'
			uci commit djonehub
			/etc/init.d/djonehub stop || true
			/etc/init.d/djonehub disable
			;;
		restart)
			/usr/share/djonehub/render_config.sh
			/etc/init.d/djonehub restart
			;;
		*)
			printf '{"ok":false,"message":"Unsupported service action"}\n'
			exit 1
			;;
	esac
}

output="$(run_action 2>&1)" || {
	printf '{"ok":false,"message":"%s"}\n' "$(json_escape "$output")"
	exit 1
}

printf '{"ok":true,"message":"%s"}\n' "$(json_escape "$output")"

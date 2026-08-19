#!/bin/sh

set -eu

. /usr/share/djonehub/lib.sh

if command -v logread >/dev/null 2>&1; then
	logread -c >/dev/null 2>&1 || true
fi

if [ -d /tmp/djonehub/logs ]; then
	find /tmp/djonehub/logs -maxdepth 1 -type f -exec sh -c ': > "$1"' _ {} \; 2>/dev/null || true
fi

printf '{"ok":true,"message":"%s"}\n' "$(json_escape "日志已清理")"

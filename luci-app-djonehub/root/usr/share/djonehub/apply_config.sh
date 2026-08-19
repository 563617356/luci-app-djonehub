#!/bin/sh

set -eu

/usr/share/djonehub/render_config.sh

if /etc/init.d/djonehub running >/dev/null 2>&1; then
	/etc/init.d/djonehub restart
fi

printf '{"ok":true,"message":"配置已保存"}\n'

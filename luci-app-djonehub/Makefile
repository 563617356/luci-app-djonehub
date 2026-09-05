include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-djonehub
PKG_VERSION?=0.1.19
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=DJOneHub
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-djonehub
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for DJOneHub
  DEPENDS:=+luci-base +rpcd +rpcd-mod-file +curl +ca-bundle +jsonfilter
  PKGARCH:=all
endef

define Package/luci-app-djonehub/description
  LuCI management page for installing, configuring, and controlling DJOneHub.
endef

define Build/Compile
endef

define Package/luci-app-djonehub/conffiles
/etc/config/djonehub
endef

define Package/luci-app-djonehub/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/share/djonehub
	echo "$(PKG_VERSION)" > $(1)/usr/share/djonehub/plugin_version
endef

define Package/luci-app-djonehub/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	mkdir -p /etc/djonehub/config /etc/djonehub/data /tmp/djonehub/logs /tmp/djonehub/download
	# Generate a random API token on first install (or when unset) so the core
	# is never left running unauthenticated on the LAN.
	_token_val="$$(uci -q get djonehub.main.token 2>/dev/null)"
	if [ -z "$$_token_val" ]; then
		_token="$$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
		[ -n "$$_token" ] && uci -q set djonehub.main.token="$$_token" && uci commit djonehub
	fi
	if [ -x /etc/init.d/rpcd ]; then
		/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
	fi
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-djonehub))

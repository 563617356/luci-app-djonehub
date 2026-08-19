include $(TOPDIR)/rules.mk

PKG_NAME:=djonehub-core
DJONEHUB_VERSION?=v1.5.2
PKG_VERSION:=$(patsubst v%,%,$(DJONEHUB_VERSION))
PKG_RELEASE:=1
PKG_LICENSE:=Proprietary
PKG_MAINTAINER:=DJOneHub
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/djonehub-core/Default
  SECTION:=utils
  CATEGORY:=Utilities
  DEPENDS:=
  PKGARCH:=all
endef

define Package/djonehub-core-arm64
  $(call Package/djonehub-core/Default)
  TITLE:=DJOneHub core binary (arm64)
  CONFLICTS:=djonehub-core djonehub-core-amd64 djonehub-core-armv7
endef

define Package/djonehub-core-amd64
  $(call Package/djonehub-core/Default)
  TITLE:=DJOneHub core binary (amd64)
  CONFLICTS:=djonehub-core djonehub-core-arm64 djonehub-core-armv7
endef

define Package/djonehub-core-armv7
  $(call Package/djonehub-core/Default)
  TITLE:=DJOneHub core binary (armv7)
  CONFLICTS:=djonehub-core djonehub-core-arm64 djonehub-core-amd64
endef

define Package/djonehub-core-arm64/description
  Preinstalled DJOneHub linux_arm64 core binary for luci-app-djonehub.
endef

define Package/djonehub-core-amd64/description
  Preinstalled DJOneHub linux_amd64 core binary for luci-app-djonehub.
endef

define Package/djonehub-core-armv7/description
  Preinstalled DJOneHub linux_armv7 core binary for luci-app-djonehub.
endef

define Build/Compile
endef

define Package/djonehub-core/install
	$(INSTALL_DIR) $(1)/etc/djonehub/bin
	$(INSTALL_BIN) ./files/djonehub-$(2) $(1)/etc/djonehub/bin/djonehub
	echo "$(DJONEHUB_VERSION)" > $(1)/etc/djonehub/bin/version
	echo "$(2)" > $(1)/etc/djonehub/bin/arch
endef

define Package/djonehub-core/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	if [ -x /etc/init.d/djonehub ] && /etc/init.d/djonehub running >/dev/null 2>&1; then
		/etc/init.d/djonehub restart || true
	fi
}
exit 0
endef

define Package/djonehub-core-arm64/install
	$(call Package/djonehub-core/install,$(1),arm64)
endef

define Package/djonehub-core-amd64/install
	$(call Package/djonehub-core/install,$(1),amd64)
endef

define Package/djonehub-core-armv7/install
	$(call Package/djonehub-core/install,$(1),armv7)
endef

define Package/djonehub-core-arm64/postinst
$(Package/djonehub-core/postinst)
endef

define Package/djonehub-core-amd64/postinst
$(Package/djonehub-core/postinst)
endef

define Package/djonehub-core-armv7/postinst
$(Package/djonehub-core/postinst)
endef

$(eval $(call BuildPackage,djonehub-core-arm64))
$(eval $(call BuildPackage,djonehub-core-amd64))
$(eval $(call BuildPackage,djonehub-core-armv7))

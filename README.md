# luci-app-djonehub

DJOneHub 的 OpenWrt / ImmortalWrt LuCI 管理插件。

## 包结构

- `luci-app-djonehub`: LuCI 页面、UCI 配置、procd 服务、核心下载与回滚脚本，不包含 DJOneHub 二进制。
- `djonehub-core-arm64` / `djonehub-core-amd64` / `djonehub-core-armv7`: 只预置对应架构的 DJOneHub 二进制和版本文件。

默认路径：

```text
/etc/config/djonehub
/etc/djonehub/bin/djonehub
/etc/djonehub/bin/version
/etc/djonehub/bin/arch
/etc/djonehub/config/config.yaml
/etc/djonehub/data
/tmp/djonehub/logs
/tmp/djonehub/download
/tmp/djonehub/tasks
```

默认 Release 仓库地址：

```text
https://github.com/563617356/djonehub-release
```

## 功能

- 在 `服务 -> DJOneHub` 管理核心安装、更新、回滚。
- 核心管理页会从 GitHub Release 列出最近版本，显示当前版本和最新版本。
- 核心安装、核心回滚和 LuCI 插件更新使用任务弹窗显示下载进度、已下载大小、总大小和下载速度。
- 启动、停止、重启 DJOneHub procd 服务。
- 通过 UCI 配置渲染 `/etc/djonehub/config/config.yaml`。
- 显示核心状态、服务状态、端口监听提示和最近日志。核心版本和架构来自安装脚本或 `djonehub-core-*` 写入的 `/etc/djonehub/bin/version` 与 `/etc/djonehub/bin/arch`。
- 核心回滚只保留上一个版本和架构元数据，回滚时重新下载旧版本 core，不在闪存中保存第二份完整二进制。

## 安装

从 GitHub Release 下载并安装：

```sh
opkg install luci-app-djonehub_<version>-r1_all.ipk
```

如果需要内置核心：

```sh
opkg install luci-app-djonehub_<version>-r1_all.ipk djonehub-core-arm64_1.5.4-r1_all.ipk
opkg install luci-app-djonehub_<version>-r1_all.ipk djonehub-core-amd64_1.5.4-r1_all.ipk
opkg install luci-app-djonehub_<version>-r1_all.ipk djonehub-core-armv7_1.5.4-r1_all.ipk
```

也可以只安装 `luci-app-djonehub`，进入 LuCI 页面后点击“安装/更新核心”。

架构对应关系：

```text
aarch64 / arm64 -> arm64
x86_64 / amd64  -> amd64
armv7l / armv7  -> armv7
```

## 发布构建

推送 `v*` tag 会触发 GitHub Action，用 OpenWrt SDK 标准打包流程生成 `.ipk` 与 `.apk`：

```sh
git tag v0.1.2
git push origin v0.1.2
```

Release 产物：

```text
luci-app-djonehub_<version>-r1_all.ipk
djonehub-core-arm64_1.5.4-r1_all.ipk
djonehub-core-amd64_1.5.4-r1_all.ipk
djonehub-core-armv7_1.5.4-r1_all.ipk
对应的 OpenWrt 25 apk 包
sha256sums.txt
```

## 开发构建

把本仓库作为 OpenWrt SDK 的 package feed 使用，或复制到 SDK 的 `package/` 目录后执行：

```sh
make package/djonehub/luci-app-djonehub/compile V=s PKG_VERSION=0.1.2
make package/djonehub/djonehub-core/compile V=s DJONEHUB_VERSION=v1.5.4
```

## TODO

- 浏览器上传本地 DJOneHub 二进制并安装。
- GitHub 镜像/代理下载配置。
- SHA256SUMS 强校验。
- 英文界面与 i18n 语言包。

# DJOneHub on OpenWRT — deploy & control from iOS

This package turns an OpenWRT router into a DJI 4G / eSIM management gateway and
lets you drive it from the **DJOneHub iOS app** and the LuCI web page.

```
 DJI 4G module (USB 2ca3:4006, eSIM/SIM)
        │  AT / QMI / MBIM
        ▼
 OpenWRT router  ── runs  /etc/djonehub/bin/djonehub  (HTTP :7575)
        │                      ▲
        │                      │  downloads djonehub_vX.Y.Z_linux_<arch>
        ▼                      │  from 563617356/djonehub-release
 iPhone (DJOneHub app)  ──────┘  http://<router-ip>:7575  + token
 LuCI page (luci-app-djonehub)
```

## 1. Binaries (you already control these)

Three-architecture Linux binaries live in **your** repo
`563617356/djonehub-release` (not a third party's). Current tag: `v0.1.0`.

- Update them: tag a new version here, or run the **Build Binaries** workflow,
  or build locally and `gh release upload` (see that repo's README).
- The package always fetches `djonehub_v<tag>_linux_<arch>` from this repo.

## 2. Build & install the OpenWRT packages

Two packages:

- `luci-app-djonehub` — LuCI page + init script + download/update logic.
- `djonehub-core-<arch>` — just the prebuilt binary for your router's arch
  (`arm64` / `amd64` / `armv7`). **Install only the one matching your router.**

### Option A — GitHub Actions (easiest)

In `luci-app-djonehub` → Actions → **Release Packages** → run with
`djonehub_version` = the tag in `djonehub-release` (default `v0.1.0`).

- OpenWRT **24.10** → produces `.ipk`
- OpenWRT **25.12** → produces `.apk`

Download the artifacts, `scp` them to the router, then:

```sh
opkg install luci-app-djonehub_*.ipk djonehub-core-<arch>_*.ipk
# for 25.12 / apk:
apk add --allow-untrusted luci-app-djonehub_*.apk djonehub-core-<arch>_*.apk
```

### Option B — local SDK build

Use the OpenWRT SDK (24.10 or 25.12) and point a feed at this repo:

```sh
# feeds.conf
src-link djonehub /path/to/luci-app-djonehub
./scripts/feeds update djonehub
./scripts/feeds install -a -p djonehub
make menuconfig   # select luci-app-djonehub + djonehub-core-<your-arch>
make package/feeds/djonehub/luci-app-djonehub/compile
make package/feeds/djonehub/djonehub-core/compile
```

## 3. Configure & start

```sh
uci set djonehub.main.enabled='1'
uci set djonehub.main.host='0.0.0.0'     # or 192.168.x.x to bind LAN only
uci set djonehub.main.port='7575'
uci set djonehub.main.username='admin'
uci set djonehub.main.password='<set a strong token>'
uci set djonehub.main.release_repo='https://github.com/563617356/djonehub-release'
uci commit djonehub
```

Install / update the core binary from the release repo (LuCI page → "Install
core", or):

```sh
/usr/share/djonehub/install_core.sh v0.1.0      # or "latest"
/etc/init.d/djonehub enable
/etc/init.d/djonehub start
```

Verify: `curl -s http://127.0.0.1:7575/ | head` (or check the LuCI status page).

## 4. Connect from the iPhone (DJOneHub app)

No app changes are needed — the iOS app is a plain HTTP/JSON client.

1. Make sure the phone is on the router's LAN (or reachable via VPN / port forward).
2. In the app, set the **server URL** to `http://<router-ip>:7575`
   (e.g. `http://192.168.1.1:7575`).
3. Set the **token** to the `password` you configured in `/etc/config/djonehub`.
4. Connect. The app talks to the same `:7575` API the LuCI page uses.

> The backend accepts a bearer token via `-token <secret>` / the
> `DJONEHUB_API_TOKEN` env var, which maps to the `password` UCI option above.

## 5. Updating later

1. Build/publish new binaries to `djonehub-release` under a new tag (`v0.2.0`, …).
2. In LuCI → DJOneHub → choose the new version and "Install core" (or
   `install_core.sh v0.2.0`). The running service is restarted automatically;
   on failure it rolls back to the previous binary.

## Notes / caveats

- The `v0.1.0` binaries in `djonehub-release` are **untested proof-of-concept**
  builds made in this environment. Replace them with your own builds before
  relying on them.
- Kernel support: QMI/MBIM need `qmi_wwan` / `cdc_mbim` (present in most
  OpenWRT images); the AT path (DJI USB `2ca3:4006`) uses a pure-Go serial
  implementation (`go.bug.st/serial`), no libusb/cgo on Linux.
- Architecture pick: aarch64/arm64 → `arm64`; x86_64/amd64 → `amd64`;
  armv7l/armv7 → `armv7`.

# Clew 桌面版

[English](DESKTOP.md) · [简体中文](DESKTOP.zh-CN.md) · [返回 README](../README.zh-CN.md)

## 安装和登录

从 [Releases](https://github.com/miuuyy/Clew/releases/latest) 下载对应平台的安装包：

- **Windows x64**：运行安装程序。可以为当前用户安装，无须 WSL。安装程序支持根据系统语言显示简体中文。
- **macOS 13 或更高版本**：按芯片类型选择 Apple 芯片版或 Intel 版。打开 DMG，将 Clew 拖入「应用程序」，也可以解压 ZIP。
- **Linux**：按处理器选择 x64 或 arm64。AppImage 需要 FUSE 2 和可用的非特权用户命名空间。为文件添加执行权限后，以普通用户运行。若发行版限制了 AppImage 所需的命名空间，可以安装 Debian 软件包。Linux 上的凭据管理需要桌面会话、Secret Service 和 D-Bus。

1.0.0 版的 macOS 安装包使用临时签名，未经过 Apple 公证。Windows 安装包未使用 Authenticode 签名，操作系统可能提示无法识别发布者。

带有中文本地化的桌面版会根据设备的首选语言决定初始界面语言。可以直接使用登录页底部的语言菜单选择 **简体中文** 或 **English**。登录后，可在 **设置 → 助手与工作区 → 界面语言** 中随时切换，选择会保存在此设备上。

选择 **使用 ChatGPT 继续**，在浏览器中登录，并允许 Clew 使用你的 ChatGPT Plus 或 Pro 订阅。保持 Clew 开启，看到「返回 Clew」后回到应用。若重启过应用、取消过登录，或页面提示登录链接缺少安全校验信息，请返回 Clew 重新发起登录。若仍有待完成的登录，先选择 **取消**。

## 数据、日志和更新

从 **帮助 → 打开数据文件夹** 可以找到本机的应用数据。各系统的默认位置如下。

| 系统 | 数据目录 |
| --- | --- |
| Windows | `%APPDATA%\clew\data` |
| macOS | `~/Library/Application Support/clew/data` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/clew/data` |

`knowledge_graph.sqlite3` 保存图谱、快照、对话和测验记录。ChatGPT 的登录凭据保存在系统的凭据管理器中，例如 macOS 钥匙串、Windows 凭据管理器或 Linux Secret Service。需要备份时，请关闭 Clew 后复制完整的数据目录。桌面版和源码开发版使用不同的数据目录，可以通过导入和导出在两者之间移动图谱。

- **帮助 → 打开日志文件夹** 可以查看启动日志。反馈问题时，请附上系统、Clew 版本及已去除敏感信息的相关日志。
- **帮助 → 检查更新** 会检查 GitHub 上是否有适用于当前平台的新版本。按提示打开发布页面，下载更新，关闭 Clew 后安装。更新会保留本地数据。

## 从源码运行

在 macOS 或 Linux 上可运行 `./scripts/dev.sh`，再打开 `http://127.0.0.1:5178`。停止开发服务请运行 `./scripts/stop_dev.sh`。

运行 Electron 需要 Node 22.22.2+。以下源码构建命令使用 Python 3.12。

**Windows PowerShell**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -e backend -r desktop/requirements.txt
npm ci
npm --prefix frontend ci
npm run dev
```

**macOS 和 Linux**

```bash
python3.12 -m venv .venv
./.venv/bin/python -m pip install -e backend -r desktop/requirements.txt
npm ci
npm --prefix frontend ci
npm run dev
```

安装包需要在对应的系统和处理器架构上构建，因为 PyInstaller 会打包原生 Python 运行时。构建平台的配置和验证步骤见[桌面发布验证](DESKTOP_RELEASE_VALIDATION.md)。

```bash
npm run package
npm run smoke:package
```

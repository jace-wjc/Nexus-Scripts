# Nexus Scripts

> 包含 FastAPI 后端 + Next.js 前端的业务工具系统，支持 AI 招聘、团队资源管理、Script Hub 权限中心等功能。

---

## ⚠️ 前提：网络问题

**国内用户需要先挂梯子**，否则依赖下载极慢或失败。

- **Windows**: 先确保梯子已开启，建议设置为全局模式
- **Mac**: 同上，或使用 Homebrew 镜像源（中科大镜像：`https://mirrors.ustc.edu.cn/`）

---

## 环境要求

| 依赖 | 版本 | Mac 安装 | Windows 安装 |
|------|------|----------|-------------|
| Python | 3.11 - 3.12 | `brew install python@3.12` 或 [官网下载](https://www.python.org/downloads/) | [官网下载](https://www.python.org/downloads/) 或 [Python Releases for Windows](https://www.python.org/ftp/python/) |
| Node.js | ≥22.3.0，部署使用 22.x | `brew install node@22` 或 [官网下载](https://nodejs.org/) | [官网下载](https://nodejs.org/)（Windows Installer .msi） |
| npm | ≥10，CI/Docker 使用 npm ci | 随 Node.js 安装 | 随 Node.js 安装 |
| MySQL | 8.0+ | `brew install mysql` 或 [官网下载](https://dev.mysql.com/downloads/mysql/) | [MySQL Installer](https://dev.mysql.com/downloads/installer/) |

---

## 快速开始

### 第一步：克隆代码

```bash
git clone https://github.com/xhzwjc/Nexus-Scripts/tree/refactor/system-v2
cd Nexus-Scripts
```

### 第二步：安装依赖

**安装后端 Python 依赖：**

```bash
cd fastApiProject

# Mac 创建虚拟环境
python3.12 -m venv venv
source venv/bin/activate

# Windows 创建虚拟环境
python -m venv venv
venv\Scripts\activate

# 安装依赖（确保梯子已开）
pip install -r requirements.txt
```

**安装前端 Node 依赖：**

```bash
cd ../my-app
# 使用 Docker / CI 相同的依赖锁定方式
npm ci
```

### 第三步：配置环境变量

```bash
cd ..
cp .env.example .env
```

编辑 `.env` 文件，**必须修改以下项**：

```bash
# 1. 数据库配置（改成你的 MySQL 信息）
DB_LOCAL_HOST="localhost"
DB_LOCAL_PORT="3306"
DB_LOCAL_USER="root"
DB_LOCAL_PASSWORD="你的MySQL密码"
DB_LOCAL_DATABASE="script_hub"

# 2. Session 密钥（随便填一串随机字符串）
SCRIPT_HUB_SESSION_SECRET="改成你的随机字符串"

# 3. 团队资源加密密钥（随便填一串随机字符串）
TEAM_RESOURCES_PASSWORD_ENCRYPTION_KEY="改成你的随机字符串"
TEAM_RESOURCES_EXPORT_ENCRYPTION_KEY="改成你的随机字符串"

# 4. 运行环境
ENVIRONMENT="local"
```

**生成随机密钥：**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 第四步：创建 MySQL 数据库

**Mac：**
```bash
mysql -u root -p
```

**Windows：** 打开 MySQL Command Line Client 或 CMD：
```bash
mysql -u root -p
```

执行以下 SQL：
```sql
CREATE DATABASE IF NOT EXISTS script_hub DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 第五步：初始化数据并启动

**初始化 Script Hub 权限数据：**
```bash
cd fastApiProject
python bootstrap_script_hub_rbac.py
```
> 成功后会输出初始管理员 Key，**务必保存好**。

**启动后端服务：**
```bash
python run.py
```
> 后端地址：http://localhost:8091

**另开终端，启动前端：**
```bash
cd my-app
npm run dev
```
> 前端地址：http://localhost:3000

---

## 初始化数据（可选）

如果需要初始化基线数据（AI 资源、团队资源等），运行：

```bash
# Mac/Linux
./bootstrap_local_mysql_data.sh

# Windows
bootstrap_local_mysql_data.bat
```

---

## 常见问题

**Q: 启动报错 `Module not found`**
```bash
# 确保激活了虚拟环境
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows
pip install -r requirements.txt
```

**Q: 数据库连接失败**
- **Mac**: `brew services start mysql`（或 `mysql.server start`）
- **Windows**: 打开"服务"应用，找到 MySQL 并启动；或 CMD 运行 `net start mysql`
- 确认 `.env` 里 `DB_LOCAL_HOST`、`DB_LOCAL_PASSWORD` 正确

**Q: 前端安装依赖失败**
先检查 Node/npm 版本、网络与 registry，再重试 `npm ci`。保留 `package-lock.json` 和 `pnpm-lock.yaml`，不要通过删除锁文件规避依赖冲突。已有 pnpm 本地工作流可以继续使用；变更依赖时同步检查两份锁文件，不混用已有的 node_modules。

验证隔离、持久化目录、部署健康检查和回滚限制见 [运行与验证说明](docs/运行与验证说明.md)。

**Q: 端口被占用（8091 或 3000）**
```bash
# macOS 查看端口占用
lsof -i :8091
lsof -i :3000
```

---

## 目录结构

```
Nexus-Scripts/
├── fastApiProject/          # FastAPI 后端
│   ├── app/                 # 应用代码
│   │   ├── routers/         # API 路由
│   │   ├── services/         # 业务逻辑
│   │   └── models.py        # 数据模型
│   ├── requirements.txt      # Python 依赖
│   ├── run.py               # 启动入口
│   └── bootstrap_*.py        # 数据初始化脚本
├── my-app/                  # Next.js 前端
│   ├── src/                # 源代码
│   └── package.json        # Node 依赖
└── scripts/                # 运维脚本
```

---

## 开发说明

- `.env` 文件不要提交到 git（已在 `.gitignore` 中忽略）
- 后端默认连接 `localhost:3306` 的 MySQL
- 前端开发服务器 http://localhost:3000，会自动代理 API 到后端
- 需要 AI 功能（招聘初筛等）请自行配置 `.env` 中的 AI API Key

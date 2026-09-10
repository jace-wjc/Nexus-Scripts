import uvicorn
import argparse

if __name__ == "__main__":
    # 解析命令行参数
    parser = argparse.ArgumentParser(description="启动春苗系统结算API服务")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="服务绑定的主机地址")
    parser.add_argument("--port", type=int, default=8000, help="服务监听的端口号")
    parser.add_argument("--reload", action="store_true", help="开发模式下自动重载")
    parser.add_argument("--graceful-timeout", type=int, default=30,
                        help="退出时等待在途请求的最长秒数，避免 SSE 阻止热重载")
    args = parser.parse_args()
    if args.graceful_timeout < 0:
        parser.error("--graceful-timeout 不能小于 0")

    # 启动服务
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        timeout_graceful_shutdown=args.graceful_timeout,
    )

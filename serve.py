"""极小的本地静态服务器 —— 双击 启动.bat，或双击打包好的 exe 时调用它。

three.js 以 ES 模块方式加载，浏览器在 file:// 下会因为跨域策略拒绝这种加载，
所以正式版必须走 http。除此之外没有任何依赖。

两种跑法，页面从哪里取：
  · 直接跑脚本：就是本目录里的文件；
  · 打包成单文件 exe：页面被 PyInstaller 解到临时目录（sys._MEIPASS），从那里取。
"""

import functools
import http.server
import os
import sys
import threading
import webbrowser

BASE_PORT = 8317


def resource_root():
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return bundle
    return os.path.dirname(os.path.abspath(__file__))


ROOT = resource_root()


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # 保持控制台安静


def main():
    os.chdir(ROOT)
    handler = functools.partial(Handler, directory=ROOT)

    server = None
    for port in range(BASE_PORT, BASE_PORT + 12):
        try:
            server = Server(("127.0.0.1", port), handler)
            break
        except OSError:
            continue

    if server is None:
        print("端口被占满了，请关掉其它本地服务后重试。")
        return

    url = "http://127.0.0.1:%d/index.html" % server.server_address[1]
    print()
    print("  莲 · 本地服务已启动")
    print("  " + url)
    print()
    print("  关掉这个窗口即可停止服务。")

    if "--no-open" in sys.argv:
        print("  （这次没有自动打开浏览器）")
    else:
        print("  浏览器会自动打开。")
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

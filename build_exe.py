"""把「莲」打包成一个单文件 exe（配合 打包.bat 使用，也可以直接 python build_exe.py）。

只塞页面真正用得到的东西：vendor/ 里躺着 10.7 MB，其中大半是这页根本没 import 的
three 扩展，所以这里从 src/main.js 出发把依赖闭包算出来，多余的一个都不带。

产物是 dist/莲.exe —— 双击就能起本地服务并打开浏览器，拷到别的电脑也能用，
那台电脑不需要装 Python。
"""

import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = "莲"


def closure(starts):
    """顺着 import 一路找下去，返回这个页面真正会用到的文件。"""
    seen, queue = set(), [os.path.normpath(p) for p in starts]

    def resolve(spec, frm):
        if spec.startswith("three/addons/"):
            return os.path.join(ROOT, "vendor", "jsm", spec[len("three/addons/"):])
        if spec == "three":
            return os.path.join(ROOT, "vendor", "three.module.js")
        if spec.startswith("."):
            return os.path.join(os.path.dirname(frm), spec)
        return None

    while queue:
        f = os.path.normpath(queue.pop())
        if f in seen or not os.path.isfile(f):
            continue
        seen.add(f)
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
        for m in re.finditer(r"from\s+['\"]([^'\"]+)['\"]", text):
            target = resolve(m.group(1), f)
            if target:
                queue.append(target)
    return sorted(seen)


def main():
    files = closure([os.path.join(ROOT, "src", "main.js")])

    args = [sys.executable, "-m", "PyInstaller",
            "--noconfirm", "--clean", "--onefile",
            "--name", NAME,
            "--add-data", "index.html" + os.pathsep + ".",
            "--add-data", "assets" + os.pathsep + "assets"]

    for f in files:
        rel = os.path.relpath(f, ROOT)
        dest = os.path.dirname(rel).replace("\\", "/") or "."
        args += ["--add-data", rel + os.pathsep + dest]
    args.append("serve.py")

    print("打进 exe 的东西：")
    print("  index.html")
    print("  assets/   （开场影片 + 三张做法配图）")
    for f in files:
        print("  " + os.path.relpath(f, ROOT))
    print()

    subprocess.check_call(args, cwd=ROOT)

    exe = os.path.join(ROOT, "dist", NAME + ".exe")
    print()
    if os.path.isfile(exe):
        size = os.path.getsize(exe) / 1048576
        print("  打包完成：dist\\%s.exe  （%.1f MB）" % (NAME, size))
    else:
        print("  没找到产物，往上翻看 PyInstaller 的报错。")


if __name__ == "__main__":
    main()

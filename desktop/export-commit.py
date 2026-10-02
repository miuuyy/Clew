"""Publish an already staged directory with the OS's atomic no-replace rename."""
from __future__ import annotations

import ctypes
import errno
import os
from pathlib import Path
import stat
import sys


def commit(source: str, destination: str) -> None:
    stage, target = Path(source), Path(destination)
    if not stage.is_absolute() or not target.is_absolute() or stage.parent != target.parent:
        raise ValueError("Export commit requires absolute sibling directories.")
    if not stat.S_ISDIR(stage.lstat().st_mode) or stage.is_symlink():
        raise ValueError("The staged export must be a real directory.")
    # Windows rename fails if the destination already exists, including symlinks.
    if sys.platform == "win32":
        os.rename(stage, target)
        return
    library = ctypes.CDLL(None, use_errno=True)
    descriptor = os.open(stage.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if sys.platform == "darwin":
            rename = library.renameatx_np
            flags = 0x00000004  # RENAME_EXCL
        elif sys.platform == "linux":
            rename = library.renameat2
            flags = 1  # RENAME_NOREPLACE
        else:
            raise RuntimeError("Unsupported export platform.")
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(descriptor, os.fsencode(stage.name), descriptor, os.fsencode(target.name), flags) != 0:
            code = ctypes.get_errno()
            if code in (errno.EEXIST, errno.ENOTEMPTY):
                raise FileExistsError("The export folder already exists. Choose another parent folder or rename the existing export.")
            raise OSError(code, os.strerror(code))
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Export commit requires source and destination.")
        commit(*sys.argv[1:])
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

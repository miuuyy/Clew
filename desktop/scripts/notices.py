"""Ship the installed Python distributions' license notices with the desktop runtime."""
from importlib import metadata
from pathlib import Path
import sysconfig
import sys
import re

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
index = []
for distribution in sorted(metadata.distributions(), key=lambda item: item.metadata.get("Name", "").lower()):
    name = distribution.metadata.get("Name", "unknown")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise RuntimeError("Invalid distribution name in license metadata.")
    version = distribution.version
    index.append(f"{name} {version}: {distribution.metadata.get('License-Expression') or distribution.metadata.get('License') or 'see package notices'}")
    for file in distribution.files or []:
        if file.name.lower().startswith(("license", "copying", "notice", "authors")):
            source = Path(distribution.locate_file(file))
            if source.is_file():
                if file.is_absolute() or ".." in file.parts:
                    raise RuntimeError(f"Unsafe license path in {name}.")
                target = output / name / file
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
python_license = Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
if not python_license.is_file():
    # Official Python Windows installers keep this alongside python.exe.
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
if not python_license.is_file():
    raise RuntimeError("The Python runtime license is missing from this build environment.")
(output / "Python-LICENSE.txt").write_bytes(python_license.read_bytes())
(output / "INDEX.txt").write_text("Clew desktop: Python package notices from the native build environment\n\n" + "\n".join(index) + "\n", encoding="utf-8")

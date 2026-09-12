"""Build deterministic release archives from this repository's checked output."""
import hashlib, json, shutil
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
browser = manifest.get('manifest_version') == 3
source = root / 'dist' / ('browser-extension' if browser else 'obsidian-plugin')
target = (root / 'dist/releases').resolve()
assert target.parent == (root / 'dist').resolve()
if target.exists(): shutil.rmtree(target)
target.mkdir(parents=True)
version = manifest['version']
folder = 'ai-inbox-browser' if browser else 'ai-inbox'
name = f'ai-inbox-{"browser" if browser else "obsidian"}-{version}.zip'
with ZipFile(target / name, 'w', compression=ZIP_DEFLATED, compresslevel=9) as output:
    for file in sorted(source.rglob('*')):
        if not file.is_file(): continue
        assert file.name not in {'data.json', 'Connection.md'} and file.suffix != '.map'
        info = ZipInfo(f'{folder}/{file.relative_to(source).as_posix()}', date_time=(2026, 9, 12, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED; info.external_attr = 0o644 << 16
        output.writestr(info, file.read_bytes(), compresslevel=9)
if not browser:
    for name in ['main.js', 'manifest.json', 'versions.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copyfile(source / name, target / name)
checksums = [f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}' for file in sorted(target.iterdir())]
(target / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print(f'Packaged {version}: {target}')

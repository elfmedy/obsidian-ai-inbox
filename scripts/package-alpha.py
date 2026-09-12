"""Deterministic, credential-free zip files from the checked Alpha build."""
import hashlib
import json
import shutil
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / 'dist' / 'alpha'
target = root / 'dist' / 'releases'
target.mkdir(parents=True, exist_ok=True)
checksums = []
for directory, folder, name in [
    ('obsidian-plugin', 'ai-inbox', 'ai-inbox-obsidian'),
    ('chrome-extension', 'ai-inbox-chrome', 'ai-inbox-chrome'),
]:
    version = json.loads((source / directory / 'manifest.json').read_text(encoding='utf-8'))['version']
    name = f'{name}-{version}-alpha.zip'
    archive = target / name
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as output:
        for file in sorted((source / directory).rglob('*')):
            if not file.is_file():
                continue
            if file.name in {'data.json', 'Connection.md'} or file.suffix == '.map':
                raise RuntimeError('Private or development file in package')
            relative = file.relative_to(source / directory).as_posix()
            info = ZipInfo(f'{folder}/{relative}', date_time=(2026, 9, 12, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            output.writestr(info, file.read_bytes(), compresslevel=9)
    checksums.append(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {name}')
# Standalone runtime assets are required for BRAT (a zip alone is not enough).
for name in ['main.js', 'manifest.json', 'versions.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']:
    file = target / name
    shutil.copyfile(source / 'obsidian-plugin' / name, file)
    checksums.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {name}')
(target / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print('Alpha packages and SHA256SUMS.txt generated in dist/releases.')

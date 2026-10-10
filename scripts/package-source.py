"""Package reviewable source and exact verification input; exclude signers/runtime state."""
from pathlib import Path
import hashlib
import subprocess
import zipfile

root = Path.cwd().resolve()
output = root.parent / 'outputs'
output.mkdir(exist_ok=True)
archive = output / 'DistributionMarkets-source.zip'
names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
files = sorted(set(name for name in names if name))
count = 0
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for name in files:
        parts = Path(name).parts
        if any(part in {'.git', '.private', 'work', 'node_modules', 'dist', 'out', 'cache', 'broadcast'} for part in parts):
            continue
        if any(part.startswith('.env') and part != '.env.example' for part in parts):
            continue
        source = root / name
        if not source.is_file():
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):
            raise RuntimeError('Refusing a source path outside the checkout')
        bundle.write(source, 'dass/' + name)
        count += 1
    verification = root / 'work/artifacts/standard-input.json'
    bundle.write(verification, 'dass/verification/arc-testnet-standard-input.json')
    count += 1
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / 'DistributionMarkets-source.sha256').write_text(f'{checksum}  {archive.name}\n')
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert not any('/.private/' in name or '/work/' in name or 'wallet.dpapi' in name for name in bundle.namelist())
print(f'{archive.name}: {count} files, {archive.stat().st_size} bytes, SHA256 {checksum}')

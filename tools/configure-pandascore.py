#!/usr/bin/env python3
"""User-operated secret entry. Never echoes/logs the token or sends network requests."""
import getpass
import os
import sys
from pathlib import Path

if not sys.stdin.isatty():
    raise SystemExit('Hay chay truc tiep trong Terminal; khong ho tro pipe/log input.')

root = Path(__file__).resolve().parent.parent
target = root / '.env.pandascore'
if target.exists() or target.is_symlink():
    raise SystemExit('Cau hinh da ton tai. Khong ghi de; lien he Ben de kiem tra tiep.')
print('Nhap API key PandaScore HIEN CO. Khong tao key moi, khong dan vao chat.')
print('Ky tu se an hoan toan khi nhap. Nhan Enter de luu; Ctrl+C de huy.')
try:
    token = getpass.getpass('PandaScore API key: ')
except (KeyboardInterrupt, EOFError):
    raise SystemExit('\nDa huy. Khong luu key.')
if not token or any(ch.isspace() for ch in token) or any(ch in token for ch in '\x00\"\'`$\\#'):
    raise SystemExit('Key rong hoac co ky tu khong hop le. Khong luu. Hay chay lai va copy nguyen key.')
# Exclusive creation prevents overwriting any existing configuration or following symlinks.
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    handle.write('MATCH_FEED_ENABLED=false\nPANDASCORE_TOKEN=' + token + '\nPANDASCORE_T1_TEAM_ID=\n')
    handle.flush()
    os.fsync(handle.fileno())
del token
print('DA LUU KEY AN TOAN. Feed van tat. Bao Ben: da nhap key xong.')

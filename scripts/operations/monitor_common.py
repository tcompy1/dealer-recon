"""Private local validation and signal-only delivery. No application data is sent."""
from __future__ import annotations
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import sys
import urllib.request

CHECKS = frozenset({'service-health', 'backup-freshness', 'scheduled-backup', 'daily-review'})
CONFIG = Path('/etc/dealer-recon-monitor')
BASE = Path('/opt/backups/managed')
STATE = Path('/var/lib/dealer-recon-monitor')
DELIVERY_SECONDS = 4
URL_PATTERN = re.compile(r'https://hc-ping\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
ARCHIVE_PATTERN = re.compile(r'\d{8}T\d{6}Z\.[A-Za-z0-9_-]+\.archive-ok')


def event(name, **fields):
    print(json.dumps({'event': name, **fields}, sort_keys=True), file=sys.stderr, flush=True)


def private_dir(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('unsafe directory')
    return info.st_uid


def private_read(path, limit=131072):
    owner = private_dir(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != owner or info.st_size > limit:
            raise ValueError('unsafe file')
        return stream.read(limit + 1)


def timestamp(value):
    if not isinstance(value, str): raise ValueError('timestamp must be text')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None: raise ValueError('timezone required')
    return parsed.astimezone(dt.timezone.utc)


def inspect_archive(path, now):
    """Rehash complete bytes; archive validation is never reported as restore proof."""
    if not ARCHIVE_PATTERN.fullmatch(path.name): raise ValueError('not a published archive')
    private_dir(path)
    if (path / 'FAILED').exists() or (path / 'FAILED').is_symlink(): raise ValueError('failed run')
    record = json.loads(private_read(path / 'record.json'))
    if not isinstance(record, dict): raise ValueError('record must be an object')
    if (record.get('status') != 'ARCHIVE_VALIDATED_RESTORE_NOT_TESTED'
            or any(type(record.get(k)) is not int or record[k] != 0 for k in ('pg_dump_exit', 'archive_list_exit'))):
        raise ValueError('unsuccessful archive')
    start, end = timestamp(record['started_utc']), timestamp(record['completed_utc'])
    if start > end or end > now: raise ValueError('invalid time')
    if type(record['bytes']) is not int or record['bytes'] <= 0: raise ValueError('empty archive')
    digest = record['sha256']
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest): raise ValueError('invalid checksum')
    if private_read(path / 'SHA256SUMS').decode().strip() != digest + '  database.dump': raise ValueError('checksum record mismatch')
    if not private_read(path / 'archive.list', 8 * 1024 * 1024).strip() or private_read(path / 'stderr.log').strip():
        raise ValueError('archive validation incomplete')
    fd = os.open(path / 'database.dump', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != path.stat().st_uid or info.st_size != record['bytes']:
            raise ValueError('unsafe dump')
        sha = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''): sha.update(block)
        after = os.fstat(stream.fileno())
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
            raise ValueError('dump changed')
    if sha.hexdigest() != digest: raise ValueError('corrupt archive')
    return {'started_utc': start.isoformat(), 'completed_utc': end.isoformat()}


def backup_freshness(base, now):
    try:
        private_dir(base)
        candidates = sorted(p for p in base.iterdir() if ARCHIVE_PATTERN.fullmatch(p.name))
        if not candidates: return {'status': 'fail', 'reason_codes': ['BACKUP_MISSING']}
        record = inspect_archive(candidates[-1], now)
        if (now - timestamp(record['completed_utc'])).total_seconds() > 26 * 3600:
            return {'status': 'fail', 'reason_codes': ['BACKUP_STALE']}
        return {'status': 'ok', 'reason_codes': []}
    except (OSError, ValueError, TypeError, KeyError):
        return {'status': 'fail', 'reason_codes': ['BACKUP_INVALID']}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DeliveryDeadline(BaseException):
    pass


@contextmanager
def delivery_deadline():
    """Bound DNS/TLS/HTTP together on these single-threaded Unix entry points.

    Preserve an earlier evaluator deadline rather than extending or swallowing it.
    """
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    start = time.monotonic()
    earlier = 0 < previous_timer[0] <= DELIVERY_SECONDS
    def expired(signum, frame):
        if earlier and callable(previous_handler): previous_handler(signum, frame)
        raise DeliveryDeadline()
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, previous_timer[0] if earlier else DELIVERY_SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(.001, previous_timer[0] - (time.monotonic() - start)), previous_timer[1])


def send(check_name, signal, config_dir=CONFIG, transport=None):
    """False records delivery failure; it does not redefine backup success/exit."""
    try:
        if check_name not in CHECKS or signal not in {'start', 'success', 'fail'}: raise ValueError('invalid signal')
        owner = private_dir(config_dir)
        if owner not in {0, os.geteuid()}: raise ValueError('unsafe owner')
        url = private_read(config_dir / (check_name + '.url'), 256).decode().strip()
        if not URL_PATTERN.fullmatch(url): raise ValueError('invalid destination')
        suffix = '' if signal == 'success' else '/' + signal
        request = urllib.request.Request(url + suffix, data=b'', method='POST')
        # Disable ambient proxy configuration and redirects; default HTTPS verifies TLS.
        opener = transport or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with delivery_deadline(), opener.open(request, timeout=4) as response:
            if response.status != 200: raise ValueError('delivery rejected')
        return True
    except (Exception, DeliveryDeadline):
        event('heartbeat_delivery_failed', check=check_name if check_name in CHECKS else 'invalid')
        return False

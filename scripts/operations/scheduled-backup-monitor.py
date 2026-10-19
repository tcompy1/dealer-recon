#!/usr/bin/env python3
"""Run the installed repaired backup once, preserving its exit independently of delivery."""
from __future__ import annotations
import datetime as dt
import os
from pathlib import Path
import subprocess
import tempfile
from monitor_common import BASE, event, inspect_archive, private_dir, private_read, send, timestamp

WRAPPER = '/usr/local/sbin/dealer-recon-backup'


def run_backup():
    # Retain both original streams privately; never send their contents externally.
    private_dir(BASE)
    descriptors = []
    code, output = None, ''
    try:
        stderr_fd, stderr_path = tempfile.mkstemp(prefix='adapter-', suffix='.stderr', dir=BASE)
        descriptors.append(stderr_fd)
        stdout_path = Path(stderr_path).with_suffix('.stdout')
        stdout_fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        descriptors.append(stdout_fd)
        result = subprocess.run([WRAPPER], stdout=stdout_fd, stderr=stderr_fd)
        code = 128 - result.returncode if result.returncode < 0 else result.returncode
        for fd in descriptors: os.fsync(fd)
        output = private_read(stdout_path).decode()
    except Exception:
        if code is None: raise
        # A known backup outcome survives diagnostic/validation bookkeeping failure.
        event('scheduled_diagnostic_persistence_failed')
    finally:
        for fd in descriptors:
            try: os.close(fd)
            except OSError: event('scheduled_diagnostic_close_failed')
    return code, output


def execute(base=BASE, runner=run_backup, notifier=send, clock=lambda: dt.datetime.now(dt.timezone.utc)):
    private_dir(base)
    before = {p.name for p in base.iterdir()}
    started = clock()
    def notify(value):
        try:
            if not notifier('scheduled-backup', value): event('scheduled_notification_failed', signal=value)
        except Exception: event('scheduled_notification_failed', signal=value)
    notify('start')
    try: code, output = runner()
    except Exception:
        notify('fail'); event('scheduled_backup_launch_failed'); return 70
    valid = False
    if code == 0:
        try:
            lines = output.strip().splitlines()
            if len(lines) != 1: raise ValueError('invalid result path')
            path = Path(lines[0])
            if path.parent != base or path.name in before: raise ValueError('not new run')
            record = inspect_archive(path, clock())
            # Wrapper started_utc has second precision; identity/new-path checks prevent replay.
            if timestamp(record['started_utc']) < started.replace(microsecond=0): raise ValueError('old run')
            valid = True
        except (OSError, ValueError, TypeError, KeyError): pass
    notify('success' if valid else 'fail')
    event('scheduled_backup_result', wrapper_exit=code, archive_valid=valid)
    return code

if __name__ == '__main__':
    os.umask(0o077)
    try: raise SystemExit(execute())
    except Exception: event('scheduled_adapter_preflight_failed'); raise SystemExit(70)

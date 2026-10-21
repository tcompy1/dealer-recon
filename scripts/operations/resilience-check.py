#!/usr/bin/env python3
"""Passive health evaluation. Default mode does not send any external signals."""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.request
from zoneinfo import ZoneInfo
from monitor_common import BASE, CONFIG, STATE, NoRedirect, backup_freshness, event, private_dir, private_read, send, timestamp

INSPECT = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{.State.Running}},"health":"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}","project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"ports":{{json .HostConfig.PortBindings}}}'


def command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=5, env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}).stdout.strip()


def http_probe(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=3) as response:
        if response.status != 200: raise ValueError('HTTP failed')
        body = response.read(1048576)
        if url.endswith('/ready') and json.loads(body) != {'status': 'ready'}: raise ValueError('not ready')
        if not body: raise ValueError('empty response')
    return 'ok'


def validate_expected(expected):
    if set(expected) != {'db', 'backend', 'frontend'}: raise ValueError('service set')
    for value in expected.values():
        if set(value) != {'id', 'image'} or not re.fullmatch('[0-9a-f]{64}', value['id']) or not re.fullmatch('sha256:[0-9a-f]{64}', value['image']):
            raise ValueError('invalid identity')
    if len({v['id'] for v in expected.values()}) != 3: raise ValueError('duplicate identity')


def check_services(expected, run=command, http=http_probe):
    validate_expected(expected)
    reasons = []
    try:
        actual = run(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=dealer-recon']).splitlines()
        if set(actual) != {v['id'] for v in expected.values()}: reasons.append('CONTAINER_SET_DRIFT')
    except Exception: reasons.append('DOCKER_UNAVAILABLE')
    for service, identity in expected.items():
        try:
            value = json.loads(run(['docker', 'inspect', '--format', INSPECT, identity['id']]))
            wanted_ports = {} if service == 'db' else {('8000/tcp' if service == 'backend' else '8080/tcp'): [{'HostIp': '127.0.0.1', 'HostPort': '8000' if service == 'backend' else '5173'}]}
            if any([value['id'] != identity['id'], value['image'] != identity['image'], value['project'] != 'dealer-recon', value['service'] != service, (value['ports'] or {}) != wanted_ports]):
                reasons.append(service.upper() + '_IDENTITY_DRIFT')
            if value['running'] is not True or (service != 'frontend' and value['health'] != 'healthy') or value['health'] == 'unhealthy':
                reasons.append(service.upper() + '_UNHEALTHY')
        except Exception: reasons.append(service.upper() + '_INSPECTION_FAILED')
    try: run(['systemctl', 'is-active', '--quiet', 'caddy'])
    except Exception: reasons.append('CADDY_UNAVAILABLE')
    for name, url in [('BACKEND', 'http://127.0.0.1:8000/ready'), ('FRONTEND', 'http://127.0.0.1:5173/')]:
        try: http(url)
        except Exception: reasons.append(name + '_HTTP_FAILED')
    try:
        output = run(['docker', 'exec', expected['db']['id'], 'sh', '-c', 'export PGCONNECT_TIMEOUT=3 PGOPTIONS="-c statement_timeout=3000"; exec psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "BEGIN READ ONLY; SELECT 1; COMMIT;"'])
        if output != '1': raise ValueError('query failed')
    except Exception: reasons.append('DATABASE_UNAVAILABLE')
    return {'status': 'fail' if reasons else 'ok', 'reason_codes': reasons}


def service_signal(ok, failures):
    if ok: return 'success', 0
    failures = min(failures + 1, 2)
    return ('fail' if failures >= 2 else None), failures


def review_completed(directory, now):
    try:
        date = now.astimezone(ZoneInfo('America/Chicago')).date().isoformat()
        record = json.loads(private_read(directory / (date + '.json')))
        reviewed = timestamp(record['reviewed_at_utc'])
        required = {'scheduled_outcome', 'backup_age', 'checksum', 'failure_log', 'disk', 'restore_evidence', 'open_incidents'}
        return (reviewed <= now and reviewed.astimezone(ZoneInfo('America/Chicago')).date().isoformat() == date
                and isinstance(record.get('reviewer'), str) and bool(record['reviewer'].strip())
                and set(record.get('checked', {})) == required and all(v is True for v in record['checked'].values()))
    except (OSError, ValueError, KeyError, TypeError): return False


def save_state(path, state):
    private_dir(path.parent)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.monitor-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


class EvaluationDeadline(BaseException):
    """Bypass per-probe Exception handlers; never continue an expired evaluation."""


def deadline(signum, frame):
    raise EvaluationDeadline()


def main(deliver=False):
    os.umask(0o077)
    # Provisioning is a separate operation: never create production directories here.
    private_dir(STATE)
    lock_fd = os.open(STATE / 'poll.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: event('monitor_overlap'); return 75
        signal.signal(signal.SIGALRM, deadline); signal.alarm(45)
        try:
            now = dt.datetime.now(dt.timezone.utc)
            expected = json.loads(private_read(CONFIG / 'containers.json'))
            state_path = STATE / 'state.json'
            state = json.loads(private_read(state_path)) if state_path.exists() else {}
            result = check_services(expected)
            disk = shutil.disk_usage(BASE)
            if disk.free < 10 * 1024**3 or disk.used / disk.total > .85:
                result['status'] = 'fail'; result['reason_codes'].append('DISK_CAPACITY_LOW')
            sig, failures = service_signal(result['status'] == 'ok', int(state.get('service_failures', 0)))
            state['service_failures'] = failures
            signals = [('service-health', sig)] if sig else []
            if time.time() - float(state.get('backup_checked_at', 0)) >= 300 or time.time() < float(state.get('backup_checked_at', 0)):
                backup = backup_freshness(BASE, now)
                signals.append(('backup-freshness', 'success' if backup['status'] == 'ok' else 'fail'))
                state['backup_checked_at'] = time.time()
                event('backup_freshness', **backup)
            review_time = now.astimezone(ZoneInfo('America/Chicago'))
            date = review_time.date().isoformat()
            # An early review must not satisfy the previous Healthchecks cron window.
            if review_time.hour >= 10 and review_completed(STATE / 'reviews', now) and state.get('review_sent_date') != date:
                signals.append(('daily-review', 'success'))
            # No sends until complete evaluation; a killed/hung evaluator cannot claim success.
            if deliver:
                for check, value in signals:
                    if send(check, value) and check == 'daily-review': state['review_sent_date'] = date
                save_state(state_path, state)
            event('service_health', **result, observed_at_utc=now.isoformat(), delivery_enabled=deliver)
            return 0 if result['status'] == 'ok' else 1
        finally: signal.alarm(0)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--send', action='store_true'); args = parser.parse_args()
    try: raise SystemExit(main(args.send))
    except (Exception, EvaluationDeadline): event('monitor_evaluation_failed'); raise SystemExit(2)

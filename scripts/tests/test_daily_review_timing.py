"""Run the real evaluator with invented review files and isolated external probes."""
import contextlib
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_operational_monitoring import archive, health, write


class DailyReviewTiming(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config, self.state, self.backups = [self.root / name for name in ('config', 'state', 'backups')]
        for directory in (self.config, self.state, self.backups, self.state / 'reviews'):
            directory.mkdir(mode=0o700)
        write(self.config / 'containers.json', {})

    def review(self, date, reviewed_at):
        path = self.state / 'reviews' / (date + '.json')
        write(path, {
            'reviewer': 'Invented test operator', 'reviewed_at_utc': reviewed_at,
            'checked': dict.fromkeys(('scheduled_outcome', 'backup_age', 'checksum',
                                     'failure_log', 'disk', 'restore_evidence', 'open_incidents'), True),
        })
        return path

    def poll(self, timestamp, *, accepted=True, deliver=True, probe_error=None):
        now = dt.datetime.fromisoformat(timestamp)
        if not list(self.backups.iterdir()):
            archive(self.backups, now - dt.timedelta(hours=1))
        class Clock(dt.datetime):
            @classmethod
            def now(cls, tz=None):
                return now
        signals = []
        def sender(check, signal):
            signals.append((check, signal))
            return accepted if check == 'daily-review' else True
        disk = type('Disk', (), dict(free=20 * 1024**3, used=50, total=100))()
        with contextlib.ExitStack() as stack:
            for name, value in [('CONFIG', self.config), ('STATE', self.state), ('BASE', self.backups)]:
                stack.enter_context(patch.object(health, name, value))
            stack.enter_context(patch.object(health.dt, 'datetime', Clock))
            stack.enter_context(patch.object(health.time, 'time', return_value=now.timestamp()))
            stack.enter_context(patch.object(health.shutil, 'disk_usage', return_value=disk))
            stack.enter_context(patch.object(health, 'check_services',
                                            return_value={'status': 'ok', 'reason_codes': []},
                                            side_effect=probe_error))
            stack.enter_context(patch.object(health, 'send', side_effect=sender))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            if probe_error:
                with self.assertRaises(health.EvaluationDeadline):
                    health.main(deliver)
            else:
                self.assertEqual(health.main(deliver), 0)
        return signals

    def saved(self):
        path = self.state / 'state.json'
        return json.loads(path.read_text()) if path.exists() else {}

    def test_early_review_preserved_until_exact_ten_then_sent_once(self):
        record = self.review('2026-10-21', '2026-10-21T14:00:00+00:00')
        original = record.read_bytes()
        self.assertEqual(self.poll('2026-10-21T14:59:59+00:00'),
                         [('service-health', 'success'), ('backup-freshness', 'success')])
        self.assertNotIn('review_sent_date', self.saved())
        self.assertEqual(record.read_bytes(), original)
        self.assertEqual(self.poll('2026-10-21T15:00:00+00:00'),
                         [('service-health', 'success'), ('daily-review', 'success')])
        self.assertEqual(self.saved()['review_sent_date'], '2026-10-21')
        self.assertEqual(self.poll('2026-10-21T15:01:00+00:00'), [('service-health', 'success')])
        self.assertEqual(record.read_bytes(), original)

    def test_failed_delivery_recovers_on_next_poll_without_consuming_day(self):
        self.review('2026-10-21', '2026-10-21T14:00:00+00:00')
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-21T15:00:00+00:00', accepted=False))
        self.assertNotIn('review_sent_date', self.saved())
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-21T15:01:00+00:00'))
        self.assertEqual(self.saved()['review_sent_date'], '2026-10-21')
        self.assertNotIn(('daily-review', 'success'), self.poll('2026-10-21T15:02:00+00:00'))

    def test_late_review_uses_chicago_day_across_utc_and_local_midnight(self):
        self.review('2026-10-21', '2026-10-22T04:50:00+00:00')
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-22T04:55:00+00:00'))
        self.assertEqual(self.saved()['review_sent_date'], '2026-10-21')
        self.assertNotIn(('daily-review', 'success'), self.poll('2026-10-22T05:01:00+00:00'))
        self.assertNotIn(('daily-review', 'success'), self.poll('2026-10-22T15:00:00+00:00'))
        self.review('2026-10-22', '2026-10-22T14:00:00+00:00')
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-22T15:01:00+00:00'))
        self.assertEqual(self.saved()['review_sent_date'], '2026-10-22')

    def test_dst_transition_days_use_local_ten_not_fixed_utc_hour(self):
        # Spring forward: 10 CDT = 15 UTC. Fall back: 10 CST = 16 UTC.
        for day, early, boundary in [('2026-03-08', '14:59:59', '15:00:00'),
                                     ('2026-11-01', '15:59:59', '16:00:00')]:
            with self.subTest(day=day):
                self.review(day, day + 'T08:00:00+00:00')
                self.assertNotIn(('daily-review', 'success'), self.poll(day + 'T' + early + '+00:00'))
                self.assertIn(('daily-review', 'success'), self.poll(day + 'T' + boundary + '+00:00'))
                self.assertNotIn(('daily-review', 'success'), self.poll(day + 'T18:00:00+00:00'))

    def test_missing_invalid_future_or_incomplete_evidence_never_sends(self):
        for mutation in ('missing', 'json', 'unchecked', 'future', 'previous-day', 'reviewer', 'symlink', 'public'):
            with self.subTest(mutation=mutation):
                path = self.review('2026-10-21', '2026-10-21T14:00:00+00:00')
                record = json.loads(path.read_text())
                if mutation == 'missing': path.unlink()
                elif mutation == 'json': write(path, '{invalid')
                elif mutation == 'unchecked':
                    record['checked']['checksum'] = False; write(path, record)
                elif mutation == 'future':
                    record['reviewed_at_utc'] = '2026-10-21T16:01:00+00:00'; write(path, record)
                elif mutation == 'previous-day':
                    record['reviewed_at_utc'] = '2026-10-20T14:00:00+00:00'; write(path, record)
                elif mutation == 'reviewer':
                    record['reviewer'] = ' '; write(path, record)
                elif mutation == 'symlink':
                    target = self.root / 'invented-review.json'; path.rename(target); path.symlink_to(target)
                elif mutation == 'public': path.chmod(0o644)
                self.assertNotIn(('daily-review', 'success'), self.poll('2026-10-21T16:00:00+00:00'))
                self.assertNotIn('review_sent_date', self.saved())
                if path.exists() or path.is_symlink(): path.unlink()

    def test_dry_run_does_not_send_or_consume_valid_due_review(self):
        self.review('2026-10-21', '2026-10-21T14:00:00+00:00')
        self.assertEqual(self.poll('2026-10-21T15:00:00+00:00', deliver=False), [])
        self.assertEqual(self.saved(), {})
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-21T15:01:00+00:00'))

    def test_incomplete_evaluation_does_not_send_or_consume_review(self):
        self.review('2026-10-21', '2026-10-21T14:00:00+00:00')
        self.assertEqual(self.poll('2026-10-21T15:00:00+00:00', probe_error=health.EvaluationDeadline), [])
        self.assertEqual(self.saved(), {})
        self.assertIn(('daily-review', 'success'), self.poll('2026-10-21T15:01:00+00:00'))


if __name__ == '__main__':
    unittest.main()

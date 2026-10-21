"""Docker projection regression and synthetic policy cases; no production access."""
import json
import os
import subprocess
import unittest
import uuid

import test_operational_monitoring as monitoring

health = monitoring.health


class HealthPolicy(unittest.TestCase):
    def setUp(self):
        self.probes = monitoring.AdditionalFaultCoverage()
        self.expected = self.probes.expected()

    def evaluate(self, service, change, http=lambda url: 'ok'):
        def run(args):
            output = self.probes.run_probe(args)
            if args[:2] == ['docker', 'inspect'] and args[-1] == self.expected[service]['id']:
                value = json.loads(output)
                change(value)
                return json.dumps(value)
            return output
        return health.check_services(self.expected, run, http)

    def test_db_and_backend_still_require_explicit_healthy(self):
        for service in ('db', 'backend'):
            for status in ('none', 'starting', 'unhealthy', '', None):
                with self.subTest(service=service, status=status):
                    result = self.evaluate(service, lambda v: v.update(health=status))
                    self.assertEqual(result, {'status': 'fail', 'reason_codes': [service.upper() + '_UNHEALTHY']})

    def test_missing_projected_health_is_an_inspection_failure(self):
        for service in self.expected:
            with self.subTest(service=service):
                result = self.evaluate(service, lambda v: v.pop('health'))
                self.assertEqual(result, {'status': 'fail', 'reason_codes': [service.upper() + '_INSPECTION_FAILED']})

    def test_frontend_without_health_still_requires_running_identity_and_image(self):
        self.assertEqual(self.evaluate('frontend', lambda v: None), {'status': 'ok', 'reason_codes': []})
        for field, value, reason in (
            ('running', False, 'FRONTEND_UNHEALTHY'),
            ('id', 'd' * 64, 'FRONTEND_IDENTITY_DRIFT'),
            ('image', 'sha256:' + 'd' * 64, 'FRONTEND_IDENTITY_DRIFT'),
            ('health', 'unhealthy', 'FRONTEND_UNHEALTHY'),
        ):
            with self.subTest(field=field):
                self.assertEqual(self.evaluate('frontend', lambda v: v.update({field: value})),
                                 {'status': 'fail', 'reason_codes': [reason]})

    def test_frontend_without_health_still_requires_http(self):
        def http(url):
            if url == 'http://127.0.0.1:5173/': raise OSError('invented-private-response')
            return 'ok'
        self.assertEqual(self.evaluate('frontend', lambda v: None, http),
                         {'status': 'fail', 'reason_codes': ['FRONTEND_HTTP_FAILED']})


@unittest.skipUnless(os.environ.get('RUN_DOCKER_MONITOR_TESTS') == '1',
                     'Set RUN_DOCKER_MONITOR_TESTS=1 on an isolated Docker test host (required in CI)')
class DockerHealthProjection(unittest.TestCase):
    def docker(self, *args):
        return subprocess.run(['docker', *args], check=True, capture_output=True,
                              text=True, timeout=30).stdout.strip()

    def test_real_container_without_health_projects_none_not_healthy(self):
        name = 'dealer-recon-monitor-test-' + uuid.uuid4().hex
        container = self.docker('create', '--name', name, '--network', 'none',
                                '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                                '--no-healthcheck', '--label', 'com.docker.compose.project=monitor-regression',
                                '--label', 'com.docker.compose.service=frontend',
                                '--env', 'INVENTED_PRIVATE_SENTINEL=must-not-be-exported',
                                'python:3.12-slim', 'python3', '-c', 'import time; time.sleep(120)')
        self.addCleanup(self.docker, 'rm', '-f', container)  # Only the exact container created above; no volumes.
        self.docker('start', container)
        state = json.loads(self.docker('inspect', '--format', '{{json .State}}', container))
        self.assertTrue(state['Running'])
        self.assertNotIn('Health', state)  # Establish the real Docker shape that triggered the incident.
        result = subprocess.run(['docker', 'inspect', '--format', health.INSPECT, container],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        projection = json.loads(result.stdout)
        self.assertEqual(projection, {
            'id': container, 'image': self.docker('inspect', '--format', '{{.Image}}', container),
            'running': True, 'health': 'none', 'project': 'monitor-regression',
            'service': 'frontend', 'ports': {},
        })
        self.assertNotIn('INVENTED_PRIVATE_SENTINEL', result.stdout)
        self.assertNotIn('must-not-be-exported', result.stdout)


if __name__ == '__main__': unittest.main()

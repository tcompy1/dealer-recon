"""Render only synthetic configuration; never start a service or read an env file."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

class ComposeContract(unittest.TestCase):
    @unittest.skipUnless(shutil.which('docker'), 'Docker Compose CLI unavailable')
    def test_restart_bindings_and_health_dependencies(self):
        root=Path(__file__).resolve().parents[2]
        env={**os.environ, 'POSTGRES_DB':'invented','POSTGRES_USER':'invented','POSTGRES_PASSWORD':'invented-test-only',
             'DATABASE_URL':'postgresql://invented:invented@db:5432/invented','BACKEND_CORS_ORIGINS':'https://invented.invalid',
             'DEFAULT_DEALERSHIP_ID':'invented','SESSION_SECRET':'invented-test-only','VITE_API_BASE_URL':'https://invented.invalid'}
        result=subprocess.run(['docker','compose','--env-file','/dev/null','-f',str(root/'docker-compose.prod.yml'),'config','--format','json'],env=env,capture_output=True,text=True,check=True,timeout=15)
        services=json.loads(result.stdout)['services']
        self.assertEqual(set(services),{'db','backend','frontend'})
        for service in services.values():self.assertEqual(service['restart'],'unless-stopped')
        self.assertNotIn('ports',services['db'])
        for name,published,target in [('backend','8000',8000),('frontend','5173',8080)]:
            ports=services[name]['ports'];self.assertEqual(len(ports),1)
            self.assertEqual((ports[0]['host_ip'],str(ports[0]['published']),ports[0]['target']),('127.0.0.1',published,target))
        self.assertEqual(services['backend']['depends_on']['db']['condition'],'service_healthy')
        self.assertEqual(services['frontend']['depends_on']['backend']['condition'],'service_healthy')
        for name in ['db','backend']:self.assertTrue(services[name]['healthcheck']['test'])

if __name__=='__main__':unittest.main()

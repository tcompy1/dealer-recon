"""Invented files and mocked outbound HTTP only; never access protected evidence."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1] / 'operations'
sys.path.insert(0, str(OPS))
# Missing implementation is initially represented by a failing behavior assertion.
def load(name):
    path = OPS / (name + '.py')
    if not path.exists(): return None
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
common = load('monitor_common')
health = load('resilience-check')
adapter = load('scheduled-backup-monitor')
NOW = dt.datetime(2026, 10, 19, 17, tzinfo=dt.timezone.utc)

def write(path, value):
    path.write_text(json.dumps(value) if not isinstance(value, str) else value)
    path.chmod(0o600)

def archive(base, now=NOW, name='20261019T170000Z.invented.archive-ok'):
    p = base / name; p.mkdir(mode=0o700)
    dump = b'PGDMP independently invented archive content'
    (p / 'database.dump').write_bytes(dump); (p / 'database.dump').chmod(0o600)
    sha = hashlib.sha256(dump).hexdigest()
    write(p / 'record.json', dict(status='ARCHIVE_VALIDATED_RESTORE_NOT_TESTED', started_utc=now.isoformat(), completed_utc=now.isoformat(), bytes=len(dump), sha256=sha, pg_dump_exit=0, archive_list_exit=0, restore_result='NOT_PERFORMED'))
    write(p / 'SHA256SUMS', sha + '  database.dump\n')
    write(p / 'archive.list', 'invented archive inventory\n'); write(p / 'stderr.log', '')
    return p

class BackupValidation(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(common, 'backup monitoring validation not implemented')
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name); self.p = archive(self.base)
    def test_nonempty_validated_archive_is_fresh_without_claiming_restore(self):
        result = common.inspect_archive(self.p, NOW)
        self.assertEqual(result['completed_utc'], NOW.isoformat())
        self.assertNotIn('RESTORE_VERIFIED', json.dumps(result))
        self.assertEqual(common.backup_freshness(self.base, NOW)['status'], 'ok')
    def test_26_hour_boundary_and_dst_use_elapsed_utc(self):
        self.assertEqual(common.backup_freshness(self.base, NOW+dt.timedelta(hours=26))['status'], 'ok')
        self.assertEqual(common.backup_freshness(self.base, NOW+dt.timedelta(hours=26, seconds=1))['reason_codes'], ['BACKUP_STALE'])
    def test_empty_missing_corrupt_or_changed_archives_fail_closed(self):
        for mutation in ['empty', 'missing', 'checksum', 'record', 'future', 'stderr', 'list', 'failed', 'permissions']:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as d:
                p = archive(Path(d))
                if mutation == 'empty': (p/'database.dump').write_bytes(b'')
                if mutation == 'missing': (p/'database.dump').unlink()
                if mutation == 'checksum': (p/'database.dump').write_bytes(b'x' * (p/'database.dump').stat().st_size)
                if mutation == 'record': write(p/'record.json', '{broken')
                if mutation == 'future':
                    r=json.loads((p/'record.json').read_text());r['completed_utc']=(NOW+dt.timedelta(seconds=1)).isoformat();write(p/'record.json',r)
                if mutation == 'stderr': write(p/'stderr.log','private warning')
                if mutation == 'list': write(p/'archive.list','')
                if mutation == 'failed': write(p/'FAILED','failed')
                if mutation == 'permissions': (p/'database.dump').chmod(0o644)
                self.assertEqual(common.backup_freshness(Path(d),NOW)['reason_codes'], ['BACKUP_INVALID'])
    def test_partial_and_empty_legacy_files_never_count_as_restore_points(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d);(base/'old.dump').touch();(base/'20261019.partial').mkdir()
            self.assertEqual(common.backup_freshness(base,NOW)['reason_codes'], ['BACKUP_MISSING'])
    def test_symlink_rejected_and_newer_corrupt_archive_does_not_fall_back(self):
        newer=self.base/'20261019T180000Z.invented.archive-ok';newer.symlink_to(self.p)
        self.assertEqual(common.backup_freshness(self.base,NOW)['reason_codes'], ['BACKUP_INVALID'])

class Heartbeat(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(common, 'heartbeat sender not implemented')
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
        self.url='https://hc-ping.com/00000000-0000-4000-8000-000000000000' # invented, never requested
        write(self.base/'service-health.url',self.url)
    def test_signal_only_tls_request_no_redirects_or_payload(self):
        seen=[]
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*a):pass
        class Transport:
            def open(inner,request,timeout):seen.append((request,timeout));return Response()
        self.assertTrue(common.send('service-health','fail',self.base,Transport()))
        request,timeout=seen[0]
        self.assertEqual(request.full_url,self.url+'/fail');self.assertEqual(request.data,b'');self.assertLessEqual(timeout,5)
        self.assertEqual(request.method,'POST')
    def test_invalid_destination_permissions_symlink_and_missing_secret_do_not_send(self):
        for value in ['http://hc-ping.com/x','https://evil.invalid/x',self.url+'?secret=x',self.url+'#x','https://user:secret@hc-ping.com/x']:
            write(self.base/'service-health.url',value)
            self.assertFalse(common.send('service-health','success',self.base))
        write(self.base/'service-health.url',self.url);(self.base/'service-health.url').chmod(0o644)
        self.assertFalse(common.send('service-health','success',self.base))
        self.assertFalse(common.send('../escape','success',self.base))
    def test_delivery_failure_is_redacted_and_never_raises(self):
        class Broken:
            def open(inner,*a,**kw):raise OSError(self.url+' private-data')
        captured=io.StringIO()
        with contextlib.redirect_stderr(captured): self.assertFalse(common.send('service-health','success',self.base,Broken()))
        self.assertNotIn(self.url,captured.getvalue());self.assertNotIn('private-data',captured.getvalue())

class Services(unittest.TestCase):
    def setUp(self):self.assertIsNotNone(health,'service evaluator not implemented')
    def sample(self):
        return {s:dict(id=c*64,image='sha256:'+c*64) for s,c in [('db','a'),('backend','b'),('frontend','c')]}
    def test_reports_each_failed_probe_without_exposing_outputs(self):
        expected=self.sample()
        def run(args):
            if args[:2]==['docker','ps']:return '\n'.join(v['id'] for v in expected.values())
            if args[:2]==['docker','inspect']:
                service=next(s for s,v in expected.items() if v['id']==args[-1])
                return json.dumps(dict(id=expected[service]['id'],image=expected[service]['image'],running=True,health='healthy' if service!='frontend' else 'none',project='dealer-recon',service=service,ports={} if service=='db' else {('8000/tcp' if service=='backend' else '8080/tcp'):[{'HostIp':'127.0.0.1','HostPort':'8000' if service=='backend' else '5173'}]}))
            if args[:2]==['docker','exec']:return '1'
            return ''
        self.assertEqual(health.check_services(expected,run,lambda url:'ok')['status'],'ok')
        def failed(args):raise subprocess.TimeoutExpired('private credential command',3)
        result=health.check_services(expected,failed,lambda url: (_ for _ in ()).throw(OSError('private')))
        self.assertEqual(result['status'],'fail');self.assertNotIn('private',json.dumps(result))
        self.assertIn('DATABASE_UNAVAILABLE',result['reason_codes'])
    def test_debounce_never_sends_success_on_incomplete_or_failed_poll(self):
        self.assertEqual(health.service_signal(False,0),(None,1))
        self.assertEqual(health.service_signal(False,1),('fail',2))
        self.assertEqual(health.service_signal(True,2),('success',0))
    def test_missing_daily_review_is_not_automatically_successful(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(health.review_completed(Path(d),NOW))

class Scheduled(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(adapter,'scheduled backup adapter not implemented')
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
    def execute(self,code=0,valid=True,notify=True):
        events=[];calls=[]
        def runner():
            calls.append(1)
            if valid:p=archive(self.base);return code,str(p)+'\n'
            return code,'sensitive stdout password'
        status=adapter.execute(self.base,runner,lambda check,signal:events.append(signal) or notify,lambda:NOW)
        return status,events,calls
    def test_success_only_after_new_archive_validation(self):
        status,events,calls=self.execute();self.assertEqual(status,0);self.assertEqual(events,['start','success']);self.assertEqual(calls,[1])
    def test_original_failure_exit_preserved_even_if_notifier_fails(self):
        status,events,calls=self.execute(75,False,False);self.assertEqual(status,75);self.assertEqual(events,['start','fail']);self.assertEqual(calls,[1])
    def test_exit_zero_without_valid_archive_is_failure_without_relabeling_exit(self):
        status,events,_=self.execute(0,False);self.assertEqual(status,0);self.assertEqual(events,['start','fail'])
    def test_existing_archive_cannot_be_reported_as_new_success(self):
        p=archive(self.base);events=[]
        code=adapter.execute(self.base,lambda:(0,str(p)+'\n'),lambda check,signal:events.append(signal) or True,lambda:NOW)
        self.assertEqual(code,0);self.assertEqual(events,['start','fail'])
    def test_delivery_failure_cannot_invalidate_successful_archive(self):
        code,events,_=self.execute(0,True,False);self.assertEqual(code,0);self.assertEqual(events,['start','success'])
        self.assertTrue(next(self.base.glob('*.archive-ok')).exists())

class RuntimeBoundaries(unittest.TestCase):
    def test_overall_deadline_cannot_be_swallowed_by_individual_probe_handlers(self):
        expected={s:dict(id=c*64,image='sha256:'+c*64) for s,c in [('db','a'),('backend','b'),('frontend','c')]}
        def expired(args):raise health.EvaluationDeadline()
        with self.assertRaises(health.EvaluationDeadline):health.check_services(expected,expired,lambda url:'ok')
    def test_real_subprocess_timeout_is_bounded(self):
        import time
        start=time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):health.command([sys.executable,'-c','import time;time.sleep(20)'])
        self.assertLess(time.monotonic()-start,8)
    def test_poll_persists_debounce_and_never_sends_on_failed_or_incomplete_evaluation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);config=root/'config';state=root/'state';base=root/'backup'
            for p in [config,state,base]:p.mkdir(mode=0o700)
            write(config/'containers.json',{})
            now=dt.datetime.now(dt.timezone.utc);archive(base,now)
            events=[]
            with patch.object(health,'CONFIG',config),patch.object(health,'STATE',state),patch.object(health,'BASE',base),patch.object(health,'check_services',return_value={'status':'fail','reason_codes':['DATABASE_UNAVAILABLE']}),patch.object(health,'send',side_effect=lambda c,s:events.append((c,s)) or True),patch.object(health.shutil,'disk_usage',return_value=type('Disk',(),dict(free=20*1024**3,used=10,total=100))()):
                self.assertEqual(health.main(True),1)
                self.assertNotIn(('service-health','success'),events)
                self.assertNotIn(('service-health','fail'),events)
                self.assertEqual(health.main(True),1)
                self.assertIn(('service-health','fail'),events)
                self.assertNotIn(('daily-review','success'),events)
                events.clear()
                with patch.object(health,'check_services',side_effect=health.EvaluationDeadline):
                    with self.assertRaises(health.EvaluationDeadline):health.main(True)
                self.assertEqual(events,[]) # missing evaluation produces no reassuring heartbeat
    def test_failed_backup_stderr_is_retained_privately_not_printed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);script=root/'wrapper';script.write_text('#!/bin/sh\necho private-diagnostic >&2\nexit 17\n');script.chmod(0o700)
            with patch.object(adapter,'WRAPPER',str(script)),patch.object(adapter,'BASE',root):
                code,output=adapter.run_backup()
            self.assertEqual(code,17)
            records=list(root.glob('adapter-*.stderr'))
            self.assertEqual(len(records),1)
            self.assertEqual(records[0].stat().st_mode & 0o777,0o600)
            self.assertIn('private-diagnostic',records[0].read_text())
            self.assertNotIn('private-diagnostic',output)
    def test_symlink_credentials_never_followed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);write(root/'real.url','https://hc-ping.com/00000000-0000-4000-8000-000000000000')
            (root/'service-health.url').symlink_to(root/'real.url')
            self.assertFalse(common.send('service-health','success',root))
    def test_redirect_handler_rejects_redirect_even_to_same_host(self):
        self.assertIsNone(common.NoRedirect().redirect_request(None,None,302,'',{},'https://hc-ping.com/other'))


class ReviewRegressions(unittest.TestCase):
    def test_stalled_notification_has_total_deadline_and_backup_still_runs_once(self):
        import time
        class Stalled:
            def open(self,*args,**kwargs):time.sleep(5);raise OSError('private')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);write(root/'scheduled-backup.url','https://hc-ping.com/00000000-0000-4000-8000-000000000000')
            calls=[]
            def notify(check,signal):return common.send(check,signal,root,Stalled())
            with patch.object(common,'DELIVERY_SECONDS',0.05,create=True):
                start=time.monotonic()
                result=adapter.execute(root,lambda:(calls.append(1) or 17,''),notify,lambda:NOW)
                self.assertLess(time.monotonic()-start,1)
            self.assertEqual(result,17);self.assertEqual(calls,[1])
    def test_malformed_record_types_preserve_wrapper_exit_and_report_failure(self):
        for record in [[],None,42,{'status':'ARCHIVE_VALIDATED_RESTORE_NOT_TESTED','pg_dump_exit':0,'archive_list_exit':0,'started_utc':[]}]:
            with self.subTest(record=record),tempfile.TemporaryDirectory() as d:
                root=Path(d);events=[]
                def run():
                    p=archive(root);write(p/'record.json',record);return 0,str(p)
                code=adapter.execute(root,run,lambda c,s:events.append(s) or True,lambda:NOW)
                self.assertEqual(code,0);self.assertEqual(events,['start','fail'])
                self.assertEqual(common.backup_freshness(root,NOW)['status'],'fail')
    def test_post_wrapper_fsync_failure_preserves_actual_exit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);script=root/'wrapper';script.write_text('#!/bin/sh\nexit 17\n');script.chmod(0o700)
            with patch.object(adapter,'WRAPPER',str(script)),patch.object(adapter,'BASE',root),patch.object(adapter.os,'fsync',side_effect=OSError('private')):
                code,_=adapter.run_backup()
            self.assertEqual(code,17)
    def test_stdout_and_stderr_retained_privately_without_log_disclosure(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);script=root/'wrapper';script.write_text('#!/bin/sh\necho private-output\necho private-error >&2\nexit 17\n');script.chmod(0o700)
            captured=io.StringIO()
            with patch.object(adapter,'WRAPPER',str(script)),patch.object(adapter,'BASE',root),contextlib.redirect_stderr(captured):code,output=adapter.run_backup()
            self.assertEqual(code,17);self.assertEqual(output,'private-output\n')
            for suffix,contents in [('stdout','private-output'),('stderr','private-error')]:
                files=list(root.glob('adapter-*.'+suffix));self.assertEqual(len(files),1)
                self.assertEqual(files[0].stat().st_mode & 0o777,0o600);self.assertIn(contents,files[0].read_text())
            self.assertNotIn('private-',captured.getvalue())


class AdditionalFaultCoverage(unittest.TestCase):
    def expected(self):return {s:dict(id=c*64,image='sha256:'+c*64) for s,c in [('db','a'),('backend','b'),('frontend','c')]}
    def run_probe(self,args):
        expected=self.expected()
        if args[:2]==['docker','ps']:return '\n'.join(v['id'] for v in expected.values())
        if args[:2]==['docker','inspect']:
            service=next(s for s,v in expected.items() if v['id']==args[-1])
            return json.dumps(dict(**expected[service],running=True,health='healthy' if service!='frontend' else 'none',project='dealer-recon',service=service,ports={} if service=='db' else {('8000/tcp' if service=='backend' else '8080/tcp'):[{'HostIp':'127.0.0.1','HostPort':'8000' if service=='backend' else '5173'}]}))
        return '1' if args[:2]==['docker','exec'] else ''
    def test_each_container_identity_state_and_publication_drift(self):
        for service in self.expected():
            for field,bad in [('id','d'*64),('image','sha256:'+'d'*64),('running',False),('health','unhealthy'),('project','other'),('service','other'),('ports',{'8000/tcp':[{'HostIp':'0.0.0.0','HostPort':'8000'}]})]:
                with self.subTest(service=service,field=field):
                    def run(args):
                        output=self.run_probe(args)
                        if args[:2]==['docker','inspect'] and args[-1]==self.expected()[service]['id']:
                            value=json.loads(output);value[field]=bad;return json.dumps(value)
                        return output
                    result=health.check_services(self.expected(),run,lambda u:'ok')
                    self.assertEqual(result['status'],'fail')
                    self.assertIn(service.upper()+('_UNHEALTHY' if field in ['running','health'] else '_IDENTITY_DRIFT'),result['reason_codes'])
    def test_missing_extra_container_caddy_and_query_failure_independently(self):
        for kind in ['missing','extra','caddy','query']:
            def run(args):
                if args[:2]==['docker','ps']:
                    if kind=='missing':return self.expected()['db']['id']
                    if kind=='extra':return self.run_probe(args)+'\n'+'d'*64
                if args[0]=='systemctl' and kind=='caddy':raise OSError('private')
                if args[:2]==['docker','exec'] and kind=='query':return 'unexpected'
                return self.run_probe(args)
            self.assertEqual(health.check_services(self.expected(),run,lambda u:'ok')['status'],'fail')
    def test_real_local_http_status_and_readiness_body(self):
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        import threading
        class Handler(BaseHTTPRequestHandler):
            code=200;body=b'{"status":"ready"}'
            def do_GET(self):self.send_response(self.code);self.end_headers();self.wfile.write(self.body)
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            url='http://127.0.0.1:'+str(server.server_port)+'/ready'
            self.assertEqual(health.http_probe(url),'ok')
            for code,body in [(503,b'{"status":"ready"}'),(200,b'{"status":"ok"}'),(200,b''),(200,b'not json'),(302,b'redirect')]:
                Handler.code=code;Handler.body=body
                with self.assertRaises(Exception):health.http_probe(url)
        finally:server.shutdown();server.server_close();thread.join()
    def test_real_lock_overlap_does_not_probe_or_send(self):
        import fcntl
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with (root/'poll.lock').open('w') as lock,patch.object(health,'STATE',root),patch.object(health,'check_services') as probe,patch.object(health,'send') as sender:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                self.assertEqual(health.main(True),75);probe.assert_not_called();sender.assert_not_called()
    def test_dst_review_date_requires_explicit_complete_current_day_record(self):
        required=['scheduled_outcome','backup_age','checksum','failure_log','disk','restore_evidence','open_incidents']
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            # Both 01:30 instances on fall-back day are the same local review day.
            first=dt.datetime(2026,11,1,6,30,tzinfo=dt.timezone.utc);second=first+dt.timedelta(hours=1)
            record={'reviewed_at_utc':first.isoformat(),'reviewer':'Invented operator','checked':dict.fromkeys(required,True)}
            write(root/'2026-11-01.json',record)
            self.assertTrue(health.review_completed(root,first));self.assertTrue(health.review_completed(root,second))
            self.assertFalse(health.review_completed(root,first-dt.timedelta(seconds=1)))
            self.assertFalse(health.review_completed(root,dt.datetime(2026,11,2,6,0,tzinfo=dt.timezone.utc)))
            record['checked']['checksum']=False;write(root/'2026-11-01.json',record)
            self.assertFalse(health.review_completed(root,second))
    def test_archive_mutation_during_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=archive(root);real_sha=hashlib.sha256
            class Changed:
                def __init__(self):self.sha=real_sha()
                def update(self,block):self.sha.update(block);(p/'database.dump').write_bytes(b'changed while hashing')
                def hexdigest(self):return self.sha.hexdigest()
            with patch.object(common.hashlib,'sha256',Changed):self.assertEqual(common.backup_freshness(root,NOW)['reason_codes'],['BACKUP_INVALID'])
    def test_nested_delivery_and_evaluator_deadlines(self):
        import signal,time
        class Stalled:
            def open(self,*a,**kw):time.sleep(5)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);write(root/'service-health.url','https://hc-ping.com/00000000-0000-4000-8000-000000000000')
            original=signal.getsignal(signal.SIGALRM)
            try:
                signal.signal(signal.SIGALRM,health.deadline);signal.setitimer(signal.ITIMER_REAL,.03)
                with patch.object(common,'DELIVERY_SECONDS',.1),self.assertRaises(health.EvaluationDeadline):common.send('service-health','success',root,Stalled())
                signal.setitimer(signal.ITIMER_REAL,.5)
                with patch.object(common,'DELIVERY_SECONDS',.03):self.assertFalse(common.send('service-health','success',root,Stalled()))
                self.assertIs(signal.getsignal(signal.SIGALRM),health.deadline)
                self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0],.2);self.assertLess(signal.getitimer(signal.ITIMER_REAL)[0],.5)
            finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,original)
    def test_interrupted_adapter_never_reports_success(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);events=[]
            def interrupted():raise KeyboardInterrupt()
            with self.assertRaises(KeyboardInterrupt):adapter.execute(root,interrupted,lambda c,s:events.append(s) or True,lambda:NOW)
            self.assertEqual(events,['start']) # provider's independent deadline must detect absence


class DiskBoundaries(unittest.TestCase):
    def test_disk_thresholds_fail_service_check_without_changing_backups(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);config=root/'config';state=root/'state';base=root/'backup'
            for p in [config,state,base]:p.mkdir(mode=0o700)
            write(config/'containers.json',{});archive(base,dt.datetime.now(dt.timezone.utc))
            for free,used,total,exit_code in [(10*1024**3,85,100,0),(10*1024**3-1,85,100,1),(20*1024**3,86,100,1)]:
                with self.subTest(free=free,used=used),patch.object(health,'CONFIG',config),patch.object(health,'STATE',state),patch.object(health,'BASE',base),patch.object(health,'check_services',side_effect=lambda e:{'status':'ok','reason_codes':[]}),patch.object(health,'send') as sender,patch.object(health.shutil,'disk_usage',return_value=type('Disk',(),dict(free=free,used=used,total=total))()):
                    self.assertEqual(health.main(False),exit_code);sender.assert_not_called()
                    self.assertFalse((state/'state.json').exists())

if __name__ == '__main__':unittest.main()

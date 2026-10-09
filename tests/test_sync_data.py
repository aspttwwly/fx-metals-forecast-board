import importlib.util,json,pathlib,subprocess,unittest,uuid
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
SCRIPT=ROOT/'sync-data.py' if (ROOT/'sync-data.py').is_file() else ROOT.parent/'scripts/sync-data.py'
spec=importlib.util.spec_from_file_location('sync',SCRIPT);sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
def run(root,*args):
 p=subprocess.run(['git',*args],cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace')
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
def data(date):
 return {'updatedAt':date+'T20:30:00','symbols':[{'symbol':'EURUSD','latestActual':{'date':date}}]}

class SyncTests(unittest.TestCase):
 def setUp(self):
  self.root=SCRIPT.parent.parent/'.runtime/sync-test-fixtures'/uuid.uuid4().hex;self.root.mkdir(parents=True)
  self.origin=self.root/'remote.git';run(self.root,'init','--bare',str(self.origin))
  self.repo=self.root/'work';run(self.root,'clone',str(self.origin),str(self.repo))
  run(self.repo,'checkout','-b','main');run(self.repo,'config','user.email','fixture@example.invalid');run(self.repo,'config','user.name','Fixture')
  (self.repo/'public/data').mkdir(parents=True);(self.repo/'public/data/manifest.json').write_text(json.dumps(data('2026-10-07')))
  (self.repo/'.gitignore').write_text('.runtime/\n')
  run(self.repo,'add','.');run(self.repo,'commit','-m','fixture');run(self.repo,'push','-u','origin','main')
  self.receipt={'run_id':'fixture-'+uuid.uuid4().hex}
 def commit(self,path,body):
  target=self.repo/path;target.write_text(body);run(self.repo,'add',path);run(self.repo,'commit','-m','fixture delta')
 def fake_convert(self,root,stage):
  stage.mkdir(parents=True);(stage/'manifest.json').write_text(json.dumps(data('2026-10-09')));return {'fixture':'hash'}
 def test_unfinished_rebase_preserved(self):
  marker=self.repo/'.git/rebase-merge';marker.mkdir()
  with self.assertRaisesRegex(RuntimeError,'Unfinished'):sync.guard_repository(self.repo)
  self.assertTrue(marker.is_dir())
 def test_unpushed_source_is_not_discarded(self):
  self.commit('source.txt','keep me');head=run(self.repo,'rev-parse','HEAD')
  with self.assertRaisesRegex(RuntimeError,'Unpushed source'):sync.align_remote(self.repo,dict(self.receipt,attempt=1))
  self.assertEqual(head,run(self.repo,'rev-parse','HEAD'));self.assertEqual((self.repo/'source.txt').read_text(),'keep me')
 def test_generated_commit_is_preserved_before_realign(self):
  self.commit('public/data/manifest.json',json.dumps(data('2026-10-08')));head=run(self.repo,'rev-parse','HEAD')
  r=dict(self.receipt,attempt=1);sync.align_remote(self.repo,r)
  self.assertEqual(head,run(self.repo,'rev-parse',r['preserved_refs'][0]))
  self.assertEqual(run(self.repo,'rev-parse','HEAD'),run(self.repo,'rev-parse','origin/main'))
 def test_older_data_keeps_remote(self):
  before=run(self.repo,'rev-parse','HEAD')
  def older(root,stage):
   stage.mkdir(parents=True);(stage/'manifest.json').write_text(json.dumps(data('2026-10-06')));return {}
  with patch.object(sync,'convert',older):sync.execute(self.repo,self.receipt)
  self.assertEqual('SKIPPED_REMOTE_NEWER',self.receipt['status']);self.assertEqual(before,run(self.repo,'rev-parse','HEAD'))
 def test_publish_reaches_remote_without_rebase(self):
  with patch.object(sync,'convert',self.fake_convert):sync.execute(self.repo,self.receipt)
  self.assertEqual('SUCCESS',self.receipt['status'])
  self.assertEqual(run(self.repo,'rev-parse','HEAD'),run(self.origin,'rev-parse','main'))
  self.assertFalse((self.repo/'.git/rebase-merge').exists())
 def test_concurrent_writer_is_refetched_and_retried(self):
  other=self.root/'other';run(self.root,'clone','-b','main',str(self.origin),str(other));run(other,'config','user.email','fixture@example.invalid');run(other,'config','user.name','Fixture')
  original=sync.git;fired=[]
  def race(root,*args,**kwargs):
   if args[0]=='push' and not fired:
    fired.append(True);(other/'public/data/manifest.json').write_text(json.dumps(data('2026-10-08')))
    run(other,'add','.');run(other,'commit','-m','concurrent data');run(other,'push','origin','main')
   kwargs['network']=False
   return original(root,*args,**kwargs)
  with patch.object(sync,'convert',self.fake_convert),patch.object(sync,'git',race):sync.execute(self.repo,self.receipt)
  self.assertEqual('SUCCESS',self.receipt['status']);self.assertEqual(2,self.receipt['attempt']);self.assertTrue(self.receipt['preserved_refs'])
  self.assertEqual(run(self.repo,'rev-parse','HEAD'),run(self.origin,'rev-parse','main'))

if __name__=='__main__':unittest.main(verbosity=2)

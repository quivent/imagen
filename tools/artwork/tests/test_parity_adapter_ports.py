import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE=Path(__file__).resolve().parents[3]/'deployment/controller/tools/artwork/remote/adapter.py'
spec=importlib.util.spec_from_file_location('parity_adapter_ports',FILE)
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)

class ParityAdapterPortsTests(unittest.TestCase):
 def test_gpu_one_routes_request_download_and_evidence_to_its_worker(self):
  with tempfile.TemporaryDirectory() as directory:
   source='/workspace/artwork-flux1-gpu1/jobs/flux1-dev/test-job/result.png'
   result={'status':'done','receipt':{'source':source,'sha256':'a'*64}}
   packet={'job':'test-job','spec':{'model':'flux1-dev'},'outputDirectory':directory}
   def download(host,ssh_port,path,destination,digest,deadline):destination.write_bytes(b'synthetic fixture')
   with patch.dict(os.environ,{'ARTWORK_SSH_HOST':'root@example.test','ARTWORK_SSH_PORT':'11012','ARTWORK_FLUX1_PORT':'18763'}),patch.object(adapter,'request',return_value=result) as request,patch.object(adapter,'download',side_effect=download) as fetch:
    completed=adapter.run(packet)
   self.assertEqual(request.call_args.args[2],18763);self.assertEqual(fetch.call_args.args[2],source)
   self.assertEqual(completed['remote']['workerPort'],18763)
 def test_arbitrary_port_is_rejected_before_submission(self):
  with patch.dict(os.environ,{'ARTWORK_FLUX1_PORT':'9000'}),patch.object(adapter,'request',side_effect=AssertionError('No submission')):
   with self.assertRaises(adapter.AdapterError):adapter.run({'job':'test-job','spec':{'model':'flux1-dev'},'outputDirectory':'/tmp/unused'})

if __name__=='__main__':unittest.main()

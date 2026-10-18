import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import prompt_clarity as study
from prompt_revisions import ready_revision

class Revisions(unittest.TestCase):
 def test_audited_revision_is_frozen_and_loadable_without_mutating_source(self):
  corpus=json.loads(study.CORPUS.read_text());scene=corpus['scenes'][0]
  sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
  row={'id':scene['id'],'sourcePrompt':scene['prompt'],'sourcePromptSha256':scene['productionPromptSha256'],
   'baselinePrompt':'Assistant baseline depicting dunes at dusk.','precisionPrompt':'Ripples in foreground sand lead toward distant dunes at dusk.',
   'baselineAuthor':'Imagen assistant','precisionAuthor':'Qwen','semanticReviewStatus':'approved','revisionStatus':'qwen-revised-token-verified',
   'baselineTokens':{'clip':40,'t5':50},'precisionTokens':{'clip':60,'t5':70}}
  row.update(baselineSha256=sha(row['baselinePrompt']),revisionBaselineSha256=sha(row['baselinePrompt']),precisionSha256=sha(row['precisionPrompt']))
  with tempfile.TemporaryDirectory() as t:
   file=Path(t)/'revision.json';file.write_text(json.dumps({'id':'test-revision','scenes':[row]}))
   settings={'width':512,'height':512,'steps':28,'guidance_scale':3.5,'max_sequence_length':512}
   package=study.compile_corpus_package(settings,corpus=corpus,revision_path=file)
   self.assertEqual(package['prompts'],{'A':row['baselinePrompt'],'B':row['precisionPrompt']})
   self.assertEqual(package['sourceCorpus']['scene']['historicalProductionPrompt'],scene['prompt'])
   study._save_package(package,Path(t));self.assertEqual(study.load_package(package['id'],Path(t)),package)
   self.assertEqual(corpus['scenes'][0]['prompt'],scene['prompt'])
   for change in [{'semanticReviewStatus':'unreviewed'},{'revisionBaselineSha256':'wrong'},{'precisionAuthor':'assistant'},{'precisionTokens':{'clip':90,'t5':70}}]:
    file.write_text(json.dumps({'id':'test-revision','scenes':[{**row,**change}]}));self.assertIsNone(ready_revision(scene,file))
   for malformed in ['not json','[]','{"id":"x","scenes":null}']:
    file.write_text(malformed);self.assertIsNone(ready_revision(scene,file))

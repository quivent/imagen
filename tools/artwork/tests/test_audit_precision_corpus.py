import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'audit_precision_corpus.py'
spec = importlib.util.spec_from_file_location('audit_precision_corpus', MODULE)
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


class PrecisionAuditTests(unittest.TestCase):
    def setUp(self):
        self.original = {'id':'scene-001','name':'A coastal view',
                         'prompt':'Original landscape 1536x1024. Sea and limestone. No people or buildings. No text or logos.'}
        self.source = json.dumps({'scenes':[self.original]}).encode()
        self.row = dict(self.original, productionPromptSha256=hashlib.sha256(self.original['prompt'].encode()).hexdigest(),
                        precisionPrompt='Landscape 1536x1024. Limestone foreground beside the sea. Exclude buildings and people; avoid logos and text.',
                        precisionAuthor='Imagen assistant', precisionStatus='draft')
        self.corpus = {'sourceSha256':hashlib.sha256(self.source).hexdigest(),'scenes':[self.row]}

    def report(self):
        return audit_module.audit(self.corpus,self.source,expected_count=1)

    def codes(self):
        return {row['code'] for row in self.report()['errors']}

    def test_reordered_exclusions_are_not_word_diff_failures(self):
        self.assertTrue(self.report()['passed'])

    def test_frozen_source_changes_detected_even_if_prompt_rehashed(self):
        self.row['prompt'] += ' Added mountains.'
        self.row['productionPromptSha256'] = hashlib.sha256(self.row['prompt'].encode()).hexdigest()
        self.assertIn('production-source-changed',self.codes())

    def test_source_file_identity_checked(self):
        self.corpus['sourceSha256'] = '0'*64
        self.assertIn('source-file-hash-mismatch',self.codes())

    def test_missing_exclusion_requires_review_not_invented_contradiction(self):
        self.row['precisionPrompt'] = 'Landscape 1536x1024. Sea and limestone. Exclude buildings; avoid logos and text.'
        report = self.report()
        self.assertFalse(report['passed'])
        self.assertEqual(report['errors'],[])
        self.assertEqual(report['reviewRequired'][0]['code'],'exclusion-paraphrase-needs-review')

    def test_positive_request_conflicting_with_no_people_is_blocked(self):
        self.row['precisionPrompt'] += ' Include people.'
        self.assertIn('explicit-positive-negative-contradiction',self.codes())

    def test_do_not_include_people_is_not_positive_request(self):
        self.row['precisionPrompt'] += ' Do not include people.'
        self.assertNotIn('explicit-positive-negative-contradiction',self.codes())

    def test_dimension_prose_mismatch(self):
        self.row['precisionPrompt'] = self.row['precisionPrompt'].replace('1536x1024','1024x1024')
        self.assertIn('dimension-prose-changed',self.codes())

    def test_dimension_multiplication_sign_equivalent(self):
        self.row['precisionPrompt'] = self.row['precisionPrompt'].replace('1536x1024','1536 × 1024')
        self.assertTrue(self.report()['passed'])

    def test_metadata_author_required(self):
        self.row.pop('precisionAuthor')
        self.assertIn('missing-or-unexpected-author',self.codes())

    def test_unchanged_precision_rejected(self):
        self.row['precisionPrompt'] = self.row['prompt']
        self.assertIn('unchanged-precision-prompt',self.codes())

    def test_duplicate_prompts_rejected(self):
        other = dict(self.original,id='scene-002')
        self.source = json.dumps({'scenes':[self.original,other]}).encode()
        self.corpus['sourceSha256'] = hashlib.sha256(self.source).hexdigest()
        self.corpus['scenes'].append(dict(self.row,id='scene-002'))
        result = audit_module.audit(self.corpus,self.source,expected_count=2)
        self.assertIn('duplicate-precision-prompt',{r['code'] for r in result['errors']})

    def test_do_not_replace_buildings_does_not_prohibit_buildings(self):
        self.original['prompt'] = 'Landscape 1536x1024. Do not replace buildings with generic landscape.'
        self.source = json.dumps({'scenes':[self.original]}).encode()
        self.corpus['sourceSha256'] = hashlib.sha256(self.source).hexdigest()
        self.row.update(self.original)
        self.row['productionPromptSha256'] = hashlib.sha256(self.original['prompt'].encode()).hexdigest()
        self.row['precisionPrompt'] = 'Landscape 1536x1024. Include buildings. Do not replace buildings with generic landscape.'
        self.assertNotIn('explicit-positive-negative-contradiction',self.codes())

    def test_audit_does_not_mutate_inputs(self):
        before = copy.deepcopy(self.corpus)
        self.report()
        self.assertEqual(before,self.corpus)

    def test_actual_frozen_corpus(self):
        root = MODULE.parents[2]
        corpus = json.loads((root/audit_module.DEFAULT_CORPUS).read_text())
        report = audit_module.audit(corpus,(root/corpus['source']).read_bytes())
        self.assertTrue(report['passed'],report)
        self.assertEqual(report['sceneCount'],150)
        self.assertEqual(report['distinctPrecisionPrompts'],150)
        self.assertEqual(report['tokenLength']['estimatedOver512'],[])
        self.assertIn('heuristic',report['tokenLength']['method'])


if __name__ == '__main__':
    unittest.main()

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const request='virtual:imagen-research-text',resolved='\0imagen-research-text';
const files={
 explanation:new URL('../docs/research/WHERE-THE-IMAGE-QUALITY-COMES-FROM.md',import.meta.url),
 protocol:new URL('../research/studies/art-direction-held-constant/PROTOCOL.md',import.meta.url),
 portability:new URL('../tools/artwork/PORTABILITY.md',import.meta.url),
 plan:new URL('../research/studies/art-direction-held-constant/plan.json',import.meta.url),
};
// Bundle only these reviewed documents. Raw Markdown and private source routes
// remain blocked by the workstation's existing HTTP boundary.
export function researchDocumentsPlugin(){return {
 name:'research-documents',
 resolveId(id){return id===request?resolved:null;},
 load(id){
  if(id!==resolved)return null;
  const values={};for(const [key,url] of Object.entries(files)){this.addWatchFile(fileURLToPath(url));values[key]=readFileSync(url,'utf8');}
  return 'export const researchTexts='+JSON.stringify(values)+';';
 },
};}

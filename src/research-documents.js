import {researchTexts} from 'virtual:imagen-research-text';
const {explanation,protocol,portability}=researchTexts;
const plan=JSON.parse(researchTexts.plan);
const briefs=plan.briefs.map(brief=>'### '+brief.name+'\n\nShort brief:\n\n'+brief.short+'\n\nStructured brief:\n\n'+brief.directed).join('\n\n');
export const researchDocuments=[
 {id:'image-quality',title:'Where the Image Quality Comes From',section:'Documents',kind:'Research note',status:'Hypothesis',description:'Separate art direction, generator capability and workflow effects before attributing the quality difference.',content:explanation,related:'art-direction-held-constant'},
 {id:'art-direction-held-constant',title:'Art Direction, Held Constant',section:'Studies',kind:'Study plan',status:'Planned',description:'A blinded 36-image pilot crossing three workflows with short and frozen structured briefs.',content:protocol+'\n\n## Frozen pilot briefs\n\n'+briefs,related:'image-quality'},
 {id:'artwork-portability',title:'Bringing the Artwork Runner into Imagen',section:'Documents',kind:'Tooling audit',status:'Imported',description:'What is portable, what remains entangled, and why the existing factory core is reused.',content:portability,related:'art-direction-held-constant'},
];

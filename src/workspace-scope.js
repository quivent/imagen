// Existing untagged operational records belong to Production. Never infer scope
// from names or task prose; new assignments can explicitly select Workbench.
export const recordWorkspace=record=>record?.workspace==='workbench'?'workbench':'production';
// Legacy records have one home, never membership in every selected study.
export const recordStudyId=(record,workspace=recordWorkspace(record))=>typeof record?.studyId==='string'&&record.studyId?record.studyId:workspace==='workbench'?'glsl-worlds':'production';
export const belongsToStudy=(record,workspace,studyId)=>recordWorkspace(record)===workspace&&recordStudyId(record,workspace)===studyId;
export function scopeAgentView(view,workspace,studyId){
 const matches=record=>recordWorkspace(record)===workspace&&(!studyId||recordStudyId(record,workspace)===studyId);
 const agents=view.agents.filter(matches);
 return {...view,agents,coordinator:matches(view.coordinator)?view.coordinator:null,running:agents.filter(a=>a.status==='running').length,available:agents.filter(a=>a.status==='available').length};
}

export const workbenchMethods=['pixel','contour','structure','hypotheses','neural-field'];
export const isWorkbenchPath=path=>/^\/workbench\/?$/.test(path||'');
export function readWorkbenchRoute(value){
 const url=new URL(value,'http://localhost'),query=url.searchParams,experiment=query.get('experiment');
 const legacyRun=/^method[1-5]-/.test(experiment||'')?experiment:null;
 const number=/^\d+$/.test(experiment||'')?Number(experiment):null;
 const studyId=query.get('study')||(number?'experiment-'+number:legacyRun?'experiment-'+(legacyRun.match(/exp(\d+)-/)?.[1]||1):null);
 const rawMethod=query.get('method');
 let method=workbenchMethods.indexOf(rawMethod)+1||Number(rawMethod)||Number(legacyRun?.match(/^method(\d)-/)?.[1])||1;
 if(!Number.isInteger(method)||method<1||method>5)method=1;
 const rawPage=Number(query.get('page')),page=Number.isInteger(rawPage)&&rawPage>0?rawPage:null;
 return {studyId,method,page,legacyRun};
}
export function workbenchURL(value,{studyId,method=1,page=null}={}){
 const url=new URL(value,'http://localhost');url.pathname='/workbench';
 for(const key of ['tab','study','experiment','method','page','comparison'])url.searchParams.delete(key);
 const number=studyId?.match(/^experiment-(\d+)$/)?.[1];if(number)url.searchParams.set('experiment',number);
 url.searchParams.set('method',workbenchMethods[method-1]||'pixel');
 if(Number.isInteger(page)&&page>0)url.searchParams.set('page',page);
 return url;
}

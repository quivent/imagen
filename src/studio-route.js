export const studioTabs=['stream','gallery','controls','tasks','performance','models','seers','worlds','workbench','research','metrics','winners','agents','daemons','rules','protocol','monitor','workbench-controls','workbench-tasks','workbench-agents','archive','qwen','pixtral-chat','prompt-comparison'];
export const studioPaths=Object.fromEntries(studioTabs.map(tab=>[tab,tab==='gallery'?'/compare':'/'+tab]));
Object.assign(studioPaths,{'workbench-controls':'/workbench/controls','workbench-tasks':'/workbench/tasks','workbench-agents':'/workbench/agents','archive':'/gallery/studio'});
const routeTabs=Object.fromEntries(Object.entries(studioPaths).map(([tab,path])=>[path,tab]));
Object.assign(routeTabs,{'/collections':'winners','/active':'stream','/metrics.html':'metrics','/monitor.html':'monitor'});
export function studioTab(value){
 const url=new URL(value,'http://localhost'),path=url.pathname.replace(/\/$/,'')||'/';
 if(routeTabs[path])return routeTabs[path];
 if(path!=='/')return null;
 const legacy=url.searchParams.get('tab');
 return studioTabs.includes(legacy)?legacy:url.searchParams.has('comparison')?'gallery':'stream';
}
export function studioTabURL(value,tab){
 if(!Object.hasOwn(studioPaths,tab))throw new Error('Unknown studio tab');
 const url=new URL(value,'http://localhost'),previous=studioTab(url);
 url.pathname=studioPaths[tab];url.searchParams.delete('tab');
 if(previous==='workbench'&&tab!=='workbench')for(const key of ['experiment','study','method','page'])url.searchParams.delete(key);
 if(previous==='research'&&tab!=='research')url.searchParams.delete('document');
 return url;
}
export function studioRedirect(value){
 const url=new URL(value,'http://localhost'),tab=studioTab(url);if(!tab||tab==='workbench')return null;
 const target=studioTabURL(url,tab);
 return target.pathname+target.search!==url.pathname+url.search?target.pathname+target.search:null;
}

export function studioPageRequest(value){
 const url=new URL(value,'http://localhost'),tab=studioTab(url);
 return tab&&url.pathname===studioPaths[tab]?'/index.html'+url.search:null;
}

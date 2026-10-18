export function mountParameters(config, apply) {
 const $ = id => document.getElementById(id);
 const all = config.groups.flatMap(group => group.values.flatMap((row, instance) => row.map((value, component) => ({ group, instance, component, name: `${group.id.split('-')[0]}.${group.id.startsWith('world') ? group.fields[component] : String(instance+1).padStart(2,'0')+'.'+group.fields[component]}`, bounds: group.limits[component] }))));
 const categories = [...new Set(all.map(item => item.group.id.split('-')[0]))];
 for (const name of categories) { const option=document.createElement('option');option.value=name;option.textContent=name;$('parameter-category').append(option); }
 let shown=80;
 function render() {
  const search=$('parameter-search').value.trim().toLowerCase(), category=$('parameter-category').value;
  const matches=all.filter(item=>(category==='all'||item.group.id.startsWith(category))&&item.name.toLowerCase().includes(search));
  $('parameter-list').replaceChildren(...matches.slice(0,shown).map(item=>{
   const label=document.createElement('label'),name=document.createElement('span'),input=document.createElement('input');
   name.textContent=item.name;input.type='number';input.step='any';input.min=item.bounds[0];input.max=item.bounds[1];input.value=item.group.values[item.instance][item.component];
   input.title=`${item.group.origin}: ${item.group.constraint}`;
   input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||!input.reportValidity())return;item.group.values[item.instance][item.component]=value;apply();};
   label.append(name,input);return label;
  }));
  $('parameter-summary').textContent=`${matches.length} matching · ${all.length} live GLSL parameters · initial values are authored guesses`;
  $('parameter-more').hidden=matches.length<=shown;
 }
 $('parameter-category').onchange=$('parameter-search').oninput=()=>{shown=80;render();};
 $('parameter-more').onclick=()=>{shown+=80;render();};
 $('parameters').onclick=()=>{render();$('parameter-dialog').showModal();};
 $('parameter-close').onclick=()=>$('parameter-dialog').close();
 return { config, count: all.length };
}

// Small, text-only Markdown renderer for repository-authored research notes.
// Raw HTML is never interpreted. This is not a renderer for arbitrary web pages.
export function researchDocumentBody(markdown){
 const article=document.createElement('article');article.className='research-document-body';
 let paragraph=[],list=null,code=null,table=null;
 const inline=(node,text)=>{
  const pattern=/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;let start=0,match;
  while((match=pattern.exec(text))){node.append(document.createTextNode(text.slice(start,match.index)));
   const child=document.createElement(match[1]?'button':match[3]?'strong':'code');child.textContent=match[1]||match[3]||match[4];
   if(match[1]){child.type='button';child.className='research-citation';child.title=match[2];child.onclick=async()=>{try{await navigator.clipboard.writeText(match[2]);child.textContent='Source link copied';}catch{child.textContent=match[1]+' · '+match[2];}};}
   node.append(child);start=pattern.lastIndex;
  }node.append(document.createTextNode(text.slice(start)));
 };
 const flush=()=>{if(paragraph.length){const p=document.createElement('p');inline(p,paragraph.join(' '));article.append(p);paragraph=[];}};
 for(const line of markdown.split('\n')){
  if(line.startsWith('```')){flush();list=null;if(code){article.append(code);code=null;}else code=document.createElement('pre');continue;}
  if(code){code.textContent+=(code.textContent?'\n':'')+line;continue;}
  if(line.startsWith('|')){
   flush();list=null;const cells=line.split('|').slice(1,-1).map(value=>value.trim());
   if(cells.every(value=>/^:?-+:?$/.test(value)))continue;
   if(!table){table=document.createElement('table');article.append(table);}
   const row=document.createElement('tr'),tag=table.children.length?'td':'th';
   for(const value of cells){const cell=document.createElement(tag);inline(cell,value);row.append(cell);}table.append(row);continue;
  }
  table=null;
  const heading=line.match(/^(#{1,3})\s+(.*)/);if(heading){flush();list=null;const node=document.createElement('h'+heading[1].length);inline(node,heading[2]);article.append(node);continue;}
  const bullet=line.match(/^(- |\d+\. )(.*)/);if(bullet){flush();if(!list){list=document.createElement(bullet[1]==='- '?'ul':'ol');article.append(list);}const item=document.createElement('li');inline(item,bullet[2]);list.append(item);continue;}
  if(!line.trim()){flush();list=null;continue;}
  if(list){inline(list.lastElementChild,' '+line.trim());continue;}
  paragraph.push(line.trim());
 }flush();if(code)article.append(code);return article;
}

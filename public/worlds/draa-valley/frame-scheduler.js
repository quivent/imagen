export function createFrameScheduler({ request, cancel, now, visible, continuous, moving, draw }) {
 let queued=null,previous=now(),disposed=false;
 function schedule(){
  if(disposed||queued!==null||!visible())return;
  queued=request(frame);
 }
 function frame(time){
  queued=null;
  if(disposed||!visible()){previous=time;return;}
  const dt=Math.max(0,Math.min((time-previous)/1000,.05));previous=time;
  draw(time,dt);
  if(continuous()||moving())schedule();
 }
 return {
  invalidate(){if(queued===null)previous=now();schedule();},
  suspend(){if(queued!==null)cancel(queued);queued=null;previous=now();},
  destroy(){disposed=true;if(queued!==null)cancel(queued);queued=null;},
 };
}

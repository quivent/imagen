export function generationIsActive(observation, now = Date.now()) {
 const section=observation?.data?.generation;
 return observation?.available===true&&section?.ok===true&&now-Date.parse(section.observedAt)<12000&&Date.parse(section.observedAt)<=now+2000&&Array.isArray(section.workers)&&section.workers.some(worker=>worker.phase==='ready'&&!worker.problem&&(Number(worker.running)>0||Boolean(worker.current)));
}

// Canonical interpretation of the monitor's runtime evidence, shared by all views.
export function observedTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
export function freshObservation(value, now = Date.now()) {
  const time = observedTime(value);
  return time !== null && now - time >= -30000 && now - time <= 12000;
}
export function runtimeState(status) {
  if (['running', 'working'].includes(status)) return 'running';
  if (['idle', 'done', 'complete', 'completed'].includes(status)) return 'available';
  return ['waiting', 'assigned', 'failed', 'interrupted', 'stopped', 'closed'].includes(status) ? status : 'unknown';
}
export function agentView(snapshot, connected = true) {
  const section = snapshot?.agents;
  const workers = Array.isArray(section?.agents) ? section.agents.filter(agent => agent && typeof agent.id === 'string' && agent.id) : [];
  const fresh = connected && section?.ok === true && section.live === true && freshObservation(section.observedAt) && new Set(workers.map(agent => agent.id)).size === workers.length;
  const normalize = agent => {
    const status = fresh ? runtimeState(agent.status) : 'unknown';
    return { ...agent, status, currentTaskId: status === 'running' && typeof agent.currentTaskId === 'string' && agent.currentTaskId ? agent.currentTaskId : null };
  };
  const agents = workers.map(normalize);
  const coordinator = normalize({ id: '/root', name: 'Coordinator', status: section?.coordinator, task: section?.coordinatorTask, currentTaskId: section?.coordinatorCurrentTaskId, startedAt: section?.coordinatorStartedAt, lastTransitionAt: section?.coordinatorLastTransitionAt });
  return { fresh, agents, coordinator, running: agents.filter(agent => agent.status === 'running').length, available: agents.filter(agent => agent.status === 'available').length };
}
const ownerId = owner => typeof owner === 'string' ? (owner === 'root' || owner === '/root' ? '/root' : owner.startsWith('/root/') ? owner : '/root/' + owner) : null;
export function taskAssignment(view, task) {
  if (!view.fresh || task.status && task.status !== 'working') return null;
  return [...view.agents, view.coordinator].find(agent => agent.status === 'running' && agent.currentTaskId === task.id && (!task.owner || agent.id === ownerId(task.owner))) || null;
}
export function dispatchView(snapshot, connected = true) {
  const rule = snapshot?.enforcement;
  return connected && rule?.rule === 'dispatch' && freshObservation(rule.observedAt) && ['ok', 'violation'].includes(rule.state) ? rule : { state: 'unknown', readyTaskIds: [] };
}

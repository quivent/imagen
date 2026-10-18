import {taskAssignment} from './agent-state.js';
export const taskStates={working:'In progress',next:'Next',ongoing:'Ongoing',done:'Done'};
const text=(tag,value,className)=>{const n=document.createElement(tag);n.textContent=value;if(className)n.className=className;return n;};
export function renderTaskBoard(root,rows,runtime){
  const doneOpen = root.querySelector('.task-group-done')?.open || false;
  const sections = [];
  for (const [state, heading] of Object.entries(taskStates)) {
    const priorityRank = { urgent: 0, high: 1 };
    const matching = rows.filter(row => row.status === state).sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2));
    if (!matching.length) continue;
    const section = document.createElement(state === 'done' ? 'details' : 'section');
    section.className = state === 'done' ? 'task-group task-group-done' : 'task-group';
    const title = text('h2', state === 'working' ? 'Recorded in progress' : heading);
    if (state === 'done') {
      section.open = doneOpen;
      const summary = document.createElement('summary');
      const icon = text('span', '›', 'task-done-icon');
      icon.setAttribute('aria-hidden', 'true');
      summary.append(icon, title, text('span', String(matching.length), 'task-done-count'));
      section.append(summary);
    } else section.append(title);
    const list = document.createElement('div');
    list.className = 'task-cards';
    for (const row of matching) {
      const card = document.createElement('article');
      card.className = 'task-card';
      card.dataset.state = state;
      const top = document.createElement('div');
      top.className = 'task-card-top';
      top.append(text('span', row.id, 'task-id'));
      if (row.priority) top.append(text('span', row.priority === 'urgent' ? 'First priority' : 'High priority', 'task-priority'));
      const assignment = taskAssignment(runtime, row);
      top.append(text('span', state === 'working' ? assignment ? 'Running' : 'Recorded in progress' : heading, 'task-state'));
      card.append(top, text('h3', row.title));
      if (row.owner || assignment || state === 'working') card.append(text('p', assignment ? `Current assignment: ${assignment.name || assignment.id}` : `Recorded owner: ${row.owner || 'not recorded'} · ${runtime.fresh ? 'no matching running assignment' : 'live assignment unknown'}`, 'task-detail'));
      if (row.difficulty || row.estimatedMinutes) {
        const range = row.estimatedMinutes;
        const estimate = range && Number.isFinite(range.min) && Number.isFinite(range.max) ? `${range.min}–${range.max} min estimated` : '';
        card.append(text('p', [row.difficulty, estimate, row.estimateConfidence && `${row.estimateConfidence} confidence`].filter(Boolean).join(' · '), 'task-detail'));
      }
      if (row.detail) card.append(text('p', row.detail, 'task-detail'));
      if (row.evidence) card.append(text('p', row.evidence, 'task-evidence'));
      list.append(card);
    }
    section.append(list);
    sections.push(section);
  }
  root.replaceChildren(...sections);
}

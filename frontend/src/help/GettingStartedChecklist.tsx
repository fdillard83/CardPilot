export type GettingStartedTask = { id: string; label: string; detail: string; complete: boolean; automatic?: boolean };

export function GettingStartedChecklist({ tasks, collapsed, onToggleCollapsed, onDismiss, onToggleTask, onStartGuide, onOpenHelp }: {
  tasks: GettingStartedTask[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDismiss: () => void;
  onToggleTask: (id: string) => void;
  onStartGuide: () => void;
  onOpenHelp: () => void;
}) {
  const completed = tasks.filter((task) => task.complete).length;
  return <section className={`getting-started${collapsed ? " getting-started-collapsed" : ""}`} aria-labelledby="getting-started-title">
    <header><div><span>New collector checklist</span><strong id="getting-started-title">Getting started with CardPilot</strong><small>{completed} of {tasks.length} complete</small></div><progress value={completed} max={tasks.length} /><div><button type="button" onClick={onToggleCollapsed}>{collapsed ? "Expand" : "Collapse"}</button><button type="button" onClick={onDismiss}>Dismiss</button></div></header>
    {!collapsed && <><div className="getting-started-grid">{tasks.map((task) => <label className={task.complete ? "complete" : ""} key={task.id}><input type="checkbox" checked={task.complete} disabled={task.automatic} onChange={() => onToggleTask(task.id)} /><span><strong>{task.label}</strong><small>{task.detail}{task.automatic ? " CardPilot marks this automatically." : " Mark complete when reviewed."}</small></span></label>)}</div><footer><button className="secondary-button" type="button" onClick={onStartGuide}>Continue guided setup</button><button type="button" onClick={onOpenHelp}>Open User Manual and FAQ</button></footer></>}
  </section>;
}

export type HelpProgress = {
  status: "not_started" | "in_progress" | "completed" | "dismissed";
  step: number;
  welcomeSeen: boolean;
  checklistDismissed: boolean;
  completedTasks: string[];
};

export const defaultHelpProgress: HelpProgress = {
  status: "not_started",
  step: 0,
  welcomeSeen: false,
  checklistDismissed: false,
  completedTasks: [],
};

export function helpProgressKey(accountKey: string) {
  return `cardpilot.helpProgress.v1.${accountKey}`;
}

export function loadHelpProgress(accountKey: string): HelpProgress {
  try {
    const raw = window.localStorage.getItem(helpProgressKey(accountKey));
    if (!raw) return { ...defaultHelpProgress };
    const value = JSON.parse(raw) as Partial<HelpProgress>;
    return {
      status: ["not_started", "in_progress", "completed", "dismissed"].includes(String(value.status)) ? value.status as HelpProgress["status"] : "not_started",
      step: Number.isInteger(value.step) ? Math.max(0, Number(value.step)) : 0,
      welcomeSeen: value.welcomeSeen === true,
      checklistDismissed: value.checklistDismissed === true,
      completedTasks: Array.isArray(value.completedTasks) ? value.completedTasks.filter((item): item is string => typeof item === "string") : [],
    };
  } catch {
    return { ...defaultHelpProgress };
  }
}

export function saveHelpProgress(accountKey: string, progress: HelpProgress) {
  window.localStorage.setItem(helpProgressKey(accountKey), JSON.stringify(progress));
}

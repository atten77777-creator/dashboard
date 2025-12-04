export function chartAriaLabel({ chartType, title, rows }: { chartType: string; title?: string; rows?: any[] }) {
  const count = rows?.length ?? 0;
  const name = title ? `${title} ` : '';
  return `${name}${chartType} chart with ${count} data points`;
}

export function enableHighContrast(root: HTMLElement) {
  root.classList.add('hc');
}

export function disableHighContrast(root: HTMLElement) {
  root.classList.remove('hc');
}

export function applyTheme(root: HTMLElement, theme: 'light' | 'dark' | 'high-contrast') {
  root.classList.remove('dark');
  root.classList.remove('hc');
  if (theme === 'dark') root.classList.add('dark');
  if (theme === 'high-contrast') root.classList.add('hc');
}
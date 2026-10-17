const target = new URL(location.href);
const tab = target.pathname.endsWith('/metrics.html') ? 'metrics' : 'monitor';
target.pathname = '/';
target.searchParams.set('tab', tab);
location.replace(target.href);

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const indexPath = join(distDir, 'index.html');
const fallbackPath = join(distDir, '404.html');
const prettyRouteFallbacks = [
  'admin/workspace/thang-oanh',
  'tournament/thang-oanh',
];

if (!existsSync(indexPath)) {
  throw new Error('Cannot create SPA fallback: dist/index.html does not exist.');
}

copyFileSync(indexPath, fallbackPath);
console.log('Created GitHub Pages SPA fallback at dist/404.html');

for (const route of prettyRouteFallbacks) {
  const routeDir = join(distDir, ...route.split('/'));
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(indexPath, join(routeDir, 'index.html'));
  console.log(`Created GitHub Pages pretty-route fallback at dist/${route}/index.html`);
}

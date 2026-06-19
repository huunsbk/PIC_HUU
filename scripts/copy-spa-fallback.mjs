import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const indexPath = join(distDir, 'index.html');
const fallbackPath = join(distDir, '404.html');

if (!existsSync(indexPath)) {
  throw new Error('Cannot create SPA fallback: dist/index.html does not exist.');
}

copyFileSync(indexPath, fallbackPath);
console.log('Created GitHub Pages SPA fallback at dist/404.html');

// Package the generated master into macOS icon representations without
// changing the artwork. Run on macOS from any working directory.
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, copyFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'darwin') throw new Error('macOS iconutil is required.');
const desktop = fileURLToPath(new URL('..', import.meta.url));
const runtime = path.resolve(desktop, '../.runtime');
await mkdir(runtime, {recursive: true});
const temporary = await mkdtemp(path.join(runtime, 'imagen-icon-'));
try {
  const raster = path.join(temporary, 'raster');
  const iconset = path.join(temporary, 'Imagen.iconset');
  await mkdir(iconset);
  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  execFileSync(process.execPath, [path.join(desktop, 'node_modules/@tauri-apps/cli/tauri.js'),
    'icon', path.join(desktop, 'assets/imagen-icon.png'), '--output', raster,
    ...sizes.flatMap(size => ['--png', String(size)])], {stdio: 'inherit'});
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await copyFile(path.join(raster, `${size * scale}x${size * scale}.png`),
        path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
    }
  }
  const icons = path.join(desktop, 'src-tauri/icons');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(icons, 'Imagen.icns')]);
  await copyFile(path.join(raster, '128x128.png'), path.join(icons, 'icon.png'));
} finally {
  await rm(temporary, {recursive: true, force: true});
}

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const banner = `// ==UserScript==
// @name         xhs-live-filter
// @namespace    https://github.com/carllx/xhs-live-filter
// @version      0.1.1
// @description  小红书直播广场智能过滤器
// @author       carllx
// @match        https://www.xiaohongshu.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      xiaohongshu.com
// @connect      edith.xiaohongshu.com
// @updateURL    https://raw.githubusercontent.com/carllx/xhs-live-filter/main/dist/xhs-live-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/carllx/xhs-live-filter/main/dist/xhs-live-filter.user.js
// @run-at       document-idle
// ==/UserScript==
`;

async function build() {
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'dist/xhs-live-filter.user.js',
    format: 'iife',
    banner: {
      js: banner,
    },
    target: ['es2022'],
    sourcemap: false,
  });

  console.log('Build completed: dist/xhs-live-filter.user.js');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

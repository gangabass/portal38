import { defineConfig } from 'vite';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export default defineConfig({base:'/portal38/',publicDir:'public',build:{outDir:'dist'},plugins:[{name:'precache-pwa',closeBundle(){
 const assets=readdirSync('dist/assets').map(f=>'assets/'+f);
 const version=createHash('sha256').update(assets.join(',')).digest('hex').slice(0,12);
 const source=readFileSync('public/sw.js','utf8').replace("const VERSION='portal38-v1';",`const VERSION='portal38-${version}';`).replace('const BUILD_ASSETS=[];',`const BUILD_ASSETS=${JSON.stringify(assets)};`);
 writeFileSync('dist/sw.js',source);
}}]});

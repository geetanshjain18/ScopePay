import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=[...readdirSync('.').filter(f=>f.endsWith('.js')),...readdirSync('public').filter(f=>f.endsWith('.js')).map(f=>'public/'+f),...readdirSync('scripts').filter(f=>f.endsWith('.mjs')).map(f=>'scripts/'+f)];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Syntax checks passed for ${files.length} modules.`);

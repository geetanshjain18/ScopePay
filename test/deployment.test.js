import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentConfig} from '../deployment.js';
import {resolve} from 'node:path';

const root=resolve('fixture');
const hosted={NODE_ENV:'production',PORT:'10000',PUBLIC_URL:'https://scopepay.example',DATA_DIR:resolve('persistent-disk'),OWNER_SETUP_TOKEN:'x'.repeat(40)};

test('local startup remains loopback-only with local host and origin restrictions',()=>{
 const config=deploymentConfig({},root);
 assert.equal(config.listenHost,'127.0.0.1');assert.equal(config.dbPath,resolve(root,'data/scopepay.db'));
 assert.equal(config.acceptsHost('localhost:4173'),true);assert.equal(config.acceptsHost('evil.example'),false);
 assert.equal(config.acceptsOrigin('https://evil.example','localhost:4173'),false);
 assert.equal(config.setupRequired(0),false);assert.equal(config.cookieSuffix.includes('Secure'),false);
});

test('hosted startup uses the Render HTTPS origin, persistent storage and secure sessions',()=>{
 const config=deploymentConfig(hosted,root);
 assert.equal(config.listenHost,'0.0.0.0');assert.equal(config.port,10000);
 assert.equal(config.dbPath,resolve(hosted.DATA_DIR,'scopepay.db'));
 assert.equal(config.acceptsHost('scopepay.example'),true);assert.equal(config.acceptsHost('evil.example'),false);
 assert.equal(config.acceptsOrigin('https://scopepay.example','scopepay.example'),true);
 assert.equal(config.acceptsOrigin('http://scopepay.example','scopepay.example'),false);
 assert.match(config.cookieSuffix,/; Secure/);assert.equal(config.setupRequired(0),true);assert.equal(config.setupRequired(1),false);
 assert.equal(config.validSetupToken(hosted.OWNER_SETUP_TOKEN),true);assert.equal(config.validSetupToken('wrong'),false);
 assert.equal(config.validSetupToken(undefined),false);
 const automatic=deploymentConfig({...hosted,PUBLIC_URL:'',RENDER_EXTERNAL_URL:'https://scopepay.onrender.com'},root);
 assert.equal(automatic.origin,'https://scopepay.onrender.com');
});

test('hosted startup rejects missing storage, weak setup protection and insecure origins',()=>{
 for(const override of [{DATA_DIR:''},{DATA_DIR:'relative'},{OWNER_SETUP_TOKEN:''},{PUBLIC_URL:'http://scopepay.example'},{PUBLIC_URL:'https://scopepay.example/path'},{PUBLIC_URL:'https://user:pass@scopepay.example'},{PORT:'bad'}])assert.throws(()=>deploymentConfig({...hosted,...override},root));
 assert.throws(()=>deploymentConfig({...hosted,PUBLIC_URL:''},root));
});

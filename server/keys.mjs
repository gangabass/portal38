import {randomBytes} from 'node:crypto';import webpush from 'web-push';import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const target=process.argv[2]||'server/.env',old=existsSync(target)?readFileSync(target,'utf8'):'';
const has=key=>new RegExp(`^${key}=\\S+`,'m').test(old);
if(has('VAPID_PUBLIC_KEY')!==has('VAPID_PRIVATE_KEY'))throw Error('VAPID-ключи должны быть настроены парой.');
const keys=webpush.generateVAPIDKeys(),values={PORT:'3002',DATA_DIR:'./data',ALLOWED_ORIGINS:'http://localhost:5173,http://127.0.0.1:5173,https://gangabass.github.io',APP_URL:'https://gangabass.github.io/portal38/',ENCRYPTION_KEY:randomBytes(32).toString('hex'),FAMILY_ACCESS_KEY:randomBytes(32).toString('base64url'),VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:replace@example.com'};
let next=old,count=0;for(const [key,value] of Object.entries(values)){if(has(key))continue;const blank=new RegExp(`^${key}=[ \\t]*$`,'m');next=blank.test(next)?next.replace(blank,`${key}=${value}`):next+`\n${key}=${value}`;count++;}
if(count)writeFileSync(target,next+'\n',{mode:0o600});console.log(`Добавлено настроек: ${count}. Существующие значения сохранены. Секреты не выводятся.`);

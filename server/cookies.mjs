const HOST='portal38.is-mis.ru';
const validName=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export function importCookies(input,now=Date.now()){
 if(!Array.isArray(input)||!input.length||input.length>100)throw Error('Не получена сессия портала. Завершите вход через ЕСИА.');
 return input.map(c=>{
  const domain=String(c.domain||'').replace(/^\./,'').toLowerCase();
  if(domain!==HOST||!validName.test(c.name)||typeof c.value!=='string'||/[\x00-\x20\x7f;,]/.test(c.value)||c.value.length>8192||typeof c.path!=='string'||!c.path.startsWith('/')||/[\x00-\x20\x7f;]/.test(c.path))throw Error('Некорректные cookies портала.');
  const expires=Number(c.expirationDate||c.expires||0);
  if(!Number.isFinite(expires))throw Error('Некорректный срок сессии.');
  return {name:c.name,value:c.value,domain:HOST,path:c.path,secure:true,expires,hostOnly:c.hostOnly!==false};
 }).filter(c=>!c.expires||c.expires*1000>now);
}
export function normalizeCookies(input={}){
 if(Array.isArray(input))return input.map(c=>({...c}));
 return Object.entries(input).map(([name,value])=>({name,value,domain:HOST,path:'/',secure:true,hostOnly:true,expires:0}));
}
export function cookieHeader(jar,url,now=Date.now()){
 return jar.filter(c=>(!c.expires||c.expires*1000>now)&&url.hostname===c.domain&&(!c.secure||url.protocol==='https:')&&(url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))).sort((a,b)=>b.path.length-a.path.length).map(c=>`${c.name}=${c.value}`).join('; ');
}
export function setCookies(jar,headers,url,now=Date.now()){
 for(const line of headers){
  const [pair,...parts]=line.split(';'),pos=pair.indexOf('=');if(pos<1)continue;
  const attrs=Object.fromEntries(parts.map(s=>{const i=s.indexOf('=');return i<0?[s.trim().toLowerCase(),true]:[s.slice(0,i).trim().toLowerCase(),s.slice(i+1).trim()];}));
  const domain=String(attrs.domain||url.hostname).replace(/^\./,'').toLowerCase();if(domain!==HOST)continue;
  const name=pair.slice(0,pos),value=pair.slice(pos+1);if(!validName.test(name)||/[\r\n;]/.test(value))continue;
  const path=typeof attrs.path==='string'&&attrs.path.startsWith('/')?attrs.path:(url.pathname.slice(0,url.pathname.lastIndexOf('/'))||'/');
  let expires=attrs.expires?Date.parse(attrs.expires)/1000:0;if(!Number.isFinite(expires))expires=0;
  if(attrs['max-age']!==undefined&&/^-?\d+$/.test(attrs['max-age']))expires=(now/1000)+Number(attrs['max-age']);
  const index=jar.findIndex(c=>c.name===name&&c.domain===domain&&c.path===path);if(index>=0)jar.splice(index,1);
  if(!expires||expires*1000>now)jar.push({name,value,domain,path,expires,hostOnly:!attrs.domain,secure:Boolean(attrs.secure)});
 }
}
export function sessionExpired(){const error=Error('Сессия портала завершилась. В разделе «Подключение» повторите вход через ЕСИА.');error.code='portal_session_expired';return error;}

import {load} from 'cheerio';
export const ROOT='https://portal38.is-mis.ru';
export class Portal {
  constructor(credentials,cookies={}) {this.credentials=credentials;this.cookies={...cookies};}
  async request(path, options={}) {
    let url=new URL(path,ROOT); if(url.origin!==ROOT) throw Error('Недопустимый адрес портала');
    for(let i=0;i<6;i++) {
      const r=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0','Cookie':Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join('; '),...options.headers}});
      for(const cookie of r.headers.getSetCookie()) {const pair=cookie.split(';')[0],pos=pair.indexOf('=');this.cookies[pair.slice(0,pos)]=pair.slice(pos+1);}
      if([301,302,303,307,308].includes(r.status)) {url=new URL(r.headers.get('location'),url);if(url.origin!==ROOT)throw Error('Портал перенаправил на другой сайт');if([301,302,303].includes(r.status))options={};continue;}
      if(!r.ok) throw Error(`Портал ответил HTTP ${r.status}`);
      return r.text();
    }
    throw Error('Слишком много перенаправлений портала');
  }
  async login() {
    await this.request('/');
    const body=new URLSearchParams({username:this.credentials.login,password:this.credentials.password,'login-submit':'Войти'});
    await this.request('/',{method:'POST',body});
    const html=await this.request('/user/cards');
    if(!load(html)('a[href*=logout]').length) throw Error('Не удалось войти на портал. Проверьте логин и пароль.');
    return html;
  }
}

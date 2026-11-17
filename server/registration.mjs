import {createHmac,randomBytes,createHash} from 'node:crypto';
export function validateRegistration(input){
 const {policy,lastName,firstName,birthDate,middleName}=input||{};
 if(typeof policy!=='string'||!/^\d{16}$/.test(policy))throw Error('Введите полис ОМС: ровно 16 цифр.');
 const valid=value=>typeof value==='string'&&value.trim().length<=100&&/^[\p{L}][\p{L} \x27’‐-]*$/u.test(value.trim());
 if(!valid(lastName)||!valid(firstName))throw Error('Введите фамилию и имя.');
 if(middleName!==undefined&&middleName!==''&&!valid(middleName))throw Error('Проверьте отчество.');
 if(typeof birthDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)||!Number.isFinite(Date.parse(birthDate))||new Date(birthDate).toISOString().slice(0,10)!==birthDate||birthDate>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Irkutsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())||Number(birthDate.slice(0,4))<1900)throw Error('Введите корректную дату рождения.');
 return {birthDate,middleName:middleName?.trim()||'',policy,lastName:lastName.trim(),firstName:firstName.trim()};
}
export function createRegistration({store,accessTokens,secret,accountId,ensurePerson}){
 let queue=Promise.resolve();
 return {
  async register(input){
   const data=validateRegistration(input);
   if(!accountId||!store.get('accounts',accountId))throw Error('Регистрация пока не настроена администратором.');
   const hash=createHmac('sha256',secret).update(data.policy).digest('hex');
   const work=queue.catch(()=>{}).then(async()=>{
    if(store.get('policies',hash))throw Error('Не удалось зарегистрироваться. Если вы уже регистрировались, войдите по сохранённому токену или обратитесь к администратору.');
    const person=await ensurePerson(accountId,data);
    if(!person||!/^\d+$/.test(person.id))throw Error('Добавление в картотеку не подтверждено.');
    if(store.list('accessTokens').some(t=>t.boundAccountId===accountId&&t.personId===person.id))throw Error('Человек уже зарегистрирован. Обратитесь к администратору.');
    store.db.exec('BEGIN IMMEDIATE');
    try{
     const token=accessTokens.create({name:data.lastName+' '+data.firstName,type:'standard'});
     accessTokens.bindPerson(token.id,accountId,person.id,hash);
     store.put('policies',hash,{id:hash,accessTokenId:token.id,personId:person.id,accountId});
     store.db.exec('COMMIT');
     return {token:token.secret};
    }catch(e){store.db.exec('ROLLBACK');throw e;}
   });queue=work;return work;
  },
  login(secret){const token=accessTokens.find(secret);if(!token?.personId||!accessTokens.owns(token.id,token.boundAccountId)||!store.get('accounts',token.boundAccountId))throw Error('Неверный личный токен.');
   const value=randomBytes(32).toString('base64url'),id=createHash('sha256').update(value).digest('hex'),now=Date.now();
   store.put('sessions',id,{id,accountId:token.boundAccountId,accessTokenId:token.id,createdAt:now,expiresAt:now+90*86400000});return {token:value};
  }
 };
}

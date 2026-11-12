import { DatabaseSync } from 'node:sqlite';
import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { mkdirSync } from 'node:fs';
export class Store {
  constructor(dir,key) {
    if (!/^[0-9a-f]{64}$/i.test(key||'')) throw Error('ENCRYPTION_KEY must be 32 random bytes in hex');
    mkdirSync(dir,{recursive:true,mode:0o700}); this.key=Buffer.from(key,'hex');
    this.db=new DatabaseSync(`${dir}/portal38.db`);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS objects (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));');
  }
  encode(kind,id,value) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv); cipher.setAAD(Buffer.from(`${kind}:${id}`));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
  }
  decode(kind,id,value) {
    const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12)); d.setAAD(Buffer.from(`${kind}:${id}`)); d.setAuthTag(b.subarray(12,28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));
  }
  list(kind) {return this.db.prepare('SELECT * FROM objects WHERE kind=?').all(kind).map(r=>this.decode(kind,r.id,r.value));}
  get(kind,id) {const r=this.db.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get(kind,id);return r?this.decode(kind,id,r.value):null;}
  put(kind,id,value) {this.db.prepare('INSERT OR REPLACE INTO objects VALUES (?,?,?)').run(kind,id,this.encode(kind,id,value));return value;}
  delete(kind,id) {this.db.prepare('DELETE FROM objects WHERE kind=? AND id=?').run(kind,id);}
}

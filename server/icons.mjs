import {deflateSync} from 'node:zlib';import {writeFileSync} from 'node:fs';
function crc(b){let c=0xffffffff;for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,check]);}
for(const size of [192,512]){const pixels=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)for(let x=0;x<size;x++){const p=y*(size*4+1)+1+x*4,cross=((x/size>=.43&&x/size<=.57&&y/size>=.28&&y/size<=.72)||(y/size>=.43&&y/size<=.57&&x/size>=.28&&x/size<=.72));pixels[p]=cross?255:23;pixels[p+1]=cross?255:104;pixels[p+2]=cross?255:85;pixels[p+3]=255;}const h=Buffer.alloc(13);h.writeUInt32BE(size);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;writeFileSync(`public/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));}

// Notification badges use the alpha channel as a monochrome mask.
// Keep the app's cross, without the opaque launcher-icon background.
const badgeSize=96;
const badgePixels=Buffer.alloc(badgeSize*(badgeSize*4+1));
for(let y=0;y<badgeSize;y++)for(let x=0;x<badgeSize;x++){
 const p=y*(badgeSize*4+1)+1+x*4;
 const cross=(x>=33&&x<63&&y>=3&&y<93)||(y>=33&&y<63&&x>=3&&x<93);
 if(cross)badgePixels.fill(255,p,p+4);
}
const badgeHeader=Buffer.alloc(13);
badgeHeader.writeUInt32BE(badgeSize);badgeHeader.writeUInt32BE(badgeSize,4);badgeHeader[8]=8;badgeHeader[9]=6;
writeFileSync('public/notification-badge-96.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',badgeHeader),chunk('IDAT',deflateSync(badgePixels)),chunk('IEND',Buffer.alloc(0))]));

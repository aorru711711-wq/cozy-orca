const zlib=require('zlib'),fs=require('fs');
['life/birds.js','life/sparkles.js','life/night.js','scene.js'].forEach(f=>require(require('path').join(__dirname,'..','src',f)));
const sc=globalThis.CozyScene;
function frame(state,t){const d=new Uint8Array(144*72*3);let fs_='#000',ga=1;
const ctx={set fillStyle(v){fs_=v},get fillStyle(){return fs_},set globalAlpha(v){ga=v},get globalAlpha(){return ga},
fillRect(x,y,w,h){const r=parseInt(fs_.slice(1,3),16),g=parseInt(fs_.slice(3,5),16),b=parseInt(fs_.slice(5,7),16);
for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++){const k=(j*144+i)*3;d[k]=r*ga+d[k]*(1-ga);d[k+1]=g*ga+d[k+1]*(1-ga);d[k+2]=b*ga+d[k+2]*(1-ga);}}};
sc.draw(ctx,state,t);return d;}
const crc=(()=>{const T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c>>>0}return b=>{let c=~0;for(const x of b)c=T[(c^x)&255]^(c>>>8);return ~c>>>0}})();
function chunk(t,b){const l=Buffer.alloc(4);l.writeUInt32BE(b.length);const tb=Buffer.concat([Buffer.from(t),b]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(tb));return Buffer.concat([l,tb,c])}
function png(frames,S_=4){const n=frames.length,W=144*S_,H=72*S_*n,raw=Buffer.alloc((W*3+1)*H);
for(let f=0;f<n;f++)for(let y=0;y<72*S_;y++){const row=(f*72*S_+y)*(W*3+1);raw[row]=0;for(let x=0;x<W;x++){const k=((y/S_|0)*144+(x/S_|0))*3;for(let c=0;c<3;c++)raw[row+1+x*3+c]=frames[f][k+c]}}
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=2;
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const st={kind:'working',crewCount:1,sailingMs:0,completedCount:1,remainingCount:1};
const S={day1:[st,0],day3:[{...st,crewCount:3,completedCount:4,remainingCount:3,sailingMs:300000},2.3],night8:[{...st,crewCount:8,sailingMs:500000,completedCount:2},1.3],idle2:[{...st,kind:"idle",crewCount:2,sailingMs:100000},4],storm5:[{...st,hasError:true,crewCount:5},0.5],day1b:[st,0.7],day1c:[st,1.4]};
const names=process.argv[3].split(',');const scale=+(process.argv[4]||4);
fs.writeFileSync(process.argv[2],png(names.map(n=>frame(S[n][0],S[n][1])),scale));

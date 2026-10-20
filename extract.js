/* استخراج البيانات محلياً (بدون API). كل كلمة: {s,x,y,w,h} حيث y من الأعلى للأسفل */
const AR_RE=/[\u0600-\u06FF]/, LAT_RE=/[A-Za-z]/;
const SUF_EN={WLL:"W.L.L",LLW:"W.L.L",SPC:"S.P.C",CPS:"S.P.C",BSC:"B.S.C",CSB:"B.S.C"};
const SUF_AR={"ذمم":"ذ.م.م","ممذ":"ذ.م.م","شمب":"ش.م.ب","بمش":"ش.م.ب","ششو":"ش.ش.و","وشش":"ش.ش.و","شمخ":"ش.م.خ"};
const sufEn=t=>SUF_EN[t.toUpperCase().replace(/[.\s()]/g,"")];
const sufAr=t=>SUF_AR[t.replace(/[.\s()]/g,"")];
const LABELS=/^(Name|Group|Commercial|Registration|Type|CR|Status|Due|Date|No\.?)$/i;
const gapOf=(a,b)=>b.x-(a.x+a.w);

function rowOf(words,ref,tol){
  const cy=ref.y+ref.h/2,t=tol||Math.max(ref.h,6)*0.6;
  return words.filter(w=>Math.abs(w.y+w.h/2-cy)<t);
}

const PF_RE=/[\uFB50-\uFDFF\uFE70-\uFEFF]/;
/* توحيد العربي: بعض ملفات PDF تخزّن الحروف بترتيب بصري معكوس. نكتشف ذلك بالتصويت ثم نصحّح */
function normDoc(words0){
  let ws=words0.map(w=>({...w,s:(AR_RE.test(w.s)||PF_RE.test(w.s))?w.s.normalize("NFKC"):w.s}));
  let a=0,b=0;
  for(const w of ws){if(!AR_RE.test(w.s))continue;
    if(/^ال/.test(w.s))a++;else if(w.s.length>3&&/لا$/.test(w.s))b++;}
  if(b>a)return ws.map(w=>AR_RE.test(w.s)?{...w,s:[...w.s].reverse().join("")}:w);
  const g={};ws.forEach(w=>{if(w.g!==undefined&&AR_RE.test(w.s))(g[w.g]=g[w.g]||[]).push(w)});
  for(const k in g){const arr=g[k];if(arr.length<2)continue;
    arr.sort((p,q)=>p.x-q.x);
    const pos=arr.map(w=>({x:w.x,w:w.w})).sort((p,q)=>q.x-p.x);
    arr.forEach((w,i)=>{w.x=pos[i].x;w.w=pos[i].w});}
  return ws;
}
function parseCR(words0){
  const words=normDoc(words0);
  const out={companyEn:"",companyAr:"",crNo:"",addrEn:"",addrAr:""};
  // رقم القيد
  const text=words.map(w=>w.s).join(" ");
  let m=text.match(/(\d{4,8})\s*-\s*(\d{1,2})(?!\d)/);
  if(m)out.crNo=m[1]+" - "+m[2];
  else if((m=text.match(/(?<!\d)(\d{1,2})\s*-\s*(\d{4,8})/)))out.crNo=m[2]+" - "+m[1];

  // الاسم التجاري بالإنجليزية
  const sw=words.find(w=>sufEn(w.s));
  if(sw){
    const row=rowOf(words,sw).filter(w=>LAT_RE.test(w.s)&&!AR_RE.test(w.s)).sort((a,b)=>a.x-b.x);
    let i=row.indexOf(sw),lo=i,hi=i;
    while(lo>0&&gapOf(row[lo-1],row[lo])<row[lo].h*1.6&&!LABELS.test(row[lo-1].s))lo--;
    while(hi<row.length-1&&gapOf(row[hi],row[hi+1])<row[hi].h*1.6&&!LABELS.test(row[hi+1].s))hi++;
    const nm=row.slice(lo,hi+1).filter(w=>w!==sw).map(w=>w.s);
    if(nm.length)out.companyEn=nm.join(" ")+" "+sufEn(sw.s);
  }
  // الاسم التجاري بالعربية
  const sa=words.find(w=>sufAr(w.s));
  if(sa){
    const row=rowOf(words,sa).filter(w=>AR_RE.test(w.s)&&w!==sa&&w.x>sa.x).sort((a,b)=>a.x-b.x);
    const got=[];let prev=sa;
    for(const w of row){if(gapOf(prev,w)<w.h*1.8){got.push(w);prev=w}else break}
    if(got.length)out.companyAr=got.reverse().map(w=>w.s).join(" ")+" "+sufAr(sa.s);
  }
  // العنوان
  const lab=n=>words.find(w=>w.s.toLowerCase().replace(/[^a-z]/g,"")===n);
  const L={block:lab("block"),road:lab("road"),bld:lab("building"),flat:lab("flatshop")||lab("flat")};
  const num=l=>{
    if(!l)return null;const cx=l.x+l.w/2;
    const c=words.filter(w=>/^\d{1,5}$/.test(w.s)&&w.y>l.y&&w.y-l.y<l.h*8);
    c.sort((a,b)=>Math.abs(a.x+a.w/2-cx)-Math.abs(b.x+b.w/2-cx));return c[0]||null;
  };
  const N={block:num(L.block),road:num(L.road),bld:num(L.bld),flat:num(L.flat)};
  if(N.block&&N.road){
    const row=rowOf(words,N.block,N.block.h*1.2).filter(w=>w.x+w.w<N.block.x-2&&!/^\d+$/.test(w.s));
    const clean=a=>a.join(" ").replace(/^(\s*\/)+/,"").replace(/(\s*\/)+\s*$/,"").replace(/\s*\/\s*/g," / ").trim();
    const en=row.filter(w=>/^[A-Z]{2,}$/.test(w.s)||w.s==="/").sort((a,b)=>a.x-b.x).map(w=>w.s);
    const ar=row.filter(w=>AR_RE.test(w.s)||w.s==="/").sort((a,b)=>b.x-a.x).map(w=>w.s);
    const P=(k,e,a)=>N[k]?{e:`${e} ${N[k].s}`,a:`${a} ${N[k].s}`}:null;
    const parts=[P("flat","Flat","شقة"),P("bld","Building","مبنى"),P("road","Road","طريق"),P("block","Block","مجمع")].filter(Boolean);
    const areaEn=clean(en),areaAr=clean(ar);
    out.addrEn=parts.map(p=>p.e).concat(areaEn?[areaEn]:[]).join(", ");
    out.addrAr=parts.map(p=>p.a).concat(areaAr?[areaAr]:[]).join("، ");
  }
  return out;
}

function parseID(text){
  const out={personEn:"",personAr:""};
  const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const BAD=/KINGDOM|BAHRAIN|IDENTITY|CARD|PERSONAL|NUMBER|NATIONALITY|NAME|مملكة|البحرين|بطاقة|الهوية|الرقم|الشخصي|الجنسية|الاسم|الإسم/i;
  let bestEn=0;
  for(const l of lines){
    const ws=l.replace(/[^A-Za-z\s.'-]/g," ").split(/\s+/).filter(x=>x.length>0);
    const up=ws.filter(x=>x===x.toUpperCase()&&/[A-Z]/.test(x));
    if(ws.length>=2&&up.length===ws.length&&!BAD.test(l)&&l.length>bestEn&&!AR_RE.test(l)){out.personEn=ws.join(" ");bestEn=l.length}
  }
  let bestAr=0;
  for(const l of lines){
    if(BAD.test(l))continue;
    const ws=l.replace(/[^\u0600-\u06FF\s]/g," ").split(/\s+/).filter(Boolean);
    const sc=ws.length+(ws.includes("بن")?3:0)+(ws.includes("آل")?1:0);
    if(ws.length>=3&&sc>bestAr){out.personAr=ws.join(" ");bestAr=sc}
  }
  return out;
}
const isCR=t=>/Commercial|Registration|السجل التجاري|قيد/i.test(t);
const isID=t=>/IDENTITY|PERSONAL\s*NUMBER|الرقم الشخصي|بطاقة الهوية/i.test(t);
if(typeof module!=="undefined")module.exports={parseCR,parseID,isCR,isID};

/* PaddleOCR (ONNX) داخل المتصفح عبر onnxruntime-web: نموذج عربي ونموذج إنجليزي لقراءة أسطر صورة الهوية */
const PADDLE_HF="https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/";
const ORT_WASM="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/";
const PADDLE_DIR={ar:"arabic/",en:"english/"};
const paddleModels={};

async function loadRec(lang){
  if(paddleModels[lang])return paddleModels[lang];
  if(typeof ort==="undefined")throw new Error("لم تُحمَّل مكتبة onnxruntime-web");
  ort.env.wasm.numThreads=1;
  ort.env.wasm.wasmPaths=ORT_WASM;
  const base=PADDLE_HF+PADDLE_DIR[lang];
  const [m,d]=await Promise.all([
    fetch(base+"rec.onnx").then(r=>{if(!r.ok)throw new Error("تعذّر تحميل نموذج PaddleOCR ("+r.status+")");return r.arrayBuffer()}),
    fetch(base+"dict.txt").then(r=>{if(!r.ok)throw new Error("تعذّر تحميل قاموس الحروف ("+r.status+")");return r.text()})
  ]);
  const dict=d.split("\n").map(s=>s.replace(/\r$/,""));
  if(dict.length&&dict[dict.length-1]==="")dict.pop();
  const sess=await ort.InferenceSession.create(new Uint8Array(m),{executionProviders:["wasm"]});
  return(paddleModels[lang]={sess,dict});
}

/* فك CTC: 0 = فراغ، ثم حروف القاموس، وما بعدها مسافة */
function ctcDecode(data,T,C,dict){
  let prev=0,txt="",ps=[];
  for(let t=0;t<T;t++){
    let bi=0,bv=-Infinity;const o=t*C;
    for(let c=0;c<C;c++){const v=data[o+c];if(v>bv){bv=v;bi=c}}
    if(bi!==0&&bi!==prev){txt+=bi-1<dict.length?dict[bi-1]:" ";ps.push(bv)}
    prev=bi;
  }
  return{text:txt,conf:ps.length?ps.reduce((a,b)=>a+b,0)/ps.length:0};
}
/* العربي يخرج بترتيب الرسم: نعكسه ونعيد مقاطع الإنجليزي والأرقام لاتجاهها */
function fixDrawn(s){
  const r=[...s.normalize("NFKC")].reverse().join("");
  return r.replace(/[A-Za-z0-9](?:[A-Za-z0-9.,:\/\-]*[A-Za-z0-9])?/g,m=>[...m].reverse().join(""));
}

async function recLine(src,lang){
  const {sess,dict}=await loadRec(lang);
  const H=48,W=Math.max(16,Math.min(1600,Math.round(src.width*H/src.height)));
  const c=document.createElement("canvas");c.width=W;c.height=H;
  const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,W,H);x.drawImage(src,0,0,W,H);
  const px=x.getImageData(0,0,W,H).data,HW=H*W,f=new Float32Array(3*HW);
  for(let i=0;i<HW;i++){f[i]=(px[4*i+2]/255-.5)/.5;f[HW+i]=(px[4*i+1]/255-.5)/.5;f[2*HW+i]=(px[4*i]/255-.5)/.5}
  const out=await sess.run({[sess.inputNames[0]]:new ort.Tensor("float32",f,[1,3,H,W])});
  const o=out[sess.outputNames[0]],r=ctcDecode(o.data,o.dims[1],o.dims[2],dict);
  const t=lang==="ar"?fixDrawn(r.text):r.text;
  return{text:t.replace(/\s+/g," ").trim(),conf:r.conf};
}

/* يقص كل سطر حدّده Tesseract ويقرؤه بالنموذجين؛ يعيد الاسم العربي والإنجليزي إن وُجدا */
async function paddleReadId(canvas,lines){
  const ar=[],en=[];
  for(const l of lines){
    const b=l.b,w=b.x1-b.x0,h=b.y1-b.y0;
    if(h<10||w<h*2)continue;
    const p=Math.round(h*.25),x0=Math.max(0,b.x0-p),y0=Math.max(0,b.y0-p);
    const cw=Math.min(canvas.width-x0,w+2*p),ch=Math.min(canvas.height-y0,h+2*p);
    const c=document.createElement("canvas");c.width=cw;c.height=ch;
    c.getContext("2d").drawImage(canvas,x0,y0,cw,ch,0,0,cw,ch);
    const ra=await recLine(c,"ar");if(ra.text)ar.push(ra);
    try{const re=await recLine(c,"en");if(re.text)en.push(re)}catch(e){en.err=e}
  }
  const pick=(arr,key)=>{
    const v=parseID(arr.map(r=>r.text).join("\n"))[key];if(!v)return null;
    const first=v.split(" ")[0],line=arr.find(r=>r.text.includes(first));
    return{text:v,conf:line?line.conf:0};
  };
  return{ar:pick(ar,"personAr"),en:pick(en,"personEn"),enErr:en.err||null};
}
if(typeof module!=="undefined")module.exports={ctcDecode,fixDrawn};

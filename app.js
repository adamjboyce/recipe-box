"use strict";
const TRAITS=[["camping","Camping-friendly"],["make-ahead","Make-ahead"],["freezer","Freezer-friendly"],["shelf-stable","Shelf stable"],["slow-cooker","Slow cooker"],["long-cook","Long cook"],["crowd","Feeds a crowd"],["quick","Quick"]];
const TRAIT_LABEL=Object.fromEntries(TRAITS);
const CATS=["Mains","Soups & Stews","Sides & Breads","Baking & Dough","Breakfast","Sauces & Condiments","Spice Blends","Desserts","Drinks"];
const CFG=window.RB_CONFIG||{};
const SB=CFG.supabaseUrl&&CFG.supabaseKey?{url:CFG.supabaseUrl.replace(/\/$/,""),key:CFG.supabaseKey}:null;
const state={recipes:new Map(),loaded:false,q:"",cat:"",show:"all",sort:"best",openId:null,checked:{},scale:{},photoSel:{},friends:new Map(),friendsLoaded:false,src:"ark",fr:new Map(),frLoaded:false};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2400)}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
Object.assign(state,load("rb.view",{}));
if(!Array.isArray(state.traits))state.traits=[];
state.checked=load("rb.checked",{});state.scale=load("rb.scale",{});
function saveView(){store("rb.view",{src:state.src,q:state.q,cat:state.cat,show:state.show,sort:state.sort,traits:state.traits,diets:state.diets,open:state.open})}
function renderTraits(){}

/* ---------- friends (Supabase REST) ---------- */
async function sb(path,opts={}){
  const r=await fetch(`${SB.url}/rest/v1/${path}`,{...opts,headers:{apikey:SB.key,...(SB.key.startsWith("sb_")?{}:{Authorization:`Bearer ${SB.key}`}),"Content-Type":"application/json",...(opts.headers||{})}});
  if(!r.ok)throw new Error(r.status+" "+(await r.text()).slice(0,200));
  const t=await r.text();return t?JSON.parse(t):null;
}
async function loadFriends(){
  if(!SB)return;
  try{
    let rows;try{rows=await sb("notes?select=id,recipe_id,name,rating,note,photo_path,created_at&order=created_at.desc&limit=5000")}catch(e){rows=await sb("notes?select=id,recipe_id,name,rating,note,created_at&order=created_at.desc&limit=5000");state.noPhotos=true}
    state.friendRows=rows;regroupFriends();
  }catch(e){console.warn("friend notes unavailable",e)}
  state.friendsLoaded=true;renderList();renderCard();if(!$("#home").hidden)renderHome();
}
function regroupFriends(){
  const al=state.aliases||new Map();state.friends=new Map();
  for(const n of state.friendRows||[]){const id=al.get(n.recipe_id)||n.recipe_id;if(!state.friends.has(id))state.friends.set(id,[]);state.friends.get(id).push(n)}
}
function sbHeaders(extra){return {apikey:SB.key,...(SB.key.startsWith("sb_")?{}:{Authorization:`Bearer ${SB.key}`}),...(extra||{})}}
const photoUrl=p=>`${SB.url}/storage/v1/object/public/photos/${p.split("/").map(encodeURIComponent).join("/")}`;
function allPhotos(r){
  const own=r.friend?(r.friendPhoto&&SB?[{src:photoUrl(r.friendPhoto),by:r.by}]:[]):(r.photos||[]).map(p=>typeof p==="string"?{src:"photos/"+p,by:"Adam"}:{src:photoUrl(p.path),by:p.by||"Adam"});
  const fr=SB?(state.friends.get(r.id)||[]).filter(n=>n.photo_path).map(n=>({src:photoUrl(n.photo_path),by:n.name})):[];
  return [...own,...fr];
}
function shrink(file){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{const max=1800,s=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
      c.toBlob(b=>b?res(b):rej(new Error("encode")),"image/jpeg",.85)};
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("decode"))};img.src=url;
  });
}
async function uploadFriendPhoto(recipeId,file){
  const blob=await shrink(file);
  if(blob.size>5*1024*1024)throw new Error("too big");
  const path=`${recipeId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const r=await fetch(`${SB.url}/storage/v1/object/photos/${path}`,{method:"POST",headers:sbHeaders({"Content-Type":"image/jpeg","x-upsert":"false"}),body:blob});
  if(!r.ok)throw new Error("upload "+r.status+" "+(await r.text()).slice(0,200));
  return path;
}
function beforeChange(r,n){const c=(r.changes||[]).find(c=>n.created_at&&n.created_at.slice(0,10)<c.date);return c?`<span class="before">before the ${esc(fmtDate(c.date))} change</span>`:""}
function friendAvg(id){const rs=(state.friends.get(id)||[]).map(n=>n.rating).filter(Boolean);return rs.length?{avg:rs.reduce((a,b)=>a+b,0)/rs.length,n:rs.length}:null}

/* ---------- index ---------- */
function renderCats(){renderFilters()}
const SHOW_OPTS=[["all","All recipes"],["rated","Rated 4+"],["photos","With photos"]];
/* ---------- filters: type dropdown, filter panel, search with exclusions ---------- */
const DIETS=[["vegetarian","Vegetarian"],["vegan","Vegan"],["pescatarian","Pescatarian"],["gluten-free","Gluten-free"],["dairy-free","Dairy-free"]];
const DIET_LABEL=Object.fromEntries(DIETS);
["diets"].forEach(k=>{if(!Array.isArray(state[k]))state[k]=[]});
state.ingr=[];state.panel=false;
const stem=w=>w.toLowerCase().trim().replace(/(es|s)$/,"");
function allGroups(r){return [...(r.groups||[]),...(r.alt_methods||[]).flatMap(a=>a.groups||[])]}
function ingText(r){return allGroups(r).flatMap(g=>g.ingredients||[]).join(" | ").toLowerCase()}
function hasIngr(r,term){const t=ingText(r),w=term.toLowerCase().trim();return t.includes(w)||t.includes(stem(w))}
function parseQ(q){
  const exc=[];
  q=(" "+q.toLowerCase()).replace(/\s(?:no|without)\s+([^\s,]+)/g,(m,w)=>{exc.push(w);return " "}).replace(/\s-([^\s,]+)/g,(m,w)=>{exc.push(w);return " "});
  return {inc:q.split(/[\s,]+/).filter(Boolean),exc};
}
function searchMatch(r){
  const {inc,exc}=parseQ(state.q||"");
  if(exc.some(w=>hasIngr(r,w)))return false;
  const h=haystack(r);
  return inc.every(w=>h.includes(w)||h.includes(stem(w)));
}
function filterMatch(r){
  if(state.diets.length&&!state.diets.every(d=>(r.diet||[]).includes(d)))return false;
  return true;
}
const SHOW_LABEL=Object.fromEntries(SHOW_OPTS);
function activeCount(){return state.traits.length+state.diets.length+(state.show&&state.show!=="all"?1:0)}
function renderFilters(){
  const all=srcList();const fr=state.src==="friends";
  document.querySelectorAll("[data-src]").forEach(b=>{b.setAttribute("aria-pressed",String(b.dataset.src===state.src));b.onclick=()=>setSrc(b.dataset.src)});
  const count=fn=>all.filter(fn).length;
  // type dropdown
  const sel=$("#catSel");
  if(sel){
    const cats=CATS.map(c=>[c,count(r=>r.category===c)]).filter(x=>x[1]);
    sel.innerHTML=`<option value="">All types</option>`+cats.map(([c,n])=>`<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");
    sel.value=state.cat||"";
    sel.onchange=()=>{state.cat=sel.value;applyFilters()};
  }
  // filters button
  const n=fr?0:activeCount(),btn=$("#fBtn");btn.hidden=fr;if(fr)state.panel=false;
  btn.innerHTML=`Filters${n?` <span class="badge">${n}</span>`:""}`;
  btn.setAttribute("aria-expanded",String(state.panel));
  btn.onclick=()=>{state.panel=!state.panel;renderFilters()};
  // active chips (shown when panel is closed)
  const act=$("#activeF");
  const chips=[...(state.show&&state.show!=="all"?[["show",state.show,SHOW_LABEL[state.show]]]:[]),
    ...state.traits.map(t=>["traits",t,TRAIT_LABEL[t]]),...state.diets.map(d=>["diets",d,DIET_LABEL[d]])].filter(c=>c[2]);
  act.hidden=fr||state.panel||!chips.length;
  act.innerHTML=chips.map(([g,k,l])=>`<span class="achip">${esc(l)}<button type="button" data-g="${g}" data-k="${esc(k)}" aria-label="Remove ${esc(l)}">×</button></span>`).join("")+(chips.length>1?`<button type="button" class="more" data-clear>Clear all</button>`:"");
  act.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{const g=b.dataset.g,k=b.dataset.k;if(g==="show")state.show="all";else state[g]=state[g].filter(x=>x!==k);applyFilters()});
  // panel
  const p=$("#fPanel");p.hidden=!state.panel;
  if(state.panel){
    const traits=TRAITS.filter(([k])=>all.some(r=>(r.traits||[]).includes(k)));
    const diets=DIETS.filter(([k])=>all.some(r=>(r.diet||[]).includes(k)));
    const grp=(title,key,items,isOn)=>`<div class="fgroup"><h5>${esc(title)}</h5><div class="opts">${items.map(([k,l])=>`<button type="button" class="chip" data-pg="${key}" data-k="${esc(k)}" aria-pressed="${isOn(k)}">${esc(l)}</button>`).join("")}</div></div>`;
    p.innerHTML=grp("Show","show",SHOW_OPTS,k=>(state.show||"all")===k)+grp("Good for","traits",traits,k=>state.traits.includes(k))+grp("Diet","diets",diets,k=>state.diets.includes(k))+
      `<p class="hint-line">Ingredients: type them in search. "mushroom" finds it, "no pork" leaves it out.</p>`+
      `<div class="fpanel-foot">${n?`<button type="button" class="more" data-clear>Clear all</button>`:""}<span style="flex:1"></span><button type="button" class="btn primary" id="fDone">Show ${filtered().length} recipes</button></div>`;
    p.querySelectorAll("[data-pg]").forEach(b=>b.onclick=()=>{const g=b.dataset.pg,k=b.dataset.k;
      if(g==="show")state.show=state.show===k?"all":k;else state[g]=state[g].includes(k)?state[g].filter(x=>x!==k):[...state[g],k];applyFilters()});
    $("#fDone").onclick=()=>{state.panel=false;renderFilters()};
  }
  document.querySelectorAll("[data-clear]").forEach(b=>b.onclick=()=>{state.show="all";state.traits=[];state.diets=[];applyFilters()});
}
function applyFilters(){saveView();renderFilters();renderList()}

const LINK_RE=/\[([^\]]+)\]\(([a-z0-9-]+)\)/g;
function linkify(escaped){return escaped.replace(LINK_RE,(m,l,id)=>state.recipes.has(id)?`<a class="rlink" href="#${id}">${l}</a>`:l)}
function unlink(t){return String(t??"").replace(LINK_RE,"$1")}
function haystack(r){return unlink([r.title,r.cuisine,r.category,(r.tags||[]).join(" "),...allGroups(r).flatMap(g=>g.ingredients||[]),(r.alt_methods||[]).map(a=>a.name).join(" ")].join(" ")).toLowerCase()}
function score(r){const f=friendAvg(r.id);return r.rating||(f?f.avg:0)}
function filtered(){
  const q=state.q.trim().toLowerCase();
  const fr=state.src==="friends";
  const rs=srcList().filter(r=>{
    if(state.cat&&r.category!==state.cat)return false;
    if(fr)return !q||searchMatch(r);
    if(state.show==="rated"&&!(score(r)>=4))return false;
    if(state.show==="photos"&&!allPhotos(r).length)return false;
    if(state.traits.length&&!state.traits.every(t=>(r.traits||[]).includes(t)))return false;
    if(!filterMatch(r))return false;
    if(q&&!searchMatch(r))return false;
    return true});
  const by={
    best:(a,b)=>score(b)-score(a)||a.title.localeCompare(b.title),
    az:(a,b)=>a.title.localeCompare(b.title),
    new:(a,b)=>(b.developed||"").localeCompare(a.developed||"")||a.title.localeCompare(b.title)}[state.sort]||((a,b)=>a.title.localeCompare(b.title));
  return rs.sort(by);
}
function stars(n){n=Math.round(n||0);return n?"★".repeat(n)+"☆".repeat(5-n):""}
function renderList(){
  const all=srcList(),fr=state.src==="friends";
  $("#count").textContent=state.loaded?`${all.length} recipe${all.length===1?"":"s"}`:"";
  const el=$("#list");if(!state.loaded)return;
  if(fr&&!state.frLoaded){el.innerHTML=`<div class="empty">Loading friends' recipes…</div>`;return}
  const rs=filtered();
  const share=fr&&SB?`<a class="btn primary share-cta" href="#share">+ Share a recipe</a>`:"";
  if(!rs.length){el.innerHTML=share+`<div class="empty">${fr&&!all.length?"No friends' recipes yet. Be the first to share one.":"Nothing matches. Clear the search or pick another category."}</div>`;return}
  const grouped=state.sort==="best"&&!state.cat;
  const order=grouped?[...rs].sort((a,b)=>CATS.indexOf(a.category)-CATS.indexOf(b.category)):rs;
  let html=share,cur=null;
  for(const r of order){
    if(grouped&&r.category!==cur){cur=r.category;html+=`<div class="group-label">${esc(cur)}</div>`}
    const f=(state.friends.get(r.id)||[]).length;
    const meta=[r.friend?"from "+r.by:r.cuisine,r.yield,f?`${f} note${f>1?"s":""}`:""].filter(Boolean).join(" · ");
    const ph0=allPhotos(r)[0];
    html+=`<button class="item${ph0?" has-photo":""}" type="button" data-id="${esc(r.id)}" aria-current="${r.id===state.openId}">
      ${ph0?`<img class="thumb" src="${esc(ph0.src)}" alt="" loading="lazy">`:""}<span class="t">${esc(r.title)}</span><span class="m">${esc(meta)}</span>
      <span class="s"><span class="mini-stars">${stars(r.rating)}</span></span></button>`;
  }
  el.innerHTML=html;
  el.querySelectorAll(".item").forEach(b=>b.onclick=()=>openRecipe(b.dataset.id));
}

/* ---------- quantities and scaling ---------- */
const QTY=/^((?:~|about |approx\.? )?[\d½¼¾⅓⅔⅛.,\/\- –]+(?:\s*(?:g|kg|mg|ml|l|L|oz|fl oz|lb|lbs|tsp|tbsp|cups?|qt|quarts?|pt|gal|gallons?|sticks?|cans?|heads?|cloves?|dozen|bottles?|packages?|sprigs?|ears?|x)\b)?)\s*(.*)$/i;
function splitQty(line){const m=String(line).match(QTY);return m&&m[2]?[m[1].trim(),m[2]]:["",line]}
const UNI={"½":.5,"¼":.25,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125};
const NUM="(?:\\d+\\s*[½¼¾⅓⅔⅛]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*[½¼¾⅓⅔⅛]|\\d+(?:\\.\\d+)?)";
const UNIT="(?:kg|g|mg|ml|l|L|fl oz|oz|lbs?|tsp|tbsp|cups?|qt|quarts?|pt|pints?|gal|gallons?|sticks?|cans?|heads?|cloves?|dozen|bottles?|packages?|sprigs?|ears?)";
const LEAD=new RegExp(`^((?:about |~)?)(${NUM})(\\s*[-–]\\s*(${NUM}))?(\\s*)(${UNIT})?(?=[\\s,.)]|$)`,"i");
const OFN=new RegExp(`^((?:juice|zest|peel|peels|whites|yolks) of (?:the same )?)(${NUM})\\b`,"i");
function num(s){s=s.trim();let m;if(m=s.match(/^(\d+)\s+(\d+)\/(\d+)$/))return +m[1]+m[2]/m[3];if(m=s.match(/^(\d+)\/(\d+)$/))return m[1]/m[2];if(m=s.match(/^(\d*)\s*([½¼¾⅓⅔⅛])$/))return (+m[1]||0)+UNI[m[2]];return parseFloat(s)}
function frac(x){const w=Math.floor(x+1e-9),r=x-w;const opts=[[0,""],[.25,"¼"],[1/3,"⅓"],[.5,"½"],[2/3,"⅔"],[.75,"¾"],[1,""]];let best=opts[0];for(const o of opts)if(Math.abs(r-o[0])<Math.abs(r-best[0]))best=o;const W=best[0]===1?w+1:w;return (W?String(W):"")+best[1]||"0"}
function fmt(x,unit){
  const u=(unit||"").toLowerCase();
  if(u==="g"||u==="ml"||u==="mg"){if(x>=100)return String(Math.round(x/5)*5);if(x>=10)return String(Math.round(x));if(x>=2)return String(Math.round(x*2)/2);return String(Math.round(x*10)/10)}
  if(u==="kg"||u==="l")return String(+x.toFixed(2));
  if(u==="oz"||u==="fl oz")return String(Math.round(x*2)/2);
  return frac(x);
}
function scaleLine(line,k){
  if(k===1)return line;
  let m=line.match(LEAD);
  if(m&&m[2]){
    const unit=m[6]||"";const a=fmt(num(m[2])*k,unit);const b=m[4]?"–"+fmt(num(m[4])*k,unit):"";
    return m[1]+a+b+m[5]+unit+line.slice(m[0].length);
  }
  m=line.match(OFN);
  if(m)return m[1]+fmt(num(m[2])*k,"")+line.slice(m[0].length);
  return line;
}
const _scaleLead=scaleLine;
scaleLine=function(line,k){
  if(k===1)return line;
  const am=String(line).match(/\(about ([^()]*)\)\s*$/);
  if(!am)return _scaleLead(line,k);
  const head=line.slice(0,am.index);
  return _scaleLead(head,k)+"(about "+_scaleLead(am[1],k)+")";
};
function getScale(id){const v=state.scale[id];return v>0?v:1}
function setScale(id,k){if(k===1)delete state.scale[id];else state.scale[id]=k;store("rb.scale",state.scale);renderCard()}
function fmtDate(d){if(!d)return"";const dt=new Date(d.length===10?d+"T12:00:00":d);return isNaN(dt)?"":dt.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}

/* ---------- card ---------- */
/* cook mode: keep the screen awake, bigger type, highlight the next step */
let wakeLock=null;
async function grabWake(){try{if("wakeLock" in navigator&&document.visibilityState==="visible"){wakeLock=await navigator.wakeLock.request("screen");wakeLock.addEventListener("release",()=>{wakeLock=null})}else if(!("wakeLock" in navigator))return false}catch(e){return false}return true}
async function setMode(m){
  const was=state.mode;state.mode=m;const b=document.body;
  b.classList.toggle("cooking",!!m);b.classList.toggle("mode-mise",m==="mise");b.classList.toggle("mode-cook",m==="cook");
  document.querySelectorAll("[data-mode]").forEach(x=>{const on=x.dataset.mode===m;x.setAttribute("aria-pressed",String(on));x.textContent=(on?"● ":"")+(x.dataset.mode==="mise"?"Mise en place":"Cook")});
  if(m&&!was){const ok=await grabWake();if(!ok)toast("This browser can't keep the screen awake, so check its sleep setting.")}
  if(!m){try{wakeLock&&await wakeLock.release()}catch(e){}wakeLock=null}
  if(m==="cook"){const h=$("#methodH");if(h)h.scrollIntoView({behavior:"smooth",block:"start"})}
  if(m==="mise"){const h=document.querySelector(".body .sec-h");if(h)h.scrollIntoView({behavior:"smooth",block:"start"})}
  markNext();
}
document.addEventListener("visibilitychange",()=>{if(state.mode&&document.visibilityState==="visible"&&!wakeLock)grabWake()});
function markNext(){for(const sel of [".ing li",".steps li"]){const ls=[...document.querySelectorAll(sel)];ls.forEach(l=>l.classList.remove("next"));const n=ls.find(l=>!l.classList.contains("done"));if(n)n.classList.add("next")}}
function openRecipe(id){
  if(state.mode&&id!==state.openId)setMode(null);
  if(id){const s=id.startsWith("f-")?"friends":"ark";if(s!==state.src){state.src=s;state.cat="";saveView();renderFilters()}}
  state.openId=id;
  try{history.replaceState(null,"","#"+(id||"box"))}catch(e){}
  showView("box");
  $("#app").classList.toggle("show-card",!!id);
  renderList();renderCard();$("#pane").scrollTop=0;window.scrollTo(0,0);
}
function photoBlock(r){
  const ps=allPhotos(r);if(!ps.length)return"";
  const sel=Math.min(state.photoSel[r.id]||0,ps.length-1);
  return `<div class="photos"><img class="hero" src="${esc(ps[sel].src)}" alt="${esc(r.title)}"><div class="photo-by">Photo by ${esc(ps[sel].by)}</div>
    ${ps.length>1?`<div class="strip">${ps.map((p,i)=>`<button type="button" data-ph="${i}" aria-current="${i===sel}" aria-label="Photo ${i+1} by ${esc(p.by)}"><img src="${esc(p.src)}" alt="" loading="lazy"></button>`).join("")}</div>`:""}</div>`;
}
/* cooking methods: the main method lives on the recipe, alternates in alt_methods; tabs pick one */
state.methodSel=load("rb.method",{});
function methodView(r){
  const alts=(r.alt_methods||[]).filter(a=>a&&a.name);
  const base={name:r.method||"Main",groups:r.groups,steps:r.steps,yield:r.yield,notes:r.notes,nutrition:r.nutrition};
  if(!alts.length)return {i:0,list:[],...base};
  const list=[base,...alts.map(a=>({name:a.name,groups:a.groups&&a.groups.length?a.groups:r.groups,steps:a.steps||[],
    yield:a.yield||r.yield,notes:a.notes?a.notes:r.notes,nutrition:a.nutrition||r.nutrition}))];
  let i=+state.methodSel[r.id]||0;if(i>=list.length)i=0;
  return {i,list,...list[i]};
}
function renderCard(){
  const el=$("#card");const r=getR(state.openId);
  if(!r){el.innerHTML=`<div class="empty">${!state.loaded||(state.src==="friends"&&!state.frLoaded)?"Opening the box…":state.src==="friends"?"Pick one of your friends' recipes.":"Pick a recipe from the box."}</div>`;return}
  const M=methodView(r),R={...r,groups:M.groups,steps:M.steps,yield:M.yield,notes:M.notes,nutrition:M.nutrition},ck=r.id+(M.i?"@"+M.i:"");
  const chk=state.checked[ck]||{};const anyChk=Object.values(chk).some(Boolean);const k=getScale(r.id);const presets=[.5,1,1.5,2,3];
  const fa=friendAvg(r.id);const notes=state.friends.get(r.id)||[];
  const me=load("rb.name","");
  el.innerHTML=`
  <div>
    <button class="btn back" type="button" id="backBtn">← ${r.friend?"Friends' recipes":"Box"}</button>
    <div class="eyebrow"><span>${esc(r.category)}</span>${r.cuisine?`<span>${esc(r.cuisine)}</span>`:""}</div>
    <h2>${esc(r.title)}</h2>${r.credit?`<div class="credit">From ${esc(r.credit)}</div>`:""}
    ${(r.changes||[]).length?`<div class="changed">Updated ${esc(fmtDate(r.changes.at(-1).date))}: ${esc(r.changes.at(-1).note)}</div>`:""}
    <div class="meta">${R.yield?`<span>Yield <b>${esc(R.yield)}</b>${k!==1?` <span class="scaled">× ${esc(frac(k))}</span>`:""}</span>`:""}</div>
    <div class="tags">${(r.traits||[]).filter(t=>TRAIT_LABEL[t]).map(t=>`<span class="trait">${esc(TRAIT_LABEL[t])}</span>`).join("")}${(r.diet||[]).filter(d=>DIET_LABEL[d]).map(d=>`<span class="diet">${esc(DIET_LABEL[d])}</span>`).join("")}${(r.tags||[]).filter(t=>!TRAIT_LABEL[t]&&t!=="large-batch"&&t!=="freezer"&&t!=="camping").map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
  </div>
  ${photoBlock(r)}
  <div class="verdict">
    ${r.friend?`<div class="pair"><span class="who">Shared by</span><span class="big by">${esc(r.by)}</span><span class="sub">${esc(fmtDate(r.developed))}</span></div>`:`<div class="pair"><span class="who">Adam</span><span class="big">${r.rating?stars(r.rating):"<span class='sub'>Not rated yet</span>"}</span></div>`}
    ${SB?`<div class="pair"><span class="who">Friends</span><span class="big friends">${fa?stars(fa.avg):"<span class='sub'>No ratings yet</span>"}</span>${fa?`<span class="sub">${fa.avg.toFixed(1)} from ${fa.n}</span>`:""}</div>`:""}
  </div>
  ${M.list.length>1?`<div class="method-tabs" role="tablist" aria-label="Cooking method">${M.list.map((x,mi)=>`<button type="button" role="tab" data-meth="${mi}" aria-selected="${mi===M.i}">${esc(x.name)}</button>`).join("")}</div>`:""}
  <div class="body">
    <section>
      <h3 class="sec-h"><span class="sec-t">Ingredients <button type="button" class="mode-btn" data-mode="mise" aria-pressed="${state.mode==="mise"}" title="Keeps the screen on while you prep">${state.mode==="mise"?"● Mise en place":"Mise en place"}</button></span><span class="chk-ctl"><small id="chkHint"${anyChk?" hidden":""}>tap to check off</small><button type="button" class="reset-chk" id="resetBtn"${anyChk?"":" hidden"}>↺ Uncheck all</button></span></h3>
      <div class="scaler" role="group" aria-label="Batch size">
        <span class="lbl">Batch</span>
        ${presets.map(p=>`<button type="button" class="sc" data-scale="${p}" aria-pressed="${k===p}">${p===1?"1×":frac(p)+"×"}</button>`).join("")}
        <input id="scaleIn" type="number" min="0.1" step="0.05" inputmode="decimal" aria-label="Custom multiplier" value="${presets.includes(k)?"":k}" placeholder="×">
      </div>
      <div class="ing-cols">${(R.groups||[]).map((g,gi)=>`<div class="ing-group">${g.name?`<h4>${esc(g.name)}</h4>`:""}<ul class="ing">${(g.ingredients||[]).map((ing,ii)=>{const [q,rest]=splitQty(scaleLine(ing,k));const key=`i${gi}-${ii}`;return `<li data-k="${key}" class="${chk[key]?"done":""}"><span class="q">${esc(q)}</span><span>${linkify(esc(rest))}</span></li>`}).join("")}</ul></div>`).join("")}</div>
    </section>
    <section>
      <h3 class="sec-h" id="methodH"><span class="sec-t">Method <button type="button" class="mode-btn" data-mode="cook" aria-pressed="${state.mode==="cook"}" title="Keeps the screen on while you cook">${state.mode==="cook"?"● Cook":"Cook"}</button></span></h3>
      <ol class="steps">${(R.steps||[]).map((s,i)=>`<li data-k="s${i}" class="${chk["s"+i]?"done":""}"><span>${linkify(esc(s))}</span></li>`).join("")}</ol>
    </section>
  </div>
  ${R.notes?`<section><h3 class="sec-h">Notes</h3><div class="notes">${linkify(esc(R.notes))}</div></section>`:""}
  ${nutritionBlock(R)}
  ${SB?`<section class="friends-sec">
    <h3 class="sec-h">Made it? <small>leave a rating or a note for ${esc(r.friend?r.by:"Adam")} and everyone else</small></h3>
    <form class="friend-form" id="ff">
      <div class="row"><input id="ffName" maxlength="40" placeholder="Your name" aria-label="Your name" value="${esc(me)}" required>
        <div class="stars" role="group" aria-label="Your rating">${[1,2,3,4,5].map(i=>`<button class="star" type="button" data-fs="${i}" aria-label="${i} star${i>1?"s":""}">★</button>`).join("")}</div></div>
      <textarea id="ffNote" maxlength="1000" placeholder="How did it go? What would you change?" aria-label="Note"></textarea>
      <div class="row"${state.noPhotos?" hidden":""}><input type="file" id="ffPhoto" accept="image/*" hidden><button class="btn" type="button" id="ffPhotoBtn">Add a photo</button><img id="ffPrev" class="ff-prev" alt="" hidden><span class="muted" id="ffPhotoName"></span></div>
      <div class="row"><button class="btn primary" type="submit">Post</button><span class="muted" id="ffMsg"></span></div>
      <p class="hint-line">Adam gives notes and photos a quick look before they show up.</p>
    </form>
    ${notes.length?`<ul class="friend-list">${notes.map(n=>`<li><div class="h"><span class="nm">${esc(n.name)}</span>${n.rating?`<span class="st">${stars(n.rating)}</span>`:""}<span class="dt">${esc(fmtDate(n.created_at))}</span>${beforeChange(r,n)}</div>${n.note?`<div class="tx">${esc(n.note)}</div>`:""}${n.photo_path?`<img class="note-photo" src="${esc(photoUrl(n.photo_path))}" alt="Photo from ${esc(n.name)}" loading="lazy">`:""}</li>`).join("")}</ul>`:state.friendsLoaded?`<p class="muted">No notes yet. Be the first.</p>`:""}
  </section>`:""}
  <div class="foot"><span class="spacer"></span>
    <button class="btn" type="button" id="copyBtn">Copy recipe</button>
    <button class="btn" type="button" id="linkBtn">Copy link</button>
  </div>`;
  el.querySelectorAll("[data-meth]").forEach(b=>b.onclick=()=>{state.methodSel[r.id]=+b.dataset.meth;store("rb.method",state.methodSel);renderCard()});
  $("#backBtn").onclick=()=>openRecipe(null);
  el.querySelectorAll("[data-ph]").forEach(b=>b.onclick=()=>{state.photoSel[r.id]=+b.dataset.ph;renderCard()});
  el.querySelectorAll(".rlink").forEach(a=>a.onclick=e=>e.stopPropagation());
  el.querySelectorAll(".ing li,.steps li").forEach(li=>li.onclick=()=>{const c=state.checked[ck]=state.checked[ck]||{};c[li.dataset.k]=!c[li.dataset.k];li.classList.toggle("done",c[li.dataset.k]);store("rb.checked",state.checked);const on=Object.values(c).some(Boolean);$("#resetBtn").hidden=!on;$("#chkHint").hidden=on;markNext()});
  el.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>setMode(state.mode===b.dataset.mode?null:b.dataset.mode));markNext();
  el.querySelectorAll("[data-scale]").forEach(b=>b.onclick=()=>setScale(r.id,+b.dataset.scale));
  $("#scaleIn").onchange=e=>{const v=parseFloat(e.target.value);if(v>0&&v<=50)setScale(r.id,Math.round(v*100)/100)};
  $("#resetBtn").onclick=()=>{delete state.checked[ck];store("rb.checked",state.checked);renderCard()};
  {const d=el.querySelector(".nutri");if(d)d.ontoggle=()=>{state.nutriOpen=d.open}}
  $("#copyBtn").onclick=()=>copyText(recipeText(R,k),"Recipe copied");
  $("#linkBtn").onclick=()=>copyText(location.origin+location.pathname+"#"+r.id,"Link copied");
  if(SB)wireFriendForm(r);
}
function wireFriendForm(r){
  let pick=0,file=null;const btns=[...document.querySelectorAll("[data-fs]")];
  const fin=$("#ffPhoto"),prev=$("#ffPrev");
  $("#ffPhotoBtn").onclick=()=>fin.click();
  fin.onchange=()=>{file=fin.files[0]||null;if(prev.src)URL.revokeObjectURL(prev.src);if(file){prev.src=URL.createObjectURL(file);prev.hidden=false;$("#ffPhotoBtn").textContent="Change photo"}else{prev.hidden=true}};
  const paint=()=>btns.forEach(b=>b.classList.toggle("on",+b.dataset.fs<=pick));
  btns.forEach(b=>b.onclick=()=>{pick=pick===+b.dataset.fs?0:+b.dataset.fs;paint()});
  $("#ff").onsubmit=async e=>{
    e.preventDefault();
    const name=$("#ffName").value.trim(),note=$("#ffNote").value.trim(),msg=$("#ffMsg");
    if(!name){msg.textContent="Add your name first.";return}
    if(!pick&&!note&&!file){msg.textContent="Pick some stars, write a note or add a photo.";return}
    msg.textContent="Posting…";store("rb.name",name);
    try{
      let photo_path=null;
      if(file){msg.textContent="Uploading photo…";try{photo_path=await uploadFriendPhoto(r.id,file)}catch(err){msg.textContent=/decode|encode/.test(err.message)?"That photo couldn't be read. Try a JPEG or PNG.":/too big/.test(err.message)?"That photo is too large.":"The photo didn't upload. Try again.";console.warn(err);return}msg.textContent="Posting…"}
      const row={recipe_id:r.id,name,rating:pick||null,note:note||null,photo_path};
      await sb("notes",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(row)});
      $("#ff").reset();pick=0;paint();file=null;prev.hidden=true;$("#ffPhotoBtn").textContent="Add a photo";
      msg.textContent="Thanks! It'll show up here once Adam approves it.";
    }catch(err){msg.textContent="Couldn't post that. Check your connection and try again."}
  };
}
function nutritionBlock(r){
  const n=r.nutrition;if(!n||!n.per_serving)return"";
  const p=n.per_serving,f=(v,u)=>v==null?"":`${v}${u}`;
  const row=(label,val,sub)=>val===""?"":`<div class="nrow${sub?" sub":""}"><span>${label}</span><b>${val}</b></div>`;
  return `<section><details class="nutri"${state.nutriOpen?" open":""}><summary><span class="sec-h" style="margin:0">Nutrition facts</span><span class="muted">${p.calories!=null?p.calories+" cal per serving":""}</span></summary>
    <div class="nlabel">
      <div class="nserv">Serving: ${esc(n.serving||"")}${n.servings?` · ${n.servings} servings per batch`:""}</div>
      <div class="ncal"><span>Calories</span><b>${p.calories??""}</b></div>
      ${row("Total fat",f(p.fat_g,"g"))}${row("Saturated fat",f(p.sat_fat_g,"g"),1)}${row("Cholesterol",f(p.cholesterol_mg,"mg"))}${row("Sodium",f(p.sodium_mg,"mg"))}
      ${row("Total carbohydrate",f(p.carbs_g,"g"))}${row("Dietary fiber",f(p.fiber_g,"g"),1)}${row("Total sugars",f(p.sugar_g,"g"),1)}${row("Protein",f(p.protein_g,"g"))}
      <p class="nnote">Estimated from USDA values for the ingredients as written, per serving at 1× batch.${n.assumptions?" "+esc(n.assumptions):""}</p>
    </div></details></section>`;
}
function recipeText(r,k=1){
  return [r.title+(k!==1?` (× ${frac(k)})`:""),r.yield?`Yield: ${r.yield}${k!==1?` × ${frac(k)}`:""}`:"","",...(r.groups||[]).flatMap(g=>[g.name?`${g.name}:`:"Ingredients:",...(g.ingredients||[]).map(i=>"- "+unlink(scaleLine(i,k))),""]),"Method:",...(r.steps||[]).map(s=>"- "+unlink(s)),r.notes?`\nNotes: ${unlink(r.notes)}`:""].filter((l,i,a)=>!(l===""&&a[i-1]==="")).join("\n").trim();
}
async function copyText(t,msg){try{await navigator.clipboard.writeText(t);toast(msg)}catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(msg)}catch(_){toast("Select and copy")}setTimeout(()=>ta.remove(),3000)}}

/* ---------- friends' recipes ---------- */
function srcList(){return [...(state.src==="friends"?state.fr:state.recipes).values()]}
function getR(id){return id?state.recipes.get(id)||state.fr.get(id):undefined}
function setSrc(src){if(src===state.src)return;state.src=src;state.cat="";state.openId=null;$("#app").classList.remove("show-card");try{history.replaceState(null,"","#box")}catch(e){}saveView();renderFilters();renderList();renderCard()}
const cleanLine=l=>l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/,"").trim();
function toGroups(text){const gs=[{name:"",ingredients:[]}];for(const raw of String(text||"").split(/\r?\n/)){const l=cleanLine(raw);if(!l)continue;if(/:$/.test(l)&&l.length<60){gs.push({name:l.slice(0,-1).trim(),ingredients:[]});continue}gs.at(-1).ingredients.push(l)}return gs.filter(g=>g.ingredients.length)}
function toSteps(text){return String(text||"").split(/\r?\n/).map(cleanLine).filter(Boolean)}
function toRecipe(x){return {id:"f-"+x.id,sid:x.id,friend:true,by:x.name,title:x.title,category:CATS.includes(x.category)?x.category:"Mains",yield:x.yield||"",developed:(x.created_at||"").slice(0,10),groups:toGroups(x.ingredients),steps:toSteps(x.steps),notes:x.notes||"",friendPhoto:x.photo_path||null}}
async function loadSubmissions(){
  if(!SB){state.frLoaded=true;return}
  try{const rows=await sb("recipe_submissions?select=id,created_at,name,title,category,yield,ingredients,steps,notes,photo_path&status=eq.approved&order=created_at.desc&limit=1000");
    state.fr=new Map(rows.map(x=>{const r=toRecipe(x);return [r.id,r]}))}
  catch(e){console.warn("friends' recipes unavailable",e)}
  state.frLoaded=true;renderFilters();renderList();renderCard();
  const h=location.hash.slice(1);if(h.startsWith("f-")&&state.fr.has(h)&&h!==state.openId)openRecipe(h);
  if(!$("#home").hidden)renderHome();
}
function renderHomeFriends(){
  const sec=$("#frSec");if(!sec)return;sec.hidden=!SB;
  const rs=[...state.fr.values()].slice(0,6);
  $("#frRow").innerHTML=rs.length?rs.map(r=>`<a class="mini" href="#${esc(r.id)}"><span class="mc">${esc(r.category)}</span><span class="mt">${esc(r.title)}</span><span class="mm">from ${esc(r.by)}</span></a>`).join(""):`<p class="muted">Nothing here yet. Got a recipe people ask you for? Share it.</p>`;
  $("#frAll").hidden=!rs.length;
}
function catOptions(sel){return CATS.map(c=>`<option${c===sel?" selected":""}>${esc(c)}</option>`).join("")}
function renderShare(){
  const f=$("#shareForm");if(f.dataset.wired){if(!$("#shareDone").hidden)$("#shareAgain").click();return}f.dataset.wired=1;
  $("#sCat").innerHTML=catOptions("Mains");$("#sName").value=load("rb.name","");
  let file=null;const fin=$("#sPhoto"),prev=$("#sPrev");
  $("#sPhotoBtn").onclick=()=>fin.click();
  fin.onchange=()=>{file=fin.files[0]||null;if(prev.src)URL.revokeObjectURL(prev.src);if(file){prev.src=URL.createObjectURL(file);prev.hidden=false;$("#sPhotoBtn").textContent="Change photo"}else prev.hidden=true};
  $("#shareAgain").onclick=()=>{f.reset();$("#sName").value=load("rb.name","");file=null;prev.hidden=true;$("#sPhotoBtn").textContent="Add a photo";$("#sMsg").textContent="";f.hidden=false;$("#shareDone").hidden=true;window.scrollTo(0,0)};
  f.onsubmit=async e=>{
    e.preventDefault();const msg=$("#sMsg");if(!SB){msg.textContent="Sharing isn't set up yet.";return}
    const v=id=>$(id).value.trim();
    const row={name:v("#sName"),title:v("#sTitle"),category:$("#sCat").value,yield:v("#sYield")||null,ingredients:v("#sIng"),steps:v("#sSteps"),notes:v("#sNotes")||null,photo_path:null};
    if(!row.name||!row.title||!row.ingredients||!row.steps){msg.textContent="Fill in your name, the recipe name, ingredients and steps.";return}
    store("rb.name",row.name);f.querySelector("[type=submit]").disabled=true;
    try{
      if(file){msg.textContent="Uploading photo…";try{row.photo_path=await uploadFriendPhoto("submissions",file)}catch(err){console.warn(err);msg.textContent="The photo didn't upload, so it was left off. Sending the recipe…"}}
      msg.textContent="Sending…";
      await sb("recipe_submissions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(row)});
      f.hidden=true;$("#shareDone").hidden=false;window.scrollTo(0,0);
    }catch(err){console.warn(err);msg.textContent="Couldn't send that. Check your connection and try again."}
    finally{f.querySelector("[type=submit]").disabled=false}
  };
}
/* admin panel lives in admin.js and only loads on #admin */
function loadAdmin(){
  if(window.RBAdmin)return window.RBAdmin.render();
  const sc=document.createElement("script");sc.src="admin.js?v="+(document.querySelector('script[src^="app.js"]').src.split("v=")[1]||"");
  sc.onload=()=>window.RBAdmin.render();sc.onerror=()=>{$("#admin").innerHTML=`<p class="muted">Couldn't load the admin panel. Reload the page.</p>`};
  document.body.appendChild(sc);
}

/* ---------- boot ---------- */
$("#q").value=state.q||"";$("#sort").value=["best","az","new"].includes(state.sort)?state.sort:"best";state.sort=$("#sort").value;
if(!["all","rated","photos"].includes(state.show))state.show="all";
$("#q").oninput=e=>{state.q=e.target.value;saveView();renderList();if(state.panel)renderFilters()};
$("#sort").onchange=e=>{state.sort=e.target.value;saveView();renderList()};
function showView(v){const home=v==="home";$("#home").hidden=!home;$("#app").hidden=v!=="box";$("#share").hidden=v!=="share";$("#admin").hidden=v!=="admin";
  document.title={home:"Ark's Vibes & Vittles",share:"Share a recipe · Ark's Vibes & Vittles",admin:"Recipe queue · Ark's Vibes & Vittles"}[v]||"Recipes · Ark's Vibes & Vittles";
  if(home)renderHome();if(v==="share")renderShare();if(v==="admin")loadAdmin();if(v!=="box")window.scrollTo(0,0)}
function route(){
  const h=location.hash.slice(1);
  if(!h){state.openId=null;showView("home");return}
  if(h==="share"){showView(h);return}
  if(h==="admin"||h.startsWith("admin/")){showView("admin");return}
  if(h==="friends"){state.src="friends";state.cat="";saveView();renderFilters();state.openId=null;history.replaceState(null,"","#box");showView("box");$("#app").classList.remove("show-card");renderList();renderCard();return}
  showView("box");
  if(h==="box"){state.openId=null;$("#app").classList.remove("show-card");renderList();renderCard();return}
  if(!getR(h)&&state.aliases&&state.aliases.has(h)){location.replace("#"+state.aliases.get(h));return}
  if(getR(h)&&h!==state.openId)openRecipe(h);
}
window.addEventListener("hashchange",route);
function goBox(patch){Object.assign(state,{src:"ark",cat:"",traits:[],diets:[],show:"all",q:""},patch||{});$("#q").value=state.q;saveView();renderFilters();location.hash="box";if(location.hash==="#box")route()}
const PICKS=[["traits","camping","Camping-friendly"],["traits","quick","Quick"],["traits","make-ahead","Make-ahead"],["traits","crowd","Feeds a crowd"],["traits","slow-cooker","Slow cooker"],["diets","vegetarian","Vegetarian"],["diets","gluten-free","Gluten-free"],["traits","freezer","Freezer-friendly"]];
function renderHome(){
  if(!state.loaded)return;
  const all=[...state.recipes.values()];
  $("#browseAll").textContent=`Browse all ${all.length} recipes`;
  $("#typeGrid").innerHTML=CATS.map(c=>{const rs=all.filter(r=>r.category===c);if(!rs.length)return"";
    const ph=rs.map(r=>allPhotos(r)[0]).find(Boolean);
    return `<button type="button" class="type-tile" data-cat="${esc(c)}">${ph?`<img src="${esc(ph.src)}" alt="" loading="lazy">`:""}<span class="tt">${esc(c)}</span><span class="tn">${rs.length} recipe${rs.length>1?"s":""}</span><span class="ts">${esc(rs.slice(0,3).map(r=>r.title).join(" · "))}</span></button>`}).join("");
  $("#picks").innerHTML=PICKS.map(([g,k,l])=>{const n=all.filter(r=>(r[g==="traits"?"traits":"diet"]||[]).includes(k)).length;return n?`<button type="button" class="pick" data-g="${g}" data-k="${k}">${esc(l)}<span>${n}</span></button>`:""}).join("");
  const newest=[...all].sort((a,b)=>(b.developed||"").localeCompare(a.developed||"")).slice(0,6);
  $("#newest").innerHTML=newest.map(r=>`<a class="mini" href="#${esc(r.id)}"><span class="mc">${esc(r.category)}</span><span class="mt">${esc(r.title)}</span><span class="mm">${esc(r.yield||"")}</span></a>`).join("");
  renderHomeFriends();
  const notes=[...state.friends.values()].flat().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6);
  $("#friendSec").hidden=!notes.length;
  $("#feed").innerHTML=notes.map(n=>{const r=getR(n.recipe_id);if(!r)return"";return `<a class="fnote" href="#${esc(r.id)}">${n.photo_path?`<img src="${esc(photoUrl(n.photo_path))}" alt="" loading="lazy">`:""}<span class="fn">${esc(n.name)} on <b>${esc(r.title)}</b></span>${n.rating?`<span class="st">${stars(n.rating)}</span>`:""}${n.note?`<span class="fx">${esc(n.note.length>140?n.note.slice(0,140)+"…":n.note)}</span>`:""}</a>`}).join("");
  document.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>goBox({cat:b.dataset.cat}));
  document.querySelectorAll(".pick").forEach(b=>b.onclick=()=>goBox({[b.dataset.g]:[b.dataset.k]}));
}
$("#homeSearch").onsubmit=e=>{e.preventDefault();goBox({q:$("#hq").value.trim()})};
/* Recipes come live from Supabase; data/recipes.json is a saved copy used only if Supabase can't be reached. */
async function loadRecipes(){
  if(SB){try{
    const [rows,aliases]=await Promise.all([sb("recipes_public?select=*&order=title"),sb("recipe_aliases?select=alias,id")]);
    state.aliases=new Map(aliases.map(a=>[a.alias,a.id]));state.live=true;return rows;
  }catch(e){console.warn("live recipes unavailable, using the saved copy",e)}}
  const d=await fetch("data/recipes.json",{cache:"no-cache"}).then(r=>r.json());
  state.aliases=new Map(Object.entries(d.aliases||{}));return d.recipes;
}
function setRecipes(rows){
  state.recipes=new Map(rows.map(r=>[r.id,{...r,category:CATS.includes(r.category)?r.category:"Mains"}]));
  state.loaded=true;
}
loadRecipes().then(rows=>{
  setRecipes(rows);
  state.traits=state.traits.filter(t=>TRAIT_LABEL[t]);renderCats();renderTraits();renderList();renderCard();route();
  if(state.friends.size)regroupFriends();
}).catch(()=>{$("#list").innerHTML=`<div class="empty">Couldn't load the recipes. Reload the page.</div>`});
loadFriends();loadSubmissions();

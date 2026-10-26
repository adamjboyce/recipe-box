"use strict";
const TRAITS=[["camping","Camping-friendly"],["make-ahead","Make-ahead"],["freezer","Freezer-friendly"],["shelf-stable","Shelf stable"],["slow-cooker","Slow cooker"],["long-cook","Long cook"],["crowd","Feeds a crowd"],["quick","Quick"]];
const TRAIT_LABEL=Object.fromEntries(TRAITS);
const CATS=["Mains","Soups & Stews","Sides & Breads","Baking & Dough","Breakfast","Sauces & Condiments","Spice Blends","Desserts","Drinks"];
const CFG=window.RB_CONFIG||{};
const SB=CFG.supabaseUrl&&CFG.supabaseKey?{url:CFG.supabaseUrl.replace(/\/$/,""),key:CFG.supabaseKey}:null;
const state={recipes:new Map(),loaded:false,q:"",cat:"",show:"all",sort:"best",openId:null,checked:{},scale:{},photoSel:{},friends:new Map(),friendsLoaded:false};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2400)}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
Object.assign(state,load("rb.view",{}));
if(!Array.isArray(state.traits))state.traits=[];
state.checked=load("rb.checked",{});state.scale=load("rb.scale",{});
function saveView(){store("rb.view",{q:state.q,cat:state.cat,show:state.show,sort:state.sort,traits:state.traits})}
function renderTraits(){
  const el=$("#traits");
  const present=new Set([...state.recipes.values()].flatMap(r=>r.traits||[]));
  el.innerHTML='<span class="lbl">Good for</span>'+TRAITS.filter(([k])=>present.has(k)).map(([k,l])=>`<button type="button" class="chip t" data-trait="${k}" aria-pressed="${state.traits.includes(k)}">${esc(l)}</button>`).join("");
  el.querySelectorAll("[data-trait]").forEach(b=>b.onclick=()=>{const k=b.dataset.trait;state.traits=state.traits.includes(k)?state.traits.filter(x=>x!==k):[...state.traits,k];saveView();renderTraits();renderList()});
}

/* ---------- friends (Supabase REST) ---------- */
async function sb(path,opts={}){
  const r=await fetch(`${SB.url}/rest/v1/${path}`,{...opts,headers:{apikey:SB.key,...(SB.key.startsWith("sb_")?{}:{Authorization:`Bearer ${SB.key}`}),"Content-Type":"application/json",...(opts.headers||{})}});
  if(!r.ok)throw new Error(r.status+" "+(await r.text()).slice(0,200));
  return r.status===204?null:r.json();
}
async function loadFriends(){
  if(!SB)return;
  try{
    const rows=await sb("notes?select=id,recipe_id,name,rating,note,created_at&order=created_at.desc&limit=5000");
    state.friends=new Map();for(const n of rows){if(!state.friends.has(n.recipe_id))state.friends.set(n.recipe_id,[]);state.friends.get(n.recipe_id).push(n)}
  }catch(e){console.warn("friend notes unavailable",e)}
  state.friendsLoaded=true;renderList();renderCard();
}
function friendAvg(id){const rs=(state.friends.get(id)||[]).map(n=>n.rating).filter(Boolean);return rs.length?{avg:rs.reduce((a,b)=>a+b,0)/rs.length,n:rs.length}:null}

/* ---------- index ---------- */
function renderCats(){
  const el=$("#cats");el.innerHTML="";
  const present=new Set([...state.recipes.values()].map(r=>r.category));
  [["","All"],...CATS.filter(c=>present.has(c)).map(c=>[c,c])].forEach(([v,l])=>{
    const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=l;
    b.setAttribute("aria-pressed",String(state.cat===v));
    b.onclick=()=>{state.cat=v;saveView();renderCats();renderList()};el.appendChild(b)});
}
function haystack(r){return [r.title,r.cuisine,r.category,(r.tags||[]).join(" "),...(r.groups||[]).flatMap(g=>g.ingredients||[])].join(" ").toLowerCase()}
function score(r){const f=friendAvg(r.id);return r.rating||(f?f.avg:0)}
function filtered(){
  const q=state.q.trim().toLowerCase();
  const rs=[...state.recipes.values()].filter(r=>{
    if(state.cat&&r.category!==state.cat)return false;
    if(state.show==="keepers"&&!r.keeper)return false;
    if(state.show==="rated"&&!(score(r)>=4))return false;
    if(state.show==="photos"&&!(r.photos||[]).length)return false;
    if(state.traits.length&&!state.traits.every(t=>(r.traits||[]).includes(t)))return false;
    if(q&&!q.split(/\s+/).every(w=>haystack(r).includes(w)))return false;
    return true});
  const by={
    best:(a,b)=>(b.keeper?1:0)-(a.keeper?1:0)||score(b)-score(a)||a.title.localeCompare(b.title),
    az:(a,b)=>a.title.localeCompare(b.title),
    new:(a,b)=>(b.developed||"").localeCompare(a.developed||"")||a.title.localeCompare(b.title)}[state.sort]||((a,b)=>a.title.localeCompare(b.title));
  return rs.sort(by);
}
function stars(n){n=Math.round(n||0);return n?"★".repeat(n)+"☆".repeat(5-n):""}
function renderList(){
  const all=[...state.recipes.values()];
  $("#count").textContent=state.loaded?`${all.length} recipes`:"";
  const el=$("#list");if(!state.loaded)return;
  const rs=filtered();
  if(!rs.length){el.innerHTML=`<div class="empty">Nothing matches. Clear the search or pick another category.</div>`;return}
  const grouped=state.sort==="best"&&!state.cat;
  const order=grouped?[...rs].sort((a,b)=>CATS.indexOf(a.category)-CATS.indexOf(b.category)):rs;
  let html="",cur=null;
  for(const r of order){
    if(grouped&&r.category!==cur){cur=r.category;html+=`<div class="group-label">${esc(cur)}</div>`}
    const f=(state.friends.get(r.id)||[]).length;
    const meta=[r.cuisine,r.yield,f?`${f} note${f>1?"s":""}`:""].filter(Boolean).join(" · ");
    const ph=(r.photos||[])[0];
    html+=`<button class="item${ph?" has-photo":""}" type="button" data-id="${esc(r.id)}" aria-current="${r.id===state.openId}">
      ${ph?`<img class="thumb" src="photos/${esc(ph)}" alt="" loading="lazy">`:""}<span class="t">${esc(r.title)}</span><span class="m">${esc(meta)}</span>
      <span class="s">${r.keeper?'<span class="keeper-tag">Keeper</span>':""}<span class="mini-stars">${stars(r.rating)}</span></span></button>`;
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
function getScale(id){const v=state.scale[id];return v>0?v:1}
function setScale(id,k){if(k===1)delete state.scale[id];else state.scale[id]=k;store("rb.scale",state.scale);renderCard()}
function fmtDate(d){if(!d)return"";const dt=new Date(d.length===10?d+"T12:00:00":d);return isNaN(dt)?"":dt.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}

/* ---------- card ---------- */
function openRecipe(id){
  state.openId=id;
  try{history.replaceState(null,"",id?"#"+id:location.pathname)}catch(e){}
  $("#app").classList.toggle("show-card",!!id);
  renderList();renderCard();$("#pane").scrollTop=0;window.scrollTo(0,0);
}
function photoBlock(r){
  const ps=r.photos||[];if(!ps.length)return"";
  const sel=Math.min(state.photoSel[r.id]||0,ps.length-1);
  return `<div class="photos"><img class="hero" src="photos/${esc(ps[sel])}" alt="${esc(r.title)}">
    ${ps.length>1?`<div class="strip">${ps.map((p,i)=>`<button type="button" data-ph="${i}" aria-current="${i===sel}" aria-label="Photo ${i+1}"><img src="photos/${esc(p)}" alt="" loading="lazy"></button>`).join("")}</div>`:""}</div>`;
}
function renderCard(){
  const el=$("#card");const r=state.recipes.get(state.openId);
  if(!r){el.innerHTML=`<div class="empty">${state.loaded?"Pick a recipe from the box.":"Opening the box…"}</div>`;return}
  const chk=state.checked[r.id]||{};const k=getScale(r.id);const presets=[.5,1,1.5,2,3];
  const fa=friendAvg(r.id);const notes=state.friends.get(r.id)||[];
  const me=load("rb.name","");
  el.innerHTML=`
  <div>
    <button class="btn back" type="button" id="backBtn">← Box</button>
    <div class="eyebrow"><span>${esc(r.category)}</span>${r.cuisine?`<span>${esc(r.cuisine)}</span>`:""}</div>
    <h2>${esc(r.title)}</h2>
    <div class="meta">${r.yield?`<span>Yield <b>${esc(r.yield)}</b>${k!==1?` <span class="scaled">× ${esc(frac(k))}</span>`:""}</span>`:""}</div>
    <div class="tags">${(r.traits||[]).filter(t=>TRAIT_LABEL[t]).map(t=>`<span class="trait">${esc(TRAIT_LABEL[t])}</span>`).join("")}${(r.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
  </div>
  ${photoBlock(r)}
  <div class="verdict">
    <div class="pair"><span class="who">Adam</span><span class="big">${r.rating?stars(r.rating):"<span class='sub'>Not rated yet</span>"}</span></div>
    ${r.keeper?'<span class="keeper-tag" style="font-size:12px;padding:2px 8px">Keeper</span>':""}
    ${SB?`<div class="pair"><span class="who">Friends</span><span class="big friends">${fa?stars(fa.avg):"<span class='sub'>No ratings yet</span>"}</span>${fa?`<span class="sub">${fa.avg.toFixed(1)} from ${fa.n}</span>`:""}</div>`:""}
  </div>
  <div class="body">
    <section>
      <h3 class="sec-h">Ingredients <small>tap to check off</small></h3>
      <div class="scaler" role="group" aria-label="Batch size">
        <span class="lbl">Batch</span>
        ${presets.map(p=>`<button type="button" class="sc" data-scale="${p}" aria-pressed="${k===p}">${p===1?"1×":frac(p)+"×"}</button>`).join("")}
        <input id="scaleIn" type="number" min="0.1" step="0.05" inputmode="decimal" aria-label="Custom multiplier" value="${presets.includes(k)?"":k}" placeholder="×">
      </div>
      ${(r.groups||[]).map((g,gi)=>`<div class="ing-group">${g.name?`<h4>${esc(g.name)}</h4>`:""}<ul class="ing">${(g.ingredients||[]).map((ing,ii)=>{const [q,rest]=splitQty(scaleLine(ing,k));const key=`i${gi}-${ii}`;return `<li data-k="${key}" class="${chk[key]?"done":""}"><span class="q">${esc(q)}</span><span>${esc(rest)}</span></li>`}).join("")}</ul></div>`).join("")}
    </section>
    <section>
      <h3 class="sec-h">Method</h3>
      <ol class="steps">${(r.steps||[]).map((s,i)=>`<li data-k="s${i}" class="${chk["s"+i]?"done":""}"><span>${esc(s)}</span></li>`).join("")}</ol>
    </section>
  </div>
  ${r.notes?`<section><h3 class="sec-h">Notes</h3><div class="notes">${esc(r.notes)}</div></section>`:""}
  ${SB?`<section class="friends-sec">
    <h3 class="sec-h">Made it? <small>leave a rating or a note for Adam and everyone else</small></h3>
    <form class="friend-form" id="ff">
      <div class="row"><input id="ffName" maxlength="40" placeholder="Your name" aria-label="Your name" value="${esc(me)}" required>
        <div class="stars" role="group" aria-label="Your rating">${[1,2,3,4,5].map(i=>`<button class="star" type="button" data-fs="${i}" aria-label="${i} star${i>1?"s":""}">★</button>`).join("")}</div></div>
      <textarea id="ffNote" maxlength="1000" placeholder="How did it go? What would you change?" aria-label="Note"></textarea>
      <div class="row"><button class="btn primary" type="submit">Post</button><span class="muted" id="ffMsg"></span></div>
    </form>
    ${notes.length?`<ul class="friend-list">${notes.map(n=>`<li><div class="h"><span class="nm">${esc(n.name)}</span>${n.rating?`<span class="st">${stars(n.rating)}</span>`:""}<span class="dt">${esc(fmtDate(n.created_at))}</span></div>${n.note?`<div class="tx">${esc(n.note)}</div>`:""}</li>`).join("")}</ul>`:state.friendsLoaded?`<p class="muted">No notes yet. Be the first.</p>`:""}
  </section>`:""}
  <div class="foot"><span class="spacer"></span>
    <button class="btn" type="button" id="resetBtn">Clear checks</button>
    <button class="btn" type="button" id="copyBtn">Copy recipe</button>
    <button class="btn" type="button" id="linkBtn">Copy link</button>
  </div>`;
  $("#backBtn").onclick=()=>openRecipe(null);
  el.querySelectorAll("[data-ph]").forEach(b=>b.onclick=()=>{state.photoSel[r.id]=+b.dataset.ph;renderCard()});
  el.querySelectorAll(".ing li,.steps li").forEach(li=>li.onclick=()=>{const c=state.checked[r.id]=state.checked[r.id]||{};c[li.dataset.k]=!c[li.dataset.k];li.classList.toggle("done",c[li.dataset.k]);store("rb.checked",state.checked)});
  el.querySelectorAll("[data-scale]").forEach(b=>b.onclick=()=>setScale(r.id,+b.dataset.scale));
  $("#scaleIn").onchange=e=>{const v=parseFloat(e.target.value);if(v>0&&v<=50)setScale(r.id,Math.round(v*100)/100)};
  $("#resetBtn").onclick=()=>{delete state.checked[r.id];store("rb.checked",state.checked);renderCard()};
  $("#copyBtn").onclick=()=>copyText(recipeText(r,k),"Recipe copied");
  $("#linkBtn").onclick=()=>copyText(location.origin+location.pathname+"#"+r.id,"Link copied");
  if(SB)wireFriendForm(r);
}
function wireFriendForm(r){
  let pick=0;const btns=[...document.querySelectorAll("[data-fs]")];
  const paint=()=>btns.forEach(b=>b.classList.toggle("on",+b.dataset.fs<=pick));
  btns.forEach(b=>b.onclick=()=>{pick=pick===+b.dataset.fs?0:+b.dataset.fs;paint()});
  $("#ff").onsubmit=async e=>{
    e.preventDefault();
    const name=$("#ffName").value.trim(),note=$("#ffNote").value.trim(),msg=$("#ffMsg");
    if(!name){msg.textContent="Add your name first.";return}
    if(!pick&&!note){msg.textContent="Pick some stars or write a note.";return}
    msg.textContent="Posting…";store("rb.name",name);
    try{
      const row={recipe_id:r.id,name,rating:pick||null,note:note||null};
      const out=await sb("notes",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
      const saved=(out&&out[0])||{...row,created_at:new Date().toISOString()};
      if(!state.friends.has(r.id))state.friends.set(r.id,[]);state.friends.get(r.id).unshift(saved);
      toast("Posted. Thanks!");renderList();renderCard();
    }catch(err){msg.textContent="Couldn't post that. Check your connection and try again."}
  };
}
function recipeText(r,k=1){
  return [r.title+(k!==1?` (× ${frac(k)})`:""),r.yield?`Yield: ${r.yield}${k!==1?` × ${frac(k)}`:""}`:"","",...(r.groups||[]).flatMap(g=>[g.name?`${g.name}:`:"Ingredients:",...(g.ingredients||[]).map(i=>"- "+scaleLine(i,k)),""]),"Method:",...(r.steps||[]).map(s=>"- "+s),r.notes?`\nNotes: ${r.notes}`:""].filter((l,i,a)=>!(l===""&&a[i-1]==="")).join("\n").trim();
}
async function copyText(t,msg){try{await navigator.clipboard.writeText(t);toast(msg)}catch(e){const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(msg)}catch(_){toast("Select and copy")}setTimeout(()=>ta.remove(),3000)}}

/* ---------- boot ---------- */
$("#q").value=state.q||"";$("#show").value=state.show;$("#sort").value=["best","az","new"].includes(state.sort)?state.sort:"best";state.sort=$("#sort").value;
if(!["all","keepers","rated","photos"].includes(state.show)){state.show="all";$("#show").value="all"}
$("#q").oninput=e=>{state.q=e.target.value;saveView();renderList()};
$("#show").onchange=e=>{state.show=e.target.value;saveView();renderList()};
$("#sort").onchange=e=>{state.sort=e.target.value;saveView();renderList()};
window.addEventListener("hashchange",()=>{const id=location.hash.slice(1);if(id!==state.openId&&state.recipes.has(id))openRecipe(id)});
fetch("data/recipes.json",{cache:"no-cache"}).then(r=>r.json()).then(d=>{
  state.recipes=new Map(d.recipes.map(r=>[r.id,{...r,category:CATS.includes(r.category)?r.category:"Mains"}]));
  state.loaded=true;
  const h=location.hash.slice(1);if(h&&state.recipes.has(h)){state.openId=h;$("#app").classList.add("show-card")}
  state.traits=state.traits.filter(t=>TRAIT_LABEL[t]);renderCats();renderTraits();renderList();renderCard();
}).catch(()=>{$("#list").innerHTML=`<div class="empty">Couldn't load the recipes. Reload the page.</div>`});
loadFriends();

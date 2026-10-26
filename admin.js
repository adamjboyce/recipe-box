"use strict";
/* Admin panel for Ark's Vibes & Vittles. Loaded only on #admin.
   Uses globals from app.js: SB, esc, CATS, TRAITS, DIETS, toGroups, toSteps, shrink, photoUrl, stars, fmtDate,
   toast, load, store, loadRecipes, setRecipes, renderList, renderHome, loadSubmissions, loadFriends. */
(function(){
const A={view:"recipes",list:[],q:"",editing:null,session:load("rb.session",null)};
const el=()=>document.getElementById("admin");
const today=()=>new Date().toISOString().slice(0,10);
const slug=t=>String(t||"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"recipe";

/* ---------- auth (Supabase Auth, email + password) ---------- */
async function authCall(grant,body){
  const r=await fetch(`${SB.url}/auth/v1/token?grant_type=${grant}`,{method:"POST",headers:{apikey:SB.key,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error_description||j.msg||j.message||("sign-in failed "+r.status));
  A.session={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600),email:(j.user&&j.user.email)||body.email||(A.session&&A.session.email)};
  store("rb.session",A.session);return A.session;
}
async function jwt(){
  if(!A.session)throw new Error("signed out");
  if(A.session.expires_at-60<Date.now()/1000){try{await authCall("refresh_token",{refresh_token:A.session.refresh_token})}catch(e){signOut();throw e}}
  return A.session.access_token;
}
function signOut(){A.session=null;try{localStorage.removeItem("rb.session")}catch(e){}}
async function call(fn,args={}){
  const t=await jwt();
  const r=await fetch(`${SB.url}/rest/v1/rpc/${fn}`,{method:"POST",headers:{apikey:SB.key,Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify(args)});
  const txt=await r.text();
  if(!r.ok){let m=txt;try{m=JSON.parse(txt).message||txt}catch(e){}throw new Error(m.slice(0,200))}
  return txt?JSON.parse(txt):null;
}
async function upload(path,blob){
  const t=await jwt();
  const r=await fetch(`${SB.url}/storage/v1/object/photos/${path}`,{method:"POST",headers:{apikey:SB.key,Authorization:`Bearer ${t}`,"Content-Type":"image/jpeg","x-upsert":"false"},body:blob});
  if(!r.ok)throw new Error("upload failed "+r.status);
}
async function removeFile(path){
  const t=await jwt();
  await fetch(`${SB.url}/storage/v1/object/photos/${path}`,{method:"DELETE",headers:{apikey:SB.key,Authorization:`Bearer ${t}`}}).catch(()=>{});
}
async function refreshSite(){try{setRecipes(await loadRecipes());renderList();if(!document.getElementById("home").hidden)renderHome()}catch(e){}}

/* ---------- shell ---------- */
async function render(){
  const root=el();
  if(!SB){root.innerHTML=`<p>Supabase isn't configured.</p>`;return}
  if(!A.session)return renderLogin();
  let ok=false;try{ok=await call("rb_am_admin")}catch(e){signOut();return renderLogin(e.message)}
  if(!ok){root.innerHTML=shell(`<p class="muted">Signed in as ${esc(A.session.email||"")}, but this account isn't an admin.</p>`);wireShell();return}
  const h=location.hash.replace(/^#admin\/?/,"");
  if(h.startsWith("r/"))return openEditor(decodeURIComponent(h.slice(2)));
  if(h==="new")return openEditor(null);
  if(h==="queue")A.view="queue";else if(h==="keys")A.view="keys";else A.view="recipes";
  if(A.view==="queue")return renderQueue();
  if(A.view==="keys")return renderKeys();
  return renderRecipes();
}
function shell(body){
  const tab=(k,l)=>`<a class="atab" href="#admin${k==="recipes"?"":"/"+k}" aria-current="${A.view===k&&!A.editing}">${l}</a>`;
  return `<div class="ahead"><a class="btn back" href="#">← Site</a><h1>Kitchen office</h1><span class="spacer"></span><span class="muted">${esc(A.session&&A.session.email||"")}</span><button class="btn" type="button" id="aSignOut">Sign out</button></div>
    <nav class="atabs">${tab("recipes","Recipes")}${tab("queue","Friends' queue")}${tab("keys","Agent keys")}</nav>${body}`;
}
function wireShell(){const b=document.getElementById("aSignOut");if(b)b.onclick=()=>{signOut();render()}}
function renderLogin(err){
  el().innerHTML=`<a class="btn back" href="#">← Site</a><h1>Kitchen office</h1>
    <form class="share-form alogin" id="aLoginF"><label>Email<input type="email" id="aEmail" autocomplete="username" required></label>
    <label>Password<input type="password" id="aPw" autocomplete="current-password" required></label>
    <div class="row"><button class="btn primary" type="submit">Sign in</button><span class="muted" id="aMsg">${esc(err||"")}</span></div></form>`;
  document.getElementById("aLoginF").onsubmit=async e=>{e.preventDefault();const m=document.getElementById("aMsg");m.textContent="Signing in…";
    try{await authCall("password",{email:document.getElementById("aEmail").value.trim(),password:document.getElementById("aPw").value});render()}catch(x){m.textContent=x.message}};
}

/* ---------- recipe list ---------- */
async function renderRecipes(){
  A.editing=null;
  el().innerHTML=shell(`<p class="muted">Loading…</p>`);wireShell();
  try{A.list=await call("rb_list")}catch(e){el().innerHTML=shell(`<p class="muted">${esc(e.message)}</p>`);wireShell();return}
  const draw=()=>{
    const q=A.q.toLowerCase();
    const rows=A.list.filter(r=>!q||(r.title+" "+r.id).toLowerCase().includes(q));
    const drafts=rows.filter(r=>r.draft).length;
    document.getElementById("aList").innerHTML=rows.map(r=>`<a class="arow" href="#admin/r/${encodeURIComponent(r.id)}"><span class="t">${esc(r.title)}</span>
      <span class="m">${r.draft?`<span class="flag">Unfinished</span>`:""}${(r.private&&r.private.flags||[]).length?`<span class="flag">Needs a look</span>`:""}<span class="mini-stars">${stars(r.rating)}</span></span>
      <span class="s">${esc(r.category)} · ${esc(r.id)}</span></a>`).join("")||`<p class="muted">No matches.</p>`;
    document.getElementById("aCount").textContent=`${rows.length} recipes${drafts?`, ${drafts} unfinished`:""}`;
  };
  el().innerHTML=shell(`<div class="row atools"><input class="search" id="aQ" type="search" placeholder="Find a recipe" value="${esc(A.q)}"><a class="btn primary" href="#admin/new">+ New recipe</a><span class="muted" id="aCount"></span></div><div class="alist" id="aList"></div>`);
  wireShell();draw();
  document.getElementById("aQ").oninput=e=>{A.q=e.target.value;draw()};
}

/* ---------- editor ---------- */
const groupsToText=gs=>(gs||[]).map((g,i)=>(g.name?g.name+":\n":"")+(g.ingredients||[]).join("\n")).join("\n");
const stepsToText=ss=>(ss||[]).join("\n");
const NUT=[["calories","Calories",""],["fat_g","Fat","g"],["sat_fat_g","Sat fat","g"],["cholesterol_mg","Cholesterol","mg"],["sodium_mg","Sodium","mg"],["carbs_g","Carbs","g"],["fiber_g","Fiber","g"],["sugar_g","Sugars","g"],["protein_g","Protein","g"]];
async function openEditor(id){
  el().innerHTML=shell(`<p class="muted">Loading…</p>`);wireShell();
  let r;
  if(id){try{r=await call("rb_get",{p_id:id})}catch(e){el().innerHTML=shell(`<p class="muted">${esc(e.message)}</p>`);wireShell();return}
    if(!r){el().innerHTML=shell(`<p class="muted">No recipe called ${esc(id)}.</p>`);wireShell();return}
    if(r.id!==id){location.replace("#admin/r/"+encodeURIComponent(r.id));return}}
  else r={id:"",title:"",category:"Mains",cuisine:"",yield:"",tags:[],traits:[],diet:[],groups:[],steps:[],notes:"",nutrition:null,rating:0,photos:[],credit:null,draft:true,developed:today(),private:{},aliases:[],log:[],_new:true};
  A.editing=r;renderEditor();
}
function renderEditor(){
  const r=A.editing,p=r.private||{},n=r.nutrition||{},ps=n.per_serving||{};
  const chk=(name,list,on)=>list.map(([k,l])=>`<label class="chk"><input type="checkbox" data-${name}="${k}"${(on||[]).includes(k)?" checked":""}> ${esc(l)}</label>`).join("");
  el().innerHTML=shell(`
  <form class="share-form aedit" id="aEdit">
    <div class="ehead"><h2>${r._new?"New recipe":esc(r.title)}</h2>${r._new?"":`<a class="btn" href="#${esc(r.id)}" target="_blank" rel="noopener">${r.draft?"Preview link":"View on site"}</a>`}</div>
    <div class="two"><label>Title<input id="eTitle" value="${esc(r.title)}" maxlength="160" required></label>
      <label>Web name <small>${r._new?"made from the title; change it if you like":"the part after # in the link"}</small>
        <div class="row nowrap"><input id="eId" value="${esc(r.id)}" ${r._new?"":"readonly"} pattern="[a-z0-9]+(-[a-z0-9]+)*">${r._new?"":`<button class="btn" type="button" id="eRename">Rename</button>`}</div></label></div>
    <div class="row toggles">
      <label class="chk big"><input type="checkbox" id="eDraft"${r.draft?" checked":""}> Unfinished <small>(kept off the site)</small></label>
      <span class="stars-edit" id="eStars" role="group" aria-label="Rating">${[1,2,3,4,5].map(i=>`<button type="button" data-st="${i}" class="${i<=r.rating?"on":""}" aria-label="${i} stars">★</button>`).join("")}</span>
    </div>
    <div class="three"><label>Type<select id="eCat">${CATS.map(c=>`<option${c===r.category?" selected":""}>${esc(c)}</option>`).join("")}</select></label>
      <label>Cuisine<input id="eCuisine" value="${esc(r.cuisine||"")}"></label>
      <label>Makes<input id="eYield" value="${esc(r.yield||"")}"></label></div>
    <fieldset><legend>Good for</legend><div class="chks">${chk("trait",TRAITS,r.traits)}</div></fieldset>
    <fieldset><legend>Diet</legend><div class="chks">${chk("diet",DIETS,r.diet)}</div></fieldset>
    <label>Tags <small>comma separated</small><input id="eTags" value="${esc((r.tags||[]).join(", "))}"></label>
    <label>Ingredients <small>one per line. A line ending in a colon starts a section, like "Sauce:". Link a recipe with [label](web-name).</small>
      <textarea id="eIng" rows="14">${esc(groupsToText(r.groups))}</textarea></label>
    <label>Steps <small>one per line</small><textarea id="eSteps" rows="12">${esc(stepsToText(r.steps))}</textarea></label>
    <label>Notes<textarea id="eNotes" rows="3">${esc(r.notes||"")}</textarea></label>
    <details class="eblock"${(r.alt_methods||[]).length?" open":""}><summary>Cooking methods <small>shown as tabs on the card</small></summary>
      <label>Main method <small>what the ingredients and steps above are, e.g. Dutch oven. Leave blank if there's only one way.</small><input id="eMethod" value="${esc(r.method||"")}"></label>
      <div id="eAlts" class="ealts">${(r.alt_methods||[]).map(altBlock).join("")}</div>
      <div class="row"><button class="btn" type="button" id="eAddAlt">+ Add another method</button></div></details>
    ${spicyBlock(r)}
    <details class="eblock"${r.nutrition?"":""}><summary>Nutrition</summary>
      <div class="two"><label>Serving<input id="nServing" value="${esc(n.serving||"")}"></label><label>Servings per batch<input id="nServings" type="number" min="0" step="1" value="${esc(n.servings??"")}"></label></div>
      <div class="ngrid">${NUT.map(([k,l,u])=>`<label>${l}${u?` <small>${u}</small>`:""}<input type="number" step="any" data-nut="${k}" value="${esc(ps[k]??"")}"></label>`).join("")}</div>
      <label>How it was estimated<textarea id="nAssume" rows="2">${esc(n.assumptions||"")}</textarea></label></details>
    <details class="eblock" open><summary>Private <small>never shown on the site</small></summary>
      <div class="two"><label>Made for<input id="pOcc" value="${esc(p.occasion||"")}" placeholder="e.g. Hobbit weekend 2026"></label>
        <label>Developed<input id="eDev" type="date" value="${esc(r.developed||"")}"></label></div>
      <div class="two"><label>Source chat title<input id="pSrcT" value="${esc(p.source_title||"")}"></label><label>Source link<input id="pSrcU" value="${esc(p.source_url||"")}"></label></div>
      <label>Private notes<textarea id="pNotes" rows="3">${esc(p.private_notes||"")}</textarea></label>
      <label>Markers <small>comma separated, e.g. version-uncertain</small><input id="pFlags" value="${esc((p.flags||[]).join(", "))}"></label>
      <label>Credit <small>shown as "From …" for a friend's recipe</small><input id="eCredit" value="${esc(r.credit||"")}"></label></details>
    <details class="eblock" open><summary>Photos</summary>
      <div class="ephotos">${(r.photos||[]).map((ph,i)=>`<figure><img src="${esc(typeof ph==="string"?"photos/"+ph:photoUrl(ph.path))}" alt=""><figcaption>${esc(ph.by||"Adam")}</figcaption>
        <div class="row">${i?`<button class="btn" type="button" data-phup="${i}">◀</button>`:""}<button class="btn danger" type="button" data-phdel="${i}">Remove</button></div></figure>`).join("")}</div>
      ${r._new?`<p class="muted">Save the recipe first, then add photos.</p>`:`<div class="row"><input type="file" id="ePhoto" accept="image/*" multiple hidden><button class="btn" type="button" id="ePhotoBtn">Add photos</button><span class="muted" id="ePhMsg"></span></div>`}</details>
    <div class="esave">
      ${r._new?"":`<label>What changed? <small>logs a change note with the old version attached. Leave blank for typo fixes.</small><input id="eWhy" placeholder="e.g. Less mayo, bigger potato chunks"></label>`}
      <div class="row"><button class="btn primary" type="submit">${r._new?"Create recipe":"Save"}</button><span class="muted" id="eMsg"></span><span class="spacer"></span>${r._new?"":`<button class="btn danger" type="button" id="eDelete">Delete recipe</button>`}</div>
    </div>
  </form>
  ${r._new?"":logBlock(r)}`);
  wireShell();wireEditor();
}
function logBlock(r){
  const entries=[...(r.log||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.created_at||"").localeCompare(a.created_at||""));
  return `<section class="alog"><h2>Cook log</h2>
    <form class="row logadd" id="lAdd"><input type="date" id="lDate" value="${today()}"><input id="lNote" placeholder="How did it go?" required>
      <select id="lRating"><option value="">No rating</option>${[5,4,3,2,1].map(i=>`<option value="${i}">${"★".repeat(i)}</option>`).join("")}</select>
      <label class="chk"><input type="checkbox" id="lChange"> Change note</label><button class="btn primary" type="submit">Add</button></form>
    ${entries.length?`<ul class="loglist">${entries.map(e=>`<li class="${e.kind}"><div class="h"><b>${esc(fmtDate(e.date))}</b> ${e.kind==="change"?`<span class="flag">Change</span>`:""}${e.rating?`<span class="mini-stars">${stars(e.rating)}</span>`:""}<span class="spacer"></span><button class="btn" type="button" data-ldel="${esc(e.id)}">Delete</button></div>
      <div>${esc(e.note)}</div>${e.before?`<details><summary>The recipe before this change</summary><pre>${esc(snapText(e.before))}</pre></details>`:""}</li>`).join("")}</ul>`:`<p class="muted">Nothing logged yet.</p>`}</section>`;
}
function altBlock(a,i){const same=!a.groups||!a.groups.length;
  return `<fieldset class="ameth" data-alt="${i}"><div class="row"><label style="flex:1">Method name<input data-af="name" value="${esc(a.name||"")}" placeholder="e.g. Slow cooker"></label>
    <button class="btn" type="button" data-amain="${i}">Make main</button><button class="btn danger" type="button" data-adel="${i}">Remove</button></div>
    <label class="chk"><input type="checkbox" data-af="same"${same?" checked":""}> Same ingredients as the main method</label>
    <label data-ingwrap${same?" hidden":""}>Ingredients<textarea data-af="groups" rows="8">${esc(same?"":groupsToText(a.groups))}</textarea></label>
    <label>Steps <small>one per line</small><textarea data-af="steps" rows="8">${esc(stepsToText(a.steps))}</textarea></label>
    <div class="two"><label>Makes <small>if different</small><input data-af="yield" value="${esc(a.yield||"")}"></label><label>Notes <small>if different</small><input data-af="notes" value="${esc(a.notes||"")}"></label></div></fieldset>`}
function collectAlts(){const old=A.editing.alt_methods||[];
  return [...document.querySelectorAll("[data-alt]")].map(f=>{const g=k=>f.querySelector(`[data-af="${k}"]`);const same=g("same").checked;
    return {name:g("name").value.trim(),groups:same?null:toGroups(g("groups").value),steps:toSteps(g("steps").value),yield:g("yield").value.trim()||null,notes:g("notes").value.trim()||null,nutrition:(old[+f.dataset.alt]||{}).nutrition||null}})}
function spicyBlock(r){const sp=(r.extras&&r.extras.spicy)||{};const pairs=a=>(a||[]).map(x=>`${x.from} => ${x.to}`).join("\n");
  const names=[...new Set((r.groups||[]).map(g=>g.name||""))];const addG=(sp.add&&sp.add[0]&&sp.add[0].group)||names[0]||"";
  return `<details class="eblock"${r.extras&&r.extras.spicy?" open":""}><summary>Spicy version <small>adds a 🌶 toggle on the card</small></summary>
    <label>Swap ingredients <small>one per line: the exact line from above, then =&gt;, then the spicy line</small><textarea id="hpSwaps" rows="4" placeholder="15 g jalapeño, minced (about 1) => 30 g serranos, minced (about 3)">${esc(pairs(sp.swaps))}</textarea></label>
    <div class="two"><label>Add ingredients <small>one per line</small><textarea id="hpAdd" rows="3">${esc((sp.add||[]).map(x=>x.line).join("\n"))}</textarea></label>
      <label>Add them to<select id="hpAddGroup">${names.map(n=>`<option value="${esc(n)}"${n===addG?" selected":""}>${esc(n||"The ingredient list")}</option>`).join("")}</select></label></div>
    <label>Swap steps <small>the exact step, then =&gt;, then the spicy step</small><textarea id="hpSteps" rows="3">${esc(pairs(sp.steps))}</textarea></label>
    <p class="muted" id="hpWarn"></p></details>`}
function collectSpicy(){
  const pairs=id=>document.getElementById(id).value.split("\n").map(l=>l.split(" => ")).filter(p=>p.length===2&&p[0].trim()&&p[1].trim()).map(([a,b])=>({from:a.trim(),to:b.trim()}));
  const g=document.getElementById("hpAddGroup").value;
  const sp={swaps:pairs("hpSwaps"),add:document.getElementById("hpAdd").value.split("\n").map(l=>l.trim()).filter(Boolean).map(line=>({group:g,line})),steps:pairs("hpSteps")};
  return sp.swaps.length||sp.add.length||sp.steps.length?sp:null;
}
const snapText=b=>[b.title,b.yield?"Makes "+b.yield:"","",groupsToText(b.groups),"",(b.steps||[]).map((s,i)=>`${i+1}. ${s}`).join("\n"),b.notes?"\nNotes: "+b.notes:""].join("\n").trim();
function collect(){
  const r=A.editing,v=id=>document.getElementById(id).value.trim();
  const nums={};document.querySelectorAll("[data-nut]").forEach(i=>{if(i.value!=="")nums[i.dataset.nut]=+i.value});
  const nut=(v("nServing")||v("nServings")||Object.keys(nums).length)?{serving:v("nServing"),servings:v("nServings")?+v("nServings"):null,per_serving:nums,assumptions:v("nAssume")}:null;
  return {
    id:r._new?(v("eId")||slug(v("eTitle"))):r.id,title:v("eTitle"),category:document.getElementById("eCat").value,cuisine:v("eCuisine"),yield:v("eYield"),
    draft:document.getElementById("eDraft").checked,rating:r.rating||0,
    traits:[...document.querySelectorAll("[data-trait]:checked")].map(i=>i.dataset.trait),diet:[...document.querySelectorAll("[data-diet]:checked")].map(i=>i.dataset.diet),
    tags:v("eTags").split(",").map(t=>t.trim().toLowerCase()).filter(Boolean),
    groups:toGroups(document.getElementById("eIng").value),steps:toSteps(document.getElementById("eSteps").value),notes:v("eNotes"),
    nutrition:nut,extras:{spicy:collectSpicy()},method:v("eMethod"),alt_methods:collectAlts().filter(a=>a.name),developed:v("eDev")||null,credit:v("eCredit")||null,photos:r.photos||[],
    private:{occasion:v("pOcc")||null,source_title:v("pSrcT")||null,source_url:v("pSrcU")||null,private_notes:v("pNotes")||null,
      flags:v("pFlags")?v("pFlags").split(",").map(t=>t.trim()).filter(Boolean):null}
  };
}
function wireEditor(){
  const r=A.editing,msg=()=>document.getElementById("eMsg");
  if(r._new){const t=document.getElementById("eTitle"),i=document.getElementById("eId");let touched=false;
    i.oninput=()=>{touched=true};t.oninput=()=>{if(!touched)i.value=slug(t.value)}}
  document.querySelectorAll("[data-st]").forEach(b=>b.onclick=()=>{const n=+b.dataset.st;r.rating=r.rating===n?0:n;document.querySelectorAll("[data-st]").forEach(x=>x.classList.toggle("on",+x.dataset.st<=r.rating))});
  document.getElementById("aEdit").onsubmit=async e=>{
    e.preventDefault();const body=collect();msg().textContent="Saving…";
    if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.id)){msg().textContent="The web name can only use lowercase letters, numbers and dashes.";return}
    if(r._new&&A.list.some(x=>x.id===body.id)){msg().textContent="That web name is taken.";return}
    try{const why=r._new?null:(document.getElementById("eWhy").value.trim()||null);
      await call("rb_save",{p_recipe:body,p_why:why});toast(r._new?"Recipe created":"Saved");refreshSite();
      if(r._new){location.hash="#admin/r/"+encodeURIComponent(body.id)}else openEditor(body.id)}
    catch(x){msg().textContent="Didn't save: "+x.message}
  };
  const del=document.getElementById("eDelete");
  if(del)del.onclick=async()=>{if(!confirm(`Delete "${r.title}" and its cook log for good?`))return;
    try{await call("rb_delete",{p_id:r.id});for(const ph of r.photos||[])if(ph.path)removeFile(ph.path);toast("Deleted");refreshSite();location.hash="#admin"}catch(x){msg().textContent=x.message}};
  const ren=document.getElementById("eRename");
  if(ren)ren.onclick=async()=>{const nv=prompt("New web name (lowercase letters, numbers and dashes). The old link will keep working.",r.id);
    if(!nv||nv===r.id)return;if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(nv)){toast("Lowercase letters, numbers and dashes only");return}
    try{await call("rb_rename",{p_old:r.id,p_new:nv});toast("Renamed");refreshSite();location.hash="#admin/r/"+encodeURIComponent(nv)}catch(x){toast(x.message)}};
  // spicy: flag swaps that don't match any line exactly
  const hpCheck=()=>{const ing=new Set([...toGroups(document.getElementById("eIng").value),...collectAlts().flatMap(a=>a.groups||[])].flatMap(g=>g.ingredients));
    const st=new Set([...toSteps(document.getElementById("eSteps").value),...collectAlts().flatMap(a=>a.steps)]);const sp=collectSpicy()||{};
    const miss=[...(sp.swaps||[]).filter(x=>!ing.has(x.from)).map(x=>x.from),...(sp.steps||[]).filter(x=>!st.has(x.from)).map(x=>x.from)];
    document.getElementById("hpWarn").textContent=miss.length?`Not found word for word, so these won't swap: ${miss.join(" / ")}`:""};
  ["hpSwaps","hpSteps","eIng","eSteps"].forEach(id=>document.getElementById(id).addEventListener("input",hpCheck));hpCheck();
  // cooking methods
  const keep=()=>{const c=collect();c.alt_methods=collectAlts();Object.assign(A.editing,c);return A.editing};
  document.getElementById("eAddAlt").onclick=()=>{const e=keep();if(!e.method)e.method="Main";e.alt_methods=[...e.alt_methods,{name:"",groups:null,steps:[]}];renderEditor()};
  document.querySelectorAll("[data-adel]").forEach(b=>b.onclick=()=>{const e=keep();e.alt_methods=e.alt_methods.filter((_,k)=>k!==+b.dataset.adel);renderEditor()});
  document.querySelectorAll('[data-af="same"]').forEach(c=>c.onchange=()=>{c.closest("[data-alt]").querySelector("[data-ingwrap]").hidden=c.checked});
  document.querySelectorAll("[data-amain]").forEach(b=>b.onclick=()=>{const e=keep(),i=+b.dataset.amain,a=e.alt_methods[i];
    const old={name:e.method||"Original",groups:a.groups?e.groups:null,steps:e.steps,yield:a.yield?e.yield:null,notes:a.notes?e.notes:null,nutrition:a.nutrition?e.nutrition:null};
    Object.assign(e,{method:a.name,groups:a.groups||e.groups,steps:a.steps,yield:a.yield||e.yield,notes:a.notes||e.notes,nutrition:a.nutrition||e.nutrition});
    e.alt_methods[i]=old;renderEditor();toast("Swapped. Save to keep it.")});
  // photos
  const savePhotos=async()=>{await call("rb_save",{p_recipe:{id:r.id,photos:r.photos}});refreshSite();renderEditor()};
  document.querySelectorAll("[data-phdel]").forEach(b=>b.onclick=async()=>{const i=+b.dataset.phdel,ph=r.photos[i];if(!confirm("Remove this photo?"))return;
    r.photos=r.photos.filter((_,k)=>k!==i);await savePhotos();if(ph&&ph.path)removeFile(ph.path)});
  document.querySelectorAll("[data-phup]").forEach(b=>b.onclick=async()=>{const i=+b.dataset.phup;const a=[...r.photos];[a[i-1],a[i]]=[a[i],a[i-1]];r.photos=a;await savePhotos()});
  const pb=document.getElementById("ePhotoBtn"),pf=document.getElementById("ePhoto");
  if(pb){pb.onclick=()=>pf.click();pf.onchange=async()=>{const m=document.getElementById("ePhMsg");const files=[...pf.files];
    for(const [i,f] of files.entries()){m.textContent=`Uploading ${i+1} of ${files.length}…`;
      try{const blob=await shrink(f);const path=`recipes/${r.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}.jpg`;await upload(path,blob);r.photos=[...(r.photos||[]),{path,by:"Adam"}]}
      catch(x){m.textContent="A photo didn't upload: "+x.message;return}}
    m.textContent="";await savePhotos();toast("Photos added")}}
  // log
  const la=document.getElementById("lAdd");
  if(la)la.onsubmit=async e=>{e.preventDefault();const rating=document.getElementById("lRating").value;
    try{await call("rb_log",{p_id:r.id,p_note:document.getElementById("lNote").value.trim(),p_kind:document.getElementById("lChange").checked?"change":"cook",p_date:document.getElementById("lDate").value||null,p_rating:rating?+rating:null});
      toast("Logged");if(rating)refreshSite();openEditor(r.id)}catch(x){toast(x.message)}};
  document.querySelectorAll("[data-ldel]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this log entry?"))return;
    try{await call("rb_log_delete",{p_log_id:b.dataset.ldel});openEditor(r.id)}catch(x){toast(x.message)}});
}

/* ---------- friends' queue ---------- */
async function renderQueue(){
  A.editing=null;el().innerHTML=shell(`<p class="muted">Loading…</p>`);wireShell();
  let q;try{q=await call("rb_queue")}catch(e){el().innerHTML=shell(`<p class="muted">${esc(e.message)}</p>`);wireShell();return}
  const pend=q.submissions.filter(x=>x.status==="pending"),live=q.submissions.filter(x=>x.status==="approved");
  const nItem=n=>{const r=getR(n.recipe_id);return `<div class="qitem qnote" data-nid="${esc(n.id)}"><div><b>${esc(n.name)}</b> on <a href="#${esc(n.recipe_id)}">${esc(r?r.title:n.recipe_id)}</a> <span class="muted">${esc(fmtDate(n.created_at))}</span> ${n.rating?`<span class="st">${stars(n.rating)}</span>`:""}</div>${n.note?`<div>${esc(n.note)}</div>`:""}${n.photo_path?`<img class="q-photo" src="${esc(photoUrl(n.photo_path))}" alt="">`:""}<div class="row"><button class="btn primary" data-nact="approved">Approve</button><span class="spacer"></span><button class="btn danger" data-nact="rejected">Toss</button></div></div>`};
  const sItem=x=>`<details class="qitem"${x.status==="pending"?" open":""} data-sid="${esc(x.id)}">
    <summary><b>${esc(x.title)}</b> <span class="muted">from ${esc(x.name)} · ${esc(fmtDate(x.created_at))}</span></summary>
    ${x.photo_path?`<img class="q-photo" src="${esc(photoUrl(x.photo_path))}" alt="">`:""}
    <label>Recipe name<input data-f="title" value="${esc(x.title)}" maxlength="120"></label>
    <div class="two"><label>Type<select data-f="category">${CATS.map(c=>`<option${c===x.category?" selected":""}>${esc(c)}</option>`).join("")}</select></label><label>Makes<input data-f="yield" value="${esc(x.yield||"")}" maxlength="120"></label></div>
    <label>Ingredients<textarea data-f="ingredients" rows="8">${esc(x.ingredients)}</textarea></label>
    <label>Steps<textarea data-f="steps" rows="8">${esc(x.steps)}</textarea></label>
    <label>Notes<textarea data-f="notes" rows="3">${esc(x.notes||"")}</textarea></label>
    <div class="row">${x.status==="pending"?`<button class="btn primary" data-act="approved">Approve and post</button>`:`<button class="btn primary" data-act="approved">Save changes</button><a class="btn" href="#f-${esc(x.id)}">View</a><button class="btn" data-act="pending">Take down</button>`}
      <button class="btn" data-promote>Add to Ark's recipes</button><span class="spacer"></span><button class="btn danger" data-act="rejected">Toss</button><span class="muted" data-msg></span></div></details>`;
  el().innerHTML=shell(`<h2>Notes and photos waiting (${q.notes.length})</h2>${q.notes.length?q.notes.map(nItem).join(""):`<p class="muted">Nothing waiting.</p>`}
    <h2>Recipes waiting (${pend.length})</h2>${pend.length?pend.map(sItem).join(""):`<p class="muted">Nothing waiting.</p>`}
    <h2>Friends' recipes on the site (${live.length})</h2>${live.map(sItem).join("")||`<p class="muted">None yet.</p>`}`);
  wireShell();
  el().querySelectorAll("[data-nact]").forEach(b=>b.onclick=async()=>{const d=b.closest(".qnote");
    try{await call("rb_note_set",{p_nid:d.dataset.nid,p_status:b.dataset.nact});toast(b.dataset.nact==="approved"?"Approved":"Tossed");d.remove();loadFriends()}catch(x){toast(x.message)}});
  const fields=d=>{const f={};d.querySelectorAll("[data-f]").forEach(i=>f[i.dataset.f]=i.value.trim());return f};
  el().querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{const d=b.closest(".qitem"),act=b.dataset.act,m=d.querySelector("[data-msg]");
    if(act==="rejected"&&!confirm("Toss this recipe? It won't be posted."))return;
    m.textContent="Saving…";try{await call("rb_submission_save",{p_sid:d.dataset.sid,p_fields:fields(d),p_status:act});toast({approved:"Posted",pending:"Taken down",rejected:"Tossed"}[act]);loadSubmissions();renderQueue()}
    catch(x){m.textContent=x.message}});
  el().querySelectorAll("[data-promote]").forEach(b=>b.onclick=async()=>{const d=b.closest(".qitem"),f=fields(d),sid=d.dataset.sid,sub=q.submissions.find(x=>x.id===sid);
    let id=slug(f.title);const taken=new Set((await call("rb_list")).map(x=>x.id));for(let i=2;taken.has(id);i++)id=slug(f.title)+"-"+i;
    if(!confirm(`Copy "${f.title}" into your recipes as an unfinished draft, credited to ${sub.name}? It comes off the friends' list.`))return;
    try{await call("rb_save",{p_recipe:{id,title:f.title,category:f.category,yield:f.yield,groups:toGroups(f.ingredients),steps:toSteps(f.steps),notes:f.notes,
        credit:sub.name,draft:true,developed:today(),photos:sub.photo_path?[{path:sub.photo_path,by:sub.name}]:[],private:{source_title:"Friend submission",friend_submission:sid}}});
      await call("rb_submission_save",{p_sid:sid,p_fields:{},p_status:"promoted"});loadSubmissions();toast("Copied into your recipes");location.hash="#admin/r/"+id}
    catch(x){toast(x.message)}});
}

/* ---------- agent keys ---------- */
async function renderKeys(){
  A.editing=null;el().innerHTML=shell(`<p class="muted">Loading…</p>`);wireShell();
  let ks=[];try{ks=await call("rb_token_list")}catch(e){}
  const now=Date.now();
  el().innerHTML=shell(`<p class="muted">A Claude session makes its own key and shows you only its fingerprint. Paste the fingerprint here to let that session read and edit recipes. Revoke it any time.</p>
    <form class="share-form" id="kAdd"><label>Fingerprint <small>64 letters and numbers from Claude</small><input id="kHash" pattern="[0-9a-fA-F]{64}" required></label>
      <div class="two"><label>Label<input id="kLabel" placeholder="e.g. Recipe work, Oct 2026"></label><label>Expires after (days)<input id="kDays" type="number" min="1" value="90"></label></div>
      <div class="row"><button class="btn primary" type="submit">Authorize</button><span class="muted" id="kMsg"></span></div></form>
    <h2>Keys</h2>${ks.length?`<ul class="loglist">${ks.map(k=>{const dead=k.revoked||(k.expires_at&&new Date(k.expires_at)<now);return `<li><div class="h"><b>${esc(k.label||"Unlabeled")}</b> <span class="muted">…${esc(k.hash.slice(-8))}</span><span class="spacer"></span>${dead?`<span class="flag">${k.revoked?"Revoked":"Expired"}</span>`:`<button class="btn danger" data-kr="${k.id}">Revoke</button>`}</div>
      <div class="muted">Added ${esc(fmtDate(k.created_at))}${k.expires_at?`, expires ${esc(fmtDate(k.expires_at))}`:""}${k.last_used_at?`, last used ${esc(fmtDate(k.last_used_at))}`:", never used"}</div></li>`}).join("")}</ul>`:`<p class="muted">No keys yet.</p>`}`);
  wireShell();
  document.getElementById("kAdd").onsubmit=async e=>{e.preventDefault();
    try{await call("rb_token_add",{p_hash:document.getElementById("kHash").value.trim().toLowerCase(),p_label:document.getElementById("kLabel").value.trim(),p_days:+document.getElementById("kDays").value||90});toast("Key authorized");renderKeys()}
    catch(x){document.getElementById("kMsg").textContent=x.message}};
  el().querySelectorAll("[data-kr]").forEach(b=>b.onclick=async()=>{if(!confirm("Revoke this key? That Claude session loses access."))return;
    try{await call("rb_token_revoke",{p_id:+b.dataset.kr});renderKeys()}catch(x){toast(x.message)}});
}

window.RBAdmin={render};
})();

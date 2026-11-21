/* =====================================================================
   fast.js v2 — Admin panel ko INSTANT banata hai.

   ASLI PROBLEM: Firebase ka ek hi "websocket" hota hai. app.js
   'inventory' ko poora ek saath maangta hai, aur purane products ki
   bhaari base64 photos (MBs mein) usi ek pipe mein aati hain — jab tak
   wo khatam na ho, customers / orders / baaki sab uske peeche atke
   rehte hain. Isi liye 4-5 minute lagte the.

   AB YE KYA KARTI HAI:
   1) Inventory ko websocket se NAHI, alag HTTP connections se,
      product-by-product (8 ek saath) laati hai — jo product pehle aata
      hai wo turant screen par dikh jata hai. Customers / orders /
      settings ko ab koi nahi rokta, wo turant aate hain.
   2) Jo purana product bhaari photos ke saath milta hai, use wahin
      ke wahin halka kar deti hai (photos "inventoryPhotos" mein shift,
      "inventory" mein sirf chhota thumb). Koi photo delete nahi hoti.
      Pehli baar ek confirm poochti hai. Ek baar sab halka ho gaya to
      aage se inventory bhi live + instant.
   3) Sab data IndexedDB cache mein save hota hai — agle visit par
      saved data TURANT dikhta hai, peeche se live update aata rehta hai.

   Load order index.html mein:  firebase init  ->  fast.js  ->  app.js
   ===================================================================== */
(function(){
  'use strict';
  if(typeof firebase==='undefined'||typeof db==='undefined')return;

  var BASE=String((firebase.app().options||{}).databaseURL||'').replace(/\/$/,'');
  function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

  /* ---------- IndexedDB cache ---------- */
  var DB_NAME='jr-admin-cache',STORE='kv',idbPromise=null;
  function idb(){
    if(idbPromise)return idbPromise;
    idbPromise=new Promise(function(res){
      try{
        var r=indexedDB.open(DB_NAME,1);
        r.onupgradeneeded=function(){r.result.createObjectStore(STORE)};
        r.onsuccess=function(){res(r.result)};
        r.onerror=function(){res(null)};
        r.onblocked=function(){res(null)};
      }catch(e){res(null)}
    });
    return idbPromise;
  }
  function cacheGet(key){
    return idb().then(function(d){
      return new Promise(function(res){
        if(!d)return res(undefined);
        try{
          var q=d.transaction(STORE,'readonly').objectStore(STORE).get(key);
          q.onsuccess=function(){res(q.result)};
          q.onerror=function(){res(undefined)};
        }catch(e){res(undefined)}
      });
    });
  }
  function cacheSet(key,val){
    idb().then(function(d){
      if(!d)return;
      try{d.transaction(STORE,'readwrite').objectStore(STORE).put(val,key)}catch(e){}
    });
  }
  var saveTimers={};
  function scheduleSave(key,getVal){
    clearTimeout(saveTimers[key]);
    saveTimers[key]=setTimeout(function(){
      try{cacheSet(key,{v:getVal(),t:Date.now()})}catch(e){}
    },800);
  }

  /* ---------- badge + styles ---------- */
  var st=document.createElement('style');
  st.textContent=
    '#fastPill{position:fixed;top:calc(8px + env(safe-area-inset-top));right:8px;z-index:999;background:#171717;color:#fff;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;box-shadow:0 2px 10px #0003;display:none}'+
    '#fastMigrateBar{background:#fff3cd;border:2px solid #d8ad58;border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#533f03}'+
    '#fastMigrateBar b{display:block;margin-bottom:6px}'+
    '#fastMigrateBar button{margin-top:10px;border:0;border-radius:8px;padding:11px 16px;background:#171717;color:#fff;font-weight:800;cursor:pointer;min-height:44px}';
  document.head.appendChild(st);
  var pill=document.createElement('div');
  pill.id='fastPill';
  document.body.appendChild(pill);
  var pending={},pillMsg={};
  function updatePill(){
    var keys=Object.keys(pending);
    if(!keys.length){pill.style.display='none';return}
    pill.textContent=pillMsg.inv||'🔄 Syncing live data…';
    pill.style.display='block';
  }

  /* ---------- helpers ---------- */
  function fakeSnap(v,path){
    return {
      val:function(){return v},
      key:path.split('/').pop()||null,
      exists:function(){return v!==null&&v!==undefined},
      forEach:function(){return false}
    };
  }
  function isHeavy(p){
    return !!p&&((p.photos&&(Array.isArray(p.photos)?p.photos.length:Object.keys(p.photos).length))||p.photo);
  }
  function rget(p,q){
    return fetch(BASE+p+'.json'+(q||'')).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    });
  }
  function rsend(method,p,body){
    return fetch(BASE+p+'.json',{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json();
    });
  }
  function shrink(dataUrl,maxDim,quality){
    maxDim=maxDim||360;quality=quality||0.55;
    return new Promise(function(resolve,reject){
      var img=new Image();
      img.onload=function(){
        var w=img.width,h=img.height;
        if(w>h&&w>maxDim){h=Math.round(h*maxDim/w);w=maxDim}
        else if(h>maxDim){w=Math.round(w*maxDim/h);h=maxDim}
        var c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL('image/jpeg',quality));
      };
      img.onerror=function(){reject(new Error('thumb decode fail'))};
      img.src=dataUrl;
    });
  }

  /* ---------- ek purane product ko halka karna (REST se, websocket nahi rokta) ---------- */
  var consent=null;
  function askConsent(){
    if(consent!==null)return consent;
    if(lsGet('jrFastConsent')==='1'){consent=true;return true}
    consent=confirm('⚡ To make the app fast, the heavy photos of older products will be moved to "inventoryPhotos" and only a small thumbnail will remain in "inventory".\n\n• No photo will be deleted\n• This happens only once\n• New products are already saved this way\n\nContinue?');
    if(consent)lsSet('jrFastConsent','1');
    return consent;
  }
  async function slim(id,p){
    var arr=Array.isArray(p.photos)?p.photos.slice():Object.keys(p.photos||{}).map(function(k){return p.photos[k]});
    arr=arr.filter(Boolean);
    if(!arr.length&&p.photo)arr=[p.photo];
    if(!arr.length)return p;
    var g=await rget('/inventoryPhotos/'+encodeURIComponent(id),'?shallow=true');
    if(!(g&&g.photos)){
      await rsend('PUT','/inventoryPhotos/'+encodeURIComponent(id),{photos:arr});
    }
    var thumb=p.thumb||arr[0];
    if(!p.thumb&&typeof thumb==='string'&&thumb.indexOf('data:')===0){
      try{thumb=await shrink(thumb)}catch(e){}
    }
    await rsend('PATCH','/inventory/'+encodeURIComponent(id),{thumb:thumb,photos:null,photo:null});
    var out=Object.assign({},p,{thumb:thumb});
    delete out.photos;delete out.photo;
    return out;
  }

  /* ---------- Inventory: progressive loader ---------- */
  function inventoryLoader(ref,cb,cancelOrCtx,ctx){
    var path='/inventory',key='v1:'+path;
    var finished=false,cacheShown=false,timer=null,latest=null,latestMap=null;
    pending[key]=1;pillMsg.inv='🔄 Loading inventory…';updatePill();

    function emit(map){try{cb(fakeSnap(map,path))}catch(e){console.error('inventory render failed:',e)}}
    function push(map){
      latest=map;
      if(timer)return;
      timer=setTimeout(function(){timer=null;emit(latest)},250);
    }

    cacheGet(key).then(function(rec){
      if(finished||!rec||!('v' in rec))return;
      cacheShown=true;
      emit(rec.v);
    });

    function subscribeLive(){
      origOn.call(ref,'value',function(snap){
        scheduleSave(key,function(){return snap.val()});
        try{checkHeavy(snap.val())}catch(e){}
        return cb.apply(this,arguments);
      },cancelOrCtx,ctx);
    }

    (async function(){
      var heavyLeft=0,failed=0,map={};
      try{
        var keys=await rget('/inventory','?shallow=true');
        var ids=Object.keys(keys||{}),i=0,done=0;
        async function worker(){
          while(i<ids.length){
            var id=ids[i++],p=null;
            try{
              p=await rget('/inventory/'+encodeURIComponent(id));
              if(p&&isHeavy(p)){
                if(askConsent()){
                  try{p=await slim(id,p)}catch(e){console.error('slim failed',id,e);heavyLeft++}
                }else heavyLeft++;
              }
              if(p)map[id]=p;
            }catch(e){console.error('item load failed',id,e);failed++}
            done++;
            pillMsg.inv='🔄 Inventory: '+done+' / '+ids.length;updatePill();
            if(!cacheShown)push(Object.assign({},map));
          }
        }
        var workers=[];
        for(var w=0;w<8;w++)workers.push(worker());
        await Promise.all(workers);
      }catch(err){
        // REST kaam nahi kiya (rules / network) — purane tareeke par wapas
        console.error('progressive inventory failed, falling back:',err);
        finished=true;clearTimeout(timer);
        delete pending[key];delete pillMsg.inv;updatePill();
        origOn.call(ref,'value',function(snap){
          scheduleSave(key,function(){return snap.val()});
          try{checkHeavy(snap.val())}catch(e){}
          return cb.apply(this,arguments);
        },cancelOrCtx,ctx);
        return;
      }
      finished=true;clearTimeout(timer);
      emit(map);
      scheduleSave(key,function(){return map});
      if(!heavyLeft&&!failed)lsSet('jrFastDone','1');
      delete pending[key];delete pillMsg.inv;updatePill();
      subscribeLive();
    })();
  }

  /* ---------- db.ref(...).on('value') wrapper ---------- */
  var Proto=(firebase.database.Query||firebase.database.Reference).prototype;
  var origOn=Proto.on;
  Proto.on=function(evt,cb,cancelOrCtx,ctx){
    if(evt!=='value'||typeof cb!=='function')return origOn.apply(this,arguments);
    var path=String(this.toString()).replace(/^https?:\/\/[^\/]+/,'');
    if(!path||path.indexOf('/.info')===0)return origOn.apply(this,arguments);

    // Inventory pehli baar(ya jab tak sab halka nahi hua): alag progressive tareeke se
    if(path==='/inventory'&&typeof fetch==='function'&&BASE&&lsGet('jrFastDone')!=='1'){
      inventoryLoader(this,cb,cancelOrCtx,ctx);
      return cb;
    }

    var key='v1:'+path,live=false;
    pending[key]=1;updatePill();
    var wrapped=function(snap){
      live=true;delete pending[key];updatePill();
      scheduleSave(key,function(){return snap.val()});
      if(path==='/inventory'){try{checkHeavy(snap.val())}catch(e){console.error(e)}}
      return cb.apply(this,arguments);
    };
    cacheGet(key).then(function(rec){
      if(live||!rec||!('v' in rec))return;
      try{cb(fakeSnap(rec.v,path))}catch(e){console.error('cache render failed:',e)}
    });
    return origOn.call(this,evt,wrapped,cancelOrCtx,ctx);
  };

  /* ---------- Backup button: agar koi bhaari product baad mein bhi mile ---------- */
  var migrating=false;
  function barEl(){return document.getElementById('fastMigrateBar')}
  function checkHeavy(val){
    if(migrating)return;
    val=val||{};
    var ids=Object.keys(val).filter(function(k){return isHeavy(val[k])});
    var bar=barEl();
    if(!ids.length){if(bar)bar.remove();return}
    var main=document.querySelector('.main');
    if(!main)return;
    if(!bar){
      bar=document.createElement('div');
      bar.id='fastMigrateBar';
      main.insertBefore(bar,main.firstChild);
    }
    bar.innerHTML='<b>⚡ '+ids.length+' product(s) are still heavy</b>'+
      'Their photos are stored inside the Database, which slows the app down. Pressing the button will move the photos to a separate gallery (no photo will be deleted).'+
      '<br><button type="button" id="fastMigrateBtn">⚡ Speed Up Now</button>';
    document.getElementById('fastMigrateBtn').onclick=function(){migrate(ids)};
  }
  async function migrate(ids){
    if(migrating)return;
    lsSet('jrFastConsent','1');consent=true;
    migrating=true;
    var done=0,failed=0,bar=barEl();
    for(var i=0;i<ids.length;i++){
      if(bar)bar.innerHTML='<b>⏳ '+(i+1)+' / '+ids.length+' product being optimized… (do not close the page)</b>';
      try{
        var p=await rget('/inventory/'+encodeURIComponent(ids[i]));
        if(p&&isHeavy(p))await slim(ids[i],p);
        done++;
      }catch(e){console.error('migrate failed',ids[i],e);failed++}
    }
    migrating=false;
    if(!failed)lsSet('jrFastDone','1');
    alert('✅ '+done+' product(s) optimized'+(failed?(' • '+failed+' failed (please try again)'):'')+'.\nPlease reload the page now.');
    location.reload();
  }
})();

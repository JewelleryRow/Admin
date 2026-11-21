window.onerror=function(msg,src,line,col,err){
  alert('⚠️ JS ERROR:\n'+msg+'\n(line '+line+')\n\nPlease send this screenshot/text to the developer.');
  return false;
};
if(typeof firebase==='undefined'){
  alert('⚠️ Firebase library failed to load! Your internet may be slow, or an ad-blocker/firewall may be blocking gstatic.com. Reload the page or try another network.');
} else if(typeof db==='undefined'){
  alert('⚠️ Firebase "db" object was not created — check the Firebase config script in index.html.');
}

const DEFAULT_UPI_ID="BHARATPE2P0T0H6Z3E05213@unitype";
const MAX_PHOTOS=4;
let photos=[];
let editingId=null;
let inventory=[];
let orders=[];
let categories=[];
let settings={codEnabled:true,shippingCost:40,minOrderValue:300,freeShipAbove:1000,prepaidDiscount:5,upiId:DEFAULT_UPI_ID};

function show(id,b){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active')}
const drop=document.getElementById('drop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');readFiles(e.dataTransfer.files)};document.getElementById('photo').onchange=e=>{readFiles(e.target.files);e.target.value='';};
/* Photo ko canvas se resize + compress karke chhota banate hain, taaki
   Realtime Database mein raw 3-5MB camera photo ki jagah ~100-200KB
   ka compact JPEG save ho — isi wajah se ab tak reload itna slow tha. */
function compressImage(file,maxDim=1000,quality=0.72){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let{width,height}=img;
        if(width>height&&width>maxDim){height=Math.round(height*maxDim/width);width=maxDim}
        else if(height>maxDim){width=Math.round(width*maxDim/height);height=maxDim}
        const canvas=document.createElement('canvas');
        canvas.width=width;canvas.height=height;
        canvas.getContext('2d').drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      img.onerror=()=>reject(new Error('Image decode fail'));
      img.src=reader.result;
    };
    reader.onerror=()=>reject(new Error('File read fail'));
    reader.readAsDataURL(file);
  });
}
/* Ek chhoti "thumb" (list-view ke liye) banata hai kisi bhi already-
   compressed data URL se — ye Storefront ki listing ko fast rakhne ke
   liye hai (neeche is file mein poora explanation hai ki kyun). */
function shrinkDataUrl(dataUrl,maxDim=360,quality=0.55){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      let{width,height}=img;
      if(width>height&&width>maxDim){height=Math.round(height*maxDim/width);width=maxDim}
      else if(height>maxDim){width=Math.round(width*maxDim/height);height=maxDim}
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0,width,height);
      resolve(canvas.toDataURL('image/jpeg',quality));
    };
    img.onerror=()=>reject(new Error('Thumbnail decode fail'));
    img.src=dataUrl;
  });
}
function readFiles(fileList){
  const files=[...fileList].filter(f=>f&&f.type.startsWith('image/'));
  if(!files.length)return;
  const room=MAX_PHOTOS-photos.length;
  if(room<=0){alert(`A product can have at most ${MAX_PHOTOS} photos`);return;}
  if(files.length>room)alert(`Only ${room} more photo(s) could be added — the limit is ${MAX_PHOTOS}`);
  files.slice(0,room).forEach(f=>{
    compressImage(f).then(dataUrl=>{
      photos.push(dataUrl);
      renderPhotoView();
    }).catch(()=>{
      alert('⚠️ This photo could not be processed, please try again.');
    });
  });
}
function removePhoto(i){photos.splice(i,1);renderPhotoView()}
function renderPhotoView(){
  document.getElementById('photoView').innerHTML=photos.map((p,i)=>`<div class="photo-thumb"><img src="${p}"><button type="button" title="Remove" onclick="removePhoto(${i})">×</button></div>`).join('');
}

/* ===== Categories: live via Firebase — Admin adds a category once,
   it shows up in the "Category" dropdown here AND on the Storefront
   nav bar instantly, on all devices. ===== */
const DEFAULT_CATEGORIES=['Tools','Beads','Chain','Stone'];
let categoriesSeeded=false;
db.ref('categories').on('value',snap=>{
  const val=snap.val()||{};
  categories=Object.keys(val).map(k=>val[k]).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  if(!categories.length && !categoriesSeeded){
    categoriesSeeded=true;
    DEFAULT_CATEGORIES.forEach(name=>{
      const id='cat-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      db.ref('categories/'+id).set({id,name}).catch(err=>alert('⚠️ Default category seeding failed: '+err.message));
    });
    return; // the seed write will re-trigger this listener with real data
  }
  renderCategoryOptions();
  renderInventory();
},err=>{
  alert('⚠️ Reading categories is failing:\n'+err.message+'\n\nREAD is not allowed on the "categories" path in Firebase Rules.');
});
function renderCategoryOptions(){
  const sel=document.getElementById('category');
  if(!sel)return;
  const current=sel.value;
  sel.innerHTML='<option value="all">All</option>'+categories.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  if([...sel.options].some(o=>o.value===current)) sel.value=current;
  const chips=document.getElementById('categoryChips');
  if(chips) chips.innerHTML=categories.map(c=>`<span class="chip">${c.name}<button type="button" title="Delete category" onclick="deleteCategory('${c.id}')">×</button></span>`).join('');
}
/* prompt() kuch browsers/webviews/preview mein block hota hai ("prompt() is not
   supported"), isliye apna chhota popup box — har jagah chalta hai. */
function askText(message,placeholder){
  return new Promise(resolve=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML='<div style="background:#fff;border-radius:14px;padding:20px;width:100%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:inherit">'+
      '<div style="font-weight:800;margin-bottom:12px;color:#171717"></div>'+
      '<input type="text" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #cfd3d8;border-radius:10px;font-size:16px">'+
      '<div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end">'+
      '<button type="button" data-x="cancel" style="border:1px solid #cfd3d8;background:#fff;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer">Cancel</button>'+
      '<button type="button" data-x="ok" style="border:0;background:#171717;color:#fff;border-radius:10px;padding:11px 18px;font-weight:800;cursor:pointer">Add</button>'+
      '</div></div>';
    wrap.firstChild.firstChild.textContent=message;
    const input=wrap.querySelector('input');
    input.placeholder=placeholder||'';
    const done=v=>{wrap.remove();resolve(v);};
    wrap.querySelector('[data-x=ok]').onclick=()=>done(input.value);
    wrap.querySelector('[data-x=cancel]').onclick=()=>done('');
    input.onkeydown=e=>{if(e.key==='Enter')done(input.value);else if(e.key==='Escape')done('');};
    document.body.appendChild(wrap);
    setTimeout(()=>input.focus(),50);
  });
}
async function addCategory(){
  const name=(await askText('Enter the new category name','e.g. Earrings')||'').trim();
  if(!name)return;
  if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){alert('This category already exists');return;}
  const id='cat-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now();
  db.ref('categories/'+id).set({id,name}).then(()=>{
    const sel=document.getElementById('category');
    if(sel) sel.value=name; // pre-select the freshly added category
  }).catch(err=>{
    console.error('addCategory failed:',err);
    alert('Category was NOT added — Firebase error: '+err.message+'\n\nGo to the Firebase console and check Realtime Database > Rules — write must be allowed on the "categories" path.');
  });
}
function deleteCategory(id){
  if(!confirm('Delete this category? Products already assigned to it will keep their category.'))return;
  db.ref('categories/'+id).remove().catch(err=>{
    console.error('deleteCategory failed:',err);
    alert('Category was NOT deleted — Firebase error: '+err.message+'\n\nGo to the Firebase console and check Realtime Database > Rules — write/delete must be allowed on the "categories" path.');
  });
}

/* ===== Inventory: live via Firebase — Admin adds/edits/deletes,
   Storefront reflects instantly. Each product can carry up to
   MAX_PHOTOS photos; the first one is used as the main/cover photo.

   IMPORTANT — data split for SPEED (no paid Firebase Storage needed):
   Photos are compressed JPEGs saved as base64 text right here in the
   Realtime Database (Storage is intentionally NOT used). But the
   Storefront's home/listing page only ever shows ONE small photo per
   product card — downloading all 4 full photos for every product just
   to show a listing thumbnail is what was making the customer app feel
   frozen/slow. So we now save two things per product:
     - inventory/{id}        → light fields only (title, price, category,
                                rating) + a small "thumb" (one shrunk
                                photo) — this is what the Storefront's
                                home page subscribes to, so it loads fast.
     - inventoryPhotos/{id}  → the full-size photo gallery (all photos) —
                                only fetched by the Storefront when a
                                customer actually opens that product's
                                detail page.
   Admin's own product list/edit form still shows/uses the full gallery
   as before; only the Storefront listing got lighter. ===== */
async function addProduct(){
  let title=document.getElementById('title').value.trim(),
      price=Number(document.getElementById('price').value),
      category=document.getElementById('category').value||'all',
      rating=document.getElementById('rating').value===''?0:Number(document.getElementById('rating').value),
      ratingCount=document.getElementById('ratingCount').value===''?0:Number(document.getElementById('ratingCount').value);
  if(!photos.length||!title||!price)return alert('At least 1 photo, a title and a price are required');
  if(rating<0||rating>5)return alert('Rating must be between 0 and 5');
  if(ratingCount<0)return alert('Rating count cannot be negative');
  const id=editingId||('jr-'+Date.now());
  const saveBtn=document.getElementById('saveBtn');
  const prevText=saveBtn.textContent;
  saveBtn.disabled=true;
  saveBtn.textContent='Saving...';
  try{
    // Photos Firebase Storage par upload NAHI hoti (Storage jaan-bujh kar
    // istemal nahi kiya ja raha) — compressed photo seedha Realtime
    // Database mein base64 ki tarah save hoti hai.
    const finalPhotos=photos;
    const thumb=await shrinkDataUrl(finalPhotos[0]);
    // Pehle bhaari gallery save karo, taaki 'inventory' entry (jo
    // Storefront ko turant dikhta hai) tabhi likhe jab uski photo gallery
    // already maujood ho — koi race condition/missing-photo na aaye.
    await db.ref('inventoryPhotos/'+id).set({photos:finalPhotos});
    // createdAt: naya product = abhi ka time. Edit karte waqt purana createdAt
    // wahi rehta hai (set() poora record badalta hai, isliye yahan bachana zaroori hai)
    let createdAt=Date.now();
    if(editingId){
      const old=inventory.find(x=>x.id===id)||{};
      const idTime=/^jr-(\d{12,13})$/.exec(String(id));
      createdAt=Number(old.createdAt)||(idTime?Number(idTime[1]):0);
    }
    const rec={id,thumb,title,price,category,rating,ratingCount};
    if(createdAt)rec.createdAt=createdAt;
    await db.ref('inventory/'+id).set(rec);
    saveBtn.disabled=false;
    resetInventoryForm();
  }catch(err){
    console.error('addProduct failed:',err);
    alert('⚠️ Product was NOT saved — Database error: '+err.message+'\n\nGo to the Firebase console and check Realtime Database > Rules — write must be allowed on the "inventory" and "inventoryPhotos" paths.');
    saveBtn.disabled=false;
    saveBtn.textContent=prevText;
  }
}
function editProduct(id){
  const p=inventory.find(x=>x.id===id);
  if(!p)return;
  editingId=id;
  // Jab tak poori gallery load nahi hoti, form mein turant thumb (ya
  // purane products ke liye purana photo/photos field) dikha dete hain.
  photos=p.thumb?[p.thumb]:((p.photos&&p.photos.length)?[...p.photos]:(p.photo?[p.photo]:[]));
  renderPhotoView();
  document.getElementById('title').value=p.title||'';
  document.getElementById('price').value=p.price||'';
  document.getElementById('category').value=p.category||'all';
  document.getElementById('rating').value=p.rating||'';
  document.getElementById('ratingCount').value=p.ratingCount||'';
  document.getElementById('inventoryFormTitle').textContent='Edit Inventory';
  document.getElementById('saveBtn').textContent='Update Inventory';
  document.getElementById('cancelEditBtn').style.display='inline-block';
  show('inventory',document.querySelector('.nav button[onclick*="inventory"]'));
  window.scrollTo({top:0,behavior:'smooth'});
  // Poori gallery background mein laa kar form mein swap kar dete hain
  // (agar available ho) — taaki edit karte waqt saari purani photos dikhein.
  db.ref('inventoryPhotos/'+id).once('value').then(snap=>{
    if(editingId!==id)return; // user ne edit cancel/switch kar diya
    const val=snap.val();
    if(val&&val.photos&&val.photos.length){
      photos=[...val.photos];
      renderPhotoView();
    }
  }).catch(err=>console.error('Failed to load full gallery for edit:',err));
}
function cancelEdit(){ resetInventoryForm(); }
function resetInventoryForm(){
  editingId=null;
  photos=[];
  renderPhotoView();
  document.getElementById('title').value='';
  document.getElementById('price').value='';
  document.getElementById('category').value='all';
  document.getElementById('rating').value='';
  document.getElementById('ratingCount').value='';
  document.getElementById('inventoryFormTitle').textContent='Add Inventory';
  document.getElementById('saveBtn').textContent='Save Inventory';
  document.getElementById('cancelEditBtn').style.display='none';
}
function deleteProduct(id){
  if(!confirm('Delete this product?'))return;
  db.ref('inventory/'+id).remove().then(()=>{
    db.ref('inventoryPhotos/'+id).remove().catch(()=>{}); // gallery bhi saaf kar do
    if(editingId===id)resetInventoryForm();
  }).catch(err=>{
    console.error('deleteProduct failed:',err);
    alert('⚠️ Product was NOT deleted — Firebase error: '+err.message);
  });
}


db.ref('inventory').on('value',snap=>{
  const val=snap.val()||{};
  inventory=Object.keys(val).map(k=>val[k]).sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  renderInventory();
  try{renderOrders();renderCustomers();}catch(e){}
});
function renderInventory(){
  document.getElementById('inventoryRows').innerHTML=inventory.length?inventory.map(p=>{
    const imgs=p.thumb?[p.thumb]:((p.photos&&p.photos.length)?p.photos:(p.photo?[p.photo]:[]));
    const thumbHtml=imgs.length?`<div class="pic-multi">${imgs.slice(0,3).map(src=>`<img src="${src}">`).join('')}</div>`:'';
    return `<tr><td>${thumbHtml}</td><td>${p.title}</td><td>${p.category||'all'}</td><td>₹${Number(p.price).toLocaleString('en-IN')}</td><td>${p.rating?`⭐ ${p.rating} (${p.ratingCount||0})`:'—'}</td><td><button class="edit-btn" onclick="editProduct('${p.id}')">Edit</button><button class="danger" onclick="deleteProduct('${p.id}')">Delete</button></td></tr>`;
  }).join(''):'<tr><td colspan="6">No inventory products</td></tr>';
  document.getElementById('productCount').textContent=inventory.length;
}

/* ===== Settings: live via Firebase — same status the Storefront reads ===== */
function toggleCOD(){ db.ref('settings').update({codEnabled:!settings.codEnabled}); }
function saveSettings(){
  const upi=document.getElementById('upiId').value.trim();
  if(!upi)return alert('UPI ID cannot be empty');
  db.ref('settings').update({
    upiId:upi,
    shippingCost:Number(document.getElementById('shipping').value||0),
    minOrderValue:Number(document.getElementById('minimum').value||0),
    freeShipAbove:Number(document.getElementById('freeShipAbove').value||0),
    prepaidDiscount:Number(document.getElementById('prepaidDiscount').value||0),
    ...timerUpdate()
  });
  alert('Settings saved');
}
/* ===== Discount Timer — admin hours/min/sec daalta hai, Save par
   "prepaidDiscountExpiresAt" (server-time ms) ban jaata hai. Storefront usi
   time tak discount deta hai; time khatam => discount 0. Sab 0 = no timer. ===== */
let _serverOffset=0;
db.ref('.info/serverTimeOffset').on('value',s=>{_serverOffset=Number(s.val())||0;});
function serverNow(){return Date.now()+_serverOffset;}
function timerUpdate(){
  const h=Number(document.getElementById('discHours').value||0),
        m=Number(document.getElementById('discMinutes').value||0),
        sec=Number(document.getElementById('discSeconds').value||0);
  const total=(h*3600+m*60+sec)*1000;
  // Sab 0 hai: agar pehle se timer chal raha hai to usse na chhedo, warna no-timer.
  if(total<=0)return (settings.prepaidDiscountExpiresAt>serverNow())?{}:{prepaidDiscountExpiresAt:0};
  return {prepaidDiscountExpiresAt:serverNow()+total};
}
function stopDiscountTimer(){
  if(!confirm('Remove the timer? The discount will keep running without a timer (or set it to 0% to turn it off).'))return;
  db.ref('settings').update({prepaidDiscountExpiresAt:0});
  ['discHours','discMinutes','discSeconds'].forEach(id=>document.getElementById(id).value=0);
}
function fmtLeft(ms){const t=Math.max(0,Math.floor(ms/1000));return String(Math.floor(t/3600)).padStart(2,'0')+':'+String(Math.floor(t%3600/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');}
function renderDiscountTimerStatus(){
  const el=document.getElementById('discountTimerStatus');if(!el)return;
  const exp=Number(settings.prepaidDiscountExpiresAt)||0;
  if(!exp){el.textContent='No timer — discount is always active';el.style.color='#555';}
  else if(serverNow()<exp){el.textContent='⏳ Discount active — time remaining: '+fmtLeft(exp-serverNow());el.style.color='#1a7a3c';}
  else{el.textContent='❌ Offer ended — discount is now 0';el.style.color='#c22';}
}
setInterval(renderDiscountTimerStatus,1000);
db.ref('settings').on('value',snap=>{
  settings={codEnabled:true,shippingCost:40,minOrderValue:300,freeShipAbove:1000,prepaidDiscount:5,upiId:DEFAULT_UPI_ID,...(snap.val()||{})};
  syncSettingsUI();
  renderDiscountTimerStatus();
});
function syncSettingsUI(){document.getElementById('codToggle').classList.toggle('on',!!settings.codEnabled);document.getElementById('shipping').value=settings.shippingCost??40;document.getElementById('minimum').value=settings.minOrderValue??300;document.getElementById('freeShipAbove').value=settings.freeShipAbove??1000;document.getElementById('prepaidDiscount').value=settings.prepaidDiscount??5;document.getElementById('upiId').value=settings.upiId??DEFAULT_UPI_ID}

/* ===== Orders: live via Firebase — Customer places, Admin updates status,
   Customer sees the new status instantly. Status keys match the storefront's
   tracking stages exactly. ===== */
const STATUS_KEYS=['PLACED','CONFIRMED','READY_TO_SHIP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','RTO','REJECTED','CANCELLED'];
/* Status ab dropdown badalte hi save nahi hota — sirf "Save Status" dabane
   aur confirm karne par hota hai. Beech ka chuna hua status yahan yaad rehta hai. */
const pendingStatus={};
function statuses(o){
  const cur=pendingStatus[o._key||o.id]||String(o.status||'').toUpperCase();
  return STATUS_KEYS.map(s=>`<option value="${s}" ${cur===s?'selected':''}>${s.replaceAll('_',' ')}</option>`).join('');
}
function pickStatus(id,v){
  const o=orders.find(x=>(x._key||x.id)===id);
  const same=o&&String(o.status||'').toUpperCase()===v;
  if(same)delete pendingStatus[id];else pendingStatus[id]=v;
  const b=document.getElementById('svb-'+id);
  if(b)b.disabled=!!same;
}
function saveStatus(id){
  const v=pendingStatus[id];
  if(!v)return;
  if(!confirm('Change order status to '+v.replaceAll('_',' ')+'?'))return;
  const b=document.getElementById('svb-'+id);
  if(b){b.disabled=true;b.textContent='Saving...';}
  updateStatus(id,v).then(()=>{delete pendingStatus[id];renderOrders();renderCustomers();});
}
function updateStatus(id,v){
  const o=orders.find(x=>(x._key||x.id)===id);
  const now=Date.now();
  const entry={status:v,at:now,label:v.replaceAll('_',' ')};
  const oldHist=o&&o.history?(Array.isArray(o.history)?o.history:Object.values(o.history)):[];
  const history=[...oldHist,entry];
  return db.ref('orders/'+id).update({status:v,updatedAt:now,history}).catch(err=>{
    console.error('updateStatus failed:',err);
    alert('⚠️ Status was NOT updated — Firebase error: '+err.message+'\n\nOrder key: '+id+'\nWRITE must be allowed on the "orders" path in Firebase Rules.');
  });
}
/* UTR / transaction reference dhundhta hai — storefront jis bhi naam se
   save kare (utr, utrNo, txnId, upiRef ...), top-level ya ek level andar. */
function getUtr(o){
  const re=/utr|txn|transaction|upi.?ref|ref.?no|payment.?ref/i;
  const pick=obj=>{
    if(!obj||typeof obj!=='object')return '';
    for(const k of Object.keys(obj)){
      const v=obj[k];
      if(re.test(k)&&v!==null&&v!==undefined&&typeof v!=='object'&&String(v).trim()!=='')return String(v).trim();
    }
    return '';
  };
  let r=pick(o);
  if(r)return r;
  for(const k of Object.keys(o)){
    if(k==='items'||k==='history')continue;
    r=pick(o[k]);
    if(r)return r;
  }
  return '';
}
/* Customer card par "Accept Order" button isi ko call karta hai —
   order PLACED se CONFIRMED ho jaata hai, aur turant Orders page ke
   "Accepted / In-Progress" section mein chala jaata hai. */
function acceptOrder(id){ updateStatus(id,'CONFIRMED'); }


/* ===== Lifetime per-customer order count — "customerStats" ek ALAG
   Firebase path hai jo "orders" se kabhi delete nahi hota. Jab bhi koi
   naya order aata hai, us customer ke phone ke neeche uski order-id
   permanently record ho jaati hai. Isse "Clear All Orders" chalane ke
   baad bhi pata chalta rehta hai ki kaunsa customer REPEAT hai (2nd/3rd
   baar order kar chuka hai), chahe purane orders delete ho chuke ho. ===== */
let customerStats={};
db.ref('customerStats').on('value',snap=>{
  customerStats=snap.val()||{};
  renderCustomers();
});
db.ref('orders').on('child_added',snap=>{
  const o=snap.val()||{};
  const phone=String(o.customerPhone||(o.address&&o.address.phone)||'').trim();
  if(!phone)return;
  db.ref('customerStats/'+phone+'/orderIds/'+snap.key).set(true).catch(()=>{});
});
function lifetimeOrderCount(phone){
  const rec=phone&&customerStats[phone];
  return (rec&&rec.orderIds)?Object.keys(rec.orderIds).length:0;
}

/* "Saare Orders Clear Karein" button — sirf "orders" path delete karta
   hai, isliye Dashboard/Orders ke saare counters (Total Orders, Total
   Amount, Placed, Delivered) turant 0 ho jaate hain. "customerStats"
   ko yeh function kabhi nahi chhedta, isliye repeat-customer record
   surakshit rehta hai. */
function clearAllOrders(){
  if(!confirm('⚠️ This will permanently delete ALL orders — Total Orders, Total Amount, Placed and Delivered will all become 0. Each customer\'s "has ordered before" record will be kept safe. Continue?'))return;
  if(!confirm('Are you absolutely sure? This action cannot be undone.'))return;
  db.ref('orders').remove().then(()=>{
    alert('✅ All orders cleared — the Dashboard and Orders sections will now start from 0.');
  }).catch(err=>{
    console.error('clearAllOrders failed:',err);
    alert('⚠️ Clear FAILED — Firebase error: '+err.message);
  });
}
db.ref('orders').on('value',snap=>{
  const val=snap.val()||{};
  orders=Object.keys(val).map(k=>({...val[k],_key:k})).sort((a,b)=>(b.placedAt||0)-(a.placedAt||0));
  renderOrders();
  renderCustomers();
});
/* Order / cart items only store id, name, price and qty - the photo is looked up
   here from the live inventory (or from the gifts list for free gifts). */
function itemPhoto(i){
  if(!i)return '';
  if(i.gift||String(i.id||'').indexOf('gift:')===0){
    const g=gifts.find(x=>x.id===(i.giftId||String(i.id).slice(5)));
    return g&&g.photo?g.photo:'';
  }
  const p=inventory.find(x=>x.id===i.id);
  if(!p)return '';
  return p.thumb||((p.photos&&p.photos.length)?p.photos[0]:(p.photo||''));
}
function itemBoxHtml(i){
  const src=itemPhoto(i),name=escH(i.n||i.name||'');
  const img=src?`<img class="jr-item-img" src="${src}" alt="" onclick="zoomPhoto(this.src)">`:'<div class="jr-item-img jr-item-noimg">📦</div>';
  return `<div class="jr-item-box">${img}<b>${name}</b><span>× ${i.qty}</span></div>`;
}
function zoomPhoto(src){
  const w=document.createElement('div');
  w.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:14px';
  w.innerHTML='<img style="max-width:100%;max-height:100%;border-radius:12px;background:#fff">';
  w.firstChild.src=src;w.onclick=()=>w.remove();
  document.body.appendChild(w);
}
function orderCardHtml(o){
  const a=o.address||{},name=a.name||o.customerName||'Customer',phone=o.customerPhone||a.phone||'';
  const addr=[a.address,a.city,a.state,a.pincode].filter(Boolean).join(', ')||'No address';
  const items=o.items||[];
  const itemsHtml=items.length?items.map(itemBoxHtml).join(''):'<span class="small">No items</span>';
  const total=o.total??o.totalAmount??0;
  const oid=o._key||o.id;
  // Is order se PEHLE is customer ne kitne order kiye (lifetime record se, Clear All ke baad bhi sahi)
  const prevBadge=(()=>{
    const ph=String(phone).trim();if(!ph)return '';
    const t=o.placedAt||o.updatedAt||0;
    const sameOrLater=orders.filter(x=>String(x.customerPhone||(x.address&&x.address.phone)||'').trim()===ph&&(x.placedAt||x.updatedAt||0)>=t).length;
    const n=Math.max(0,lifetimeOrderCount(ph)-Math.max(1,sameOrLater));
    return n>0?` <span class="repeat-badge">🛍️ ${n} previous order${n>1?'s':''} placed</span>`:'';
  })();
  const utr=getUtr(o);
  const isCod=/cod|cash/i.test(String(o.payment||''));
  const utrHtml=utr
    ?`<div style="margin-bottom:8px;font-size:13px">UTR No: <b>${utr}</b> <button type="button" class="edit-btn" onclick="navigator.clipboard&&navigator.clipboard.writeText('${utr}');this.textContent='Copied'">Copy</button></div>`
    :(isCod?'':`<div style="margin-bottom:8px;font-size:13px;color:#c22">UTR No: <b>not provided by customer / not found</b></div>`);
  const isDelivered=String(o.status||'').toUpperCase()==='DELIVERED';
  const isCancelled=String(o.status||'').toUpperCase()==='CANCELLED';
  const cancelBlockHtml=isCancelled?`
    <div class="jr-block jr-pending" style="border-top:2px solid #171717">
      <div class="jr-block-title">❌ Cancelled — Refund Details</div>
      <div style="margin-bottom:6px;font-size:13px">Cancelled on: <b>${o.cancelledAt?new Date(o.cancelledAt).toLocaleString('en-IN'):'-'}</b></div>
      <div style="margin-bottom:6px;font-size:13px">Payment: <b>${o.payment||'-'}</b> • Amount: <b>₹${Number(total).toLocaleString('en-IN')}</b></div>
      <div style="margin-bottom:6px;font-size:13px">Refund UPI ID: <b id="rf-${o.id}">${o.refundUpiId||'Not provided'}</b> ${o.refundUpiId?`<button type="button" class="edit-btn" onclick="navigator.clipboard&&navigator.clipboard.writeText('${o.refundUpiId}');this.textContent='Copied'">Copy</button>`:''}</div>
      <div style="font-size:13px">${o.refundStatus||'Refund pending'}</div>
    </div>`:'';
  return `<div class="jr-card">
    <div class="st-save-row"><button type="button" id="svb-${oid}" class="st-save" ${pendingStatus[oid]?'':'disabled'} onclick="saveStatus('${oid}')">💾 Save Status</button></div>
    <div class="jr-card-header">
      <div><div class="jrh-title">🧾 <span>${o.id||'-'}</span></div><div class="jrh-sub">👤 ${name}${prevBadge}${phone?` • 📞 ${phone}`:''}</div></div>
      <div class="jrh-right">Shipping: ₹${o.shipping??0}<br><span class="jrh-amount">₹${Number(total).toLocaleString('en-IN')}</span></div>
    </div>
    <div class="jr-card-address">📍 ${addr}</div>
    <div class="jr-card-body">
      <div class="jr-block jr-cart">
        <div class="jr-block-title">💍 Order Items</div>
        ${itemsHtml}
      </div>
      <div class="jr-block jr-value">
        <div class="jr-block-title">💳 Payment &amp; Status</div>
        <div style="margin-bottom:8px;font-size:13px">Payment: <b>${o.payment||'-'}</b></div>
        ${utrHtml}
        <select class="status" style="width:100%" onchange="pickStatus('${oid}',this.value)">${statuses(o)}</select>
      </div>
    </div>
    ${cancelBlockHtml}
  </div>`;
}
function renderOrders(){
  const acceptedBody=document.getElementById('acceptedOrders');
  const deliveredBody=document.getElementById('deliveredOrders');
  if(!acceptedBody||!deliveredBody)return;

  // PLACED (naye, abhi accept nahi hue) orders yahan nahi, Customers page
  // par us customer ke apne card mein dikhte hain — Accept karte hi yahan aa jaate hain.
  // DELIVERED / RTO / REJECTED hote hi order "In-Progress" se hat kar neeche
  // "Delivered / RTO / Rejected" section mein chala jaata hai.
  const CLOSED=['DELIVERED','RTO','REJECTED','CANCELLED'];
  const accepted=orders.filter(o=>{
    const s=String(o.status||'').toUpperCase();
    return s!=='PLACED'&&!CLOSED.includes(s);
  });
  const delivered=orders.filter(o=>String(o.status||'').toUpperCase()==='DELIVERED');
  const closedOrders=orders.filter(o=>CLOSED.includes(String(o.status||'').toUpperCase()));

  acceptedBody.innerHTML=accepted.length?accepted.map(orderCardHtml).join(''):'<p style="text-align:center;padding:20px;color:#888">No accepted orders yet</p>';
  deliveredBody.innerHTML=closedOrders.length?closedOrders.map(orderCardHtml).join(''):'<p style="text-align:center;padding:20px;color:#888">No delivered / RTO / rejected / cancelled orders yet</p>';

  const deliveredAmount=delivered.reduce((sum,o)=>sum+Number(o.total??o.totalAmount??0),0);
  document.getElementById('deliveredCount').textContent=delivered.length;
  document.getElementById('deliveredAmount').textContent='₹'+deliveredAmount.toLocaleString('en-IN');

  let total=orders.reduce((a,o)=>a+Number(o.total??o.totalAmount??0),0);
  document.getElementById('ordersCount').textContent=orders.length;
  document.getElementById('placedCount').textContent=orders.filter(o=>String(o.status||'').toUpperCase()==='PLACED').length;
  document.getElementById('totalAmount').textContent='₹'+total.toLocaleString('en-IN');
}

/* Manual refresh button just re-renders from the already-live in-memory data. */
function renderAll(){renderInventory();renderOrders();syncSettingsUI();renderCategoryOptions();renderCustomers();}

/* ===== Customers: live via Firebase — Storefront pushes a logged-in
   customer's profile + current cart here whenever they log in, edit
   their profile, or change their cart. Guests (not logged in) never
   appear here. ===== */
let customers=[];
db.ref('customers').on('value',snap=>{
  const val=snap.val()||{};
  customers=Object.keys(val).map(k=>val[k]).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  renderCustomers();
},err=>{
  console.error('customers read failed:',err);
});
function renderCustomers(){
  const body=document.getElementById('customerRows');
  if(!body)return;
  if(!customers.length){
    body.innerHTML='<p style="text-align:center;padding:20px;color:#888">No customer has logged in yet</p>';
    return;
  }
  // Sirf wahi customers jinke cart mein item hai, ya jinka naya (PLACED) order
  // abhi accept hona baaki hai. Accept / Delivered / RTO / Reject / Cancel ke
  // baad order yahan se hat jaata hai; cart khali ho to customer bhi nahi dikhta.
  const visible=customers.filter(c=>{
    const hasCart=!!(c.cart&&c.cart.length);
    const hasPending=orders.some(o=>{
      const ph=o.customerPhone||(o.address&&o.address.phone)||'';
      return String(ph).trim()===String(c.phone||'').trim()&&String(o.status||'PLACED').toUpperCase()==='PLACED';
    });
    return hasCart||hasPending;
  });
  if(!visible.length){
    body.innerHTML='<p style="text-align:center;padding:20px;color:#888">No customer with items in cart or a new order</p>';
    return;
  }
  body.innerHTML=visible.map(c=>{
    const addr=[c.address,c.landmark,c.district,c.state,c.pincode].filter(Boolean).join(', ')||'No address provided';
    const cartItems=(c.cart&&c.cart.length)?c.cart:[];
    const cartHtml=cartItems.length?cartItems.map(itemBoxHtml).join(''):'';
    const lastActive=c.updatedAt?new Date(c.updatedAt).toLocaleString('en-IN'):'—';

    // Is customer ke SAARE orders (koi bhi status — PLACED, CONFIRMED,
    // DELIVERED, ...), sabse naya sabse pehle. Pehle sirf PLACED order
    // hi yahan dikhta tha, isliye accept karte hi "kisne kya order
    // kiya" gayab ho jaata tha. Ab yahan hamesha us customer ka
    // sabse latest order + uska status saaf dikhega.
    const custOrders=orders.filter(o=>{
      const phone=o.customerPhone||(o.address&&o.address.phone)||'';
      return String(phone).trim()===String(c.phone||'').trim();
    }).sort((a,b)=>(b.placedAt||b.updatedAt||0)-(a.placedAt||a.updatedAt||0));
    // Customer ka card hamesha dikhta hai; accept ke baad bhi uska latest order
    // (status ke saath) yahin dikhta rehta hai, aur cart mein naya item aate hi cart dikh jaata hai.
    const pendingOrders=custOrders.filter(o=>String(o.status||'PLACED').toUpperCase()==='PLACED');
    const lifetime=lifetimeOrderCount(c.phone);
    // Pehle kitne order kar chuka hai (abhi ka naya PLACED order ginti mein nahi)
    const prevOrders=Math.max(0,lifetime-pendingOrders.length);

    const rightBlock=pendingOrders.length?pendingOrders.map(po=>{
      const items=po.items||[];
      const itemsHtml=items.length?items.map(itemBoxHtml).join(''):'<span class="small">No items</span>';
      const total=po.total??po.totalAmount??0;
      const k=po._key||po.id;
      return `<div class="jr-block jr-pending">
          <div class="jr-block-title">🧾 New Order Received</div>
          <div style="font-size:22px;font-weight:900;margin:0 0 10px">Order Value: ₹${Number(total).toLocaleString('en-IN')}</div>
          <div class="small" style="margin-bottom:8px">Order ID: ${po.id||'-'}</div>
          ${itemsHtml}
          <button type="button" class="jr-accept-btn" onclick="acceptOrder('${k}')">✅ Accept Order</button>
        </div>`;
    }).join(''):`<div class="jr-block jr-value"></div>`;

    return `<div class="jr-card">
      <div class="jr-card-header">
        <div><div class="jrh-title">${c.name||'No name provided'}${prevOrders>0?` <span class="repeat-badge">🛍️ ${prevOrders} previous order${prevOrders>1?'s':''} placed</span>`:''}</div><div class="jrh-sub">📞 ${c.phone||'-'} • Lifetime Orders: ${lifetime}</div></div>
        <div class="jrh-right">Last Active<br>${lastActive}</div>
      </div>
      <div class="jr-card-address">📍 ${addr}</div>
      <div class="jr-card-body">
        ${cartItems.length?`<div class="jr-block jr-cart">
          <div class="jr-block-title">🛒 Current Cart</div>
          <div style="font-size:22px;font-weight:900;margin:0 0 10px">Cart Value: ₹${Number(cartItems.reduce((s,x)=>s+(Number(x.p||x.price)||0)*(Number(x.qty)||0),0)||c.cartTotal||0).toLocaleString('en-IN')}</div>
          ${cartHtml}
        </div>`:'<div class="jr-block jr-cart"></div>'}
        ${rightBlock}
      </div>
    </div>`;
  }).join('');
}

/* =====================================================================
   FREE GIFT inventory — "gifts" path in Firebase.
   gifts/{id} = {id,title,photo,minValue,reason,expiresAt,createdAt}
   Storefront reads this live: cart value >= minValue => gift is added to
   the cart for FREE. expiresAt (server-time ms, 0 = no timer) hides it.
   ===================================================================== */
let gifts=[],giftPhotoData='',editingGiftId=null;
const escH=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.getElementById('giftPhoto').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!f.type.startsWith('image/'))return;
  try{giftPhotoData=await compressImage(f,600,0.7);renderGiftPhoto();}
  catch(err){alert('⚠️ This photo could not be processed, please try again.');}
};
function renderGiftPhoto(){
  document.getElementById('giftPhotoView').innerHTML=giftPhotoData?`<div class="photo-thumb"><img src="${giftPhotoData}"><button type="button" title="Remove" onclick="giftPhotoData='';renderGiftPhoto()">×</button></div>`:'';
}
function resetGiftForm(){
  editingGiftId=null;giftPhotoData='';renderGiftPhoto();
  ['giftTitle','giftMin','giftReason'].forEach(id=>document.getElementById(id).value='');
  ['giftHours','giftMinutes','giftSeconds'].forEach(id=>document.getElementById(id).value=0);
  document.getElementById('giftSaveBtn').textContent='Save Gift';
  document.getElementById('giftFormTitle').textContent='Add Free Gift';
  document.getElementById('giftCancelBtn').style.display='none';
}
async function saveGift(){
  const title=document.getElementById('giftTitle').value.trim(),
        minValue=Number(document.getElementById('giftMin').value),
        reason=document.getElementById('giftReason').value.trim();
  if(!giftPhotoData||!title)return alert('A gift photo and a title are required');
  if(!(minValue>0))return alert('Please enter the minimum cart value (greater than 0)');
  const total=(Number(document.getElementById('giftHours').value||0)*3600+Number(document.getElementById('giftMinutes').value||0)*60+Number(document.getElementById('giftSeconds').value||0))*1000;
  const expiresAt=total>0?serverNow()+total:0;
  const id='gift-'+Date.now();
  const rec={id,title,photo:giftPhotoData,minValue,reason,expiresAt,createdAt:Date.now()};
  const btn=document.getElementById('giftSaveBtn'),prev=btn.textContent;
  btn.disabled=true;btn.textContent='Saving...';
  try{
    await db.ref('gifts/'+id).set(rec);
    resetGiftForm();
  }catch(err){
    console.error('saveGift failed:',err);
    alert('⚠️ Gift was NOT saved — Firebase error: '+err.message+'\n\nCheck Realtime Database > Rules — write must be allowed on the "gifts" path.');
    btn.textContent=prev;
  }
  btn.disabled=false;
}
let gmPhotoData='',gmInitTotal=0;
function editGift(id){
  const g=gifts.find(x=>x.id===id);if(!g)return;
  editingGiftId=id;gmPhotoData=g.photo||'';
  document.getElementById('gmImg').src=gmPhotoData;
  document.getElementById('gmTitle').value=g.title||'';
  document.getElementById('gmMin').value=g.minValue||'';
  document.getElementById('gmReason').value=g.reason||'';
  const exp=Number(g.expiresAt)||0,left=exp?Math.max(0,exp-serverNow()):0,t=Math.floor(left/1000);
  document.getElementById('gmH').value=Math.floor(t/3600);
  document.getElementById('gmM').value=Math.floor(t%3600/60);
  document.getElementById('gmS').value=t%60;
  gmInitTotal=Math.floor(t/3600)*3600+Math.floor(t%3600/60)*60+t%60;
  document.getElementById('gmTimerHint').textContent='';
  document.getElementById('giftModal').classList.add('open');
}
function closeGiftModal(){document.getElementById('giftModal').classList.remove('open');editingGiftId=null;}
document.getElementById('gmPhoto').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f||!f.type.startsWith('image/'))return;
  try{gmPhotoData=await compressImage(f,600,0.7);document.getElementById('gmImg').src=gmPhotoData;}
  catch(err){alert('⚠️ This photo could not be processed, please try again.');}
};
async function saveGiftEdit(){
  const id=editingGiftId,old=gifts.find(x=>x.id===id);if(!old)return closeGiftModal();
  const title=document.getElementById('gmTitle').value.trim(),
        minValue=Number(document.getElementById('gmMin').value),
        reason=document.getElementById('gmReason').value.trim();
  if(!gmPhotoData||!title)return alert('A gift photo and a title are required');
  if(!(minValue>0))return alert('Please enter the minimum cart value (greater than 0)');
  const total=Number(document.getElementById('gmH').value||0)*3600+Number(document.getElementById('gmM').value||0)*60+Number(document.getElementById('gmS').value||0);
  let expiresAt;
  if(total===gmInitTotal)expiresAt=Number(old.expiresAt)||0;   // timer untouched
  else expiresAt=total>0?serverNow()+total*1000:0;
  const rec={id,title,photo:gmPhotoData,minValue,reason,expiresAt,createdAt:Number(old.createdAt)||Date.now()};
  const btn=document.getElementById('gmSave');btn.disabled=true;btn.textContent='Saving...';
  try{await db.ref('gifts/'+id).set(rec);closeGiftModal();}
  catch(err){console.error('saveGiftEdit failed:',err);alert('⚠️ Gift was NOT saved — Firebase error: '+err.message+'\n\nCheck Realtime Database > Rules — write must be allowed on the "gifts" path.');}
  btn.disabled=false;btn.textContent='Save Changes';
}
function deleteGift(id){
  if(!confirm('Delete this gift? It will also disappear from customers\' carts.'))return;
  db.ref('gifts/'+id).remove().then(()=>{}).catch(err=>alert('⚠️ Gift was NOT deleted — Firebase error: '+err.message));
}
function giftStateHtml(g){
  const exp=Number(g.expiresAt)||0;
  if(!exp)return '<span class="gift-state no">Always available</span>';
  if(serverNow()<exp)return `<span class="gift-state on" data-gexp="${exp}">⏳ ${fmtLeft(exp-serverNow())} left</span>`;
  return '<span class="gift-state off">❌ Expired</span>';
}
function renderGifts(){
  const box=document.getElementById('giftCards');if(!box)return;
  box.innerHTML=gifts.length?gifts.map(g=>`<div class="gl-card${Number(g.expiresAt)&&serverNow()>=Number(g.expiresAt)?' expired':''}" onclick="editGift('${g.id}')">
    ${g.photo?`<img class="gl-img" src="${g.photo}">`:'<div class="gl-img"></div>'}
    <span class="gl-badge">${giftStateHtml(g)}</span>
    <button type="button" class="gl-del" title="Delete" onclick="event.stopPropagation();deleteGift('${g.id}')">🗑</button>
    <div class="gl-body"><div class="gl-title">${escH(g.title)}</div><div class="gl-min">Min cart: ₹${Number(g.minValue).toLocaleString('en-IN')}</div><div class="gl-reason">${escH(g.reason)||''}</div><div class="gl-tap">✏️ Tap to edit</div></div>
  </div>`).join(''):'<div class="gl-empty">No free gifts added yet</div>';
}
db.ref('gifts').on('value',snap=>{
  const val=snap.val()||{};
  gifts=Object.keys(val).map(k=>val[k]).filter(Boolean).sort((a,b)=>(a.minValue||0)-(b.minValue||0));
  renderGifts();
  try{renderOrders();renderCustomers();}catch(e){}
});
setInterval(()=>{
  document.querySelectorAll('[data-gexp]').forEach(el=>{
    const exp=Number(el.dataset.gexp);
    if(serverNow()>=exp)renderGifts();
    else el.textContent='⏳ '+fmtLeft(exp-serverNow())+' left';
  });
},1000);


/* =====================================================================
   CART EDIT — admin ek customer ka cart edit karta hai.
   Customer ko mobile number se kholte hain (customers/<key>), cart me
   sirf INVENTORY ke products add ho sakte hain, rate hamesha latest
   inventory price. Save karne par customers/<key>/cart + cartTotal
   update hota hai (wahi jagah jahan Storefront customer ka cart rakhta hai).
   ===================================================================== */
let ceKey=null,ceCust=null,ceCart=[],ceDirty=false;
const cePhone=v=>String(v||'').replace(/\D/g,'').slice(-10);
const ceIsGift=i=>!!i&&(i.gift||String(i.id||'').indexOf('gift:')===0);
const ceInv=id=>inventory.find(x=>x.id===id);
const ceThumb=p=>p?(p.thumb||((p.photos&&p.photos.length)?p.photos[0]:(p.photo||''))):'';
const ceRs=n=>'₹'+Number(n||0).toLocaleString('en-IN');
function ceSetDirty(v){ceDirty=v;const d=document.getElementById('ceDirty');if(d)d.textContent=v?'• unsaved changes':'';}

async function ceOpen(){
  const q=cePhone(document.getElementById('ceSearch').value);
  if(q.length<10)return alert('Please enter the 10 digit mobile number');
  const btn=document.getElementById('ceOpenBtn');btn.disabled=true;btn.textContent='Opening...';
  try{
    const snap=await db.ref('customers').once('value');
    const val=snap.val()||{};
    let key=null;
    Object.keys(val).forEach(k=>{if(key)return;const c=val[k]||{};if(cePhone(c.phone)===q||cePhone(k)===q)key=k;});
    if(!key){alert('No customer account found for this number.\nThe customer must have logged in on the website at least once.');return;}
    ceKey=key;ceCust=val[key]||{};
    ceLoadCartFromCust();
    document.getElementById('ceBody').style.display='block';
    ceRender();
  }catch(err){
    alert('⚠️ Could not open the account — '+err.message);
  }finally{btn.disabled=false;btn.textContent='Open Account';}
}
function ceLoadCartFromCust(){
  const raw=ceCust&&ceCust.cart;
  const arr=Array.isArray(raw)?raw:Object.keys(raw||{}).map(k=>raw[k]);
  ceCart=arr.filter(Boolean).map(i=>({...i,qty:Math.max(1,Number(i.qty)||1)}));
  ceSetDirty(false);
}
async function ceReload(){
  if(!ceKey)return;
  try{
    const s=await db.ref('customers/'+ceKey).once('value');
    ceCust=s.val()||{};ceLoadCartFromCust();ceRender();
  }catch(e){alert('⚠️ '+e.message);}
}
function ceCustOrders(){
  if(!ceCust)return [];
  const q=cePhone(ceCust.phone||ceKey);
  return orders.filter(o=>cePhone(o.customerPhone||(o.address&&o.address.phone))===q)
    .sort((a,b)=>(b.placedAt||b.updatedAt||0)-(a.placedAt||a.updatedAt||0));
}
function ceRender(){
  if(!ceCust)return;
  const c=ceCust;
  const addr=[c.address,c.landmark,c.district,c.state,c.pincode].filter(Boolean).join(', ')||'No address provided';
  document.getElementById('ceCustInfo').innerHTML=
    `<div style="font-size:18px;font-weight:800">${escH(c.name||'No name provided')}</div>
     <div class="small">📞 ${escH(c.phone||ceKey)} • Lifetime Orders: ${lifetimeOrderCount(c.phone)}</div>
     <div class="small" style="margin-top:4px">📍 ${escH(addr)}</div>`;
  ceRenderOrder();ceRenderCart();cePickRender();
}
function ceRenderOrder(){
  const list=ceCustOrders();
  const area=document.getElementById('ceOrderArea');
  if(!list.length){area.innerHTML='<div class="small">This customer has no previous order.</div>';return;}
  const prev=document.getElementById('ceOrderSel');
  const sel=prev?prev.value:'';
  const opts=list.map((o,i)=>{
    const k=o._key||o.id;
    const d=o.placedAt?new Date(o.placedAt).toLocaleDateString('en-IN'):'';
    return `<option value="${escH(k)}" ${(sel?sel===k:i===0)?'selected':''}>${i===0?'Last order — ':''}${escH(o.id||k)} • ${d} • ${escH(String(o.status||'PLACED').replaceAll('_',' '))}</option>`;
  }).join('');
  area.innerHTML=`<select id="ceOrderSel" onchange="ceRenderOrder()" style="width:100%;margin-bottom:10px">${opts}</select><div id="ceOrderItems"></div>`;
  const o=ceGetSelOrder();
  const items=((o&&o.items)||[]).filter(i=>!ceIsGift(i));
  const ceOrdVal=Number((o&&(o.total??o.totalAmount))||0);
  document.getElementById('ceOrderItems').innerHTML=`<div style="font-size:18px;font-weight:900;margin:0 0 6px">Order Value: ${ceRs(ceOrdVal)}</div>`+(items.length?items.map(i=>{
    const p=ceInv(i.id);
    return `<div class="ce-row" style="padding:8px 0"><div class="ce-info"><b>${escH(i.n||i.name||'')}</b><span class="small">× ${Number(i.qty)||1}${p?` • now ${ceRs(p.price)}`:''}</span>${p?'':'<div class="small" style="color:#c22">No longer in inventory — will be skipped</div>'}</div></div>`;
  }).join(''):'<div class="small">No items</div>')+
  `<button class="btn" style="margin-top:12px" onclick="ceLoadOrder()">📦 Add These Items To Cart</button>`;
}
function ceGetSelOrder(){
  const list=ceCustOrders();const sel=document.getElementById('ceOrderSel');
  return list.find(o=>(o._key||o.id)===(sel&&sel.value))||list[0];
}
function ceLoadOrder(){
  const o=ceGetSelOrder();if(!o)return;
  const skipped=[];let added=0;
  (o.items||[]).forEach(i=>{
    if(ceIsGift(i))return;
    const p=ceInv(i.id);
    if(!p){skipped.push(i.n||i.name||i.id);return;}
    const qty=Math.max(1,Number(i.qty)||1);
    const ex=ceCart.find(x=>x.id===i.id);
    if(ex)ex.qty=qty;else ceCart.push({id:p.id,n:p.title,p:Number(p.price),qty});
    added++;
  });
  ceSetDirty(true);ceRenderCart();
  if(skipped.length)alert('These items are no longer in inventory and were skipped:\n• '+skipped.join('\n• '));
  else if(!added)alert('Nothing to add.');
}
function ceRenderCart(){
  const box=document.getElementById('ceCartRows');
  let total=0;
  box.innerHTML=ceCart.length?ceCart.map((i,idx)=>{
    const gift=ceIsGift(i);
    const p=gift?null:ceInv(i.id);
    const price=gift?0:(p?Number(p.price):Number(i.p||i.price||0));
    const sub=price*i.qty;total+=sub;
    const src=gift?itemPhoto(i):ceThumb(p);
    const img=src?`<img src="${src}" alt="">`:'<div class="ce-noimg">📦</div>';
    const name=escH(i.n||i.name||(p&&p.title)||'');
    if(gift)return `<div class="ce-row">${img}<div class="ce-info"><b>${name}</b><span class="small">🎁 Free gift (managed automatically)</span></div><div class="ce-sub">FREE</div></div>`;
    return `<div class="ce-row">${img}
      <div class="ce-info"><b>${name}</b><span class="small">${ceRs(price)} each (latest)</span>${p?'':'<div class="small" style="color:#c22">Not in inventory any more</div>'}</div>
      <div class="ce-qty"><button type="button" onclick="ceQty(${idx},-1)">−</button><input type="number" min="1" max="99" value="${i.qty}" onchange="ceSetQty(${idx},this.value)"><button type="button" onclick="ceQty(${idx},1)">+</button></div>
      <div class="ce-sub">${ceRs(sub)}</div>
      <button class="danger" type="button" onclick="ceRemove(${idx})">✕</button></div>`;
  }).join(''):'';
  document.getElementById('ceTotal').textContent=ceRs(total);
  const _t=document.getElementById('ceTopTotal');if(_t)_t.textContent='Cart Value: '+ceRs(total);
}
function ceQty(idx,d){const i=ceCart[idx];if(!i)return;i.qty=Math.min(99,Math.max(1,i.qty+d));ceSetDirty(true);ceRenderCart();}
function ceSetQty(idx,v){const i=ceCart[idx];if(!i)return;i.qty=Math.min(99,Math.max(1,Math.floor(Number(v))||1));ceSetDirty(true);ceRenderCart();}
function ceRemove(idx){ceCart.splice(idx,1);ceSetDirty(true);ceRenderCart();}
function ceClear(){if(!ceCart.length)return;if(!confirm('Remove all items from this cart view? (Press Save to apply)'))return;ceCart=[];ceSetDirty(true);ceRenderCart();}
function cePickRender(){
  const box=document.getElementById('cePick');if(!box)return;
  const q=(document.getElementById('ceFind').value||'').trim().toLowerCase();
  const list=inventory.filter(p=>!q||String(p.title||'').toLowerCase().includes(q)).slice(0,60);
  box.innerHTML=list.length?list.map(p=>{
    const src=ceThumb(p);
    return `<div class="ce-p">${src?`<img src="${src}" alt="">`:'<div class="ce-noimg" style="width:100%;height:110px">📦</div>'}<b>${escH(p.title)}</b><span class="small">${ceRs(p.price)}</span><button class="btn" type="button" data-id="${escH(p.id)}" onclick="ceAdd(this.dataset.id)">＋ Add</button></div>`;
  }).join(''):'<div class="small">No product found</div>';
}
function ceAdd(id){
  const p=ceInv(id);if(!p)return;
  const ex=ceCart.find(x=>x.id===id);
  if(ex)ex.qty=Math.min(99,ex.qty+1);else ceCart.push({id:p.id,n:p.title,p:Number(p.price),qty:1});
  ceSetDirty(true);ceRenderCart();
}
async function ceSave(){
  if(!ceKey)return;
  const btn=document.getElementById('ceSaveBtn');
  let total=0;
  const items=ceCart.map(i=>{
    if(ceIsGift(i))return {id:i.id,n:i.n||i.name||'',p:0,qty:1};
    const p=ceInv(i.id);
    const price=p?Number(p.price):Number(i.p||i.price||0);
    const name=(p&&p.title)||i.n||i.name||'';
    total+=price*i.qty;
    return {id:i.id,n:name,p:price,qty:i.qty};
  });
  btn.disabled=true;btn.textContent='Saving...';
  try{
    const clean=JSON.parse(JSON.stringify(items));
    await db.ref('customers/'+ceKey).update({cart:clean,cartTotal:total,cartEditedAt:firebase.database.ServerValue.TIMESTAMP,cartEditedBy:'admin'});
    ceCart=clean;ceSetDirty(false);ceRenderCart();
    alert('✅ Cart saved to the customer\'s account.');
  }catch(err){
    alert('⚠️ Cart was NOT saved — Database error: '+err.message);
  }finally{btn.disabled=false;btn.textContent='💾 Save To Customer Account';}
}

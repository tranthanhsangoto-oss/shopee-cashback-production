/* Production Admin patch: real Supabase auth + persistent tier settings. */
(function(){
  const q=s=>document.querySelector(s);
  const internalEmail=username=>String(username||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')+'@users.shopee-cashback.example.com';

  function showAdminLogin(message=''){
    let overlay=q('#prodAdminAuth');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='prodAdminAuth';
      overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#f6f7fb;display:grid;place-items:center;padding:20px;font-family:Inter,system-ui,Arial';
      overlay.innerHTML=`<div style="width:min(100%,430px);background:#fff;border:1px solid #e8ebf1;border-radius:22px;padding:22px;box-shadow:0 18px 55px rgba(30,40,60,.14)">
        <div style="width:42px;height:42px;border-radius:13px;background:#ee4d2d;color:#fff;display:grid;place-items:center;font-weight:900">A</div>
        <h2 style="margin:14px 0 6px">Đăng nhập Admin</h2>
        <div style="font-size:13px;color:#747d8f;margin-bottom:14px">Chỉ tài khoản có quyền Admin mới truy cập được trang quản trị.</div>
        <label style="display:block;font-size:11px;font-weight:800;color:#747d8f;margin-bottom:5px">Tên đăng nhập</label>
        <input id="prodAdminUser" style="width:100%;padding:11px 12px;border:1px solid #e8ebf1;border-radius:11px" autocomplete="username">
        <label style="display:block;font-size:11px;font-weight:800;color:#747d8f;margin:10px 0 5px">Mật khẩu</label>
        <input id="prodAdminPass" type="password" style="width:100%;padding:11px 12px;border:1px solid #e8ebf1;border-radius:11px" autocomplete="current-password">
        <div id="prodAdminErr" style="min-height:18px;color:#b53131;font-size:12px;margin-top:8px"></div>
        <button id="prodAdminLoginBtn" style="width:100%;border:0;border-radius:12px;padding:12px;background:#ee4d2d;color:#fff;font-weight:850;cursor:pointer">Đăng nhập</button>
      </div>`;
      document.body.appendChild(overlay);
      q('#prodAdminLoginBtn').onclick=async()=>{
        const u=q('#prodAdminUser').value.trim();
        const p=q('#prodAdminPass').value;
        q('#prodAdminErr').textContent='';
        if(!u||!p){q('#prodAdminErr').textContent='Vui lòng nhập tên đăng nhập và mật khẩu.';return}
        const {error}=await prodSb.auth.signInWithPassword({email:internalEmail(u),password:p});
        if(error){q('#prodAdminErr').textContent='Tên đăng nhập hoặc mật khẩu không đúng.';return}
        const ok=await verifyAdmin();
        if(ok)location.reload();
        else q('#prodAdminErr').textContent='Tài khoản này không có quyền Admin.';
      };
    }
    const err=q('#prodAdminErr'); if(err&&message)err.textContent=message;
  }

  async function verifyAdmin(){
    try{
      const {data}=await prodSb.auth.getSession();
      const user=data?.session?.user;
      if(!user){showAdminLogin();return false}
      const {data:p,error}=await prodSb.from('profiles').select('id,username,display_name,role,is_locked').eq('id',user.id).maybeSingle();
      if(error||!p||p.role!=='admin'||p.is_locked){
        await prodSb.auth.signOut();
        showAdminLogin('Tài khoản này không có quyền Admin.');
        return false;
      }
      q('#prodAdminAuth')?.remove();
      if(typeof syncSupabaseAccounts==='function')await syncSupabaseAccounts();
      return true;
    }catch(e){
      showAdminLogin('Không thể kiểm tra quyền Admin.');
      return false;
    }
  }

  // Pending purchase intents are reconciliation helpers only, not real orders.
  try{
    if(typeof syncSupabaseAccounts==='function'){
      const originalSyncSupabaseAccounts=syncSupabaseAccounts;
      syncSupabaseAccounts=async function(){
        await originalSyncSupabaseAccounts();
        if(Array.isArray(state?.orders)){
          state.orders=state.orders.filter(o=>o?.source!=='intent' && !String(o?.id||'').startsWith('WAIT-'));
          save();
          if(typeof renderOrders==='function')renderOrders();
          if(typeof renderUserTracking==='function')renderUserTracking();
        }
      };
    }
  }catch(e){console.warn(e)}

  try{
    if(typeof saveSettings==='function'){
      saveSettings=async function(){
        const thresholds={
          bronze:Number(q('#tBronze')?.value||0), silver:Number(q('#tSilver')?.value||0),
          gold:Number(q('#tGold')?.value||0), platinum:Number(q('#tPlat')?.value||0), diamond:Number(q('#tDia')?.value||0)
        };
        const rates={
          bronze:Number(q('#rBronze')?.value||0), silver:Number(q('#rSilver')?.value||0),
          gold:Number(q('#rGold')?.value||0), platinum:Number(q('#rPlat')?.value||0), diamond:Number(q('#rDia')?.value||0)
        };
        if(!(thresholds.bronze<=thresholds.silver&&thresholds.silver<=thresholds.gold&&thresholds.gold<=thresholds.platinum&&thresholds.platinum<=thresholds.diamond)){
          alert('Mốc hạng phải tăng dần: Đồng ≤ Bạc ≤ Vàng ≤ Bạch Kim ≤ Kim Cương.'); return;
        }
        for(const key of ['bronze','silver','gold','platinum','diamond']){
          if(rates[key]<0||rates[key]>100){alert('Tỷ lệ cashback phải từ 0% đến 100%.');return}
        }
        const rows=['bronze','silver','gold','platinum','diamond'].map((key,i)=>({
          tier_key:key,
          display_name:{bronze:'Đồng',silver:'Bạc',gold:'Vàng',platinum:'Bạch Kim',diamond:'Kim Cương'}[key],
          min_confirmed_cashback:thresholds[key],
          cashback_rate:rates[key]/100,
          sort_order:i+1
        }));
        const {error}=await prodSb.from('cashback_tiers').upsert(rows,{onConflict:'tier_key'});
        if(error){alert('Không thể lưu hạng vào Supabase: '+error.message);return}
        state.settings.tierThresholds=thresholds;
        state.settings.tierRates=rates;
        state.settings.minWithdraw=Number(q('#minWd')?.value||50000);
        state.settings.maxWithdraw=Number(q('#maxWd')?.value||2000000);
        save(); render();
        alert('Đã lưu mốc hạng và tỷ lệ cashback vào hệ thống.');
      };
    }
  }catch(e){console.warn(e)}

  try{
    if(typeof editOrder==='function'){
      const legacyEditOrder=editOrder;
      editOrder=async function(id,k,v){
        const o=state.orders.find(x=>x.id===id);
        if(!o)return;
        legacyEditOrder(id,k,v);
        const changed=state.orders.find(x=>x.id===id);
        if(!changed)return;
        const normalized=changed.commissionStatus==='Đã xác nhận'?'confirmed':changed.commissionStatus==='Không hợp lệ'?'invalid':'pending';
        const patch={
          product_name:changed.product,
          order_value:Number(changed.orderValue||0),
          shopee_commission:Number(changed.commission||0),
          cashback_amount:normalized==='invalid'?0:Number(changed.cashback||0),
          order_status:changed.orderStatus,
          commission_status:changed.commissionStatus,
          normalized_status:normalized,
          updated_at:new Date().toISOString()
        };
        const {error}=await prodSb.from('orders').update(patch).eq('order_id',id);
        if(error){alert('Không thể lưu thay đổi đơn hàng: '+error.message);await syncSupabaseAccounts();}
      };
    }
  }catch(e){console.warn(e)}

  verifyAdmin();
  try{prodSb.auth.onAuthStateChange(()=>setTimeout(verifyAdmin,100));}catch(e){}
})();

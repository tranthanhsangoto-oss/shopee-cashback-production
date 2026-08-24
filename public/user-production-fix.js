/* Production User patch: real Supabase data, safe tracking, no fake orders. */
(function(){
  const q=s=>document.querySelector(s);
  const wdStatus=s=>({pending:'Đang chờ',paid:'Đã trả',rejected:'Từ chối'}[s]||s||'Đang chờ');
  const ticketStatus=s=>({pending:'Đang chờ',replied:'Đã phản hồi',closed:'Đã đóng'}[s]||s||'Đang chờ');

  async function currentProfile(){
    try{
      const {data}=await sb.auth.getSession();
      const user=data?.session?.user;
      if(!user)return null;
      const {data:profile,error}=await sb.from('profiles')
        .select('id,username,display_name,role,is_locked,tracking_code')
        .eq('id',user.id).maybeSingle();
      if(error)return null;
      return profile||null;
    }catch(e){console.warn('profile check failed',e);return null}
  }

  async function enforceUserOnly(){
    const profile=await currentProfile();
    if(!profile)return;
    if(profile.is_locked||profile.role==='admin'){
      await sb.auth.signOut();
      q('#appRoot')?.classList.add('hidden');
      q('#loginScreen')?.classList.remove('hidden');
      alert(profile.is_locked?'Tài khoản đang bị khóa. Vui lòng liên hệ admin.':'Tài khoản Admin vui lòng đăng nhập tại trang quản trị.');
    }
  }

  try{
    if(typeof setSignedInUser==='function'){
      const originalSetSignedInUser=setSignedInUser;
      setSignedInUser=async function(authUser){
        const user=await originalSetSignedInUser(authUser);
        if(user?.role==='admin'){
          await sb.auth.signOut();
          throw new Error('Tài khoản Admin vui lòng đăng nhập tại trang quản trị.');
        }
        return user;
      };
    }
  }catch(e){console.warn(e)}

  async function loadRemoteUserData(){
    if(!state?.user?.id)return;
    const uid=state.user.id;
    const [ordersRes,tiersRes,wdRes,ticketsRes,notifRes,settingsRes]=await Promise.all([
      sb.from('orders').select('order_id,user_id,sub_id,product_name,shop_name,order_value,shopee_commission,cashback_rate,cashback_amount,order_status,commission_status,normalized_status,ordered_at,source_imported_at,updated_at').eq('user_id',uid).order('updated_at',{ascending:false}),
      sb.from('cashback_tiers').select('*').order('sort_order'),
      sb.from('withdrawals').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
      sb.from('support_tickets').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
      sb.from('notifications').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(100),
      sb.from('system_settings').select('setting_key,setting_value').eq('setting_key','withdrawal_rules').maybeSingle()
    ]);

    if(!ordersRes.error){
      state.orders=(ordersRes.data||[]).map(o=>({
        id:o.order_id,userId:o.user_id,product:o.product_name||'Sản phẩm Shopee',shopName:o.shop_name||'',
        orderValue:Number(o.order_value||0),commission:Number(o.shopee_commission||0),
        cashbackRate:Number(o.cashback_rate||0),cashback:Number(o.cashback_amount||0),
        orderStatus:o.order_status||(o.normalized_status==='confirmed'?'Hoàn thành':o.normalized_status==='invalid'?'Không hợp lệ':'Đang xử lý'),
        commissionStatus:o.commission_status||(o.normalized_status==='confirmed'?'Đã xác nhận':o.normalized_status==='invalid'?'Không hợp lệ':'Đang chờ'),
        normalizedStatus:o.normalized_status||'pending',
        createdAt:o.ordered_at||o.source_imported_at||o.updated_at,source:'shopee',isIntent:false
      }));
    }

    if(!tiersRes.error&&tiersRes.data?.length){
      for(const row of tiersRes.data){
        const k=row.tier_key;
        if(!['bronze','silver','gold','platinum','diamond'].includes(k))continue;
        state.settings.tierThresholds[k]=Number(row.min_confirmed_cashback||0);
        state.settings.tierRates[k]=Math.round(Number(row.cashback_rate||0)*100);
      }
    }

    if(!settingsRes.error&&settingsRes.data?.setting_value){
      const v=settingsRes.data.setting_value;
      state.settings.minWithdraw=Number(v.min||50000);
      state.settings.maxWithdraw=Number(v.max||2000000);
    }

    if(!wdRes.error){
      state.withdrawals=(wdRes.data||[]).map(w=>({
        id:w.id,userId:w.user_id,amount:Number(w.amount||0),bank:w.bank_name,account:w.bank_account,holder:w.account_holder,
        status:wdStatus(w.status),rejectReason:w.reject_reason||'',createdAt:w.created_at,paidAt:w.paid_at,rejectedAt:w.rejected_at
      }));
    }

    if(!ticketsRes.error){
      state.tickets=(ticketsRes.data||[]).map(t=>({
        id:t.id,userId:t.user_id,userName:state.user.name,userEmail:'',category:t.category,title:t.title,message:t.message,
        status:ticketStatus(t.status),reply:t.admin_reply||'',createdAt:t.created_at,repliedAt:t.replied_at
      }));
    }

    if(!notifRes.error){
      state.notifications=(notifRes.data||[]).map(n=>({
        id:n.id,userId:n.user_id,title:n.title,message:n.message,read:!!n.read,createdAt:n.created_at
      }));
    }
    save();
  }

  try{loadProductionCommerceData=loadRemoteUserData}catch(e){}

  try{
    renderOrders=function(){
      const arr=(state.orders||[]).filter(o=>o.userId===state.user.id&&o.source==='shopee').slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
      q('#ordersList').innerHTML=arr.length?arr.map(o=>{
        const normalized=o.normalizedStatus||((o.commissionStatus||'').toLowerCase().includes('xác nhận')?'confirmed':(o.commissionStatus||'').toLowerCase().includes('không')?'invalid':'pending');
        const isPending=normalized==='pending';
        const isInvalid=normalized==='invalid';
        const cashText=isInvalid?'0đ':isPending?('Dự kiến +'+money(o.cashback)):('+'+money(o.cashback));
        const cashLabel=isInvalid?'Không được hoàn':isPending?'Cashback dự kiến':'Bạn nhận được';
        const note=isPending
          ? '<div class="tiny" style="margin-top:7px;color:#8a6618">Shopee đã ghi nhận đơn. Cashback hiện là dự kiến và chỉ được cộng vào số dư khi hoa hồng được Shopee xác nhận. Trạng thái sẽ cập nhật sau lần đối soát báo cáo tiếp theo.</div>'
          : (isInvalid?'<div class="tiny" style="margin-top:7px;color:var(--bad)">Shopee xác định đơn/hoa hồng không hợp lệ nên cashback là 0đ.</div>':'');
        return `<div class="order"><div class="thumb">🛍️</div><div><b>${esc(o.product)}</b><div class="muted">Mã đơn: ${esc(o.id)} · Giá trị: ${money(o.orderValue)}</div><div style="margin-top:5px"><span class="status ${statusClass(o.orderStatus)}">${esc(o.orderStatus||'Đang xử lý')}</span> <span class="status ${statusClass(o.commissionStatus)}">${esc(o.commissionStatus||'Đang chờ')}</span></div>${note}</div><div class="amount"><div class="tiny" style="margin-bottom:4px">${cashLabel}</div><div style="color:${isInvalid?'var(--bad)':isPending?'var(--warn)':'var(--ok)'}">${cashText}</div></div></div>`;
      }).join(''):'<p class="muted">Chưa có đơn hàng nào được Shopee ghi nhận. Việc bấm mở Shopee không được tính là một đơn hàng.</p>';
    };
  }catch(e){console.warn(e)}

  try{
    requestWithdraw=async function(){
      const b=balances(),amt=Number(q('#wdAmount').value||0);
      const bank=q('#wdBank').value.trim(),account=q('#wdAccount').value.trim(),holder=q('#wdHolder').value.trim();
      if(amt<state.settings.minWithdraw)return alert('Số tiền rút tối thiểu là '+money(state.settings.minWithdraw)+'.');
      if(amt>state.settings.maxWithdraw)return alert('Mỗi lần chỉ có thể rút tối đa '+money(state.settings.maxWithdraw)+'.');
      if(amt>b.available)return alert('Số tiền rút vượt quá số dư khả dụng.');
      if(!bank||!account||!holder)return alert('Vui lòng nhập đầy đủ thông tin tài khoản nhận tiền.');
      const {error}=await sb.from('withdrawals').insert({user_id:state.user.id,amount:amt,bank_name:bank,bank_account:account,account_holder:holder,status:'pending'});
      if(error)return alert('Không thể gửi yêu cầu rút: '+error.message);
      if(!state.savedBankInfo)state.savedBankInfo={};
      state.savedBankInfo[state.user.id]={bank,account,holder}; save();
      q('#wdAmount').value='';
      await loadRemoteUserData(); render();
      alert('Đã gửi yêu cầu rút tiền.');
    };
  }catch(e){console.warn(e)}

  try{
    sendTicket=async function(){
      const title=q('#tkTitle').value.trim(),message=q('#tkMsg').value.trim();
      if(!title||!message)return alert('Nhập tiêu đề và nội dung.');
      const {error}=await sb.from('support_tickets').insert({user_id:state.user.id,category:q('#tkCat').value,title,message,status:'pending'});
      if(error)return alert('Không thể gửi support ticket: '+error.message);
      q('#tkTitle').value='';q('#tkMsg').value='';
      await loadRemoteUserData();render();alert('Đã gửi support ticket.');
    };
  }catch(e){console.warn(e)}

  try{
    const originalToggleNotif=toggleNotif;
    toggleNotif=async function(){
      originalToggleNotif();
      const unread=(state.notifications||[]).filter(n=>n.userId===state.user.id&&!n.read).map(n=>n.id);
      if(unread.length){
        await sb.from('notifications').update({read:true}).in('id',unread);
        (state.notifications||[]).forEach(n=>{if(unread.includes(n.id))n.read=true}); save(); renderNotif();
      }
    };
  }catch(e){console.warn(e)}

  // Keep purchase intents only as private reconciliation helpers; never show them as orders.
  try{
    if(typeof createPendingPurchaseIntent==='function'){
      const originalCreatePendingPurchaseIntent=createPendingPurchaseIntent;
      createPendingPurchaseIntent=async function(data){
        if(!state?.user?.id)return originalCreatePendingPurchaseIntent(data);
        const since=new Date(Date.now()-15000).toISOString();
        const {data:existing}=await sb.from('purchase_intents').select('*')
          .eq('user_id',state.user.id).eq('status','awaiting_reconciliation').eq('clean_url',data.cleanUrl||'')
          .gte('created_at',since).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(existing)return existing;
        return originalCreatePendingPurchaseIntent(data);
      };
    }
  }catch(e){console.warn(e)}

  let inputTimer=null;
  const linkInput=q('#shopLink');
  if(linkInput){
    linkInput.addEventListener('input',()=>{
      clearTimeout(inputTimer);
      inputTimer=setTimeout(()=>{try{if(typeof trackPastedShopeeLink==='function')trackPastedShopeeLink()}catch(e){}},900);
    });
  }

  async function refreshVisible(){
    if(document.hidden||!state?.user?.id)return;
    try{await loadRemoteUserData();render()}catch(e){console.warn('refresh failed',e)}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshVisible()});
  setInterval(refreshVisible,60000);
  setTimeout(enforceUserOnly,250);
  try{sb.auth.onAuthStateChange(()=>setTimeout(enforceUserOnly,150));}catch(e){}
})();

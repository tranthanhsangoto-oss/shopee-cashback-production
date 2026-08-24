/* Production Admin patch: auth, real Supabase persistence, Shopee reconciliation. */
(function(){
  const q=s=>document.querySelector(s);
  const internalEmail=username=>String(username||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')+'@users.shopee-cashback.example.com';
  const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_\-]+/g,' ').replace(/\s+/g,' ');
  const sub=v=>String(v||'').trim().replace(/-+$/,'');
  const pick=(row,names)=>{const e=Object.entries(row||{});for(const n of names){const f=e.find(([k])=>norm(k)===norm(n));if(f)return f[1]}for(const n of names){const f=e.find(([k])=>norm(k).includes(norm(n)));if(f)return f[1]}return ''};
  const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;const s=String(v??'').replace(/[^0-9,.-]/g,'').trim();if(!s)return 0;if(/^\d{1,3}([.,]\d{3})+$/.test(s))return Number(s.replace(/[.,]/g,''));return Number(s.replace(/,/g,''))||0};
  const invalid=s=>{const n=norm(s);return ['khong hop le','invalid','huy','cancel','refund','return','hoan tien','tra hang'].some(x=>n.includes(x))};
  const confirmed=s=>{const n=norm(s);return ['da xac nhan','confirmed','approved','validated','hoan thanh','thanh cong'].some(x=>n.includes(x))};
  const wdStatus=s=>({pending:'Đang chờ',paid:'Đã trả',rejected:'Từ chối'}[s]||s||'Đang chờ');
  const ticketStatus=s=>({pending:'Đang chờ',replied:'Đã phản hồi',closed:'Đã đóng'}[s]||s||'Đang chờ');

  function showAdminLogin(message=''){
    let overlay=q('#prodAdminAuth');
    if(!overlay){
      overlay=document.createElement('div');overlay.id='prodAdminAuth';
      overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#f6f7fb;display:grid;place-items:center;padding:20px;font-family:Inter,system-ui,Arial';
      overlay.innerHTML=`<div style="width:min(100%,430px);background:#fff;border:1px solid #e8ebf1;border-radius:22px;padding:22px;box-shadow:0 18px 55px rgba(30,40,60,.14)"><div style="width:42px;height:42px;border-radius:13px;background:#ee4d2d;color:#fff;display:grid;place-items:center;font-weight:900">A</div><h2 style="margin:14px 0 6px">Đăng nhập Admin</h2><div style="font-size:13px;color:#747d8f;margin-bottom:14px">Chỉ tài khoản có quyền Admin mới truy cập được trang quản trị.</div><label style="display:block;font-size:11px;font-weight:800;color:#747d8f;margin-bottom:5px">Tên đăng nhập</label><input id="prodAdminUser" style="width:100%;padding:11px 12px;border:1px solid #e8ebf1;border-radius:11px" autocomplete="username"><label style="display:block;font-size:11px;font-weight:800;color:#747d8f;margin:10px 0 5px">Mật khẩu</label><input id="prodAdminPass" type="password" style="width:100%;padding:11px 12px;border:1px solid #e8ebf1;border-radius:11px" autocomplete="current-password"><div id="prodAdminErr" style="min-height:18px;color:#b53131;font-size:12px;margin-top:8px"></div><button id="prodAdminLoginBtn" style="width:100%;border:0;border-radius:12px;padding:12px;background:#ee4d2d;color:#fff;font-weight:850;cursor:pointer">Đăng nhập</button></div>`;
      document.body.appendChild(overlay);
      q('#prodAdminLoginBtn').onclick=async()=>{const u=q('#prodAdminUser').value.trim(),p=q('#prodAdminPass').value;q('#prodAdminErr').textContent='';if(!u||!p){q('#prodAdminErr').textContent='Vui lòng nhập tên đăng nhập và mật khẩu.';return}const {error}=await prodSb.auth.signInWithPassword({email:internalEmail(u),password:p});if(error){q('#prodAdminErr').textContent='Tên đăng nhập hoặc mật khẩu không đúng.';return}const ok=await verifyAdmin();if(ok)location.reload();else q('#prodAdminErr').textContent='Tài khoản này không có quyền Admin.'};
    }
    if(message&&q('#prodAdminErr'))q('#prodAdminErr').textContent=message;
  }

  async function verifyAdmin(){
    try{
      const {data}=await prodSb.auth.getSession();const user=data?.session?.user;
      if(!user){showAdminLogin();return false}
      const {data:p,error}=await prodSb.from('profiles').select('id,username,display_name,role,is_locked').eq('id',user.id).maybeSingle();
      if(error||!p||p.role!=='admin'||p.is_locked){await prodSb.auth.signOut();showAdminLogin('Tài khoản này không có quyền Admin.');return false}
      q('#prodAdminAuth')?.remove();if(typeof syncSupabaseAccounts==='function')await syncSupabaseAccounts();return true;
    }catch(e){showAdminLogin('Không thể kiểm tra quyền Admin.');return false}
  }

  const oldSync=typeof syncSupabaseAccounts==='function'?syncSupabaseAccounts:null;
  syncSupabaseAccounts=async function(){
    if(oldSync)await oldSync();
    const [profilesRes,ordersRes,eventsRes,wdRes,ticketsRes,notifRes,tiersRes,settingsRes]=await Promise.all([
      prodSb.from('profiles').select('id,username,display_name,role,is_locked,tracking_code,created_at').order('created_at',{ascending:false}),
      prodSb.from('orders').select('*').order('updated_at',{ascending:false}).limit(2000),
      prodSb.from('tracking_events').select('*').order('created_at',{ascending:false}).limit(1000),
      prodSb.from('withdrawals').select('*').order('created_at',{ascending:false}).limit(1000),
      prodSb.from('support_tickets').select('*').order('created_at',{ascending:false}).limit(1000),
      prodSb.from('notifications').select('*').order('created_at',{ascending:false}).limit(1000),
      prodSb.from('cashback_tiers').select('*').order('sort_order'),
      prodSb.from('system_settings').select('setting_key,setting_value').eq('setting_key','withdrawal_rules').maybeSingle()
    ]);
    if(profilesRes.error)throw profilesRes.error;
    const profiles=profilesRes.data||[];
    state.accounts=profiles.map(p=>({id:p.tracking_code||p.id,supabaseId:p.id,trackingCode:p.tracking_code||'',name:p.display_name||p.username,username:p.username||'',email:'',authType:'local',status:p.is_locked?'locked':'active',role:p.role||'user',createdAt:p.created_at}));
    const pById=new Map(profiles.map(p=>[p.id,p]));
    if(!ordersRes.error)state.orders=(ordersRes.data||[]).map(o=>{const p=pById.get(o.user_id);return{id:o.order_id,userId:p?.tracking_code||o.user_id,supabaseUserId:o.user_id,product:o.product_name||'Sản phẩm Shopee',orderValue:Number(o.order_value||0),commission:Number(o.shopee_commission||0),cashback:Number(o.cashback_amount||0),cashbackRate:Number(o.cashback_rate||0),orderStatus:o.order_status||(o.normalized_status==='confirmed'?'Hoàn thành':o.normalized_status==='invalid'?'Không hợp lệ':'Đang xử lý'),commissionStatus:o.commission_status||(o.normalized_status==='confirmed'?'Đã xác nhận':o.normalized_status==='invalid'?'Không hợp lệ':'Đang chờ'),normalizedStatus:o.normalized_status||'pending',createdAt:o.ordered_at||o.source_imported_at||o.updated_at,source:'shopee'}});
    if(!eventsRes.error)state.clicks=(eventsRes.data||[]).map(e=>{const p=pById.get(e.user_id);return{id:e.id,userId:p?.tracking_code||e.user_id,supabaseUserId:e.user_id,type:e.event_type,originalUrl:e.original_url||'',cleanUrl:e.clean_url||'',affiliateUrl:e.affiliate_url||'',createdAt:e.created_at}});
    if(!wdRes.error)state.withdrawals=(wdRes.data||[]).map(w=>{const p=pById.get(w.user_id);return{id:w.id,userId:p?.tracking_code||w.user_id,supabaseUserId:w.user_id,amount:Number(w.amount||0),bank:w.bank_name,account:w.bank_account,holder:w.account_holder,status:wdStatus(w.status),rejectReason:w.reject_reason||'',createdAt:w.created_at,paidAt:w.paid_at,rejectedAt:w.rejected_at}});
    if(!ticketsRes.error)state.tickets=(ticketsRes.data||[]).map(t=>{const p=pById.get(t.user_id);return{id:t.id,userId:p?.tracking_code||t.user_id,supabaseUserId:t.user_id,userName:p?.display_name||p?.username||'User',userEmail:'',category:t.category,title:t.title,message:t.message,status:ticketStatus(t.status),reply:t.admin_reply||'',createdAt:t.created_at,repliedAt:t.replied_at}});
    if(!notifRes.error)state.notifications=(notifRes.data||[]).map(n=>{const p=pById.get(n.user_id);return{id:n.id,userId:p?.tracking_code||n.user_id,supabaseUserId:n.user_id,title:n.title,message:n.message,read:!!n.read,createdAt:n.created_at}});
    if(!tiersRes.error&&tiersRes.data?.length){for(const r of tiersRes.data){if(state.settings.tierThresholds[r.tier_key]!==undefined){state.settings.tierThresholds[r.tier_key]=Number(r.min_confirmed_cashback||0);state.settings.tierRates[r.tier_key]=Math.round(Number(r.cashback_rate||0)*100)}}}
    if(!settingsRes.error&&settingsRes.data?.setting_value){state.settings.minWithdraw=Number(settingsRes.data.setting_value.min||50000);state.settings.maxWithdraw=Number(settingsRes.data.setting_value.max||2000000)}
    save();render();if(q('#syncText'))q('#syncText').textContent='Supabase · '+new Date().toLocaleTimeString('vi-VN');
  };

  saveSettings=async function(){
    const thresholds={bronze:Number(q('#tBronze')?.value||0),silver:Number(q('#tSilver')?.value||0),gold:Number(q('#tGold')?.value||0),platinum:Number(q('#tPlat')?.value||0),diamond:Number(q('#tDia')?.value||0)};
    const rates={bronze:Number(q('#rBronze')?.value||0),silver:Number(q('#rSilver')?.value||0),gold:Number(q('#rGold')?.value||0),platinum:Number(q('#rPlat')?.value||0),diamond:Number(q('#rDia')?.value||0)};
    if(!(thresholds.bronze<=thresholds.silver&&thresholds.silver<=thresholds.gold&&thresholds.gold<=thresholds.platinum&&thresholds.platinum<=thresholds.diamond))return alert('Mốc hạng phải tăng dần.');
    if(Object.values(rates).some(x=>x<0||x>100))return alert('Tỷ lệ cashback phải từ 0% đến 100%.');
    const rows=['bronze','silver','gold','platinum','diamond'].map((key,i)=>({tier_key:key,display_name:{bronze:'Đồng',silver:'Bạc',gold:'Vàng',platinum:'Bạch Kim',diamond:'Kim Cương'}[key],min_confirmed_cashback:thresholds[key],cashback_rate:rates[key]/100,sort_order:i+1}));
    const min=Number(q('#minWd')?.value||50000),max=Number(q('#maxWd')?.value||2000000);
    const [tierRes,setRes]=await Promise.all([prodSb.from('cashback_tiers').upsert(rows,{onConflict:'tier_key'}),prodSb.from('system_settings').upsert({setting_key:'withdrawal_rules',setting_value:{min,max}},{onConflict:'setting_key'})]);
    if(tierRes.error||setRes.error)return alert('Không thể lưu cài đặt: '+(tierRes.error?.message||setRes.error?.message));
    state.settings.tierThresholds=thresholds;state.settings.tierRates=rates;state.settings.minWithdraw=min;state.settings.maxWithdraw=max;save();render();alert('Đã lưu quy tắc vào Supabase.');
  };

  // Shopee-imported orders are source-of-truth records. Do not manually falsify their status/commission.
  editOrder=async function(id,k,v){
    const o=state.orders.find(x=>String(x.id)===String(id));if(!o)return;
    if(['orderStatus','commissionStatus','commission','orderValue'].includes(k))return alert('Trường này lấy từ báo cáo Shopee. Hãy import báo cáo mới để cập nhật trạng thái thực tế.');
    if(k==='product'){const {error}=await prodSb.from('orders').update({product_name:v,updated_at:new Date().toISOString()}).eq('order_id',id);if(error)return alert(error.message);o.product=v;save();render()}
  };
  delOrder=function(){alert('Không xóa đơn Shopee khỏi lịch sử đối soát. Nếu đơn không hợp lệ, trạng thái sẽ được cập nhật từ báo cáo Shopee.')};

  async function pushNotification(userUuid,title,message){if(!userUuid)return;const {error}=await prodSb.from('notifications').insert({user_id:userUuid,title,message,read:false});if(error)console.warn('notification',error)}

  payWd=async function(id){const w=state.withdrawals.find(x=>String(x.id)===String(id));if(!w||w.status!=='Đang chờ')return;const {error}=await prodSb.from('withdrawals').update({status:'paid',paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(error)return alert(error.message);await pushNotification(w.supabaseUserId,'Rút tiền thành công','Admin đã chuyển '+money(w.amount)+' vào tài khoản '+w.bank+' • '+w.account+'.');await syncSupabaseAccounts();showToast('Đã đánh dấu chuyển khoản thành công.')};
  confirmRejectWithdraw=async function(){if(!pendingRejectWithdrawId)return;const w=state.withdrawals.find(x=>String(x.id)===String(pendingRejectWithdrawId));if(!w||w.status!=='Đang chờ')return closeWithdrawRejectModal();const reason=q('#withdrawRejectReason').value.trim();const {error}=await prodSb.from('withdrawals').update({status:'rejected',reject_reason:reason||null,rejected_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',w.id);if(error)return alert(error.message);await pushNotification(w.supabaseUserId,'Yêu cầu rút tiền bị từ chối',reason?'Yêu cầu rút '+money(w.amount)+' bị từ chối. Lý do: '+reason:'Yêu cầu rút '+money(w.amount)+' bị từ chối. Số tiền đã được trả lại số dư khả dụng.');closeWithdrawRejectModal();await syncSupabaseAccounts();showToast('Đã từ chối yêu cầu rút tiền.')};

  replyTicket=async function(id){const t=state.tickets.find(x=>String(x.id)===String(id)),v=q('#rp_'+id)?.value.trim();if(!t||!v)return;const {error}=await prodSb.from('support_tickets').update({admin_reply:v,status:'replied',replied_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id);if(error)return alert(error.message);await pushNotification(t.supabaseUserId,'Support đã phản hồi','Admin đã phản hồi ticket "'+t.title+'".');await syncSupabaseAccounts()};

  notify=function(title,message,userId=state.user.id){const ac=(state.accounts||[]).find(a=>a.id===userId||a.supabaseId===userId);if(ac?.supabaseId)pushNotification(ac.supabaseId,title,message)};
  sendNotif=async function(){const t=q('#nTitle').value.trim(),m=q('#nMsg').value.trim();if(!t||!m)return alert('Nhập tiêu đề và nội dung.');const ac=(state.accounts||[]).find(a=>a.id===state.user.id||a.supabaseId===state.user.id);if(!ac?.supabaseId)return alert('Chưa chọn được user nhận thông báo.');await pushNotification(ac.supabaseId,t,m);q('#nTitle').value='';q('#nMsg').value='';await syncSupabaseAccounts();alert('Đã gửi thông báo.')};

  function commissionFromRow(row){
    const total=pick(row,['Tổng hoa hồng','Tổng tiền hoa hồng','Total Commission','Commission Total','Hoa hồng']);
    if(String(total).trim()!=='')return {value:Math.max(0,num(total)),method:'total'};
    const parts=[pick(row,['Hoa hồng sản phẩm','Product Commission']),pick(row,['Hoa hồng đơn hàng','Order Commission']),pick(row,['Hoa hồng Xtra','Xtra Commission','Hoa hồng thêm'])].filter(v=>String(v).trim()!=='');
    return {value:Math.max(0,parts.reduce((s,v)=>s+num(v),0)),method:parts.length?'components':'none'};
  }
  function parseDate(v){if(!v)return null;if(v instanceof Date&&!isNaN(v))return v.toISOString();if(typeof v==='number'&&window.XLSX?.SSF){const d=XLSX.SSF.parse_date_code(v);if(d)return new Date(Date.UTC(d.y,d.m-1,d.d,d.H||0,d.M||0,d.S||0)).toISOString()}const d=new Date(v);return isNaN(d)?null:d.toISOString()}
  async function cashbackRateFor(profile,existing){if(existing?.cashback_rate!=null)return Number(existing.cashback_rate);try{const {data}=await prodSb.rpc('confirmed_cashback_for_user',{target_user:profile.id});const total=Number(data||0),t=state.settings.tierThresholds,r=state.settings.tierRates;if(total>=t.diamond)return r.diamond/100;if(total>=t.platinum)return r.platinum/100;if(total>=t.gold)return r.gold/100;if(total>=t.silver)return r.silver/100;return r.bronze/100}catch(e){return Number(state.settings.tierRates.bronze||60)/100}}

  importShopeeReport=async function(){
    const input=q('#shopeeReportFile'),box=q('#shopeeImportResult');if(!input?.files?.[0])return alert('Vui lòng chọn file Báo cáo chuyển đổi Shopee.');box.textContent='Đang đọc và đối soát báo cáo...';
    try{
      await syncSupabaseAccounts();
      const {data:profiles,error:pErr}=await prodSb.from('profiles').select('id,username,display_name,tracking_code');if(pErr)throw pErr;
      const buf=await input.files[0].arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});if(!rows.length)throw new Error('File không có dữ liệu.');
      let updated=0,unmatched=0,skipped=0,newOrders=0,statusChanges=0,commissionMethod='';
      for(const raw of rows){
        const orderId=String(pick(raw,['Order ID','Mã đơn hàng','ID đơn hàng','Order No','Order Number'])||'').trim();const subId=sub(pick(raw,['Sub_id','Sub id','Sub ID','sub_id','SubID']));if(!orderId){skipped++;continue}
        const p=(profiles||[]).find(x=>sub(x.tracking_code)===subId||sub(x.username)===subId);if(!p){unmatched++;continue}
        const product=String(pick(raw,['Tên sản phẩm','Thông tin sản phẩm','Product Name','Product'])||'').trim();const shop=String(pick(raw,['Tên Shop','Shop Name','Tên cửa hàng'])||'').trim();const orderValue=num(pick(raw,['Giá trị đơn hàng','Order Value','Giá trị đơn','GMV']));
        const c=commissionFromRow(raw);commissionMethod=commissionMethod||c.method;const commission=c.value;
        const orderStatus=String(pick(raw,['Trạng thái đơn hàng','Order Status','Trạng thái đơn'])||'').trim();const commissionStatus=String(pick(raw,['Trạng thái hoa hồng','Commission Status','Trạng thái ghi nhận','Commission Validation Status'])||'').trim();
        const statusText=(commissionStatus+' '+orderStatus).trim();const normalized=invalid(statusText)?'invalid':confirmed(commissionStatus)?'confirmed':'pending';
        const orderedAt=parseDate(pick(raw,['Thời gian đặt hàng','Ngày đặt hàng','Order Time','Order Date','Created Time']));
        const {data:existing}=await prodSb.from('orders').select('*').eq('order_id',orderId).maybeSingle();const rate=await cashbackRateFor(p,existing);const cashback=normalized==='invalid'?0:Math.round(commission*rate);
        const payload={order_id:orderId,user_id:p.id,sub_id:subId,product_name:product||existing?.product_name||'Sản phẩm Shopee',shop_name:shop||existing?.shop_name||'',order_value:orderValue,shopee_commission:commission,cashback_rate:rate,cashback_amount:cashback,order_status:orderStatus||existing?.order_status||'',commission_status:commissionStatus||existing?.commission_status||'',normalized_status:normalized,ordered_at:orderedAt||existing?.ordered_at||null,source_imported_at:new Date().toISOString(),updated_at:new Date().toISOString()};
        const {error:oErr}=await prodSb.from('orders').upsert(payload,{onConflict:'order_id'});if(oErr)throw oErr;
        if(!existing){newOrders++;await pushNotification(p.id,'Shopee đã ghi nhận đơn hàng','Đơn '+orderId+' đã xuất hiện trong báo cáo Shopee. Cashback dự kiến: '+money(cashback)+'.');const {data:intent}=await prodSb.from('purchase_intents').select('id').eq('user_id',p.id).eq('status','awaiting_reconciliation').order('created_at',{ascending:true}).limit(1).maybeSingle();if(intent?.id)await prodSb.from('purchase_intents').update({status:'reconciled',matched_order_id:orderId,reconciled_at:new Date().toISOString()}).eq('id',intent.id)}
        else if(existing.normalized_status!==normalized||String(existing.order_status||'')!==orderStatus||String(existing.commission_status||'')!==commissionStatus){statusChanges++;if(normalized==='confirmed')await pushNotification(p.id,'Cashback đã được xác nhận','Đơn '+orderId+' đã được Shopee xác nhận. Bạn nhận '+money(cashback)+' cashback.');else if(normalized==='invalid')await pushNotification(p.id,'Đơn không đủ điều kiện cashback','Đơn '+orderId+' được Shopee cập nhật không hợp lệ. Cashback: 0đ.');else await pushNotification(p.id,'Shopee cập nhật trạng thái đơn','Đơn '+orderId+' hiện: '+(orderStatus||'Đang xử lý')+' · '+(commissionStatus||'Hoa hồng đang chờ')+'.')}
        updated++;
      }
      await syncSupabaseAccounts();
      box.innerHTML='Đã đọc <b>'+rows.length+'</b> dòng · đối soát <b>'+updated+'</b> đơn · đơn mới <b>'+newOrders+'</b> · thay đổi trạng thái <b>'+statusChanges+'</b> · không khớp Sub ID <b>'+unmatched+'</b> · bỏ qua <b>'+skipped+'</b>.<br><span class="tiny">Hoa hồng: '+(commissionMethod==='total'?'ưu tiên cột tổng hoa hồng':commissionMethod==='components'?'tính từ các cột thành phần vì chưa thấy cột tổng':'không tìm thấy cột hoa hồng')+'. Cùng Order ID luôn được cập nhật, không cộng trùng.</span>';
    }catch(e){console.error(e);box.textContent='Import lỗi: '+(e.message||e)}
  };

  verifyAdmin();
  try{prodSb.auth.onAuthStateChange(()=>setTimeout(verifyAdmin,100));}catch(e){}
})();

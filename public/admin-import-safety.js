/* Strict Shopee import safety layer.
   Never guesses payable commission. Unknown/ambiguous rows stay pending with 0 payable cashback. */
(function(){
  const q=s=>document.querySelector(s);
  const norm=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_\-]+/g,' ').replace(/\s+/g,' ');
  const sub=v=>String(v??'').trim().replace(/-+$/,'');
  const entries=row=>Object.entries(row||{});
  const exactPick=(row,names)=>{for(const n of names){const f=entries(row).find(([k])=>norm(k)===norm(n));if(f)return {found:true,value:f[1],header:f[0]}}return {found:false,value:'',header:''}};
  const pick=(row,names)=>{const x=exactPick(row,names);if(x.found)return x;for(const n of names){const f=entries(row).find(([k])=>norm(k).includes(norm(n)));if(f)return {found:true,value:f[1],header:f[0]}}return {found:false,value:'',header:''}};
  const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;let s=String(v??'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;if(/^\d{1,3}([.,]\d{3})+$/.test(s))return Number(s.replace(/[.,]/g,''));return Number(s.replace(/,/g,''))||0};
  const invalid=s=>{const n=norm(s);return ['khong hop le','invalid','huy','cancel','refund','return','hoan tien','tra hang','fraud','gian lan'].some(x=>n.includes(x))};
  const confirmed=s=>{const n=norm(s);return ['da xac nhan','confirmed','approved','validated'].some(x=>n.includes(x))};
  const parseDate=v=>{if(!v)return null;const d=new Date(v);return isNaN(d)?null:d.toISOString()};

  function authoritativeCommission(row){
    // Prefer Shopee's net affiliate commission because that is the amount actually earned by the affiliate.
    let x=exactPick(row,[
      'Hoa hồng ròng tiếp thị liên kết (₫)','Hoa hồng ròng tiếp thị liên kết','Hoa hong rong tiep thi lien ket',
      'Net Affiliate Commission','Net affiliate commission (₫)','Net Commission'
    ]);
    if(x.found)return {known:true,value:Math.max(0,num(x.value)),header:x.header,method:'net_affiliate'};

    // Accept an explicitly named TOTAL only. Never sum product/order/XTRA columns automatically.
    x=exactPick(row,['Tổng hoa hồng','Tổng tiền hoa hồng','Total Commission','Commission Total']);
    if(x.found)return {known:true,value:Math.max(0,num(x.value)),header:x.header,method:'explicit_total'};
    return {known:false,value:0,header:'',method:'unknown'};
  }

  async function tierRateFor(profile,existing){
    if(existing?.cashback_rate!=null)return Number(existing.cashback_rate);
    try{
      const {data,error}=await prodSb.rpc('confirmed_cashback_for_user',{target_user:profile.id});
      if(error)throw error;
      const total=Number(data||0),t=state.settings.tierThresholds,r=state.settings.tierRates;
      if(total>=t.diamond)return Number(r.diamond||0)/100;
      if(total>=t.platinum)return Number(r.platinum||0)/100;
      if(total>=t.gold)return Number(r.gold||0)/100;
      if(total>=t.silver)return Number(r.silver||0)/100;
      return Number(r.bronze||60)/100;
    }catch(e){return Number(state.settings.tierRates.bronze||60)/100}
  }

  async function safeNotify(uid,title,message){
    try{await prodSb.from('notifications').insert({user_id:uid,title,message,read:false})}catch(e){}
  }

  importShopeeReport=async function(){
    const input=q('#shopeeReportFile'),box=q('#shopeeImportResult');
    if(!input?.files?.[0])return alert('Vui lòng chọn file Báo cáo chuyển đổi Shopee.');
    box.textContent='Đang kiểm tra báo cáo theo chế độ an toàn...';
    try{
      await syncSupabaseAccounts();
      const {data:profiles,error:pErr}=await prodSb.from('profiles').select('id,username,display_name,tracking_code');
      if(pErr)throw pErr;
      const buf=await input.files[0].arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      if(!rows.length)throw new Error('File không có dữ liệu.');

      const prepared=[];
      for(const raw of rows){
        const order=pick(raw,['Order ID','Order id','Mã đơn hàng','ID đơn hàng']);
        const orderId=String(order.value||'').trim();
        if(orderId)prepared.push({raw,orderId});
      }
      const counts=new Map();prepared.forEach(x=>counts.set(x.orderId,(counts.get(x.orderId)||0)+1));
      const duplicateIds=new Set([...counts].filter(([,c])=>c>1).map(([id])=>id));

      let updated=0,newOrders=0,statusChanges=0,unmatched=0,skipped=0,ambiguous=0,missingCommission=0;
      for(const {raw,orderId} of prepared){
        if(duplicateIds.has(orderId)){ambiguous++;continue}
        const subCell=pick(raw,['Sub_id','Sub id','Sub ID','sub_id']);
        const subId=sub(subCell.value);
        const p=(profiles||[]).find(x=>sub(x.tracking_code)===subId || sub(x.username)===subId);
        if(!p){unmatched++;continue}

        const product=String(pick(raw,['Tên sản phẩm','Thông tin sản phẩm','Product Name','Product']).value||'').trim();
        const shop=String(pick(raw,['Tên Shop','Tên shop','Shop Name','Shop']).value||'').trim();
        const orderValue=num(pick(raw,['Giá trị mua (₫)','Giá trị mua','Giá trị đơn hàng','Order Value','Purchase Value']).value);
        const orderStatus=String(pick(raw,['Trạng thái đơn hàng','Order Status','Trạng thái đơn']).value||'').trim();
        const commissionStatus=String(pick(raw,['Trạng thái hoa hồng','Commission Status','Trạng thái ghi nhận','Commission Validation Status']).value||'').trim();
        const commission=authoritativeCommission(raw);
        const orderedAt=parseDate(pick(raw,['Thời Gian Đặt Hàng','Thời gian đặt hàng','Order Time','Purchase Time','Order Date']).value);
        const {data:existing,error:eErr}=await prodSb.from('orders').select('*').eq('order_id',orderId).maybeSingle();
        if(eErr)throw eErr;

        const sourceInvalid=invalid(orderStatus+' '+commissionStatus);
        let normalized='pending';
        if(sourceInvalid)normalized='invalid';
        else if(commission.known&&confirmed(commissionStatus))normalized='confirmed';
        // If Shopee says confirmed but the authoritative commission column is unknown,
        // keep normalized=pending to prevent an accidental payout.

        const rate=await tierRateFor(p,existing);
        const commissionValue=commission.known?commission.value:Number(existing?.shopee_commission||0);
        const cashback=normalized==='invalid'?0:(commission.known?Math.round(commissionValue*rate):Number(existing?.cashback_amount||0));
        if(!commission.known)missingCommission++;

        const payload={
          order_id:orderId,user_id:p.id,sub_id:subId,
          product_name:product||existing?.product_name||'Sản phẩm Shopee',
          shop_name:shop||existing?.shop_name||'',
          order_value:orderValue||Number(existing?.order_value||0),
          shopee_commission:commissionValue,
          cashback_rate:rate,
          cashback_amount:cashback,
          order_status:orderStatus||existing?.order_status||'',
          commission_status:commissionStatus||existing?.commission_status||'',
          normalized_status:normalized,
          ordered_at:orderedAt||existing?.ordered_at||null,
          source_imported_at:new Date().toISOString(),updated_at:new Date().toISOString()
        };
        const {error:oErr}=await prodSb.from('orders').upsert(payload,{onConflict:'order_id'});if(oErr)throw oErr;

        if(!existing){
          newOrders++;
          await safeNotify(p.id,'Shopee đã ghi nhận đơn hàng',commission.known
            ? ('Đơn '+orderId+' đã xuất hiện trong báo cáo Shopee. Cashback dự kiến: '+money(cashback)+'.')
            : ('Đơn '+orderId+' đã xuất hiện trong báo cáo Shopee. Cashback đang chờ xác minh cột hoa hồng.'));
        }else if(existing.normalized_status!==normalized||String(existing.order_status||'')!==orderStatus||String(existing.commission_status||'')!==commissionStatus){
          statusChanges++;
          if(normalized==='confirmed')await safeNotify(p.id,'Cashback đã được xác nhận','Đơn '+orderId+' đã được Shopee xác nhận. Bạn nhận '+money(cashback)+' cashback.');
          else if(normalized==='invalid')await safeNotify(p.id,'Đơn không đủ điều kiện cashback','Đơn '+orderId+' được Shopee cập nhật không hợp lệ. Cashback: 0đ.');
          else await safeNotify(p.id,'Shopee cập nhật trạng thái đơn','Đơn '+orderId+' hiện: '+(orderStatus||'Đang xử lý')+'. Cashback chưa được cộng vào số dư.');
        }
        updated++;
      }

      skipped=rows.length-prepared.length;
      await syncSupabaseAccounts();
      let warning='';
      if(duplicateIds.size)warning+='<br><b style="color:#b53131">Đã khóa '+duplicateIds.size+' Order ID có nhiều dòng</b> để tránh cộng/ghi đè sai. Chờ map schema đơn thật.';
      if(missingCommission)warning+='<br><b style="color:#b97900">Có '+missingCommission+' dòng chưa có cột hoa hồng tổng/net rõ ràng</b>; hệ thống không tự cộng các cột thành phần.';
      box.innerHTML='Đã đọc <b>'+rows.length+'</b> dòng · cập nhật an toàn <b>'+updated+'</b> đơn · đơn mới <b>'+newOrders+'</b> · đổi trạng thái <b>'+statusChanges+'</b> · không khớp Sub ID <b>'+unmatched+'</b> · bỏ qua <b>'+skipped+'</b> · dòng mơ hồ <b>'+ambiguous+'</b>.'+warning+'<br><span class="tiny">Chỉ cột “Hoa hồng ròng tiếp thị liên kết” hoặc cột tổng hoa hồng rõ ràng mới được dùng để tính cashback.</span>';
    }catch(e){console.error(e);box.textContent='Import lỗi: '+(e.message||e)}
  };
})();
/* Strict Shopee import layer mapped from the real AffiliateCommissionReport CSV.
   Source of truth: Shopee Order ID + Sub_id1 + Net Affiliate Commission. */
(function(){
  const q=s=>document.querySelector(s);
  const norm=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_\-]+/g,' ').replace(/\s+/g,' ');
  const sub=v=>String(v??'').trim().replace(/-+$/,'');
  const entries=row=>Object.entries(row||{});
  const exactPick=(row,names)=>{for(const n of names){const f=entries(row).find(([k])=>norm(k)===norm(n));if(f)return {found:true,value:f[1],header:f[0]}}return {found:false,value:'',header:''}};
  const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;let s=String(v??'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;if(/^\d{1,3}([.,]\d{3})+$/.test(s))return Number(s.replace(/[.,]/g,''));return Number(s.replace(/,/g,''))||0};
  const parseDate=v=>{if(!v)return null;const s=String(v).trim();if(!s)return null;const d=new Date(s);return isNaN(d)?null:d.toISOString()};
  const isInvalid=s=>{const n=norm(s);return ['da huy','huy','khong hop le','gian lan','fraud','refund','hoan tien','tra hang'].some(x=>n.includes(x))};
  const isCompleted=s=>{const n=norm(s);return n==='hoan thanh'||n.includes('hoan thanh')||n.includes('completed')};

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
    box.textContent='Đang đọc Báo cáo chuyển đổi Shopee theo schema Production...';
    try{
      await syncSupabaseAccounts();
      const {data:profiles,error:pErr}=await prodSb.from('profiles').select('id,username,display_name,tracking_code');
      if(pErr)throw pErr;

      const buf=await input.files[0].arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      if(!rows.length)throw new Error('File không có dữ liệu.');

      const required=['ID đơn hàng','Trạng thái đặt hàng','Thời Gian Đặt Hàng','Tên Item','Giá trị đơn hàng (₫)','Hoa hồng ròng tiếp thị liên kết(₫)','Trạng thái sản phẩm liên kết','Sub_id1'];
      const headers=Object.keys(rows[0]||{});
      const missing=required.filter(h=>!headers.some(x=>norm(x)===norm(h)));
      if(missing.length)throw new Error('File chưa đúng schema Shopee Production. Thiếu cột: '+missing.join(', '));

      const prepared=[];
      for(const raw of rows){
        const orderId=String(exactPick(raw,['ID đơn hàng']).value||'').trim();
        if(orderId)prepared.push({raw,orderId});
      }
      const counts=new Map();prepared.forEach(x=>counts.set(x.orderId,(counts.get(x.orderId)||0)+1));
      const duplicateIds=new Set([...counts].filter(([,c])=>c>1).map(([id])=>id));

      let updated=0,newOrders=0,statusChanges=0,unmatched=0,skipped=rows.length-prepared.length,ambiguous=0;
      for(const {raw,orderId} of prepared){
        // Until we observe a real multi-line order from Shopee, never guess whether
        // order-level net commission is repeated or split across product rows.
        if(duplicateIds.has(orderId)){ambiguous++;continue}

        const subId=sub(exactPick(raw,['Sub_id1']).value);
        const p=(profiles||[]).find(x=>sub(x.tracking_code)===subId || sub(x.username)===subId);
        if(!p){unmatched++;continue}

        const checkoutId=String(exactPick(raw,['Checkout id']).value||'').trim();
        const itemId=String(exactPick(raw,['Item id']).value||'').trim();
        const product=String(exactPick(raw,['Tên Item']).value||'').trim();
        const shop=String(exactPick(raw,['Tên Shop']).value||'').trim();
        const orderValue=Math.max(0,num(exactPick(raw,['Giá trị đơn hàng (₫)']).value));
        const commission=Math.max(0,num(exactPick(raw,['Hoa hồng ròng tiếp thị liên kết(₫)']).value));
        const orderStatus=String(exactPick(raw,['Trạng thái đặt hàng']).value||'').trim();
        const productStatus=String(exactPick(raw,['Trạng thái sản phẩm liên kết']).value||'').trim();
        const orderedAt=parseDate(exactPick(raw,['Thời Gian Đặt Hàng']).value);
        const clickedAt=parseDate(exactPick(raw,['Thời gian Click']).value);

        const statusText=orderStatus+' '+productStatus;
        const normalized=isInvalid(statusText)?'invalid':(isCompleted(orderStatus)&&isCompleted(productStatus)?'confirmed':'pending');
        const commissionStatus=normalized==='confirmed'?'Đã xác nhận':normalized==='invalid'?'Không hợp lệ':'Đang chờ';

        const {data:existing,error:eErr}=await prodSb.from('orders').select('*').eq('order_id',orderId).maybeSingle();
        if(eErr)throw eErr;
        const rate=await tierRateFor(p,existing);
        const cashback=normalized==='invalid'?0:Math.round(commission*rate);

        const payload={
          order_id:orderId,user_id:p.id,sub_id:subId,
          checkout_id:checkoutId||existing?.checkout_id||null,
          item_id:itemId||existing?.item_id||null,
          product_name:product||existing?.product_name||'Sản phẩm Shopee',
          shop_name:shop||existing?.shop_name||'',
          order_value:orderValue,
          shopee_commission:commission,
          cashback_rate:rate,
          cashback_amount:cashback,
          order_status:orderStatus,
          commission_status:commissionStatus,
          affiliate_product_status:productStatus,
          normalized_status:normalized,
          ordered_at:orderedAt||existing?.ordered_at||null,
          clicked_at:clickedAt||existing?.clicked_at||null,
          source_imported_at:new Date().toISOString(),updated_at:new Date().toISOString()
        };
        const {error:oErr}=await prodSb.from('orders').upsert(payload,{onConflict:'order_id'});if(oErr)throw oErr;

        if(!existing){
          newOrders++;
          const msg=normalized==='confirmed'
            ? 'Đơn '+orderId+' đã hoàn thành. Cashback đã xác nhận: '+money(cashback)+'.'
            : normalized==='invalid'
              ? 'Đơn '+orderId+' không hợp lệ. Cashback: 0đ.'
              : 'Shopee đã ghi nhận đơn '+orderId+'. Cashback dự kiến: '+money(cashback)+'.';
          await safeNotify(p.id,'Shopee đã ghi nhận đơn hàng',msg);
          const {data:intent}=await prodSb.from('purchase_intents').select('id').eq('user_id',p.id).eq('status','awaiting_reconciliation').order('created_at',{ascending:true}).limit(1).maybeSingle();
          if(intent?.id)await prodSb.from('purchase_intents').update({status:'reconciled',matched_order_id:orderId,reconciled_at:new Date().toISOString()}).eq('id',intent.id);
        }else if(existing.normalized_status!==normalized||String(existing.order_status||'')!==orderStatus||String(existing.affiliate_product_status||'')!==productStatus||Number(existing.shopee_commission||0)!==commission){
          statusChanges++;
          if(normalized==='confirmed')await safeNotify(p.id,'Cashback đã được xác nhận','Đơn '+orderId+' đã hoàn thành. Bạn nhận '+money(cashback)+' cashback.');
          else if(normalized==='invalid')await safeNotify(p.id,'Đơn không đủ điều kiện cashback','Đơn '+orderId+' không hợp lệ. Cashback: 0đ.');
          else await safeNotify(p.id,'Shopee cập nhật trạng thái đơn','Đơn '+orderId+' hiện: '+(orderStatus||productStatus||'Đang chờ xử lý')+'. Cashback dự kiến '+money(cashback)+'.');
        }
        updated++;
      }

      await syncSupabaseAccounts();
      let warning='';
      if(duplicateIds.size)warning='<br><b style="color:#b53131">Đã khóa '+duplicateIds.size+' Order ID có nhiều dòng</b>. Chưa tự cộng/ghi đè vì cần quan sát một đơn multi-item thực tế trước.';
      box.innerHTML='Đã đọc <b>'+rows.length+'</b> dòng · đối soát <b>'+updated+'</b> đơn · đơn mới <b>'+newOrders+'</b> · đổi trạng thái <b>'+statusChanges+'</b> · không khớp Sub ID <b>'+unmatched+'</b> · bỏ qua <b>'+skipped+'</b> · dòng mơ hồ <b>'+ambiguous+'</b>.'+warning+'<br><span class="tiny">Cashback được tính duy nhất từ “Hoa hồng ròng tiếp thị liên kết(₫)”. Đơn chỉ vào số dư khi cả trạng thái đặt hàng và trạng thái sản phẩm liên kết đều Hoàn thành.</span>';
    }catch(e){console.error(e);box.textContent='Import lỗi: '+(e.message||e)}
  };
})();
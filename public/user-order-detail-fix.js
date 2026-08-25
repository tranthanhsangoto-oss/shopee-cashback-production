/* Show authoritative Shopee order details from Supabase. */
(function(){
  const q=s=>document.querySelector(s);
  const fmtTime=v=>{try{return new Date(v).toLocaleString('vi-VN')}catch(e){return ''}};
  const oldLoad=typeof loadProductionCommerceData==='function'?loadProductionCommerceData:null;
  if(oldLoad){
    loadProductionCommerceData=async function(){
      await oldLoad();
      if(!state?.user?.id)return;
      const {data,error}=await sb.from('orders')
        .select('order_id,checkout_id,item_id,clicked_at,affiliate_product_status,shop_name,ordered_at')
        .eq('user_id',state.user.id);
      if(error)return;
      const byId=new Map((data||[]).map(x=>[String(x.order_id),x]));
      for(const o of state.orders||[]){
        const x=byId.get(String(o.id));if(!x)continue;
        o.checkoutId=x.checkout_id||'';o.itemId=x.item_id||'';o.clickedAt=x.clicked_at||null;
        o.affiliateProductStatus=x.affiliate_product_status||'';o.shopName=x.shop_name||o.shopName||'';
        o.createdAt=x.ordered_at||o.createdAt;
      }
      save();
    };
  }

  renderOrders=function(){
    const arr=(state.orders||[]).filter(o=>o.userId===state.user.id&&o.source==='shopee')
      .slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    q('#ordersList').innerHTML=arr.length?arr.map(o=>{
      const normalized=o.normalizedStatus||'pending',pending=normalized==='pending',bad=normalized==='invalid';
      const cashText=bad?'0đ':pending?('Dự kiến +'+money(o.cashback)):('+'+money(o.cashback));
      const cashLabel=bad?'Không được hoàn':pending?'Cashback dự kiến':'Bạn nhận được';
      const time=o.createdAt?fmtTime(o.createdAt):'';
      const note=pending
        ? '<div class="tiny" style="margin-top:7px;color:#8a6618">Đơn đã được Shopee ghi nhận. Cashback chỉ được cộng vào số dư khi trạng thái hoàn thành.</div>'
        : bad?'<div class="tiny" style="margin-top:7px;color:var(--bad)">Đơn không hợp lệ nên cashback là 0đ.</div>':'';
      return `<div class="order"><div class="thumb">🛍️</div><div><b>${esc(o.product)}</b>
        <div class="muted">Mã đơn: ${esc(o.id)}${o.shopName?' · '+esc(o.shopName):''}</div>
        ${time?`<div class="tiny" style="margin-top:3px">Thời gian đặt: ${esc(time)}</div>`:''}
        <div class="tiny" style="margin-top:3px">Giá trị đơn: ${money(o.orderValue)}</div>
        <div style="margin-top:5px"><span class="status ${statusClass(o.orderStatus)}">${esc(o.orderStatus||'Đang xử lý')}</span> <span class="status ${statusClass(o.commissionStatus)}">${esc(o.commissionStatus||'Đang chờ')}</span></div>${note}
        </div><div class="amount"><div class="tiny" style="margin-bottom:4px">${cashLabel}</div><div style="color:${bad?'var(--bad)':pending?'var(--warn)':'var(--ok)'}">${cashText}</div></div></div>`;
    }).join(''):'<p class="muted">Chưa có đơn hàng nào được Shopee ghi nhận. Việc bấm mở Shopee không được tính là một đơn hàng.</p>';
  };
})();
/* DEV-only sandbox. No Production database writes. */
(function(){
  const isAdmin=/\/admin(?:\.html)?\/?$/i.test(location.pathname);
  const DEV_USER_ID='DEV-U001';

  function addBanner(){
    if(document.getElementById('devModeBanner'))return;
    const bar=document.createElement('div');
    bar.id='devModeBanner';
    bar.textContent='DEV MODE · DỮ LIỆU TEST · KHÔNG ẢNH HƯỞNG PRODUCTION';
    bar.style.cssText='position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:100000;background:#202634;color:#fff;border:2px solid #ffb59f;border-radius:999px;padding:7px 13px;font:800 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 8px 24px rgba(0,0,0,.16);pointer-events:none';
    document.body.appendChild(bar);
  }

  function seedUser(){
    try{
      if(typeof state==='undefined')return;
      state.user={id:DEV_USER_ID,name:'DEV Test User',username:'devuser',email:'',role:'user',trackingCode:'DEV001'};
      state.currentUserId=DEV_USER_ID;
      state.productionMode=false;
      state.accounts=[{id:DEV_USER_ID,name:'DEV Test User',username:'devuser',authType:'local',status:'active',role:'user',createdAt:new Date().toISOString()}];
      if(!Array.isArray(state.orders)||!state.orders.some(o=>o.userId===DEV_USER_ID)){
        state.orders=[
          {id:'DEV-ORDER-001',userId:DEV_USER_ID,product:'Sản phẩm test DEV',orderValue:250000,commission:20000,cashback:12000,orderStatus:'Hoàn thành',commissionStatus:'Đã xác nhận',normalizedStatus:'confirmed',createdAt:new Date(Date.now()-86400000).toISOString(),source:'shopee'},
          {id:'DEV-ORDER-002',userId:DEV_USER_ID,product:'Đơn đang chờ DEV',orderValue:180000,commission:12000,cashback:7200,orderStatus:'Đang chờ xử lý',commissionStatus:'Đang chờ',normalizedStatus:'pending',createdAt:new Date().toISOString(),source:'shopee'}
        ];
      }
      state.withdrawals=Array.isArray(state.withdrawals)?state.withdrawals:[];
      state.notifications=Array.isArray(state.notifications)?state.notifications:[];
      state.tickets=Array.isArray(state.tickets)?state.tickets:[];
      if(typeof save==='function')save();
    }catch(e){console.warn('DEV seed failed',e)}
  }

  function installUserSandbox(){
    seedUser();
    try{
      loadProductionCommerceData=async()=>{};
      trackShopeeEvent=async function(eventType,data={}){
        state.clicks=Array.isArray(state.clicks)?state.clicks:[];
        const row={id:'DEV-EVT-'+Date.now(),userId:DEV_USER_ID,type:eventType,eventType,createdAt:new Date().toISOString(),...data};
        state.clicks.push(row); if(typeof save==='function')save(); return row;
      };
      createPendingPurchaseIntent=async function(data={}){
        const row={id:'DEV-INTENT-'+Date.now(),userId:DEV_USER_ID,status:'awaiting_reconciliation',createdAt:new Date().toISOString(),...data};
        return row;
      };
      showAuthState=async function(){
        seedUser();
        document.querySelector('#loginScreen')?.classList.add('hidden');
        document.querySelector('#appRoot')?.classList.remove('hidden');
        if(typeof render==='function')render();
      };
      localLogin=showAuthState;
      registerLocalAccount=showAuthState;
      logoutUser=function(){alert('DEV MODE: phiên test được giữ cục bộ trong trình duyệt.');};
      saveProfile=function(){
        const v=document.querySelector('#editName')?.value?.trim(); if(v)state.user.name=v;
        if(typeof save==='function')save(); if(typeof closePops==='function')closePops(); if(typeof render==='function')render();
      };
      if(typeof requestWithdraw==='function'){
        requestWithdraw=function(){
          const amt=Number(document.querySelector('#wdAmount')?.value||0),bank=document.querySelector('#wdBank')?.value?.trim()||'',account=document.querySelector('#wdAccount')?.value?.trim()||'',holder=document.querySelector('#wdHolder')?.value?.trim()||'';
          if(!amt||!bank||!account||!holder)return alert('DEV: nhập đủ thông tin test.');
          state.withdrawals.push({id:'DEV-WD-'+Date.now(),userId:DEV_USER_ID,amount:amt,bank,account,holder,status:'Đang chờ',createdAt:new Date().toISOString()});
          if(typeof save==='function')save(); if(typeof render==='function')render(); alert('DEV: đã tạo yêu cầu rút tiền test, không gửi lên Production.');
        };
      }
      if(typeof sendTicket==='function'){
        sendTicket=function(){
          const title=document.querySelector('#tkTitle')?.value?.trim()||'',message=document.querySelector('#tkMsg')?.value?.trim()||'';
          if(!title||!message)return alert('DEV: nhập tiêu đề và nội dung.');
          state.tickets.push({id:'DEV-TK-'+Date.now(),userId:DEV_USER_ID,userName:state.user.name,category:document.querySelector('#tkCat')?.value||'Khác',title,message,status:'Đang chờ',createdAt:new Date().toISOString()});
          if(typeof save==='function')save(); if(typeof render==='function')render(); alert('DEV: ticket chỉ được lưu cục bộ.');
        };
      }
    }catch(e){console.warn('DEV overrides failed',e)}
    setTimeout(()=>showAuthState(),0);
  }

  function installAdminSandbox(){
    try{
      syncSupabaseAccounts=async function(){ if(typeof render==='function')render(); };
      importShopeeReport=function(){alert('DEV MODE: importer Production đã bị khóa. Khi phát triển importer mới, dữ liệu sẽ chỉ ghi vào sandbox DEV.');};
      if(typeof sendNotif==='function'){
        sendNotif=function(){alert('DEV MODE: thông báo test không gửi tới user Production.');};
      }
    }catch(e){console.warn('DEV admin overrides failed',e)}
    setTimeout(()=>{try{if(typeof render==='function')render()}catch(e){}},0);
  }

  addBanner();
  if(isAdmin)installAdminSandbox();else installUserSandbox();
})();

/* Production safety/runtime patch.
   Keeps the existing UI intact while enforcing user/admin separation
   and making Shopee-link tracking more reliable. */
(function(){
  const q=s=>document.querySelector(s);

  async function currentProfile(){
    try{
      const {data}=await sb.auth.getSession();
      const user=data?.session?.user;
      if(!user)return null;
      const {data:profile,error}=await sb
        .from('profiles')
        .select('id,username,display_name,role,is_locked,tracking_code')
        .eq('id',user.id)
        .maybeSingle();
      if(error)return null;
      return profile||null;
    }catch(e){
      console.warn('profile check failed',e);
      return null;
    }
  }

  async function enforceUserOnly(){
    const profile=await currentProfile();
    if(!profile)return;
    if(profile.is_locked){
      await sb.auth.signOut();
      q('#appRoot')?.classList.add('hidden');
      q('#loginScreen')?.classList.remove('hidden');
      alert('Tài khoản đang bị khóa. Vui lòng liên hệ admin.');
      return;
    }
    if(profile.role==='admin'){
      await sb.auth.signOut();
      q('#appRoot')?.classList.add('hidden');
      q('#loginScreen')?.classList.remove('hidden');
      alert('Tài khoản Admin vui lòng đăng nhập tại trang quản trị.');
    }
  }

  // Prevent an admin account from being used as a normal cashback user.
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

  // Avoid creating several pending records when the same button is double-tapped.
  try{
    if(typeof createPendingPurchaseIntent==='function'){
      const originalCreatePendingPurchaseIntent=createPendingPurchaseIntent;
      createPendingPurchaseIntent=async function(data){
        if(!state?.user?.id)return originalCreatePendingPurchaseIntent(data);
        const since=new Date(Date.now()-15000).toISOString();
        const {data:existing}=await sb
          .from('purchase_intents')
          .select('*')
          .eq('user_id',state.user.id)
          .eq('status','awaiting_reconciliation')
          .eq('clean_url',data.cleanUrl||'')
          .gte('created_at',since)
          .order('created_at',{ascending:false})
          .limit(1)
          .maybeSingle();
        if(existing)return existing;
        return originalCreatePendingPurchaseIntent(data);
      };
    }
  }catch(e){console.warn(e)}

  // Track a valid Shopee URL even when mobile browsers/autofill do not emit a normal paste event.
  let inputTimer=null;
  const linkInput=q('#shopLink');
  if(linkInput){
    linkInput.addEventListener('input',()=>{
      clearTimeout(inputTimer);
      inputTimer=setTimeout(()=>{
        try{
          if(typeof trackPastedShopeeLink==='function')trackPastedShopeeLink();
        }catch(e){console.warn(e)}
      },900);
    });
  }

  // Re-check existing session once the legacy page initialization has finished.
  setTimeout(enforceUserOnly,250);
  try{sb.auth.onAuthStateChange(()=>setTimeout(enforceUserOnly,150));}catch(e){}
})();

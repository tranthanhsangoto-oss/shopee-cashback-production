/* Persist notification read state after the main user runtime patch. */
(function(){
  try{
    if(typeof toggleNotif!=='function'||typeof sb==='undefined')return;
    const previousToggle=toggleNotif;
    toggleNotif=async function(){
      const unread=(state?.notifications||[]).filter(n=>n.userId===state?.user?.id&&!n.read).map(n=>n.id);
      await previousToggle();
      if(!unread.length)return;
      const {error}=await sb.from('notifications').update({read:true}).in('id',unread);
      if(error){console.warn('mark notifications read failed',error);return}
      (state.notifications||[]).forEach(n=>{if(unread.includes(n.id))n.read=true});
      save();
      if(typeof renderNotif==='function')renderNotif();
    };
  }catch(e){console.warn(e)}
})();

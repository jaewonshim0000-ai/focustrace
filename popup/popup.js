(function(){
  var $=function(id){return document.getElementById(id)};
  var poll=null,tabId=null;

  function show(v){
    $('vIdle').style.display=v==='idle'?'':'none';
    $('vLive').style.display=v==='live'?'':'none';
    $('vRes').style.display=v==='res'?'':'none';
    $('dot').className='st-dot'+(v==='live'?' on':'');
    $('stTxt').className='st-txt'+(v==='live'?' on':'');
    $('stTxt').textContent=v==='live'?'TRACKING':v==='res'?'COMPLETE':'IDLE';
  }

  $('btnLaunch').addEventListener('click',function(){
    var url=chrome.runtime.getURL('tracker/tracker.html');
    chrome.tabs.create({url:url,active:true},function(t){tabId=t.id;show('live');startPoll()});
  });

  $('btnOpen').addEventListener('click',function(){
    if(tabId)chrome.tabs.update(tabId,{active:true}).catch(function(){
      chrome.tabs.create({url:chrome.runtime.getURL('tracker/tracker.html'),active:true},function(t){tabId=t.id});
    });
  });

  function startPoll(){clearInterval(poll);poll=setInterval(pollLive,1500);pollLive()}

  function pollLive(){
    chrome.runtime.sendMessage({type:'LOAD',key:'live'},function(resp){
      if(chrome.runtime.lastError||!resp||!resp.data)return;
      var s=resp.data;
      if(s.ended){clearInterval(poll);chrome.runtime.sendMessage({type:'LOAD',key:'session'},function(r){if(r&&r.data&&r.data.results)showRes(r.data.results);else show('idle')});return}
      $('lScore').textContent=s.score!=null?s.score:'—';
      $('lScore').className='live-num '+(s.score>=70?'hi':s.score>=40?'mi':'lo');
      $('lTime').textContent=s.time||'0:00';
      $('lRead').textContent=s.readings||0;
      $('lTrig').textContent=s.triggers||0;
      setBar('bGaze','vGaze',s.gazeScore||0);
      setBar('bEyes','vEyes',s.eyeScore||0);
      setBar('bHead','vHead',s.headScore||0);
    });
  }

  function setBar(b,v,p){$(b).style.width=p+'%';$(v).textContent=p}

  function showRes(r){
    show('res');
    $('rPill').innerHTML='<span>'+r.personality.emoji+'</span> '+r.personality.name;
    $('rPdesc').textContent=r.personality.desc;
    var s=r.summary;
    $('rStats').innerHTML=
      '<div class="rs"><div class="rs-v hi">'+s.avgScore+'%</div><div class="rs-l">Avg</div></div>'+
      '<div class="rs"><div class="rs-v" style="color:#22c55e">'+s.peakScore+'%</div><div class="rs-l">Peak</div></div>'+
      '<div class="rs"><div class="rs-v">'+s.totalMin+'m</div><div class="rs-l">Time</div></div>'+
      '<div class="rs"><div class="rs-v lo">'+s.unfocusCount+'</div><div class="rs-l">Triggers</div></div>';
    var html='';
    r.insights.forEach(function(i){html+='<div class="ins"><div class="ins-h"><span class="ins-ic">'+i.icon+'</span><span class="ins-tt">'+i.title+'</span></div><div class="ins-tx">'+i.text+'</div></div>'});
    $('rIns').innerHTML=html;
  }

  $('btnNewP').addEventListener('click',function(){show('idle')});
  $('btnLast').addEventListener('click',function(){
    chrome.runtime.sendMessage({type:'LOAD',key:'session'},function(r){if(r&&r.data&&r.data.results)showRes(r.data.results)});
  });
  $('btnExp').addEventListener('click',function(){
    chrome.runtime.sendMessage({type:'LOAD',key:'session'},function(r){
      if(!r||!r.data)return;
      var b=new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'});
      var a=document.createElement('a');a.href=URL.createObjectURL(b);
      a.download='focustrace-'+new Date().toISOString().slice(0,16)+'.json';a.click();
    });
  });

  chrome.runtime.sendMessage({type:'LOAD',key:'live'},function(resp){
    if(chrome.runtime.lastError){show('idle');return}
    if(resp&&resp.data&&!resp.data.ended){show('live');startPoll()}
    else{chrome.runtime.sendMessage({type:'LOAD',key:'session'},function(r){if(r&&r.data)$('btnLast').style.display='';show('idle')})}
  });
})();

(function(){
  var body=document.body, menu=document.querySelector('.menu');
  if(menu) menu.addEventListener('click',function(){
    var o=body.classList.toggle('open'); menu.setAttribute('aria-expanded',o?'true':'false');
  });
  var nt=document.querySelector('.navtoggle');
  if(nt){
    nt.setAttribute('aria-pressed',body.classList.contains('nav-off')?'false':'true');
    nt.addEventListener('click',function(){
      var off=body.classList.toggle('nav-off'); nt.setAttribute('aria-pressed',off?'false':'true');
      try{localStorage.setItem('navOff',off?'1':'0')}catch(e){}
    });
  }
  var q=document.getElementById('q'), box=document.getElementById('results'), idx=null, sel=-1;
  function load(){
    if(idx) return Promise.resolve(idx);
    return fetch('search-index.json').then(function(r){return r.json()}).then(function(d){idx=d;return d});
  }
  function esc(s){return s.replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function run(){
    var terms=q.value.toLowerCase().split(/\s+/).filter(function(t){return t.length>1});
    if(!terms.length){box.hidden=true;return}
    load().then(function(d){
      var hits=[];
      d.forEach(function(r){
        var t=(r.heading+' '+r.page_title+' '+r.text).toLowerCase(), score=0;
        for(var i=0;i<terms.length;i++){
          if(t.indexOf(terms[i])<0){score=-1;break}
          if(r.heading.toLowerCase().indexOf(terms[i])>=0) score+=5;
          if(r.page_title.toLowerCase().indexOf(terms[i])>=0) score+=2;
          score+=1;
        }
        if(score>0) hits.push([score,r]);
      });
      hits.sort(function(a,b){return b[0]-a[0]});
      hits=hits.slice(0,10); sel=-1;
      if(!hits.length){box.innerHTML='<div class="none">No matches.</div>';box.hidden=false;return}
      box.innerHTML=hits.map(function(h){
        var r=h[1], low=r.text.toLowerCase(), p=low.indexOf(terms[0]); if(p<0)p=0;
        var s=r.text.slice(Math.max(0,p-50),p+110), out=esc(s);
        terms.forEach(function(t){out=out.replace(new RegExp('('+t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>')});
        var href=r.page+'.html'+(r.anchor?'#'+r.anchor:'');
        return '<a href="'+href+'"><div class="where">'+esc(r.page_title)+(r.heading!==r.page_title?' · '+esc(r.heading):'')+'</div><div class="snip">'+out+'</div></a>';
      }).join('');
      box.hidden=false;
    });
  }
  if(q){
    q.addEventListener('input',run);
    q.addEventListener('keydown',function(e){
      var items=box.querySelectorAll('a'); if(!items.length) return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){
        e.preventDefault(); sel=(sel+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
        items.forEach(function(a,i){a.classList.toggle('sel',i===sel)});
      } else if(e.key==='Enter'&&sel>=0){e.preventDefault();location.href=items[sel].getAttribute('href')}
      else if(e.key==='Escape'){box.hidden=true}
    });
    document.addEventListener('click',function(e){if(!e.target.closest('.search')) box.hidden=true});
    document.addEventListener('keydown',function(e){
      if(e.key==='/'&&document.activeElement!==q&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();q.focus()}
    });
  }
})();

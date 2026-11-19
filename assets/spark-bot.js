/* SPARK Bot — Axo-style chat assistant for the SPARK 2K26 fest site.
   Same bubble UI as the Axofy order-page chat: blue user bubbles right,
   dark Axo bubbles left, typing dots, suggestion chips.
   Knowledge base is SPARK-only. Client-side, no server, no intro/guide.
   Default language: English. Loaded on every page except the home page. */
(function(){
"use strict";
var AVATAR="/assets/hero-pose-1.webp";
var NAME="SPARK Bot";

/* ---------- Knowledge base: intent -> keywords -> answer ---------- */
var KB=[
{ k:["when","date","day","time","start","schedule","timing","which day","what day"],
  a:"SPARK 2K26 is on <b>Friday, 27 November 2026</b>, and it starts at <b>10 AM</b>. One day, four events, one campus." },
{ k:["where","venue","location","place","address","reach","how to reach","college","ramapuram","kottayam","map","direction"],
  a:"The fest is at <b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b>. You can see the venue map on the <b>Map</b> page. The college is in Ramapuram, Kottayam district." },
{ k:["event","events","competition","competitions","arena","what are the events","list of events","which events"],
  a:"There are <b>4 events</b>, in this order:<br>1. <b>Reels Competition</b> (team 1-4) - Rs.2,000 + Rs.1,000<br>2. <b>Prompting</b> (team 1-2) - Rs.1,500 + Rs.750<br>3. <b>Quiz</b> (team 2-3) - Rs.2,000 + Rs.1,000<br>4. <b>Treasure Hunt</b> (team 3-5) - Rs.6,000 winner-takes-all<br><br>Total prize pool: <b>Rs.14,250</b>. Tap any event on the Events page to register." },
{ k:["reel","reels","reel competition","reel creation","video","short video"],
  a:"<b>Reels Competition</b> - Create a reel that stops the scroll.<br>Team: 1-4 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Agnivesh Santhosh, Daniel.<br><a href=\"/registration/reels-competition\">Register for Reels Competition</a>" },
{ k:["prompt","prompting","ai prompt","prompt engineering"],
  a:"<b>Prompting</b> - The art of crafting the perfect AI prompt.<br>Team: 1-2 members. Prizes: <b>1st Rs.1,500, 2nd Rs.750</b>.<br>Coordinator: Adithya Rajagopal.<br><a href=\"/registration/prompting\">Register for Prompting</a>" },
{ k:["quiz"],
  a:"<b>Quiz</b> - A battle of brains across rapid rounds of questions.<br>Team: 2-3 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Aleena, Niya.<br><a href=\"/registration/quiz\">Register for Quiz</a>" },
{ k:["treasure","treasure hunt","hunt","clue","clues"],
  a:"<b>Treasure Hunt</b> - A campus-wide race of clues leading to the hidden treasure.<br>Team: 3-5 members. Prize: <b>Rs.6,000, winner-takes-all</b> (no 2nd prize).<br>Coordinators: Abhinavu Babu, Aadhil Kabeer.<br><a href=\"/registration/treasure-hunt\">Register for Treasure Hunt</a>" },
{ k:["prize","prizes","prize pool","prize money","win","winner","reward","cash"],
  a:"Total prize pool: <b>Rs.14,250</b>.<br>Reels Competition: Rs.2,000 + Rs.1,000<br>Prompting: Rs.1,500 + Rs.750<br>Quiz: Rs.2,000 + Rs.1,000<br>Treasure Hunt: <b>Rs.6,000, winner-takes-all</b>." },
{ k:["register","registration","sign up","signup","join","apply","how to register","enroll","participate","entry"],
  a:"To register, go to the <b>Events</b> page, tap the event you want, and fill the form. You need your <b>school name and a valid school ID</b>. Registration is per event, and your team size must fit that event's limit.<br><a href=\"/events\">See all events</a>" },
{ k:["team","team size","members","how many","group"],
  a:"Team sizes:<br>Reels Competition: 1-4 members<br>Prompting: 1-2 members<br>Quiz: 2-3 members<br>Treasure Hunt: 3-5 members" },
{ k:["coordinator","coordinators","contact","phone","number","call","help","support","who to contact","organiser","organizer","lead","student lead","associate lead"],
  a:"Main contacts:<br><b>Student Lead - Ananthu Anil</b>: 7510142466<br><b>Associate Lead - Bista Mariya Jojo</b>: 9746446739<br><br>Faculty: Shibu Kallarackal (9446375272), Archana Gopinath (9495955010).<br>For help with a specific event, contact that event's coordinators on its registration page." },
{ k:["instagram","insta","social","follow"],
  a:"Follow the fest on Instagram: <b>@celesta2k26</b> - updates, announcements and results.<br><a href=\"https://www.instagram.com/celesta2k26\" target=\"_blank\" rel=\"noopener\">@celesta2k26 on Instagram</a>" },
{ k:["who","eligible","eligibility","can i join","who can join","can join","can i participate","school","student","12th","class","standard","age"],
  a:"SPARK is an <b>inter-school</b> fest for <b>12th standard school students</b>. You need your school name and a valid school ID to register. Around 150-200 students are expected." },
{ k:["nexus","association","organised","organized","organiser","who organises","who organizes","mac","college"],
  a:"SPARK 2K26 is organised by <b>NEXUS</b>, the Association of Computer Applications at Mar Augusthinose College, Ramapuram. Tagline: <b>Decode Your Future</b>." },
{ k:["fee","fees","cost","price","payment","pay","free","entry fee","ticket"],
  a:"There is no entry fee mentioned on the site. Registration is free through the Events page. If you are unsure, ask the Student Lead Ananthu Anil (7510142466)." },
{ k:["bring","what to bring","carry","id","id card","school id"],
  a:"Bring your <b>valid school ID card</b> - it is required for registration and entry. Bring your school name and team details too." },
{ k:["food","lunch","snack","eat","canteen"],
  a:"Food details are not announced on the site yet. Ask the Student Lead Ananthu Anil (7510142466) for the latest food arrangements." },
{ k:["hi","hello","hey","hai","good morning","good afternoon","good evening","vanakkam"],
  a:"Hey! Ask me anything about SPARK 2K26 - events, prizes, registration, venue, or contacts." },
{ k:["thank","thanks","thank you","nandhi","thanks a lot"],
  a:"Anytime! See you on 27 November. Good luck!" },
{ k:["bye","goodbye","see you"],
  a:"See you at SPARK on 27 November!" }
];
var FALLBACK="I don't have that answer yet. Try asking about the events, prizes, registration, venue, or contacts - or call the Student Lead <b>Ananthu Anil (7510142466)</b>.";

var CHIPS=["When is SPARK?","What events are there?","How do I register?","Where is the venue?","Prizes?","Contact"];

/* ---------- Matching ---------- */
function norm(s){ return (" "+s.toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()+" "); }
function answerFor(q){
  var nq=norm(q), best=null, bestScore=0;
  for(var i=0;i<KB.length;i++){
    var score=0;
    for(var j=0;j<KB[i].k.length;j++){
      var kw=KB[i].k[j];
      if(kw.indexOf(" ")>=0){ if(nq.indexOf(" "+kw+" ")>=0) score+=3; }
      else if(nq.indexOf(" "+kw+" ")>=0) score+=2;
      else if(nq.indexOf(kw)>=0) score+=1;
    }
    if(score>bestScore){ bestScore=score; best=KB[i]; }
  }
  return best?best.a:FALLBACK;
}

/* ---------- CSS (Axofy chat bubbles, SPARK panel) ---------- */
var CSS=[
".sparkbot-fab{position:fixed;right:16px;bottom:calc(96px + env(safe-area-inset-bottom));z-index:101;width:56px;height:56px;border-radius:50%;border:2px solid #fff;background:#111 url("+AVATAR+") center 18%/78% no-repeat;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer;padding:0;transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}",
".sparkbot-fab:active{transform:scale(.92)}",
".sparkbot-fab .sparkbot-dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff}",
".sparkbot-panel{position:fixed;left:50%;transform:translate(-50%,calc(100% + 24px));bottom:0;width:min(420px,calc(100% - 16px));max-height:min(560px,calc(100dvh - 40px));z-index:102;display:flex;flex-direction:column;background:#141417;border:1px solid rgba(255,255,255,.14);border-radius:22px 22px 0 0;box-shadow:0 -12px 48px rgba(0,0,0,.5);overflow:hidden;transition:transform .38s cubic-bezier(.2,.8,.2,1)}",
".sparkbot-panel.open{transform:translate(-50%,0)}",
".sparkbot-head{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.09);flex:none}",
".sparkbot-av{width:40px;height:40px;border-radius:50%;background:#111 url("+AVATAR+") center 18%/80% no-repeat;border:1.5px solid rgba(255,255,255,.25);flex:none}",
".sparkbot-head b{display:block;color:#fff;font-size:15px;line-height:1.2}",
".sparkbot-head span{display:block;color:rgba(255,255,255,.6);font-size:12px;margin-top:2px}",
".sparkbot-head span i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:5px;font-style:normal}",
".sparkbot-close{margin-left:auto;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:#fff;font-size:17px;line-height:1;cursor:pointer;flex:none}",
".sparkbot-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:14px 12px 8px;min-height:120px}",
".sparkbot-msg{max-width:80%;padding:9px 13px;border-radius:19px;font:500 15px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap;word-break:break-word;animation:sparkbotIn .3s cubic-bezier(.2,.8,.2,1)}",
".sparkbot-msg.u + .sparkbot-msg.a,.sparkbot-msg.a + .sparkbot-msg.u{margin-top:10px}",
".sparkbot-msg.u{align-self:flex-end;background:#0a84ff;color:#fff;border-bottom-right-radius:6px}",
".sparkbot-msg.a{align-self:flex-start;background:#2c2c30;color:#f4f4f6;border-bottom-left-radius:6px}",
".sparkbot-msg a{color:#5eb1ff}",
".sparkbot-msg.u a{color:#fff;text-decoration:underline}",
"@keyframes sparkbotIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}",
".sparkbot-typing{align-self:flex-start;background:#2c2c30;border-radius:19px;border-bottom-left-radius:6px;padding:12px 14px;display:flex;gap:5px}",
".sparkbot-typing i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.6);animation:sparkbotBlink 1.1s infinite}",
".sparkbot-typing i:nth-child(2){animation-delay:.18s}",
".sparkbot-typing i:nth-child(3){animation-delay:.36s}",
"@keyframes sparkbotBlink{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
".sparkbot-chips{display:flex;gap:8px;overflow-x:auto;padding:6px 12px 10px;flex:none;scrollbar-width:none}",
".sparkbot-chips::-webkit-scrollbar{display:none}",
".sparkbot-chip{flex:none;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;padding:9px 13px;border-radius:99px;cursor:pointer;white-space:nowrap}",
".sparkbot-chip:active{transform:scale(.96)}",
".sparkbot-input{display:flex;gap:8px;padding:10px 12px calc(12px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.09);flex:none}",
".sparkbot-input input{flex:1;min-width:0;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#fff;border-radius:99px;padding:11px 15px;font:500 15px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;outline:none}",
".sparkbot-input input::placeholder{color:rgba(255,255,255,.45)}",
".sparkbot-input button{width:44px;height:44px;flex:none;border-radius:50%;border:0;background:#ff5c00;color:#fff;font-size:18px;cursor:pointer}",
".sparkbot-input button:active{transform:scale(.92)}",
"@media (min-width:720px){.sparkbot-panel{left:auto;right:16px;transform:translateY(calc(100% + 24px));bottom:calc(164px + env(safe-area-inset-bottom));border-radius:22px}.sparkbot-panel.open{transform:none}}"
].join("\n");

/* ---------- Build DOM ---------- */
function build(){
  var st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
  var fab=document.createElement("button");
  fab.className="sparkbot-fab"; fab.setAttribute("aria-label","Chat with SPARK Bot");
  fab.innerHTML='<span class="sparkbot-dot"></span>';
  var panel=document.createElement("div");
  panel.className="sparkbot-panel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","SPARK Bot chat");
  panel.innerHTML=
    '<div class="sparkbot-head"><span class="sparkbot-av"></span><div><b>'+NAME+'</b><span><i></i>Online - answers instantly</span></div><button class="sparkbot-close" aria-label="Close chat">&times;</button></div>'
    +'<div class="sparkbot-msgs" id="sparkbotMsgs"></div>'
    +'<div class="sparkbot-chips" id="sparkbotChips"></div>'
    +'<div class="sparkbot-input"><input id="sparkbotIn" type="text" placeholder="Ask about SPARK..." autocomplete="off" enterkeyhint="send"><button id="sparkbotSend" aria-label="Send">&#10148;</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  var msgs=panel.querySelector("#sparkbotMsgs"),
      chips=panel.querySelector("#sparkbotChips"),
      input=panel.querySelector("#sparkbotIn"),
      sendBtn=panel.querySelector("#sparkbotSend"),
      closeBtn=panel.querySelector(".sparkbot-close"),
      greeted=false;

  function addMsg(text, who){
    var d=document.createElement("div");
    d.className="sparkbot-msg "+who; d.innerHTML=text;
    msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight;
    return d;
  }
  function showTyping(){
    var t=document.createElement("div");
    t.className="sparkbot-typing"; t.innerHTML="<i></i><i></i><i></i>";
    msgs.appendChild(t); msgs.scrollTop=msgs.scrollHeight;
    return t;
  }
  function ask(q){
    q=(q||"").trim(); if(!q) return;
    addMsg(q.replace(/</g,"&lt;"), "u");
    input.value="";
    var t=showTyping();
    setTimeout(function(){
      t.remove();
      addMsg(answerFor(q), "a");
    }, 450+Math.min(500, q.length*8));
  }
  CHIPS.forEach(function(c){
    var b=document.createElement("button");
    b.className="sparkbot-chip"; b.textContent=c;
    b.addEventListener("click", function(){ ask(c); });
    chips.appendChild(b);
  });
  function open(){
    panel.classList.add("open");
    if(!greeted){ greeted=true; addMsg("Hey! I am the SPARK Bot. Ask me anything about SPARK 2K26 - events, prizes, registration, venue, or contacts.", "a"); }
    setTimeout(function(){ input.focus(); }, 380);
  }
  function close(){ panel.classList.remove("open"); }
  fab.addEventListener("click", function(){ panel.classList.contains("open")?close():open(); });
  closeBtn.addEventListener("click", close);
  sendBtn.addEventListener("click", function(){ ask(input.value); });
  input.addEventListener("keydown", function(e){ if(e.key==="Enter"){ e.preventDefault(); ask(input.value); } });
}

if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", build); }
else { build(); }
})();

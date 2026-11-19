/* SPARK Bot v10 — Axo-style chat assistant for SPARK 2K26.
   Header matches the Axofy Axo bot: big robot avatar on top, name + role,
   small language button + mute button only (no settings, no CC).
   Avatar: the SPARK robot head in its own natural shape, no circle, no
   border, no background. The head image is a tight transparent cutout, so
   the head itself is the button and the header mark.
   The closed panel hides fully (translate 100% + 80px) so the header
   avatar never peeks out at the bottom of the page.
   Languages: English (default) + Malayalam (Manglish). The matcher understands
   BOTH English and Manglish keywords in either language.
   Sound: when sound is on, the bot READS its reply aloud (text-to-speech);
   the mute button turns voice off. Client-side only, no server.
   Keyboard: the pages use interactive-widget=resizes-content, so the layout
   viewport shrinks when the on-screen keyboard opens and the panel
   (bottom:0) sits flush above it with no gap. No JS coordinate math.
   Drag: ONLY the closed head (FAB) moves, the open panel stays put. Drag the head anywhere; a tap opens the chat. Slow drag follows the finger, a fast flick glides with momentum. Transform-only, so it cannot slow the site down.
   hero). Slow drag follows the finger 1:1 on the GPU transform. A fast
   flick down closes it, a fast flick up snaps it tall. Transform-only, so
   it cannot slow the site down.
   Loaded on every page except the home page. */
(function(){
"use strict";
var AVATAR="/assets/spark-bot-avatar.webp?v=2";
var NAME="SPARK Bot";
var ROLE="SPARK Assistant";

/* ---------- Knowledge base ----------
   k  = English keywords, mk = Manglish (Malayalam in Latin script) keywords.
   a  = English answer, m = Manglish answer. Matching checks both lists. */
var KB=[
{ k:["when","date","day","time","start","schedule","timing","which day","what day"],
  mk:["eppo","eppozhanu","eppa","ennu","ennanu","ethra","samayam","date","time"],
  a:"SPARK 2K26 is on <b>Friday, 27 November 2026</b>, and it starts at <b>10 AM</b>. One day, four events, one campus.",
  m:"SPARK 2K26 <b>Friday, 27 November 2026</b> aanu, <b>10 AM</b> nu start cheyyum. Oru day, 4 events, oru campus." },
{ k:["where","venue","location","place","address","reach","how to reach","college","collage","ramapuram","kottayam","map","direction","where is the college","where is spark","where is the fest","college location","college address","fest venue","where is it happening"],
  mk:["evide","evideya","evdieya","evidea","evideyanu","venue","sthalam","college","collage","ramapuram","kottayam","map","ethu","fest evide","spark evide","college evide","evideyanu college","collage evdieya","evdieya college"],
  a:"The fest is at <b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b>. You can see the venue map on the <b>Map</b> page.",
  m:"Fest <b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b> aanu. Venue map <b>Map</b> page il kaanam." },
{ k:["event","events","competition","competitions","arena","what are the events","list of events","which events"],
  mk:["events","enthokkeyanu","entha","competition","enth","events enthokke","enthokkeya"],
  a:"There are <b>4 events</b>, in this order:<br>1. <b>Reels Competition</b> (team 1-4) - Rs.2,000 + Rs.1,000<br>2. <b>Prompting</b> (team 1-2) - Rs.1,500 + Rs.750<br>3. <b>Quiz</b> (team 2-3) - Rs.2,000 + Rs.1,000<br>4. <b>Treasure Hunt</b> (team 3-5) - Rs.6,000 winner-takes-all<br><br>Total prize pool: <b>Rs.14,250</b>. Tap any event on the Events page to register.",
  m:"<b>4 events</b> undu:<br>1. <b>Reels Competition</b> (team 1-4) - Rs.2,000 + Rs.1,000<br>2. <b>Prompting</b> (team 1-2) - Rs.1,500 + Rs.750<br>3. <b>Quiz</b> (team 2-3) - Rs.2,000 + Rs.1,000<br>4. <b>Treasure Hunt</b> (team 3-5) - Rs.6,000 winner-takes-all<br><br>Total prize pool: <b>Rs.14,250</b>. Register cheyyan Events page il event select cheyyuka." },
{ k:["reel","reels","reel competition","reel creation","video","short video"],
  mk:["reel","reels","video"],
  a:"<b>Reels Competition</b> - Create a reel that stops the scroll.<br>Team: 1-4 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Agnivesh Santhosh, Daniel.<br><a href=\"/registration/reels-competition\">Register for Reels Competition</a>",
  m:"<b>Reels Competition</b> - Create a reel that stops the scroll.<br>Team: 1-4 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Agnivesh Santhosh, Daniel.<br><a href=\"/registration/reels-competition\">Register for Reels Competition</a>" },
{ k:["prompt","prompting","ai prompt","prompt engineering"],
  mk:["prompt","prompting","ai"],
  a:"<b>Prompting</b> - The art of crafting the perfect AI prompt.<br>Team: 1-2 members. Prizes: <b>1st Rs.1,500, 2nd Rs.750</b>.<br>Coordinator: Adithya Rajagopal.<br><a href=\"/registration/prompting\">Register for Prompting</a>",
  m:"<b>Prompting</b> - The art of crafting the perfect AI prompt.<br>Team: 1-2 members. Prizes: <b>1st Rs.1,500, 2nd Rs.750</b>.<br>Coordinator: Adithya Rajagopal.<br><a href=\"/registration/prompting\">Register for Prompting</a>" },
{ k:["quiz"],
  mk:["quiz"],
  a:"<b>Quiz</b> - A battle of brains across rapid rounds of questions.<br>Team: 2-3 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Aleena, Niya.<br><a href=\"/registration/quiz\">Register for Quiz</a>",
  m:"<b>Quiz</b> - A battle of brains across rapid rounds of questions.<br>Team: 2-3 members. Prizes: <b>1st Rs.2,000, 2nd Rs.1,000</b>.<br>Coordinators: Aleena, Niya.<br><a href=\"/registration/quiz\">Register for Quiz</a>" },
{ k:["treasure","treasure hunt","hunt","clue","clues"],
  mk:["treasure","hunt","clue"],
  a:"<b>Treasure Hunt</b> - A campus-wide race of clues leading to the hidden treasure.<br>Team: 3-5 members. Prize: <b>Rs.6,000, winner-takes-all</b> (no 2nd prize).<br>Coordinators: Abhinavu Babu, Aadhil Kabeer.<br><a href=\"/registration/treasure-hunt\">Register for Treasure Hunt</a>",
  m:"<b>Treasure Hunt</b> - A campus-wide race of clues leading to the hidden treasure.<br>Team: 3-5 members. Prize: <b>Rs.6,000, winner-takes-all</b> (no 2nd prize).<br>Coordinators: Abhinavu Babu, Aadhil Kabeer.<br><a href=\"/registration/treasure-hunt\">Register for Treasure Hunt</a>" },
{ k:["prize","prizes","prize pool","prize money","win","winner","reward","cash"],
  mk:["prize","prizes","sammana","cash","kitum","kaanum","price"],
  a:"Total prize pool: <b>Rs.14,250</b>.<br>Reels Competition: Rs.2,000 + Rs.1,000<br>Prompting: Rs.1,500 + Rs.750<br>Quiz: Rs.2,000 + Rs.1,000<br>Treasure Hunt: <b>Rs.6,000, winner-takes-all</b>.",
  m:"Total prize pool: <b>Rs.14,250</b>.<br>Reels Competition: Rs.2,000 + Rs.1,000<br>Prompting: Rs.1,500 + Rs.750<br>Quiz: Rs.2,000 + Rs.1,000<br>Treasure Hunt: <b>Rs.6,000, winner-takes-all</b>." },
{ k:["register","registration","sign up","signup","join","apply","how to register","enroll","participate","entry"],
  mk:["register","eppadi","cheyyum","join","apply","participate","cheyyan","regist"],
  a:"To register, go to the <b>Events</b> page, tap the event you want, and fill the form. You need your <b>school name and a valid school ID</b>. Registration is per event, and your team size must fit that event's limit.<br><a href=\"/events\">See all events</a>",
  m:"Register cheyyan <b>Events</b> page il poyi event select cheythu form fill cheyyuka. <b>School name-um valid school ID-um</b> venam. Registration oru event nu vendiyanu, team size event nte limit il otta venam.<br><a href=\"/events\">See all events</a>" },
{ k:["team","team size","members","how many","group"],
  mk:["team","members","ethra","per","aalu"],
  a:"Team sizes:<br>Reels Competition: 1-4 members<br>Prompting: 1-2 members<br>Quiz: 2-3 members<br>Treasure Hunt: 3-5 members",
  m:"Team sizes:<br>Reels Competition: 1-4 members<br>Prompting: 1-2 members<br>Quiz: 2-3 members<br>Treasure Hunt: 3-5 members" },
{ k:["coordinator","coordinators","contact","phone","number","call","help","support","who to contact","organiser","organizer","lead","student lead","associate lead"],
  mk:["contact","phone","number","vilikku","help","support","coordinator","lead","ananthu","bista"],
  a:"Main contacts:<br><b>Student Lead - Ananthu Anil</b>: 7510142466<br><b>Associate Lead - Bista Mariya Jojo</b>: 9746446739<br><br>Faculty: Shibu Kallarackal (9446375272), Archana Gopinath (9495955010).<br>For help with a specific event, contact that event's coordinators on its registration page.",
  m:"Main contacts:<br><b>Student Lead - Ananthu Anil</b>: 7510142466<br><b>Associate Lead - Bista Mariya Jojo</b>: 9746446739<br><br>Faculty: Shibu Kallarackal (9446375272), Archana Gopinath (9495955010).<br>Oru event ne kurichu help venamenkil aa event nte registration page il coordinators ne contact cheyyuka." },
{ k:["instagram","insta","social","follow"],
  mk:["instagram","insta","social","follow"],
  a:"Follow the fest on Instagram: <b>@celesta2k26</b> - updates, announcements and results.<br><a href=\"https://www.instagram.com/celesta2k26\" target=\"_blank\" rel=\"noopener\">@celesta2k26 on Instagram</a>",
  m:"Fest ne Instagram il follow cheyyuka: <b>@celesta2k26</b> - updates, announcements, results.<br><a href=\"https://www.instagram.com/celesta2k26\" target=\"_blank\" rel=\"noopener\">@celesta2k26 on Instagram</a>" },
{ k:["who","eligible","eligibility","can i join","who can join","can join","can i participate","school","student","12th","class","standard","age"],
  mk:["arokke","join","cheyyam","eligible","school","student","12th","class","pattum","pattumo"],
  a:"SPARK is an <b>inter-school</b> fest for <b>12th standard school students</b>. You need your school name and a valid school ID to register. Around 150-200 students are expected.",
  m:"SPARK oru <b>inter-school</b> fest aanu, <b>12th standard school students</b> nu vendiyanu. School name-um valid school ID-um venam. 150-200 students varum ennu pratheekshikkunnu." },
{ k:["nexus","association","organised","organized","organiser","who organises","who organizes","mac","college"],
  mk:["nexus","association","organise","college","mac"],
  a:"SPARK 2K26 is organised by <b>NEXUS</b>, the Association of Computer Applications at Mar Augusthinose College, Ramapuram. Tagline: <b>Decode Your Future</b>.",
  m:"SPARK 2K26 organise cheyyunnathu <b>NEXUS</b> aanu, Mar Augusthinose College, Ramapuram ile Association of Computer Applications. Tagline: <b>Decode Your Future</b>." },
{ k:["fee","fees","cost","price","payment","pay","free","entry fee","ticket"],
  mk:["fee","fees","cost","price","payment","free","cash"],
  a:"There is no entry fee mentioned on the site. Registration is free through the Events page. If you are unsure, ask the Student Lead Ananthu Anil (7510142466).",
  m:"Site il entry fee onnum paranjittilla. Registration Events page vazhi free aanu. Doubt undenkil Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["bring","what to bring","carry","id","id card","school id"],
  mk:["bring","carry","id","kondu","varuka"],
  a:"Bring your <b>valid school ID card</b> - it is required for registration and entry. Bring your school name and team details too.",
  m:"<b>Valid school ID card</b> kondu varuka - registration-um entry-um athu venam. School name-um team details-um koodi kondu varuka." },
{ k:["food","lunch","snack","eat","canteen"],
  mk:["food","lunch","snack","eat","canteen","bhakshanam"],
  a:"Food details are not announced on the site yet. Ask the Student Lead Ananthu Anil (7510142466) for the latest food arrangements.",
  m:"Food details site il announce cheythittilla. Latest food arrangements nu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["hi","hello","hey","hai","good morning","good afternoon","good evening","vanakkam","namaste"],
  mk:["hi","hello","hey","hai","vanakkam","namaste","namaskaram"],
  a:"Hey! Ask me anything about SPARK 2K26 - events, prizes, registration, venue, or contacts.",
  m:"Hey! SPARK 2K26 ne kurichu enthum chodikkam - events, prizes, registration, venue, contacts." },
{ k:["thank","thanks","thank you","nandhi","thanks a lot"],
  mk:["thanks","thank","nandhi","nanni"],
  a:"Anytime! See you on 27 November. Good luck!",
  m:"Welcome! 27 November nu kaanam. Good luck!" },
{ k:["bye","goodbye","see you"],
  mk:["bye","goodbye"],
  a:"See you at SPARK on 27 November!",
  m:"27 November SPARK il kaanam!" },
{ k:["schedule","timetable","time table","programme","program","order of events","when does it start","agenda","running order"],
  mk:["schedule","timetable","samayam","eppo","thudangum","avsanam","paripadi","order"],
  a:"SPARK starts at <b>10 AM on Friday, 27 November 2026</b>. Event order: 1. Reels Competition, 2. Prompting, 3. Quiz, 4. Treasure Hunt. Exact timings for each event are not announced yet - ask the Student Lead Ananthu Anil (7510142466).",
  m:"SPARK <b>27 November 2026, 10 AM</b> nu start cheyyum. Event order: 1. Reels Competition, 2. Prompting, 3. Quiz, 4. Treasure Hunt. Oru event nte exact timing announce cheythittilla - Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["dress code","dress","what to wear","clothes","uniform","wear"],
  mk:["dress","dress code","ethu","wear","clothes","uniform"],
  a:"No dress code is announced on the site. For the latest, ask the Student Lead Ananthu Anil (7510142466).",
  m:"Dress code site il announce cheythittilla. Latest nu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["certificate","certificates","participation certificate","will i get a certificate"],
  mk:["certificate","certificates"],
  a:"Certificates are not mentioned on the site yet. Ask the Student Lead Ananthu Anil (7510142466) whether participants get certificates.",
  m:"Certificates ne kurichu site il onnum paranjittilla. Participants nu certificate kittumo ennu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["judge","judging","judges","how are winners decided","criteria","evaluation","scoring","marks"],
  mk:["judge","judging","criteria","marks","winner"],
  a:"Prizes are listed on each event page. The judging criteria are not published on the site - ask the event coordinators or the Student Lead Ananthu Anil (7510142466).",
  m:"Prizes oru event page il undu. Judging criteria site il publish cheythittilla - event coordinators, allenkil Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["rules","rule","terms","conditions","what are the rules"],
  mk:["rules","rule","terms","conditions","niyamam"],
  a:"Main rules: SPARK is for <b>12th standard school students</b> only. You need your <b>school name and a valid school ID</b>. Register separately for each event, and your team size must fit that event's limit (Reels 1-4, Prompting 1-2, Quiz 2-3, Treasure Hunt 3-5).",
  m:"Main rules: SPARK <b>12th standard school students</b> nu mathramanu. <b>School name-um valid school ID-um</b> venam. Oru event nu register cheyyuka, team size event nte limit il otta venam (Reels 1-4, Prompting 1-2, Quiz 2-3, Treasure Hunt 3-5)." },
{ k:["multiple events","more than one event","two events","join two","join all","all events","can i join multiple"],
  mk:["multiple","randu","all events","ethra"],
  a:"Yes, you can register for more than one event. Registration is per event, so register separately for each event you want to join on the Events page.",
  m:"Yes, oru event il kooduthal join cheyyam. Registration oru event nu vendiyanu, join cheyyan ullathil okke separate aayi Events page il register cheyyuka." },
{ k:["different schools","other school","team from different","mixed team"],
  mk:["different","mixed"],
  a:"That is not stated on the site. Ask the Student Lead Ananthu Anil (7510142466) whether a team can have members from different schools.",
  m:"Athu site il paranjittilla. Oru team il different schools il ninnum members aakamo ennu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["deadline","last date","last day","when to register by","register before","closing date"],
  mk:["deadline","last date","avsanam","eppo"],
  a:"No registration deadline is published on the site. The fest is on <b>27 November 2026</b>, so register before that. For the last date, ask the Student Lead Ananthu Anil (7510142466).",
  m:"Registration deadline site il publish cheythittilla. Fest <b>27 November 2026</b> aanu, athinu munne register cheyyuka. Last date nu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["results","result","when results","announcement","winners announced","who won"],
  mk:["results","result","winner","announce"],
  a:"Results will be announced at the fest and on Instagram <b>@celesta2k26</b>. For the exact result time, ask the Student Lead Ananthu Anil (7510142466).",
  m:"Results fest il um Instagram <b>@celesta2k26</b> il um announce cheyyum. Exact time nu Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["sponsor","sponsors","sponsored","who sponsors"],
  mk:["sponsor","sponsors"],
  a:"SPARK sponsors include <b>SpicyJack, Cafe Classico, Ajay Electronics, KLOG and Fisat Computers</b>.",
  m:"SPARK sponsors: <b>SpicyJack, Cafe Classico, Ajay Electronics, KLOG, Fisat Computers</b>." },
{ k:["who made","who built","who created","developer","technical lead","made this site","built this"],
  mk:["made","built","developer","technical"],
  a:"The SPARK website is built and run by <b>NEXUS</b>. Technical Lead: <b>Aben Sojan</b>.",
  m:"SPARK website build cheythathum run cheyyunnathum <b>NEXUS</b> aanu. Technical Lead: <b>Aben Sojan</b>." },
{ k:["what is spark","about spark","tell me about spark","spark meaning","tagline","decode your future","spark entha"],
  mk:["spark","tagline","entha","enth","spark entha","entha spark"],
  a:"<b>SPARK 2K26</b> is an inter-school fest for 12th standard students, organised by NEXUS at Mar Augusthinose College, Ramapuram. Tagline: <b>Decode Your Future</b>. Four events, Rs.14,250 in prizes, on Friday, 27 November 2026 from 10 AM.",
  m:"<b>SPARK 2K26</b> oru inter-school fest aanu, 12th standard students nu vendi, NEXUS organise cheyyunnu, Mar Augusthinose College, Ramapuram il. Tagline: <b>Decode Your Future</b>. 4 events, Rs.14,250 prizes, Friday, 27 November 2026, 10 AM muthal." },
{ k:["college student","can college students","i am in college","degree","bca student"],
  mk:["college","degree","bca"],
  a:"No. SPARK is an <b>inter-school</b> fest only for <b>12th standard school students</b>. College students cannot participate.",
  m:"Illa. SPARK oru <b>inter-school</b> fest aanu, <b>12th standard school students</b> nu mathram. College students nu participate cheyyan pattilla." },
{ k:["accommodation","stay","hotel","where to stay","hostel","rooms"],
  mk:["stay","hotel","hostel","room","accommodation"],
  a:"Accommodation is not mentioned on the site. Ask the Student Lead Ananthu Anil (7510142466).",
  m:"Accommodation ne kurichu site il onnum paranjittilla. Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["parking","vehicle","bike","car","where to park"],
  mk:["parking","vehicle","bike","car"],
  a:"Parking details are not on the site. Ask the Student Lead Ananthu Anil (7510142466).",
  m:"Parking details site il illa. Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["solo","alone","single","by myself","without team","i am alone","can i join solo","join solo","solo join","solo join cheyyamo","thaniye join"],
  mk:["solo","alone","single","thaniye","solo join","thaniye join","join cheyyamo"],
  a:"Yes, you can join solo in <b>Reels Competition (1-4)</b> and <b>Prompting (1-2)</b>, both allow a team of 1. Quiz needs 2-3 and Treasure Hunt needs 3-5.",
  m:"Yes, <b>Reels Competition (1-4)</b> um <b>Prompting (1-2)</b> um thaniye join cheyyam. Quiz nu 2-3 venam, Treasure Hunt nu 3-5 venam." },
{ k:["change registration","cancel registration","edit registration","update my registration","registered wrong","mistake","change my registration","cancel my registration","edit my registration"],
  mk:["change","cancel","edit","update","mistake"],
  a:"You cannot change a registration yourself on the site. Contact the Student Lead Ananthu Anil (7510142466) and they will fix it.",
  m:"Registration ningal thanne site il change cheyyan pattilla. Student Lead Ananthu Anil (7510142466) ne contact cheyyuka, avar fix cheyyum." },
{ k:["confirmation","did my registration go through","registered successfully","check my registration","i registered","go through","my registration","registered"],
  mk:["confirmation","cheythu","success"],
  a:"After you submit the form and see the success message, your registration is recorded. To double-check, contact the Student Lead Ananthu Anil (7510142466).",
  m:"Form submit cheythu success message kandu enkil registration record aayi. Double-check cheyyan Student Lead Ananthu Anil (7510142466) ne contact cheyyuka." },
{ k:["quiz topics","quiz syllabus","what is quiz about","quiz questions","quiz rounds"],
  mk:["quiz topics","topics","syllabus","questions"],
  a:"<b>Quiz</b> is a battle of brains across rapid rounds of questions, covering <b>tech, science and general knowledge</b>. Team: 2-3 members. Prizes: 1st Rs.2,000, 2nd Rs.1,000.",
  m:"<b>Quiz</b> oru battle of brains aanu, rapid rounds, <b>tech, science, general knowledge</b> cover cheyyum. Team: 2-3 members. Prizes: 1st Rs.2,000, 2nd Rs.1,000." },
{ k:["reels rules","reel duration","how long reel","reel length","what reel to make"],
  mk:["reels rules","duration","length"],
  a:"<b>Reels Competition</b> - create a reel that stops the scroll. Team: 1-4 members. Prizes: 1st Rs.2,000, 2nd Rs.1,000. The exact reel length and rules are not on the site - ask the coordinators Agnivesh Santhosh or Daniel, or the Student Lead Ananthu Anil (7510142466).",
  m:"<b>Reels Competition</b> - create a reel that stops the scroll. Team: 1-4 members. Prizes: 1st Rs.2,000, 2nd Rs.1,000. Reel nte exact length-um rules-um site il illa - coordinators Agnivesh Santhosh, Daniel, allenkil Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["treasure hunt route","where is treasure","how does treasure hunt work","treasure hunt rules"],
  mk:["treasure hunt route","route"],
  a:"<b>Treasure Hunt</b> is a campus-wide race of clues leading to the hidden treasure. Team: 3-5 members. Prize: Rs.6,000, winner-takes-all. The clue route is part of the event and is revealed on the day.",
  m:"<b>Treasure Hunt</b> oru campus-wide race aanu, clues follow cheythu hidden treasure kandethanam. Team: 3-5 members. Prize: Rs.6,000, winner-takes-all. Clue route event nte bhagavum, aa day reveal cheyyum." },
{ k:["what is prompting","how prompting works","prompting what"],
  mk:["prompting what","prompt"],
  a:"<b>Prompting</b> is the art of crafting the perfect AI prompt. Team: 1-2 members. Prizes: 1st Rs.1,500, 2nd Rs.750. You will be given a task and you must write the best prompt to make the AI deliver.",
  m:"<b>Prompting</b> perfect AI prompt craft cheyyunna kalayanu. Team: 1-2 members. Prizes: 1st Rs.1,500, 2nd Rs.750. Oru task tharum, AI ne kond best output edukkanulla prompt ezhuthanam." },
{ k:["how to reach","bus","transport","route","directions","reach the college","coming from","how to come","how do i get there","how to get to the college","bus route","college bus"],
  mk:["bus","transport","route","reach","eppadi varum","engane varum","varan","bus evide","route etha"],
  a:"The fest is at <b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b>. See the exact location on the <b>Map</b> page. For bus routes and directions from your place, ask the Student Lead Ananthu Anil (7510142466).",
  m:"Fest <b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b> aanu. Exact location <b>Map</b> page il kaanam. Bus routes-um directions-um Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["about the college","college info","mar augusthinose","about mac","college history","collage","college details","tell me about the college"],
  mk:["about the college","about mac","college","collage","college ne kurichu","mac ne kurichu"],
  a:"<b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b> hosts SPARK 2K26. NEXUS, the Association of Computer Applications (BCA department), organises the fest. For more about the college, ask the Student Lead Ananthu Anil (7510142466).",
  m:"<b>Mar Augusthinose College, Ramapuram, Kottayam, Kerala</b> aanu SPARK 2K26 host cheyyunnathu. NEXUS, Association of Computer Applications (BCA department), aanu fest organise cheyyunnathu. College ne kurichu kooduthal ariyam Student Lead Ananthu Anil (7510142466) nod chodikkuka." },
{ k:["help","i need help","emergency","support","assistance"],
  mk:["help","emergency","support"],
  a:"For any help, contact the <b>Student Lead Ananthu Anil (7510142466)</b> or the <b>Associate Lead Bista Mariya Jojo (9746446739)</b>.",
  m:"Help nu <b>Student Lead Ananthu Anil (7510142466)</b> allenkil <b>Associate Lead Bista Mariya Jojo (9746446739)</b> ne contact cheyyuka." },
{ k:["when does it end","end time","closing","what time ends","over by"],
  mk:["end","avsanam","closing"],
  a:"The end time is not announced on the site. The fest starts at 10 AM on 27 November 2026. For the closing time, ask the Student Lead Ananthu Anil (7510142466).",
  m:"End time site il announce cheythittilla. Fest 27 November 2026, 10 AM nu start cheyyum. Closing time nu Student Lead Ananthu Anil (7510142466) nod chodikkuka." }
];
var FALLBACK={
  en:"I don't have that answer yet. Try asking about the events, prizes, registration, venue, or contacts - or call the Student Lead <b>Ananthu Anil (7510142466)</b>.",
  ml:"Aa answer enikku ariyilla. Events, prizes, registration, venue, contacts enningane chodichu nokku - allenkil Student Lead <b>Ananthu Anil (7510142466)</b> ne vilikku."
};
var GREET={
  en:"Hey! I am the SPARK Bot. Ask me anything about SPARK 2K26 - events, prizes, registration, venue, or contacts.",
  ml:"Hey! Njan SPARK Bot aanu. SPARK 2K26 ne kurichu enthum chodikkam - events, prizes, registration, venue, contacts."
};
var CHIPS={
  en:["When is SPARK?","What events are there?","How do I register?","Where is the venue?","Prizes?","Contact"],
  ml:["SPARK eppozhanu?","Events enthokkeyanu?","Register eppadi cheyyum?","Venue evideyanu?","Prizes?","Contact"]
};
var PH={ en:"Ask about SPARK...", ml:"SPARK ne kurichu chodikkuka..." };

/* ---------- State ---------- */
var lang="en";
try{ var saved=localStorage.getItem("sparkbot_lang"); if(saved==="ml"||saved==="en") lang=saved; }catch(e){}
var muted=false;
try{ muted=localStorage.getItem("sparkbot_mute")==="1"; }catch(e){}

/* ---------- Matching (English + Manglish, either language) ---------- */
function norm(s){ return (" "+s.toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()+" "); }
function scoreList(nq, list){
  var score=0;
  for(var j=0;j<list.length;j++){
    var kw=list[j];
    if(kw.indexOf(" ")>=0){ if(nq.indexOf(" "+kw+" ")>=0) score+=3; }
    else if(nq.indexOf(" "+kw+" ")>=0) score+=2;
    else if(kw.length>=5 && nq.indexOf(kw)>=0) score+=1;
  }
  return score;
}
function answerFor(q){
  var nq=norm(q), best=null, bestScore=0;
  for(var i=0;i<KB.length;i++){
    var score=scoreList(nq, KB[i].k) + scoreList(nq, KB[i].mk||[]);
    if(score>bestScore){ bestScore=score; best=KB[i]; }
  }
  if(!best) return FALLBACK[lang];
  return (lang==="ml"&&best.m)?best.m:best.a;
}

/* ---------- Voice: read the bot's reply aloud (text-to-speech) ---------- */
function stripHtml(s){ return s.replace(/<br\s*\/?>/gi,". ").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").trim(); }
function speak(html){
  if(muted) return;
  if(!("speechSynthesis" in window)){ pop(); return; }
  try{
    window.speechSynthesis.cancel();
    var u=new SpeechSynthesisUtterance(stripHtml(html));
    u.lang=(lang==="ml")?"ml-IN":"en-IN";
    u.rate=1; u.pitch=1;
    window.speechSynthesis.speak(u);
  }catch(e){ pop(); }
}
/* Tiny pop, only used when speech is unavailable. */
var AC=null;
function pop(){
  if(muted) return;
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==="suspended") AC.resume();
    var o=AC.createOscillator(), g=AC.createGain();
    o.type="sine"; o.frequency.setValueAtTime(620, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, AC.currentTime+0.09);
    g.gain.setValueAtTime(0.12, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime+0.12);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime+0.13);
  }catch(e){}
}

/* ---------- CSS (Axo-style header, bubbles, chips) ---------- */
var CSS=[
".sparkbot-fab{position:fixed;right:16px;bottom:calc(96px + env(safe-area-inset-bottom));z-index:101;width:76px;height:52px;border:0;border-radius:0;background-color:transparent;background-image:url("+AVATAR+");background-size:contain;background-repeat:no-repeat;background-position:center;cursor:grab;padding:0;filter:drop-shadow(0 6px 16px rgba(0,0,0,.45));transform:translate(var(--fx,0px),var(--fy,0px));touch-action:none;transition:transform .25s cubic-bezier(.2,.8,.2,1)}",
".sparkbot-fab:active{transform:translate(var(--fx,0px),var(--fy,0px)) scale(.92)}",
".sparkbot-fab.dragging{transition:none;will-change:transform;cursor:grabbing}",
".sparkbot-fab .sparkbot-dot{position:absolute;top:0;right:0;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff}",
".sparkbot-panel{position:fixed;left:50%;transform:translate(-50%,calc(100% + 80px));bottom:0;width:min(420px,calc(100% - 16px));max-height:min(600px,calc(100dvh - 40px));z-index:102;display:flex;flex-direction:column;background:#141417;border:1px solid rgba(255,255,255,.14);border-radius:22px 22px 0 0;box-shadow:0 -12px 48px rgba(0,0,0,.5);overflow:visible;transition:transform .38s cubic-bezier(.2,.8,.2,1)}",
".sparkbot-panel.open{transform:translate(-50%,0)}",
".sparkbot-hero{position:relative;flex:none;padding:48px 14px 0;text-align:center}",
".sparkbot-av{position:absolute;top:-41px;left:50%;transform:translateX(-50%);width:120px;height:83px;border:0;border-radius:0;background-color:transparent;background-image:url("+AVATAR+");background-size:contain;background-repeat:no-repeat;background-position:center;filter:drop-shadow(0 8px 20px rgba(0,0,0,.5))}",
".sparkbot-hero b{display:block;color:#fff;font:800 21px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;letter-spacing:.01em}",
".sparkbot-hero span{display:block;color:rgba(255,255,255,.65);font:500 13.5px/1.4 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;margin-top:4px}",
".sparkbot-hero span i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3b82f6;margin-right:6px;font-style:normal}",
".sparkbot-ctl{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:12px}",
".sparkbot-lang{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#fff;font:600 13.5px/1 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;padding:9px 13px;border-radius:99px;cursor:pointer}",
".sparkbot-lang svg{flex:none}",
".sparkbot-lang .chev{font-size:10px;opacity:.7}",
".sparkbot-mute{width:38px;height:38px;flex:none;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;display:grid;place-items:center}",
".sparkbot-mute.off{color:rgba(255,255,255,.45)}",
".sparkbot-close{position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:#fff;font-size:17px;line-height:1;cursor:pointer;z-index:2}",
".sparkbot-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:14px 12px 8px;min-height:110px}",
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
"@media (min-width:720px){.sparkbot-panel{left:auto;right:16px;transform:translateY(calc(100% + 80px));bottom:calc(164px + env(safe-area-inset-bottom));border-radius:22px}.sparkbot-panel.open{transform:none}}"
].join("\n");

/* ---------- Build DOM ---------- */
var GLOBE='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg>';
var SPK_ON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
var SPK_OFF='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

function build(){
  var st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
  var fab=document.createElement("button");
  fab.className="sparkbot-fab"; fab.setAttribute("aria-label","Chat with SPARK Bot");
  fab.innerHTML='<span class="sparkbot-dot"></span>';
  var panel=document.createElement("div");
  panel.className="sparkbot-panel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","SPARK Bot chat");
  panel.innerHTML=
    '<div class="sparkbot-hero"><span class="sparkbot-av"></span>'
    +'<b>'+NAME+'</b><span><i></i>'+ROLE+'</span>'
    +'<div class="sparkbot-ctl"><button class="sparkbot-lang" id="sparkbotLang">'+GLOBE+'<span id="sparkbotLangName">English</span><span class="chev">&#9662;</span></button>'
    +'<button class="sparkbot-mute" id="sparkbotMute" aria-label="Toggle sound"></button></div>'
    +'<button class="sparkbot-close" aria-label="Close chat">&times;</button></div>'
    +'<div class="sparkbot-msgs" id="sparkbotMsgs"></div>'
    +'<div class="sparkbot-chips" id="sparkbotChips"></div>'
    +'<div class="sparkbot-input"><input id="sparkbotIn" type="text" placeholder="Ask about SPARK..." autocomplete="off" enterkeyhint="send"><button id="sparkbotSend" aria-label="Send">&#10148;</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  var msgs=panel.querySelector("#sparkbotMsgs"),
      chipsBox=panel.querySelector("#sparkbotChips"),
      input=panel.querySelector("#sparkbotIn"),
      sendBtn=panel.querySelector("#sparkbotSend"),
      closeBtn=panel.querySelector(".sparkbot-close"),
      langBtn=panel.querySelector("#sparkbotLang"),
      langName=panel.querySelector("#sparkbotLangName"),
      muteBtn=panel.querySelector("#sparkbotMute"),
      greeted=false;

  function langLabel(){ return lang==="ml"?"Malayalam":"English"; }
  function renderChips(){
    chipsBox.innerHTML="";
    CHIPS[lang].forEach(function(c){
      var b=document.createElement("button");
      b.className="sparkbot-chip"; b.textContent=c;
      b.addEventListener("click", function(){ ask(c); });
      chipsBox.appendChild(b);
    });
  }
  function renderMute(){ muteBtn.innerHTML=muted?SPK_OFF:SPK_ON; muteBtn.classList.toggle("off", muted); }
  function applyLang(){
    langName.textContent=langLabel();
    input.placeholder=PH[lang];
    renderChips();
    try{ localStorage.setItem("sparkbot_lang", lang); }catch(e){}
  }
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
      var ans=answerFor(q);
      addMsg(ans, "a");
      speak(ans);
    }, 450+Math.min(500, q.length*8));
  }
  langBtn.addEventListener("click", function(){
    lang=(lang==="en")?"ml":"en";
    applyLang();
    var note=(lang==="ml")?"Malayalam il chodikkam. SPARK ne kurichu enthum chodikkuka.":"Switched to English. Ask me anything about SPARK.";
    addMsg(note, "a");
    speak(note);
  });
  muteBtn.addEventListener("click", function(){
    muted=!muted;
    try{ localStorage.setItem("sparkbot_mute", muted?"1":"0"); }catch(e){}
    renderMute();
    if(muted){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    else { speak(lang==="ml"?"Sound on aanu.":"Sound is on."); }
  });
  function open(){
    panel.classList.add("open");
    if(!greeted){ greeted=true; var g=GREET[lang]; addMsg(g, "a"); speak(g); }
    setTimeout(syncPanel, 60);
    setTimeout(syncPanel, 400);
    setTimeout(function(){ input.focus(); }, 380);
  }
  function close(){
    panel.classList.remove("open");
    panel.style.top=""; panel.style.bottom=""; panel.style.maxHeight="";
    try{ window.speechSynthesis.cancel(); }catch(e){}
  }

  /* Keyboard: the pages use interactive-widget=resizes-content, so the
     layout viewport shrinks when the on-screen keyboard opens and the panel
     (bottom:0) sits flush above it with no gap. No JS coordinate math.
     syncPanel only keeps the latest message in view when the viewport
     moves. The CSS max-height uses 100dvh, which shrinks with the
     keyboard, so the panel always fits. */
  var vv=window.visualViewport;
  function syncPanel(){
    if(!panel.classList.contains("open")) return;
    msgs.scrollTop=msgs.scrollHeight;
  }
  if(vv){ vv.addEventListener("resize", syncPanel); vv.addEventListener("scroll", syncPanel); }
  window.addEventListener("resize", syncPanel);
  input.addEventListener("focus", function(){ setTimeout(syncPanel, 60); setTimeout(syncPanel, 300); setTimeout(syncPanel, 600); });

  /* FAB drag: ONLY the closed head moves, the open panel stays put. Drag
     the head anywhere on screen; a tap (no move) still opens the chat.
     Slow drag follows the finger 1:1 on the GPU transform. A fast flick
     glides it with momentum. It stays where dropped, clamped on screen.
     Transform-only, so it cannot slow the site down. */
  var fabDrag=null, fabRaf=false, fabSuppressClick=false;
  function fabQueue(){
    if(fabRaf) return;
    fabRaf=true;
    requestAnimationFrame(function(){
      fabRaf=false;
      if(!fabDrag) return;
      fab.style.setProperty("--fx", fabDrag.fx+"px");
      fab.style.setProperty("--fy", fabDrag.fy+"px");
    });
  }
  function fabClamp(fx, fy, b){
    var vw=window.innerWidth, vh=window.innerHeight;
    fx=Math.max(8-b.baseL, Math.min(vw-8-b.baseR, fx));
    fy=Math.max(8-b.baseT, Math.min(vh-8-b.baseB, fy));
    return {fx:fx, fy:fy};
  }
  function fabGlide(vx, vy, b){
    var fx=parseFloat(fab.style.getPropertyValue("--fx"))||0;
    var fy=parseFloat(fab.style.getPropertyValue("--fy"))||0;
    function step(){
      vx*=0.92; vy*=0.92;
      if(Math.abs(vx)<0.02 && Math.abs(vy)<0.02) return;
      var c=fabClamp(fx+vx*16, fy+vy*16, b);
      fx=c.fx; fy=c.fy;
      fab.style.setProperty("--fx", fx+"px");
      fab.style.setProperty("--fy", fy+"px");
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  fab.addEventListener("pointerdown", function(e){
    var r=fab.getBoundingClientRect();
    var fx0=parseFloat(fab.style.getPropertyValue("--fx"))||0;
    var fy0=parseFloat(fab.style.getPropertyValue("--fy"))||0;
    fabDrag={x0:e.clientX, y0:e.clientY, fx0:fx0, fy0:fy0, fx:fx0, fy:fy0,
      moved:0, lastX:e.clientX, lastY:e.clientY, lastT:performance.now(),
      velX:0, velY:0,
      baseL:r.left-fx0, baseR:r.right-fx0, baseT:r.top-fy0, baseB:r.bottom-fy0};
    fab.classList.add("dragging");
    try{ fab.setPointerCapture(e.pointerId); }catch(err){}
  });
  fab.addEventListener("pointermove", function(e){
    if(!fabDrag) return;
    var dx=e.clientX-fabDrag.x0, dy=e.clientY-fabDrag.y0;
    fabDrag.moved=Math.max(fabDrag.moved, Math.abs(dx)+Math.abs(dy));
    var c=fabClamp(fabDrag.fx0+dx, fabDrag.fy0+dy, fabDrag);
    fabDrag.fx=c.fx; fabDrag.fy=c.fy;
    var now=performance.now(), dt=now-fabDrag.lastT;
    if(dt>0){ fabDrag.velX=(e.clientX-fabDrag.lastX)/dt; fabDrag.velY=(e.clientY-fabDrag.lastY)/dt; fabDrag.lastX=e.clientX; fabDrag.lastY=e.clientY; fabDrag.lastT=now; }
    fabQueue();
  });
  function fabEndDrag(){
    if(!fabDrag) return;
    var d=fabDrag; fabDrag=null;
    fab.classList.remove("dragging");
    if(d.moved>8){
      fabSuppressClick=true;
      setTimeout(function(){ fabSuppressClick=false; }, 60);
      if(Math.abs(d.velX)>0.5 || Math.abs(d.velY)>0.5){ fabGlide(d.velX, d.velY, d); }
    }
  }
  fab.addEventListener("pointerup", fabEndDrag);
  fab.addEventListener("pointercancel", function(){ if(fabDrag){ fabDrag=null; fab.classList.remove("dragging"); } });

  fab.addEventListener("click", function(){ if(fabSuppressClick) return; panel.classList.contains("open")?close():open(); });
  closeBtn.addEventListener("click", close);
  sendBtn.addEventListener("click", function(){ ask(input.value); });
  input.addEventListener("keydown", function(e){ if(e.key==="Enter"){ e.preventDefault(); ask(input.value); } });

  applyLang();
  renderMute();
}

if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", build); }
else { build(); }
})();

/* Electronic Lecturer — Ahmed Yaseen
 * Mode: Hybrid KB + GPT (fallbacks to KB if no API key)
 * Authoring date: 2025-10-06
*/
const chatLog = () => document.getElementById('chatLog');
const inputEl = () => document.getElementById('userInput');
const kbStatusEl = () => document.getElementById('kbStatus');
const sendBtn = () => document.getElementById('sendBtn');
const micBtn = () => document.getElementById('micBtn');
const ttsToggle = () => document.getElementById('ttsToggle');
const modeSelect = () => document.getElementById('modeSelect');

let KNOWLEDGE_RAW = "";
let SECTIONS = [];
let ASR; // speech recognition
let speaking = false;

// System prompt (scope guardrails)
const SYSTEM_PROMPT = `
أنت "المحاضر الإلكتروني — أحمد ياسين" للبرنامج التدريبي: "الذكاء الصناعي في الإدارة: تعزيز الكفاءة والابتكار".
المؤسسة: مركز التدريب المالي والمحاسبي — وزارة المالية (قسم الحاسبة الإلكترونية).
المهام:
- أجب فقط ضمن نطاق المادة المُدرجة في قاعدة المعرفة المرفقة.
- إن كان السؤال خارج النطاق، قل: "هذا السؤال خارج نطاق المادة المعتمدة لهذه الدورة."
- الأسلوب: عربي فصيح أكاديمي، موجز وواضح، مدعم بأمثلة عندما يلزم.
- لا تقدّم وعوداً تقنية تتجاوز قدرات المنصة.
`;

// Add message to UI
function addMsg(content, who='bot'){
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = content;
  chatLog().appendChild(div);
  chatLog().scrollTop = chatLog().scrollHeight;
  if (who === 'bot' && ttsToggle().checked) speak(content);
}

// Simple TTS using Web Speech API
function speak(text){
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar';
  // let the browser pick default arabic voice
  window.speechSynthesis.speak(u);
}

// Load knowledge base
async function loadKB(){
  try{
    const res = await fetch('knowledge.txt',{cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    KNOWLEDGE_RAW = await res.text();
    // Split by headings "## " into sections
    SECTIONS = KNOWLEDGE_RAW
      .split(/\n(?=##\s)/g)
      .map(s => s.trim())
      .filter(Boolean);
    kbStatusEl().textContent = `تم التحميل: ${SECTIONS.length} قسم معرفي`;
  }catch(e){
    kbStatusEl().textContent = 'فشل تحميل قاعدة المعرفة — تأكد من وجود الملف.';
  }
}

// naive retrieve: rank sections by keyword overlap
function retrieve(query, topK=3){
  if (!SECTIONS.length) return [];
  const q = query.toLowerCase().replace(/[^\u0600-\u06FF\w\s]/g,' ');
  const qTokens = q.split(/\s+/).filter(Boolean);
  const scored = SECTIONS.map((sec,idx)=>{
    const low = sec.toLowerCase();
    let score = 0;
    qTokens.forEach(t => { if (low.includes(t)) score += 1; });
    return {idx, sec, score};
  }).sort((a,b)=>b.score-a.score);
  return scored.slice(0, topK).filter(s => s.score>0).map(s=>s.sec);
}

// Main ask flow
async function ask(){
  const q = inputEl().value.trim();
  if(!q) return;
  addMsg(q,'user');
  inputEl().value = '';

  // Always retrieve top sections
  const retrieved = retrieve(q, 4);
  const contextBlock = retrieved.length ?
    "المقاطع ذات الصلة:\n" + retrieved.join("\n\n") :
    "لا توجد مقاطع مطابقة في قاعدة المعرفة.";

  const mode = modeSelect().value;
  const hasKey = typeof window.OPENAI_API_KEY === 'string' && window.OPENAI_API_KEY.length>0;

  if ((mode === 'kb') || !hasKey){
    // KB-only answer
    let answer;
    if (retrieved.length){
      // simple heuristic: return the best section or a concise extract
      answer = summarizeFromKB(q, retrieved);
    }else{
      answer = "هذا السؤال خارج نطاق المادة المعتمدة لهذه الدورة.";
    }
    addMsg(answer,'bot');
    return;
  }

  // else GPT / Hybrid
  addMsg('⏳ جارِ التفكير…','bot');
  try{
    const payload = {
      model: 'gpt-5',
      messages: [
        {role:'system', content: SYSTEM_PROMPT},
        {role:'system', content: contextBlock},
        {role:'user', content: q}
      ],
      temperature: 0.3
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{
        'Authorization': 'Bearer ' + window.OPENAI_API_KEY,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (text){
      // replace the "thinking" message content
      const last = chatLog().querySelector('.msg.bot:last-child');
      if(last && last.textContent.includes('جارِ التفكير')){
        last.textContent = text;
      }else{
        addMsg(text,'bot');
      }
      if(ttsToggle().checked) speak(text);
    }else{
      addMsg('تعذر الحصول على استجابة من GPT — تم التحويل لوضع قاعدة المعرفة.','bot');
      const fallback = retrieved.length ? summarizeFromKB(q, retrieved) :
        "هذا السؤال خارج نطاق المادة المعتمدة لهذه الدورة.";
      addMsg(fallback,'bot');
    }
  }catch(err){
    addMsg('حدث خطأ في الاتصال بـ GPT — تم التحويل لوضع قاعدة المعرفة.','bot');
    const fallback = retrieved.length ? summarizeFromKB(q, retrieved) :
      "هذا السؤال خارج نطاق المادة المعتمدة لهذه الدورة.";
    addMsg(fallback,'bot');
  }
}

// Very light summarization from KB (rule-based)
function summarizeFromKB(q, sections){
  // If there's a section that starts with a heading matching query terms, prioritize it
  const titleMatch = sections.find(s => /^##\s/.test(s));
  let out = sections[0];
  // Try to extract 8-12 lines
  const lines = out.split('\n').slice(0, 12);
  return lines.join('\n').trim();
}

// Init ASR (browser-dependent)
function initASR(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    micBtn().disabled = true;
    micBtn().textContent = 'الميكروفون غير مدعوم';
    return;
  }
  ASR = new SR();
  ASR.lang = 'ar-IQ'; // Arabic (Iraq) if supported
  ASR.interimResults = false;
  ASR.maxAlternatives = 1;

  ASR.onresult = e => {
    const text = e.results[0][0].transcript;
    inputEl().value = text;
    ask();
  };
  ASR.onend = () => { micBtn().textContent = 'ابدأ التسجيل'; };
  ASR.onerror = () => { micBtn().textContent = 'حاول مرة أخرى'; };
}

document.addEventListener('DOMContentLoaded', ()=>{
  loadKB();
  initASR();
  sendBtn().addEventListener('click', ask);
  inputEl().addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); ask(); }
  });
  micBtn().addEventListener('click', ()=>{
    if(!ASR) return;
    micBtn().textContent = 'جارِ الاستماع… تحدّث الآن';
    ASR.start();
  });
});

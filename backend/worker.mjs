// Gardner Classroom's private results API. Deploy to Cloudflare Workers with a D1 DB binding.
const CHORDS=[['Small C','xxx010'],['Small G','xxx003'],['Small G7','xxx001'],['Em','022000'],['D','xx0232'],['C','x32010'],['G','320003'],['A','x02220'],['A7','x02020'],['Am','x02210'],['D7','xx0212'],['E','022100']];
const BUILD=['C','G','D','Am'];
const RUBRIC={position:3,C:2,G:2,D:2,Em:2,Am:2,'G-D':3,'D-Em':3,'Em-C':3,'C-G':3,pulse:5};
const SCHEMA=[
  `CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, student_name TEXT NOT NULL, answers TEXT NOT NULL, written_score INTEGER NOT NULL, section_scores TEXT NOT NULL, practical_scores TEXT, practical_score INTEGER, teacher_note TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL, graded_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS submissions_date ON submissions(submitted_at DESC)`,
  `CREATE TABLE IF NOT EXISTS teacher_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS request_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`
];
const initialized=new WeakMap();
async function initialize(db){if(!initialized.has(db))initialized.set(db,db.batch(SCHEMA.map(sql=>db.prepare(sql))).catch(error=>{initialized.delete(db);throw error}));await initialized.get(db)}
export function grade(a){const sections={strings:a.strings.reduce((s,v,i)=>s+Number(v.trim().toUpperCase()==='EADGBE'[i]),0),symbols:a.symbols.reduce((s,v,i)=>s+(v===['skip','open','press','nut'][i]?2:0),0),names:a.names.reduce((s,v,i)=>s+(v===CHORDS[i][0]?2:0),0),diagrams:0,knowledge:a.knowledge.reduce((s,v)=>s+(v==='0'?2:0),0),apply:a.apply.reduce((s,v,i)=>s+(v===['0','2','0','0'][i]?2:0),0)};for(const name of BUILD){const v=a.diagrams[name],shape=CHORDS.find(c=>c[0]===name)[1].split('');if(name==='G'&&v.join('')==='32oo33'){sections.diagrams+=4;continue}if(shape.every((x,i)=>!['x','0'].includes(x)||v[i]===(x==='0'?'o':'x')))sections.diagrams++;shape.forEach((x,i)=>{if(!['x','0'].includes(x)&&v[i]===x)sections.diagrams++})}return{sections,total:Object.values(sections).reduce((s,v)=>s+v,0)}}
export function validAnswers(a){if(!a||typeof a!=='object')return false;const lengths={strings:6,symbols:4,names:12,knowledge:4,apply:4};if(!Object.entries(lengths).every(([k,n])=>Array.isArray(a[k])&&a[k].length===n&&a[k].every(v=>typeof v==='string'&&v.length<60)))return false;return a.strings.every(v=>v.length<=1)&&a.symbols.every(v=>['','skip','open','press','nut'].includes(v))&&a.names.every(v=>v===''||CHORDS.some(c=>c[0]===v))&&[...a.knowledge,...a.apply].every(v=>['','0','1','2'].includes(v))&&BUILD.every(k=>Array.isArray(a.diagrams?.[k])&&a.diagrams[k].length===6&&a.diagrams[k].every(v=>['','x','o','1','2','3','4'].includes(v)))}
async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('')}
async function samePassword(a,b){const x=await hash(a),y=await hash(b);let difference=0;for(let i=0;i<x.length;i++)difference|=x.charCodeAt(i)^y.charCodeAt(i);return difference===0}
const COOKIE='__Host-gardner_teacher';
function sessionCookie(token,age=28800){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`}
async function authenticated(request,db){const token=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!token||!/^[a-f0-9]{64}$/.test(token))return false;return !!await db.prepare('SELECT token_hash FROM teacher_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first()}
async function limit(request,db,kind,max){const hour=Math.floor(Date.now()/3600000),address=request.headers.get('CF-Connecting-IP')||'unknown',bucket=kind+':'+hour+':'+await hash(address);const row=await db.prepare('INSERT INTO request_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,Date.now()+7200000).first();return row.attempts<=max}
async function body(request){if(Number(request.headers.get('Content-Length'))>16000)throw new Error('Too much data');const raw=await request.text();if(raw.length>16000)throw new Error('Too much data');return JSON.parse(raw)}
function unpack(row){return{...row,answers:JSON.parse(row.answers),section_scores:JSON.parse(row.section_scores),practical_scores:row.practical_scores?JSON.parse(row.practical_scores):null}}
export default{async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=['https://gardnerclassroom.com','https://www.gardnerclassroom.com'];if(env.ALLOW_LOCALHOST==='true')allowed.push('http://localhost:8765','http://127.0.0.1:8765');
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(allowed.includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Credentials']='true'}
  const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
  if(origin&&!allowed.includes(origin))return json({error:'This origin is not allowed.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if(['POST','PATCH'].includes(request.method)&&!allowed.includes(origin))return json({error:'Open this tool from Gardner Classroom.'},403);
  const path=new URL(request.url).pathname;
  if(path==='/api/health')return json({service:'Gardner Classroom results',database:!!env.DB,teacherLogin:!!env.TEACHER_PASSWORD&&env.TEACHER_PASSWORD.length>=12});
  if(!env.DB)return json({error:'Results storage is being configured. Keep this tab open and try again.'},503);
  try{
    await initialize(env.DB);
    if(path==='/api/submissions'&&request.method==='POST'){
      const data=await body(request),name=typeof data.name==='string'?data.name.trim():'';
      if(name.length<2||name.length>80||!validAnswers(data.answers)||typeof data.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.id))return json({error:'Check your name and answers before submitting.'},400);
      const answers=JSON.stringify({strings:data.answers.strings,symbols:data.answers.symbols,names:data.answers.names,diagrams:Object.fromEntries(BUILD.map(n=>[n,data.answers.diagrams[n]])),knowledge:data.answers.knowledge,apply:data.answers.apply});
      const existing=await env.DB.prepare('SELECT id,student_name,answers,written_score,section_scores,submitted_at FROM submissions WHERE id=?').bind(data.id).first();
      if(existing){if(existing.student_name!==name||existing.answers!==answers)return json({error:'This submission was already saved. Start a new test to send new answers.'},409);return json({id:existing.id,score:{total:existing.written_score,sections:JSON.parse(existing.section_scores)},completedAt:existing.submitted_at})}
      if(!await limit(request,env.DB,'submit',500))return json({error:'Too many submissions. Please try again later.'},429);
      const score=grade(data.answers),completedAt=new Date().toISOString();
      await env.DB.prepare('INSERT INTO submissions(id,student_name,answers,written_score,section_scores,submitted_at) VALUES(?,?,?,?,?,?)').bind(data.id,name,answers,score.total,JSON.stringify(score.sections),completedAt).run();
      return json({id:data.id,score,completedAt},201);
    }
    if(path==='/api/teacher/login'&&request.method==='POST'){
      if(!env.TEACHER_PASSWORD||env.TEACHER_PASSWORD.length<12)return json({error:'The teacher password has not been configured yet.'},503);
      if(!await limit(request,env.DB,'login',12))return json({error:'Too many sign-in attempts. Try again in an hour.'},429);
      const data=await body(request);if(typeof data.password!=='string'||data.password.length>200||!await samePassword(data.password,env.TEACHER_PASSWORD))return json({error:'Incorrect teacher password.'},401);
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
      await env.DB.prepare('INSERT INTO teacher_sessions(token_hash,expires_at) VALUES(?,?)').bind(await hash(token),Date.now()+28800000).run();
      await env.DB.batch([env.DB.prepare('DELETE FROM teacher_sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('DELETE FROM request_limits WHERE expires_at<?').bind(Date.now())]);
      return json({signedIn:true},200,{'Set-Cookie':sessionCookie(token)});
    }
    if(path.startsWith('/api/teacher/')){
      if(!await authenticated(request,env.DB))return json({error:'Sign in to view private teacher results.'},401);
      if(path==='/api/teacher/session'&&request.method==='GET')return json({signedIn:true});
      if(path==='/api/teacher/logout'&&request.method==='POST'){const token=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);await env.DB.prepare('DELETE FROM teacher_sessions WHERE token_hash=?').bind(await hash(token)).run();return json({signedIn:false},200,{'Set-Cookie':sessionCookie('',0)})}
      if(path==='/api/teacher/submissions'&&request.method==='GET'){
        const offset=Math.max(0,Math.min(100000,parseInt(new URL(request.url).searchParams.get('offset')||'0',10)||0));
        const rows=await env.DB.prepare('SELECT id,student_name,written_score,practical_score,submitted_at,graded_at FROM submissions ORDER BY submitted_at DESC,id LIMIT 100 OFFSET ?').bind(offset).all();
        return json({submissions:rows.results,nextOffset:rows.results.length===100?offset+100:null});
      }
      const match=path.match(/^\/api\/teacher\/submissions\/([a-f0-9-]{36})$/i);
      if(match){
        const row=await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(match[1]).first();if(!row)return json({error:'Submission not found.'},404);
        if(request.method==='GET')return json({submission:unpack(row)});
        if(request.method==='PATCH'){
          const data=await body(request);if(!data.scores||Object.entries(RUBRIC).some(([key,max])=>!Number.isInteger(data.scores[key])||data.scores[key]<0||data.scores[key]>max)||typeof data.note!=='string'||data.note.length>2000)return json({error:'Select a score for every playing item. Notes can contain up to 2,000 characters.'},400);
          const scores=Object.fromEntries(Object.keys(RUBRIC).map(k=>[k,data.scores[k]])),practicalScore=Object.values(scores).reduce((s,v)=>s+v,0),gradedAt=new Date().toISOString();
          await env.DB.prepare('UPDATE submissions SET practical_scores=?,practical_score=?,teacher_note=?,graded_at=? WHERE id=?').bind(JSON.stringify(scores),practicalScore,data.note,gradedAt,row.id).run();
          return json({practicalScore,gradedAt});
        }
      }
    }
    return json({error:'Not found.'},404);
  }catch(error){if(error instanceof SyntaxError||error.message==='Too much data')return json({error:'Please send a valid benchmark submission.'},400);return json({error:'Could not save or load results. Your answers are still in this tab; please try again.'},503)}
}};

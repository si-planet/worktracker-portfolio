import './strict-schema';
import {basePath,logicalPath,routeURL,demoURL,allowedDemoPath} from './route';
import { createCategoryApi } from './category-api.mjs';
import { fixture, companyId, projectId, project, tags } from './fixture';
import { restoreMonthSeed } from './month-seed';
const key=`wt-portfolio-demo-v4:${basePath}`;
let handler: (route:any)=>Promise<any>;
const {state}=await fixture({route:async(_pattern,fn)=>{handler=fn;}});
let saved:unknown;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
const restored=restoreMonthSeed(saved);
state.entries=restored.entries;
let colors:Record<string,any>=restored.colors;
const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const persist=()=>{try{localStorage.setItem(key,JSON.stringify({entries:state.entries,colors,seedVersion:restored.seedVersion}));}catch{}};
if(restored.shouldPersist)persist();
const categories=createCategoryApi({companyId,projects:[project],tags,initial:(()=>{try{return JSON.parse(localStorage.getItem(key+'-categories')||'{}')||{};}catch{return {};}})(),save:(value:any)=>localStorage.setItem(key+'-categories',JSON.stringify(value))});
let importance:Record<string,any>=Object.fromEntries(state.entries.filter((_,i)=>[0,5].includes(i)).map(e=>[e.id,{workEntryId:e.id,importance:true,version:1}]));try{const saved=JSON.parse(localStorage.getItem(key+'-importance')||'null');if(saved&&typeof saved==='object')importance=saved;}catch{}

globalThis.fetch=async(input,init)=>{
 const u=new URL(input instanceof Request?input.url:String(input),location.href);
 if(u.origin!==location.origin){throw new Error('Portfolio demo blocks external requests');}
 if(!u.pathname.startsWith('/api/')){return new Response('Demo API only',{status:403});}
 const requestedCompany=/^\/api\/companies\/([^/]+)(?:\/|$)/.exec(u.pathname)?.[1];
 if(requestedCompany&&requestedCompany!==companyId)return json({code:'NOT_FOUND'},404);
 const method=init?.method||(input instanceof Request?input.method:'GET');
 const body=typeof init?.body==='string'?JSON.parse(init.body):{};
 if(method==='GET'&&u.pathname.endsWith('/work-importance'))return json({companyId,items:u.searchParams.getAll('id').map(workEntryId=>importance[workEntryId]||{workEntryId,importance:null,version:null})});
 const importanceMatch=/\/work-entries\/([^/]+)\/importance$/.exec(u.pathname);
 if(method==='PUT'&&importanceMatch){const id=importanceMatch[1],old=importance[id]||{version:null};if(!state.entries.some(x=>x.id===id))return json({code:'NOT_FOUND'},404);if(old.version!==body.version)return json({code:'VERSION_CONFLICT'},409);if(body.importance!==null&&typeof body.importance!=='boolean')return json({code:'VALIDATION_FAILED'},400);importance[id]={workEntryId:id,importance:body.importance,version:(old.version||0)+1};localStorage.setItem(key+'-importance',JSON.stringify(importance));return json(importance[id]);}
 const categoryResponse=categories.handle(u.pathname,method,body);if(categoryResponse)return categoryResponse;
 if(method==='GET'&&u.pathname.endsWith('/work-colors'))return json({companyId,items:u.searchParams.getAll('id').map(workEntryId=>colors[workEntryId]||{workEntryId,color:null,version:null})});
 const colorMatch=/\/work-entries\/([^/]+)\/color$/.exec(u.pathname);
 if(method==='PUT'&&colorMatch){const id=colorMatch[1],old=colors[id]||{version:null};if(!state.entries.some(x=>x.id===id))return json({code:'NOT_FOUND'},404);if(old.version!==body.version)return json({code:'VERSION_CONFLICT'},409);if(body.color!==null&&!/^#[a-f\d]{6}$/i.test(body.color))return json({code:'VALIDATION_FAILED'},400);colors[id]={workEntryId:id,color:body.color,version:(old.version||0)+1};persist();return json(colors[id]);}
 if(!['GET','POST','PATCH','DELETE','PUT'].includes(method))return json({code:'DEMO_UNSUPPORTED'},405);
 // Only record editing and display preferences are simulated. No account/admin mutations.
 if(method!=='GET'&&!/\/work-entries(?:\/[^/]+(?:\/status)?)?$/.test(u.pathname))return json({code:'DEMO_UNSUPPORTED'},403);
 let response:Response|undefined;
 await handler({request:()=>({url:()=>u.href,method:()=>method,postDataJSON:()=>body}),fulfill:async(o:any)=>{response=json(o.json,o.status||200);}});
 if(!response)return json({code:'DEMO_UNSUPPORTED'},404);
 if(method==='DELETE'&&response.ok){const id=u.pathname.split('/').at(-1)!;delete colors[id];}
 if(method!=='GET'&&response.ok)persist();
 return response;
};
const base=`/c/${companyId}`;
let initialPath='/';try{initialPath=logicalPath();}catch{}
if(initialPath==='/'||!allowedDemoPath(initialPath))history.replaceState(null,'',demoURL(`${base}/month?year=2026&month=2026-10&date=2026-10-01&projectId=${projectId}`));
window.addEventListener('hashchange',()=>window.location.reload());
const banner=document.createElement('aside');banner.className='demo-banner';banner.innerHTML='<strong>PORTFOLIO DEMO</strong><span>2026년 10월 가상 데이터 · 이 브라우저에만 저장 · 계정/서버 연결 없음</span><button type="button" id="demo-export">JSON 내려받기</button><button type="button" id="demo-reset">데모 초기화</button>';document.body.prepend(banner);const scope=document.createElement('details');scope.className='demo-scope';scope.innerHTML='<summary>체험 범위와 저장 방식</summary><p>가상 데이터로 월간·주간·일간 업무와 색상·중요 표시를 체험할 수 있습니다. 변경 내용은 이 브라우저에만 저장됩니다. 일간·주간 메모 작성, 로그인·계정 관리·WBS 가져오기·서버 저장은 공개 데모에 포함하지 않습니다.</p>';banner.after(scope);
banner.querySelector('#demo-reset')!.addEventListener('click',()=>{if(confirm('이 데모의 가상 업무를 초기화할까요?')){localStorage.removeItem(key);localStorage.removeItem(key+'-categories');localStorage.removeItem(key+'-importance');for(const k of Object.keys(sessionStorage)){if(k.includes(companyId)||k.includes('work-user-a'))sessionStorage.removeItem(k);}location.href=basePath;}});
document.addEventListener('click',event=>{
 const a=(event.target as Element).closest('a');if(!a)return;
 if(a.download&&a.href.startsWith('blob:'))return;
 const raw=a.getAttribute('href')||'';
 if(raw.startsWith('#')&&!raw.startsWith('#/')){
  event.preventDefault();const target=document.getElementById(raw.slice(1));
  if(target){target.scrollIntoView();target.focus();}return;
 }
 try{a.href=demoURL(a.href).href;}
 catch{event.preventDefault();alert('이 포트폴리오 데모는 월간·주간·일간 업무와 색상 편집을 제공합니다. 계정·관리·서버 기능은 포함하지 않습니다.');}
},true);
banner.querySelector('#demo-export')!.addEventListener('click',()=>{const blob=new Blob([JSON.stringify({schema:'worktracker-portfolio-demo/v1',synthetic:true,entries:state.entries,colors},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='worktracker-demo.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const trimDemoNavigation=()=>{for(const a of document.querySelectorAll<HTMLAnchorElement>('#root a[href]')){
 const raw=a.getAttribute('href')||'';if(raw.startsWith('#')&&!raw.startsWith('#/'))continue;
 try{const u=routeURL(a.href);if(!allowedDemoPath(u.pathname))a.hidden=true;else a.href=demoURL(u).href;}
 catch{a.hidden=true;}
}};
const trimUnsupported=()=>{trimDemoNavigation();for(const b of document.querySelectorAll<HTMLButtonElement>('#root button')){if(['복제','마감 연장','업무 미루기','업무 중단','진행 재개','WBS 연결','회사 설정'].includes(b.textContent?.trim()||''))b.hidden=true;}};
new MutationObserver(trimUnsupported).observe(document.getElementById('root')!,{childList:true,subtree:true});
await import('../web/main');

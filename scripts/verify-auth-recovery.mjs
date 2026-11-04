import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import { resolvePdfBrowserExecutable } from '../dist/src/pdf/browser-executable.js';
import { setAuthCookies, readCookie, ACCESS_TOKEN_COOKIE } from '../dist/src/auth/auth-cookie.util.js';

const root=path.resolve(process.argv[2]??path.join(import.meta.dirname,'../../../Imarrt Bill Ui/Imarrt-BillUi'));
const output=path.resolve(import.meta.dirname,'../.work/auth-recovery');fs.mkdirSync(output,{recursive:true});
const build=await Bun.build({entrypoints:[root+'/src/lib/api.ts'],target:'browser',format:'esm',outdir:output,define:{'process.env.NEXT_PUBLIC_API_URL':JSON.stringify('/api/v1')}});
if(!build.success)throw new AggregateError(build.logs,'API client bundle failed');
const bundle=await build.outputs[0].text();
const previousEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';
const user={id:'qa-user',name:'Synthetic User',email:'qa@example.invalid',role:'OWNER',sessionId:'qa-session',mfaEnabled:true,mfaVerified:true};
const checks=[];
let state;
function resetState(){state={generation:0,expired:false,denyProtected:false,denyRefresh:false,late:false,refreshes:0,me:0,unauthorized:0,requests:[]};}
resetState();
const app=express();app.use(express.json());
app.get('/client.js',(_,res)=>res.type('application/javascript').send(bundle));
app.use('/api/v1',async(req,res)=>{
  const url=req.path;const cookie=readCookie(req,ACCESS_TOKEN_COOKIE);state.requests.push({url,method:req.method});
  const authenticated=cookie===`qa-access-${state.generation}`&&!state.expired;
  const cookies=()=>setAuthCookies(res,{accessToken:`qa-access-${state.generation}`,refreshToken:`qa-refresh-${state.generation}`});
  if(url==='/auth/login'){cookies();return res.json({mfaRequired:false});}
  if(url==='/auth/refresh'){
    state.refreshes++;await new Promise(resolve=>setTimeout(resolve,40));
    if(state.denyRefresh)return res.status(state.refreshStatus??401).json({message:'Refresh unavailable'});
    state.generation++;state.expired=false;cookies();return res.json({message:'Session refreshed'});
  }
  if(url==='/auth/me'){state.me++;return authenticated?res.json(user):res.status(401).json({message:'Unauthorized'});}
  if(url==='/branches'&&authenticated)return res.json([{id:'qa-branch',businessId:'qa-business',isActive:true}]);
  if(!authenticated||state.denyProtected){
    state.unauthorized++;if(state.late&&url==='/accounts')await new Promise(resolve=>setTimeout(resolve,180));
    return res.status(401).json({message:'Unauthorized'});
  }
  if(url==='/forbidden')return res.status(403).json({message:'Insufficient permissions'});
  return res.json([]);
});
app.get(/.*/,(_,res)=>res.type('html').send('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module">import * as client from "/client.js";window.client=client;window.ready=true;</script></body></html>'));
const server=await new Promise(resolve=>{const handle=app.listen(4018,'127.0.0.1',()=>resolve(handle));});
const browser=await puppeteer.launch({executablePath:await resolvePdfBrowserExecutable(),headless:true,args:process.env.PUPPETEER_NO_SANDBOX==='true'?['--no-sandbox','--disable-setuid-sandbox']:[]});
async function page(){resetState();const context=await browser.createBrowserContext();const tab=await context.newPage();await tab.goto('http://localhost:4018/dashboard');await tab.waitForFunction(()=>window.ready);await tab.evaluate(async()=>{localStorage.setItem('activeBusinessId','qa-business');localStorage.setItem('activeBranchId:qa-business','qa-branch');await window.client.api.post('/auth/login',{});await window.client.getCurrentUser();});return {tab,context};}
async function check(name,work){try{await work();checks.push({name,passed:true});console.log('PASS '+name);}catch(error){checks.push({name,passed:false,error:String(error),requests:state.requests,refreshes:state.refreshes});console.log('FAIL '+name+': '+error);}finally{await Promise.all(browser.browserContexts().filter(context=>context!==browser.defaultBrowserContext()).map(context=>context.close()));}}
try {
 await check('production HttpOnly cookies work on localhost',async()=>{const{tab,context}=await page();await tab.evaluate(()=>window.client.api.get('/items'));assert.equal(state.unauthorized,0);const cookies=await tab.cookies('http://localhost:4018/api/v1/auth/me');assert.ok(cookies.some(cookie=>cookie.name===ACCESS_TOKEN_COOKIE&&cookie.httpOnly&&cookie.secure));await context.close();});
 await check('expired cached sessions revalidate before business requests',async()=>{const{tab,context}=await page();state.expired=true;await tab.evaluate(()=>{const real=Date.now;Date.now=()=>real()+31_000;});await tab.evaluate(()=>window.client.api.get('/items'));assert.equal(state.unauthorized,0,'An expired auth check should recover before /items is sent');assert.equal(state.refreshes,1);assert.ok(state.me>=3);await context.close();});
 await check('parallel and late 401 responses share one refresh',async()=>{const{tab,context}=await page();state.expired=true;state.late=true;const result=await tab.evaluate(async()=>await Promise.all(['/suppliers','/parties','/items','/documents','/invoices','/accounts'].map(async url=>{try{await window.client.api.get(url);return true;}catch{return false;}})));assert.ok(result.every(Boolean));assert.equal(state.refreshes,1,'Late old responses must reuse the already refreshed session');await context.close();});
 await check('401 after a successful refresh returns to login without a retry loop',async()=>{const{tab,context}=await page();state.denyProtected=true;await tab.evaluate(()=>window.client.api.get('/items').catch(()=>null)).catch(()=>undefined);await tab.waitForFunction(()=>location.pathname==='/login',{timeout:3000});assert.equal(state.refreshes,1);await context.close();});
 await check('expired refresh token returns to login',async()=>{const{tab,context}=await page();state.expired=true;state.denyRefresh=true;await tab.evaluate(()=>window.client.api.get('/items').catch(()=>null)).catch(()=>undefined);await tab.waitForFunction(()=>location.pathname==='/login',{timeout:3000});assert.equal(state.refreshes,1);await context.close();});
 await check('permission errors do not refresh or sign out the user',async()=>{const{tab,context}=await page();const status=await tab.evaluate(()=>window.client.api.get('/forbidden').then(()=>0,error=>error.response.status));assert.equal(status,403);assert.equal(state.refreshes,0);assert.ok((await tab.evaluate(()=>window.client.getCurrentUser())).id);await context.close();});
 await check('temporary refresh-server errors preserve the login and allow recovery',async()=>{const{tab,context}=await page();state.expired=true;state.denyRefresh=true;state.refreshStatus=503;const status=await tab.evaluate(()=>window.client.api.get('/items').then(()=>0,error=>error.response?.status));assert.equal(status,503);assert.equal(new URL(tab.url()).pathname,'/dashboard');state.denyRefresh=false;await tab.evaluate(()=>window.client.api.get('/items'));assert.equal(new URL(tab.url()).pathname,'/dashboard');await context.close();});
 fs.writeFileSync(output+'/results.json',JSON.stringify({checks,databaseAccess:false,liveApiAccess:false},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.filter(check=>check.passed).length,failed:checks.filter(check=>!check.passed).length,databaseAccess:false}));
 if(checks.some(check=>!check.passed))process.exitCode=1;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));process.env.NODE_ENV=previousEnv;}

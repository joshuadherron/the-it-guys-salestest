import crypto from 'node:crypto';
import {ConfidentialClientApplication} from '@azure/msal-node';
import {query} from './db.js';
import {loginLimit} from './security.js';
export function msalClient() {return new ConfidentialClientApplication({auth:{clientId:process.env.ENTRA_CLIENT_ID,authority:`https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,clientSecret:process.env.ENTRA_CLIENT_SECRET},system:{loggerOptions:{loggerCallback:()=>{},piiLoggingEnabled:false}}});}
export function authRoutes(app) {
 app.get('/auth/login',loginLimit,async(req,res)=>{
  if(!process.env.ENTRA_TENANT_ID||!process.env.ENTRA_CLIENT_ID||!process.env.ENTRA_CLIENT_SECRET)return res.status(503).render('error',{message:'Microsoft sign-in is not configured. Complete the server environment settings.'});
  const verifier=crypto.randomBytes(32).toString('base64url');req.session.auth={state:crypto.randomBytes(32).toString('hex'),nonce:crypto.randomBytes(32).toString('hex'),verifier,at:Date.now()};
  const url=await msalClient().getAuthCodeUrl({scopes:['openid','profile','email'],redirectUri:process.env.ENTRA_REDIRECT_URI,state:req.session.auth.state,nonce:req.session.auth.nonce,codeChallenge:crypto.createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',responseMode:'query'});
  req.session.save(e=>e?res.status(500).send('Session unavailable.'):res.redirect(url));
 });
 app.get('/auth/callback',loginLimit,async(req,res)=>{
  const auth=req.session.auth;delete req.session.auth;
  if(!auth||req.query.state!==auth.state||Date.now()-auth.at>600000||typeof req.query.code!=='string')return res.status(403).send('Sign-in expired or invalid.');
  const result=await msalClient().acquireTokenByCode({code:req.query.code,scopes:['openid','profile','email'],redirectUri:process.env.ENTRA_REDIRECT_URI,codeVerifier:auth.verifier});
  if(result.idTokenClaims?.nonce!==auth.nonce||result.idTokenClaims?.tid!==process.env.ENTRA_TENANT_ID)return res.status(403).send('Wrong tenant or invalid sign-in.');
  const email=(result.idTokenClaims.preferred_username||'').toLowerCase();const [user]=await query('SELECT email,role FROM allowlist WHERE email=? AND enabled=TRUE',[email]);
  if(!user)return res.status(403).send('This account is not allowed.');
  await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));req.session.user=user;res.redirect('/');
 });
 app.post('/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('tig.sid');res.redirect('/');}));
}

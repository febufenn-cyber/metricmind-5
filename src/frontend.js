const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
});

export function serveFrontend(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = new URL(request.url).pathname;
  if (path === '/' || path === '/app') return asset(APP_HTML, 'text/html; charset=utf-8');
  if (path === '/assets/app.css') return asset(APP_CSS, 'text/css; charset=utf-8', 'public, max-age=3600');
  if (path === '/assets/app.js') return asset(APP_JS, 'text/javascript; charset=utf-8', 'public, max-age=3600');
  return null;
}

function asset(body, contentType, cacheControl = 'no-store') {
  return new Response(body, {
    headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl, ...SECURITY_HEADERS }
  });
}

export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Metricmind evidence-first product analytics">
  <title>Metricmind</title>
  <link rel="stylesheet" href="/assets/app.css">
  <script type="module" src="/assets/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Metricmind home"><span aria-hidden="true">M</span> Metricmind</a>
    <div class="top-actions">
      <span id="session-status" class="status-pill" role="status">Not connected</span>
      <button id="configure-button" class="button secondary" type="button">Configure</button>
    </div>
  </header>
  <div class="app-layout">
    <nav class="sidebar" aria-label="Primary navigation">
      <button class="nav-item active" data-view="onboarding" type="button">Connect</button>
      <button class="nav-item" data-view="ask" type="button">Ask</button>
      <button class="nav-item" data-view="investigate" type="button">Investigate</button>
      <button class="nav-item" data-view="metrics" type="button">Metrics</button>
    </nav>
    <main id="main" tabindex="-1">
      <div id="flash" class="flash" role="alert" hidden></div>
      <section id="view-onboarding" class="view" aria-labelledby="onboarding-title">
        <header class="page-heading"><p class="eyebrow">Workspace setup</p><h1 id="onboarding-title">Connect a read-only warehouse</h1><p>Metricmind verifies that the configured role can read approved analytics data and cannot write to it.</p></header>
        <div class="step-grid">
          <article class="card"><span class="step">1</span><h2>Authenticate</h2><p>Use a Supabase access token and select an organization. Tokens are kept in session storage only.</p><button id="open-configure" class="button secondary" type="button">Set session</button></article>
          <article class="card"><span class="step">2</span><h2>Verify connection</h2><p>Check the dedicated reader role, selected table, schema mapping and read-only transaction boundary.</p><button id="test-connection" class="button primary" type="button">Test connection</button></article>
          <article class="card"><span class="step">3</span><h2>Inspect health</h2><p>Review ingestion freshness and semantic dependencies before asking business questions.</p><button id="check-health" class="button secondary" type="button">Check health</button></article>
        </div>
        <div id="connection-result" class="result-panel" aria-live="polite"></div>
      </section>

      <section id="view-ask" class="view" aria-labelledby="ask-title" hidden>
        <header class="page-heading"><p class="eyebrow">Evidence-first analysis</p><h1 id="ask-title">Ask a verified product question</h1><p>Answers include the exact metric version, complete periods, SQL, parameters and data freshness.</p></header>
        <form id="ask-form" class="composer">
          <label for="question">Question</label>
          <textarea id="question" name="question" rows="3" maxlength="500" required placeholder="How did signups change last week?"></textarea>
          <div class="suggestions" aria-label="Example questions">
            <button type="button" data-question="How many signups happened yesterday?">Signups yesterday</button>
            <button type="button" data-question="Show daily activation for the last 30 days">Activation trend</button>
            <button type="button" data-question="Break down purchases by platform last week">Purchases by platform</button>
          </div>
          <button class="button primary" type="submit">Run analysis</button>
        </form>
        <div id="answer-result" class="result-panel" aria-live="polite"></div>
      </section>

      <section id="view-investigate" class="view" aria-labelledby="investigate-title" hidden>
        <header class="page-heading"><p class="eyebrow">Bounded investigation</p><h1 id="investigate-title">Investigate an observed change</h1><p>Metricmind ranks aggregate associations and contradictions. It never presents association as causation.</p></header>
        <form id="investigation-form" class="composer">
          <label for="investigation-question">Investigation question</label>
          <textarea id="investigation-question" name="question" rows="3" maxlength="500" required placeholder="Why did signups drop last week?"></textarea>
          <fieldset><legend>Approved dimensions</legend><label><input type="checkbox" name="dimension" value="platform" checked> Platform</label><label><input type="checkbox" name="dimension" value="source" checked> Source</label><label><input type="checkbox" name="dimension" value="country"> Country</label><label><input type="checkbox" name="dimension" value="app_version"> App version</label></fieldset>
          <button class="button primary" type="submit">Run investigation</button>
        </form>
        <div id="investigation-result" class="result-panel" aria-live="polite"></div>
        <section class="history"><div class="section-heading"><h2>Recent investigations</h2><button id="refresh-investigations" class="button text" type="button">Refresh</button></div><div id="investigation-list"></div></section>
      </section>

      <section id="view-metrics" class="view" aria-labelledby="metrics-title" hidden>
        <header class="page-heading"><p class="eyebrow">Semantic governance</p><h1 id="metrics-title">Verified metrics</h1><p>Every answer is pinned to an immutable metric version. Health warnings are shown before definitions are trusted.</p></header>
        <div class="section-heading"><div><h2>Catalog</h2><p id="catalog-meta" class="muted"></p></div><button id="refresh-metrics" class="button secondary" type="button">Refresh</button></div>
        <div id="metric-grid" class="metric-grid" aria-live="polite"></div>
        <div id="semantic-health" class="result-panel"></div>
      </section>
    </main>
  </div>

  <dialog id="configuration-dialog" aria-labelledby="configuration-title">
    <form id="configuration-form" method="dialog">
      <h2 id="configuration-title">Session configuration</h2>
      <p>Production uses a verified Supabase access token. The token is stored only for this browser tab.</p>
      <label for="access-token">Bearer token</label><input id="access-token" name="token" type="password" autocomplete="off">
      <label for="organization-id">Organization ID</label><input id="organization-id" name="organization" autocomplete="off" required>
      <div class="dialog-actions"><button class="button text" value="cancel" type="button" id="cancel-configuration">Cancel</button><button class="button primary" value="save" type="submit">Save session</button></div>
    </form>
  </dialog>
  <noscript><p class="noscript">Metricmind requires JavaScript to use the interactive analytics workspace.</p></noscript>
</body>
</html>`;

export const APP_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#162033;background:#f5f7fb;--accent:#3157d5;--accent-dark:#2443aa;--border:#dce2ee;--muted:#647086;--surface:#fff;--danger:#9b2c2c;--success:#16794c}*{box-sizing:border-box}body{margin:0;min-height:100vh}.skip-link{position:absolute;left:-999px;top:8px;background:#111;color:#fff;padding:10px;z-index:20}.skip-link:focus{left:8px}.topbar{height:64px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:10}.brand{font-weight:800;color:#17213a;text-decoration:none;font-size:1.1rem}.brand span{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--accent);color:#fff;margin-right:7px}.top-actions{display:flex;gap:10px;align-items:center}.status-pill{font-size:.82rem;padding:6px 10px;border-radius:999px;background:#eef1f7;color:var(--muted)}.status-pill.connected{background:#e2f6ec;color:var(--success)}.app-layout{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100vh - 64px)}.sidebar{background:#17213a;padding:24px 14px;display:flex;flex-direction:column;gap:7px}.nav-item{border:0;border-radius:9px;background:transparent;color:#cbd3e5;text-align:left;padding:12px 14px;font-weight:650;cursor:pointer}.nav-item:hover,.nav-item:focus-visible{background:#26324f;color:#fff}.nav-item.active{background:#fff;color:#17213a}main{padding:34px;max-width:1200px;width:100%;margin:0 auto}.page-heading{max-width:760px;margin-bottom:24px}.page-heading h1{font-size:clamp(1.8rem,4vw,2.7rem);letter-spacing:-.035em;margin:.2rem 0 .6rem}.page-heading p{color:var(--muted);line-height:1.6}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:.74rem;font-weight:800;color:var(--accent)!important}.step-grid,.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card,.composer,.result-card,.history{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 8px 28px rgba(30,45,80,.05)}.card h2{font-size:1.05rem}.card p,.muted{color:var(--muted);line-height:1.55}.step{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#e7ecff;color:var(--accent);font-weight:800}.button{border:0;border-radius:9px;padding:10px 15px;font:inherit;font-weight:700;cursor:pointer}.button.primary{background:var(--accent);color:#fff}.button.primary:hover{background:var(--accent-dark)}.button.secondary{background:#eef1f7;color:#1d2943}.button.text{background:transparent;color:var(--accent)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #8ca4ff;outline-offset:2px}.composer{display:grid;gap:12px;max-width:820px}.composer label,.composer legend,dialog label{font-weight:700}textarea,input{width:100%;border:1px solid #bcc6d9;border-radius:10px;padding:12px;font:inherit;background:var(--surface);color:inherit}fieldset{border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;flex-wrap:wrap;gap:14px}fieldset label{font-weight:500}.suggestions{display:flex;gap:8px;flex-wrap:wrap}.suggestions button{border:1px solid var(--border);background:#fff;border-radius:999px;padding:7px 11px;color:#34415c;cursor:pointer}.result-panel{margin-top:20px}.result-card{margin-bottom:14px}.result-card h2,.result-card h3{margin-top:0}.evidence{border-top:1px solid var(--border);margin-top:16px;padding-top:12px}.evidence summary{cursor:pointer;font-weight:750}.evidence pre{white-space:pre-wrap;word-break:break-word;background:#151d30;color:#edf2ff;padding:14px;border-radius:10px;max-height:360px;overflow:auto}.chart{display:flex;align-items:flex-end;gap:8px;min-height:150px;padding-top:18px;overflow:auto}.bar{min-width:58px;flex:1;background:#dfe6ff;border-radius:7px 7px 2px 2px;position:relative}.bar span{position:absolute;bottom:-25px;font-size:.72rem;color:var(--muted);width:100%;text-align:center;overflow:hidden;text-overflow:ellipsis}.flash{padding:12px 15px;border-radius:10px;background:#fdecec;color:var(--danger);margin-bottom:16px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:30px 0 14px}.history{margin-top:24px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px}.metric-card header{display:flex;justify-content:space-between;gap:10px}.badge{font-size:.72rem;font-weight:800;border-radius:999px;padding:5px 8px;background:#e2f6ec;color:var(--success)}dialog{border:0;border-radius:16px;padding:0;max-width:520px;width:calc(100% - 32px);box-shadow:0 24px 80px rgba(0,0,0,.25)}dialog::backdrop{background:rgba(12,20,38,.65)}dialog form{padding:24px;display:grid;gap:12px}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}.noscript{padding:16px;background:#fff4d9}.loading{color:var(--muted);font-style:italic}.confidence{font-weight:800}.confidence.high{color:var(--success)}.confidence.medium{color:#946200}.confidence.low{color:var(--danger)}@media(max-width:760px){.topbar{padding:0 14px}.app-layout{grid-template-columns:1fr}.sidebar{position:sticky;top:64px;z-index:9;flex-direction:row;overflow:auto;padding:8px;background:#17213a}.nav-item{white-space:nowrap;padding:9px 12px}main{padding:22px 14px}.step-grid,.metric-grid{grid-template-columns:1fr}.status-pill{display:none}}@media(prefers-reduced-motion:no-preference){.view{animation:fade .18s ease-out}@keyframes fade{from{opacity:.55;transform:translateY(4px)}to{opacity:1;transform:none}}}`;

export const APP_JS = `const state={token:sessionStorage.getItem('metricmind.token')||'',organization:localStorage.getItem('metricmind.organization')||'',session:null};
const byId=(id)=>document.getElementById(id);const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node};
function headers(json=false){const value={};if(json)value['Content-Type']='application/json';if(state.token)value.Authorization='Bearer '+state.token;if(state.organization)value['X-Metricmind-Organization']=state.organization;return value}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{...headers(Boolean(options.body)),...(options.headers||{})}});let payload;try{payload=await response.json()}catch{payload={error:{message:'The server returned an unreadable response.'}}}if(!response.ok)throw new Error(payload.error?.message||('Request failed with status '+response.status));return payload}
function flash(message){const node=byId('flash');node.textContent=message||'';node.hidden=!message}
function loading(target,label='Loading…'){target.replaceChildren(el('p',label,'loading'))}
function showView(name){document.querySelectorAll('.view').forEach((node)=>{node.hidden=node.id!=='view-'+name});document.querySelectorAll('.nav-item').forEach((node)=>node.classList.toggle('active',node.dataset.view===name));byId('main').focus()}
function configure(){byId('access-token').value=state.token;byId('organization-id').value=state.organization;byId('configuration-dialog').showModal()}
async function refreshSession(){try{const payload=await api('/v1/session');state.session=payload;const status=byId('session-status');status.textContent=(payload.organization.role+' · '+payload.organization.id);status.classList.add('connected');flash('')}catch(error){state.session=null;const status=byId('session-status');status.textContent='Session required';status.classList.remove('connected');flash(error.message)}}
function resultCard(title,narrative){const card=el('article',undefined,'result-card');card.append(el('h2',title));if(narrative)card.append(el('p',narrative));return card}
function evidenceDetails(value){const details=el('details',undefined,'evidence');details.append(el('summary','Evidence and lineage'));details.append(el('pre',JSON.stringify(value,null,2)));return details}
function chart(spec){if(!spec)return null;const wrap=el('div',undefined,'chart');wrap.setAttribute('role','img');wrap.setAttribute('aria-label','Chart for '+(spec.label||'analysis result'));const data=Array.isArray(spec.data)?spec.data:spec.value!==undefined?[{label:spec.label||'Value',value:spec.value}]:[];const values=data.map((item)=>Number(item.value)||0);const max=Math.max(1,...values);data.forEach((item,index)=>{const bar=el('div',undefined,'bar');bar.style.height=Math.max(6,(values[index]/max)*130)+'px';bar.title=(item.segment||item.period||item.bucket||item.label||'Value')+': '+values[index];bar.append(el('span',item.segment||item.period||item.label||String(index+1)));wrap.append(bar)});return wrap}
function renderAnswer(payload){const target=byId('answer-result');target.replaceChildren();const answer=payload.answer;const card=resultCard(answer.headline,answer.narrative);const confidence=el('p','Confidence: '+answer.confidence,'confidence '+answer.confidence);card.append(confidence);const graph=chart(answer.chart);if(graph)card.append(graph);card.append(evidenceDetails(answer.evidence));target.append(card)}
function renderInvestigation(record){const target=byId('investigation-result');target.replaceChildren();const card=resultCard(record.headline,'Causal status: '+record.causalStatus.replaceAll('_',' '));card.append(el('p','Confidence: '+record.confidence.level+' — '+record.confidence.reason,'confidence '+record.confidence.level));const observations=el('section');observations.append(el('h3','Observed evidence'));const list=el('ul');(record.observations||[]).forEach((item)=>list.append(el('li',item.statement)));observations.append(list);card.append(observations);const hypotheses=el('section');hypotheses.append(el('h3','Bounded hypotheses'));const hypothesisList=el('ul');(record.hypotheses||[]).forEach((item)=>hypothesisList.append(el('li',item.statement+' ('+item.evidenceStrength+' evidence; causality not established)')));hypotheses.append(hypothesisList);card.append(hypotheses);card.append(evidenceDetails(record.evidence));target.append(card)}
async function loadInvestigations(){const target=byId('investigation-list');loading(target);try{const payload=await api('/v1/investigations?limit=10');target.replaceChildren();if(!payload.investigations.length){target.append(el('p','No saved investigations yet.','muted'));return}payload.investigations.forEach((item)=>{const card=resultCard(item.headline,item.question);card.append(el('p',new Date(item.createdAt).toLocaleString()+' · '+item.status,'muted'));target.append(card)})}catch(error){target.replaceChildren(el('p',error.message,'flash'))}}
async function loadMetrics(){const target=byId('metric-grid');loading(target);try{const [catalog,health]=await Promise.all([api('/v1/semantic/metrics'),api('/v1/semantic/health')]);byId('catalog-meta').textContent='Revision '+catalog.revision+' · '+catalog.persistence;target.replaceChildren();catalog.metrics.forEach((metric)=>{const card=el('article',undefined,'metric-card');const header=el('header');header.append(el('h3',metric.name));header.append(el('span','Verified v'+metric.version.number,'badge'));card.append(header,el('p',metric.description,'muted'),el('p','Definition hash: '+metric.version.definitionHash,'muted'));target.append(card)});const healthTarget=byId('semantic-health');healthTarget.replaceChildren();const healthCard=resultCard('Semantic health: '+health.status,'Healthy: '+health.summary.healthy+' · Warnings: '+health.summary.warning+' · Invalid: '+health.summary.invalid);healthCard.append(evidenceDetails(health.metrics));healthTarget.append(healthCard)}catch(error){target.replaceChildren(el('p',error.message,'flash'))}}
async function connectionTest(){const target=byId('connection-result');loading(target,'Verifying read-only role…');try{const [connection,freshness]=await Promise.all([api('/v1/data-sources/test',{method:'POST'}),api('/v1/data-sources/freshness')]);const card=resultCard('Connection verified',connection.message||'The configured role passed the read-only checks.');card.append(el('p','Freshness: '+freshness.status,'confidence '+(freshness.status==='fresh'?'high':'medium')));card.append(evidenceDetails({connection,freshness}));target.replaceChildren(card)}catch(error){target.replaceChildren(el('p',error.message,'flash'))}}
async function healthCheck(){const target=byId('connection-result');loading(target);try{const payload=await api('/v1/semantic/health');const card=resultCard('Semantic health: '+payload.status,'Healthy: '+payload.summary.healthy+' · Warnings: '+payload.summary.warning+' · Invalid: '+payload.summary.invalid);card.append(evidenceDetails(payload.metrics));target.replaceChildren(card)}catch(error){target.replaceChildren(el('p',error.message,'flash'))}}
document.querySelectorAll('.nav-item').forEach((button)=>button.addEventListener('click',()=>{showView(button.dataset.view);if(button.dataset.view==='metrics')loadMetrics();if(button.dataset.view==='investigate')loadInvestigations()}));
document.querySelectorAll('[data-question]').forEach((button)=>button.addEventListener('click',()=>{byId('question').value=button.dataset.question;byId('question').focus()}));
byId('configure-button').addEventListener('click',configure);byId('open-configure').addEventListener('click',configure);byId('cancel-configuration').addEventListener('click',()=>byId('configuration-dialog').close());
byId('configuration-form').addEventListener('submit',(event)=>{event.preventDefault();state.token=byId('access-token').value.trim();state.organization=byId('organization-id').value.trim();sessionStorage.setItem('metricmind.token',state.token);localStorage.setItem('metricmind.organization',state.organization);byId('configuration-dialog').close();refreshSession()});
byId('test-connection').addEventListener('click',connectionTest);byId('check-health').addEventListener('click',healthCheck);byId('refresh-metrics').addEventListener('click',loadMetrics);byId('refresh-investigations').addEventListener('click',loadInvestigations);
byId('ask-form').addEventListener('submit',async(event)=>{event.preventDefault();const target=byId('answer-result');loading(target,'Running verified analysis…');try{renderAnswer(await api('/v1/questions',{method:'POST',body:JSON.stringify({question:byId('question').value})}))}catch(error){target.replaceChildren(el('p',error.message,'flash'))}});
byId('investigation-form').addEventListener('submit',async(event)=>{event.preventDefault();const target=byId('investigation-result');loading(target,'Running bounded investigation…');const dimensions=[...document.querySelectorAll('input[name="dimension"]:checked')].map((node)=>node.value);try{const payload=await api('/v1/investigations',{method:'POST',body:JSON.stringify({question:byId('investigation-question').value,dimensions,maxDimensions:4})});renderInvestigation(payload.investigation);loadInvestigations()}catch(error){target.replaceChildren(el('p',error.message,'flash'))}});
refreshSession();`;

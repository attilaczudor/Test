import * as http from "http";

export interface UiServerConfig {
  port: number;
  host: string;
  gatewayUrl: string;
}

/**
 * Comprehensive OpenClaw Dashboard
 *
 * Tab-based SPA with sections:
 *   - Dashboard: System health overview, provider cards, cost, router stats
 *   - Chat: Direct conversation with agent/council
 *   - Council: Deliberation viewer, member status, escalation log
 *   - Providers: LLM provider health, latency, error tracking
 *   - Activity: Live event feed with routing decisions
 *   - Settings: Thresholds, provider config, council tuning
 */
export class UiServer {
  private server: http.Server | null = null;
  private readonly config: UiServerConfig;

  constructor(config: UiServerConfig) {
    this.config = config;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.listen(this.config.port, this.config.host, () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const requestOrigin = req.headers.origin || "";
    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ws: wss: http: https:; media-src blob:; img-src 'self' data: blob:;"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "1; mode=block");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(this.generateHtml());
    } else if (req.url === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ gatewayUrl: this.config.gatewayUrl }));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }

  generateHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaw v2 - Control Panel</title>
<style>
:root {
  --bg: #0a0e14;
  --surface: #131920;
  --surface2: #1a2230;
  --border: #263040;
  --border-light: #304050;
  --text: #e0e8f0;
  --text-dim: #708090;
  --text-muted: #506070;
  --accent: #4d9fff;
  --accent-dim: #1a3a5f;
  --success: #2dd47b;
  --success-dim: #0f3a24;
  --warning: #f0a030;
  --warning-dim: #3a2a10;
  --danger: #f05050;
  --danger-dim: #3a1515;
  --purple: #a070f0;
  --purple-dim: #2a1a4a;
  --font: -apple-system, 'Segoe UI', 'Inter', sans-serif;
  --mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace;
  --radius: 10px;
  --radius-sm: 6px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);height:100vh;overflow:hidden;display:flex;flex-direction:column}

/* Top Bar */
.topbar{display:flex;align-items:center;gap:16px;padding:0 20px;height:52px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.topbar .logo{font-size:15px;font-weight:700;letter-spacing:-.3px;white-space:nowrap}
.topbar .logo span{color:var(--accent)}
.conn-badge{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);padding:4px 10px;border-radius:20px;background:var(--surface2);border:1px solid var(--border)}
.conn-dot{width:7px;height:7px;border-radius:50%;background:var(--danger);flex-shrink:0}
.conn-dot.on{background:var(--success)}
.tabs{display:flex;gap:2px;margin-left:24px;flex:1}
.tab{padding:8px 16px;font-size:12px;font-weight:500;color:var(--text-dim);border:none;background:none;cursor:pointer;border-radius:var(--radius-sm) var(--radius-sm) 0 0;transition:all .15s;font-family:var(--font);position:relative}
.tab:hover{color:var(--text);background:var(--surface2)}
.tab.active{color:var(--accent);background:var(--surface2)}
.tab.active::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--accent);border-radius:2px 2px 0 0}
.tab .badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;margin-left:4px;background:var(--accent-dim);color:var(--accent)}
.tab .badge.warn{background:var(--warning-dim);color:var(--warning)}

/* Sections */
.sections{flex:1;overflow:hidden}
.section{display:none;height:100%;overflow-y:auto;padding:20px;animation:fadeIn .2s}
.section.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.sec-title{font-size:18px;font-weight:700;margin-bottom:16px;letter-spacing:-.3px}
.sec-sub{font-size:12px;color:var(--text-dim);margin-bottom:20px;margin-top:-10px}

/* Dashboard Grid */
.dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;transition:border-color .15s}
.card:hover{border-color:var(--border-light)}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-title{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-dim);font-weight:600}
.card-value{font-size:28px;font-weight:700;letter-spacing:-.5px;line-height:1.1}
.card-sub{font-size:11px;color:var(--text-dim);margin-top:4px}
.card.wide{grid-column:span 2}
@media(max-width:700px){.card.wide{grid-column:span 1}}

/* Pills */
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:600}
.pill.green{background:var(--success-dim);color:var(--success)}
.pill.blue{background:var(--accent-dim);color:var(--accent)}
.pill.yellow{background:var(--warning-dim);color:var(--warning)}
.pill.red{background:var(--danger-dim);color:var(--danger)}
.pill.purple{background:var(--purple-dim);color:var(--purple)}
.pill-dot{width:5px;height:5px;border-radius:50%;background:currentColor}

/* Provider cards */
.provider-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.provider-card{flex:1;min-width:140px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px}
.provider-card .pname{font-size:12px;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.provider-card .pstat{font-size:10px;color:var(--text-dim);line-height:1.6}

/* Metric bar */
.metric-bar{height:4px;background:var(--surface2);border-radius:2px;margin-top:8px;overflow:hidden}
.metric-bar .fill{height:100%;border-radius:2px;transition:width .5s}
.metric-bar .fill.blue{background:var(--accent)}
.metric-bar .fill.green{background:var(--success)}
.metric-bar .fill.yellow{background:var(--warning)}
.metric-bar .fill.red{background:var(--danger)}

/* Chat Section */
.chat-layout{display:flex;height:100%;gap:0;margin:-20px;overflow:hidden}
.chat-sidebar{width:220px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--surface);flex-shrink:0}
.chat-sidebar h4{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-dim);padding:14px 14px 8px;font-weight:600}
.convo-list{flex:1;overflow-y:auto;padding:0 8px 8px}
.convo-item{padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer;font-size:12px;color:var(--text-dim);margin-bottom:2px;border:1px solid transparent}
.convo-item:hover{background:var(--surface2);color:var(--text)}
.convo-item.active{background:var(--accent-dim);color:var(--accent);border-color:var(--accent)}
.convo-item .time{font-size:9px;color:var(--text-muted);margin-top:2px}
.new-chat-btn{margin:8px;padding:8px;border:1px dashed var(--border);border-radius:var(--radius-sm);background:none;color:var(--text-dim);font-family:var(--font);font-size:12px;cursor:pointer;text-align:center}
.new-chat-btn:hover{border-color:var(--accent);color:var(--accent)}
.chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.chat-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:80%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.6;word-wrap:break-word;position:relative}
.msg.user{align-self:flex-end;background:var(--accent-dim);border:1px solid #2a5080;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border);border-bottom-left-radius:4px}
.msg.system{align-self:center;background:none;color:var(--text-muted);font-size:11px;text-align:center;max-width:100%;padding:4px}
.msg .msg-role{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px}
.msg .msg-meta{font-size:9px;color:var(--text-muted);margin-top:6px;display:flex;gap:8px;flex-wrap:wrap}
.msg .msg-meta .pill{font-size:8px;padding:1px 6px}
.msg pre{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;overflow-x:auto;font-family:var(--mono);font-size:11px;margin-top:6px}
.msg code{font-family:var(--mono);font-size:12px;background:var(--bg);padding:1px 4px;border-radius:3px}
.chat-input{border-top:1px solid var(--border);padding:14px 20px;display:flex;flex-direction:column;gap:8px;background:var(--surface)}
.chat-input-row{display:flex;gap:8px;align-items:flex-end}
.chat-input textarea{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-family:var(--font);font-size:13px;padding:10px 14px;resize:none;outline:none;min-height:42px;max-height:140px;transition:border-color .15s}
.chat-input textarea:focus{border-color:var(--accent)}
.chat-input textarea::placeholder{color:var(--text-muted)}
.chat-actions{display:flex;gap:6px;align-items:center}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text);font-family:var(--font);font-size:12px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn:disabled{opacity:.3;cursor:not-allowed}
.btn.primary{background:var(--accent);color:#000;border-color:var(--accent);font-weight:600}
.btn.primary:hover{opacity:.85}
.btn.sm{padding:5px 10px;font-size:11px}

/* Council Section */
.council-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:900px){.council-grid{grid-template-columns:1fr}}
.tier-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.tier-card h4{font-size:12px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.member-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px;background:var(--surface2)}
.member-row .mdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.member-row .mdot.ready{background:var(--success)}
.member-row .mdot.busy{background:var(--warning);animation:pulse 1s infinite}
.member-row .mdot.offline{background:var(--text-muted)}
.member-row .mdot.error{background:var(--danger)}
.member-row .mname{font-weight:500;flex:1}
.member-row .mrole{color:var(--text-dim);font-size:10px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.escalation-log{margin-top:16px}
.escalation-log h4{font-size:12px;font-weight:600;margin-bottom:10px}
.esc-entry{display:flex;gap:10px;padding:8px 10px;border-radius:var(--radius-sm);margin-bottom:4px;font-size:11px;background:var(--surface);border:1px solid var(--border)}
.esc-entry .esc-body{flex:1}
.esc-entry .esc-time{color:var(--text-muted);font-size:10px;flex-shrink:0}

/* Providers Section */
.provider-detail{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px}
.provider-detail .pd-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.provider-detail .pd-name{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.provider-detail .pd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.pd-stat{background:var(--surface2);border-radius:var(--radius-sm);padding:10px}
.pd-stat .label{font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px}
.pd-stat .val{font-size:18px;font-weight:700;margin-top:2px}

/* Activity Feed */
.feed{max-width:800px}
.feed-item{display:flex;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);margin-bottom:4px;font-size:12px;background:var(--surface);border:1px solid var(--border);transition:border-color .15s}
.feed-item:hover{border-color:var(--border-light)}
.feed-icon{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.feed-icon.local{background:var(--success-dim);color:var(--success)}
.feed-icon.cloud{background:var(--purple-dim);color:var(--purple)}
.feed-icon.council{background:var(--accent-dim);color:var(--accent)}
.feed-body{flex:1;min-width:0}
.feed-body .title{font-weight:500}
.feed-body .detail{color:var(--text-dim);font-size:11px;margin-top:2px}
.feed-time{color:var(--text-muted);font-size:10px;flex-shrink:0;text-align:right}

/* Settings Section */
.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;max-width:1000px}
.setting-group{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.setting-group h4{font-size:12px;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
.setting-row:last-child{border-bottom:none}
.setting-label{font-size:12px}
.setting-label small{display:block;color:var(--text-dim);font-size:10px;margin-top:2px}
.setting-input input[type=number],.setting-input input[type=text]{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--mono);font-size:12px;padding:6px 10px;width:100px;outline:none}
.setting-input input:focus{border-color:var(--accent)}
.toggle{position:relative;width:36px;height:20px;cursor:pointer}
.toggle input{opacity:0;width:0;height:0}
.toggle .slider{position:absolute;inset:0;background:var(--surface2);border:1px solid var(--border);border-radius:10px;transition:.2s}
.toggle .slider::before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:var(--text-dim);left:2px;top:2px;transition:.2s}
.toggle input:checked+.slider{background:var(--accent-dim);border-color:var(--accent)}
.toggle input:checked+.slider::before{transform:translateX(16px);background:var(--accent)}

/* Skill Cards */
.skill-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--surface2);border:1px solid var(--border);transition:border-color .15s}
.skill-card:hover{border-color:var(--border-light)}
.skill-card .sk-icon{width:36px;height:36px;border-radius:8px;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.skill-card .sk-body{flex:1;min-width:0}
.skill-card .sk-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.skill-card .sk-desc{font-size:11px;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skill-card .sk-meta{display:flex;gap:8px;margin-top:4px;font-size:10px;color:var(--text-muted)}
.skill-card .sk-actions{display:flex;gap:4px;flex-shrink:0}

/* Voice Overlay */
.voice-overlay{display:none;position:fixed;inset:0;background:rgba(10,14,20,.96);z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.voice-overlay.active{display:flex}
.voice-orb{width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,var(--accent) 0%,var(--accent-dim) 80%);transition:transform .15s,box-shadow .15s;box-shadow:0 0 40px rgba(77,159,255,.2)}
.voice-orb.listening{animation:orbP 2s ease-in-out infinite}
.voice-orb.speaking{transform:scale(1.1);background:radial-gradient(circle,var(--purple) 0%,var(--purple-dim) 80%);box-shadow:0 0 60px rgba(160,112,240,.4);animation:orbW .8s ease-in-out infinite}
.voice-orb.user{transform:scale(1.15);background:radial-gradient(circle,var(--success) 0%,var(--success-dim) 80%);box-shadow:0 0 60px rgba(45,212,123,.4)}
.voice-orb.processing{background:radial-gradient(circle,var(--warning) 0%,var(--warning-dim) 80%);animation:orbS 1.5s linear infinite}
@keyframes orbP{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes orbW{0%,100%{transform:scale(1.1)}50%{transform:scale(1.05)}}
@keyframes orbS{0%{transform:rotate(0deg) scale(1.03)}100%{transform:rotate(360deg) scale(1.03)}}
.voice-status{font-size:14px;color:var(--text-dim)}
.voice-transcript{font-size:15px;text-align:center;max-width:600px;min-height:22px;padding:0 20px}
.voice-close{position:absolute;top:20px;right:20px;background:none;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-dim);padding:8px 16px;font-family:var(--font);font-size:12px;cursor:pointer}
.voice-close:hover{border-color:var(--danger);color:var(--danger)}

::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--border-light)}
</style>
</head>
<body>

<div class="topbar">
  <div class="logo">Open<span>Claw</span> v2</div>
  <div class="conn-badge">
    <span class="conn-dot" id="connDot"></span>
    <span id="connText">Connecting...</span>
  </div>
  <div class="tabs" id="tabBar">
    <button class="tab active" data-tab="dashboard">Dashboard</button>
    <button class="tab" data-tab="chat">Chat</button>
    <button class="tab" data-tab="council">Council</button>
    <button class="tab" data-tab="providers">Providers</button>
    <button class="tab" data-tab="activity">Activity <span class="badge" id="activityBadge" style="display:none">0</span></button>
    <button class="tab" data-tab="skills">Skills <span class="badge" id="skillsBadge" style="display:none">0</span></button>
    <button class="tab" data-tab="memory">Memory</button>
    <button class="tab" data-tab="repos">Repos</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>
  <button class="btn sm" onclick="toggleVoice()">Voice</button>
</div>

<div class="sections">

<!-- Dashboard -->
<div class="section active" id="sec-dashboard">
  <div class="sec-title">System Overview</div>
  <div class="dash-grid">
    <div class="card">
      <div class="card-header"><span class="card-title">System Status</span></div>
      <div class="card-value" id="d-status" style="color:var(--success)">--</div>
      <div class="card-sub" id="d-uptime"></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Routing</span></div>
      <div class="card-value" id="d-routed">0</div>
      <div class="card-sub"><span id="d-local">0</span> local / <span id="d-escalated">0</span> escalated</div>
      <div class="metric-bar"><div class="fill green" id="d-localBar" style="width:100%"></div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Cloud Spend Today</span></div>
      <div class="card-value" id="d-cost">$0.00</div>
      <div class="card-sub"><span id="d-budget">$10.00</span> daily budget</div>
      <div class="metric-bar"><div class="fill yellow" id="d-costBar" style="width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Council</span></div>
      <div class="card-value" id="d-council">--</div>
      <div class="card-sub" id="d-council-sub">Members ready</div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Memory</span></div>
      <div class="card-value" id="d-memory">--</div>
      <div class="card-sub">Graph nodes</div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Queue</span></div>
      <div class="card-value" id="d-queue">0 / 0</div>
      <div class="card-sub">Running / Pending</div>
    </div>
  </div>
  <div class="card wide" style="margin-bottom:14px">
    <div class="card-header"><span class="card-title">LLM Providers</span></div>
    <div class="provider-row" id="d-providers">
      <div class="provider-card"><div class="pname"><span class="pill green"><span class="pill-dot"></span> local</span> Ollama</div><div class="pstat">Waiting for status...</div></div>
    </div>
  </div>
  <div class="card wide">
    <div class="card-header"><span class="card-title">Smart Router Stats</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
      <div class="pd-stat"><div class="label">Avg Local Conf</div><div class="val" id="d-avgLocalConf">--</div></div>
      <div class="pd-stat"><div class="label">Avg Cloud Conf</div><div class="val" id="d-avgCloudConf">--</div></div>
      <div class="pd-stat"><div class="label">Avg Local Latency</div><div class="val" id="d-avgLocalLat">--</div></div>
      <div class="pd-stat"><div class="label">Avg Cloud Latency</div><div class="val" id="d-avgCloudLat">--</div></div>
      <div class="pd-stat"><div class="label">Council Evals</div><div class="val" id="d-councilEvals">0</div></div>
      <div class="pd-stat"><div class="label">Approvals</div><div class="val" id="d-councilApprovals">0</div></div>
    </div>
  </div>
</div>

<!-- Chat -->
<div class="section" id="sec-chat">
  <div class="chat-layout">
    <div class="chat-sidebar">
      <h4>Conversations</h4>
      <button class="new-chat-btn" onclick="newConvo()">+ New Chat</button>
      <div class="convo-list" id="convoList"></div>
    </div>
    <div class="chat-main">
      <div class="chat-messages" id="chatMessages">
        <div class="msg system">OpenClaw v2 - Local-first AI. Cloud only when the council approves.</div>
      </div>
      <div class="chat-input">
        <div class="chat-input-row">
          <textarea id="chatInput" placeholder="Type a message..." rows="1"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"
            oninput="autoResize(this)"></textarea>
          <button class="btn primary" onclick="sendChat()">Send</button>
        </div>
        <div class="chat-actions">
          <span class="pill green" id="routeIndicator"><span class="pill-dot"></span> Local First</span>
          <label class="btn sm" style="cursor:pointer">Image <input type="file" accept="image/*" onchange="handleImage(event)" style="display:none"></label>
          <button class="btn sm" onclick="toggleVoice()">Mic</button>
          <span style="flex:1"></span>
          <span style="font-size:10px;color:var(--text-muted)" id="chatStatus"></span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Council -->
<div class="section" id="sec-council">
  <div class="sec-title">Council Overview</div>
  <div class="sec-sub">3-Tier thinking engine. Each tier has persistent memory that survives model swaps. Cloud escalation requires your approval.</div>
  <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
    <span class="pill" id="councilStatusPill" style="background:var(--danger-dim);color:var(--danger)"><span class="pill-dot"></span> Stopped</span>
    <button class="btn sm primary" onclick="startCouncil()">Start</button>
    <button class="btn sm" onclick="restartCouncil()">Restart</button>
    <button class="btn sm" onclick="stopCouncil()">Stop</button>
    <span style="flex:1"></span>
    <span style="font-size:11px;color:var(--text-dim)" id="councilMemInfo">Memory: 0 entries</span>
  </div>
  <div class="council-grid">
    <div class="tier-card">
      <h4><span class="pill purple"><span class="pill-dot"></span> Tier 1</span> Director (3-70B)</h4>
      <div id="council-tier1"><div class="member-row"><span class="mdot offline"></span><span class="mname">Not provisioned</span></div></div>
    </div>
    <div class="tier-card">
      <h4><span class="pill blue"><span class="pill-dot"></span> Tier 2</span> Branches (2-20B, 2-5 members)</h4>
      <div id="council-tier2"><div class="member-row"><span class="mdot offline"></span><span class="mname">Not provisioned</span></div></div>
    </div>
    <div class="tier-card" style="grid-column:span 2">
      <h4><span class="pill green"><span class="pill-dot"></span> Tier 3</span> Specialists (0.5-7B, up to 10 per branch)</h4>
      <div id="council-tier3"><div class="member-row"><span class="mdot offline"></span><span class="mname">Not provisioned</span></div></div>
    </div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><span class="card-title">Model Management</span></div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px">Swap any member's model. Memory and personality persist across swaps.</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="swapMemberId" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px">
        <option value="">Select member...</option>
      </select>
      <input type="text" id="swapNewModel" placeholder="New model (e.g. dolphin-llama3:8b)" style="flex:1;min-width:200px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px">
      <select id="swapBackend" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px">
        <option value="ollama">Ollama</option>
        <option value="llamacpp">llama.cpp</option>
        <option value="vllm">vLLM</option>
      </select>
      <button class="btn sm primary" onclick="swapModel()">Swap Model</button>
    </div>
  </div>
  <div class="escalation-log">
    <h4>Recent Escalation Decisions</h4>
    <div id="escalationLog">
      <div class="esc-entry"><div class="esc-body" style="color:var(--text-muted)">No escalation decisions yet</div></div>
    </div>
  </div>
</div>

<!-- Providers -->
<div class="section" id="sec-providers">
  <div class="sec-title">LLM Providers</div>
  <div class="sec-sub">Provider health, latency tracking, and error counts. Local providers are always preferred.</div>
  <div id="providerDetails">
    <div class="provider-detail">
      <div class="pd-header"><div class="pd-name"><span class="pill green"><span class="pill-dot"></span> local</span> Ollama (default)</div></div>
      <div class="pd-stats">
        <div class="pd-stat"><div class="label">Status</div><div class="val">Waiting...</div></div>
        <div class="pd-stat"><div class="label">Latency</div><div class="val">--</div></div>
        <div class="pd-stat"><div class="label">Errors</div><div class="val">0</div></div>
      </div>
    </div>
  </div>
</div>

<!-- Activity -->
<div class="section" id="sec-activity">
  <div class="sec-title">Activity Feed</div>
  <div class="sec-sub">Live routing decisions, escalations, and system events.</div>
  <div class="feed" id="activityFeed">
    <div class="feed-item"><div class="feed-icon local">~</div><div class="feed-body"><div class="title">System started</div><div class="detail">Waiting for events...</div></div><div class="feed-time">now</div></div>
  </div>
</div>

<!-- Skills (ClawHub) -->
<div class="section" id="sec-skills">
  <div class="sec-title">Skills Marketplace</div>
  <div class="sec-sub">Browse and install skills from <a href="https://clawhub.ai" target="_blank" style="color:var(--accent)">ClawHub</a> — the OpenClaw skill ecosystem.</div>
  <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
    <input type="text" id="skillSearch" placeholder="Search skills..." style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 14px;outline:none" onkeydown="if(event.key==='Enter')searchSkills()">
    <button class="btn primary" onclick="searchSkills()">Search</button>
    <button class="btn" onclick="trendingSkills()">Trending</button>
    <button class="btn" onclick="checkSkillUpdates()">Check Updates</button>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap" id="skillTags">
    <button class="btn sm" onclick="searchSkills('productivity')">Productivity</button>
    <button class="btn sm" onclick="searchSkills('developer tools')">Developer</button>
    <button class="btn sm" onclick="searchSkills('smart home')">Smart Home</button>
    <button class="btn sm" onclick="searchSkills('media')">Media</button>
    <button class="btn sm" onclick="searchSkills('communication')">Communication</button>
    <button class="btn sm" onclick="searchSkills('security')">Security</button>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-header"><span class="card-title">Installed Skills</span><span class="pill blue" id="installedCount">0</span></div>
    <div id="installedSkills" style="display:flex;flex-direction:column;gap:6px">
      <div style="color:var(--text-muted);font-size:12px;padding:8px">No skills installed. Search above or browse trending.</div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title" id="searchResultsTitle">Trending Skills</span></div>
    <div id="skillResults" style="display:flex;flex-direction:column;gap:6px">
      <div style="color:var(--text-muted);font-size:12px;padding:8px">Loading...</div>
    </div>
  </div>
</div>

<!-- Memory -->
<div class="section" id="sec-memory">
  <div class="sec-title">Council Memory</div>
  <div class="sec-sub">Persistent memory for each council member. Survives model swaps — knowledge is tied to the member's role, not the LLM.</div>
  <div class="dash-grid" style="margin-bottom:16px">
    <div class="card">
      <div class="card-header"><span class="card-title">Total Knowledge</span></div>
      <div class="card-value" id="mem-total">0</div>
      <div class="card-sub" id="mem-interactions">0 interactions</div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Active Members</span></div>
      <div class="card-value" id="mem-members">0</div>
      <div class="card-sub">with persistent memory</div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">LoRA Adapters</span></div>
      <div class="card-value" id="mem-lora">0</div>
      <div class="card-sub">fine-tuned adapters active</div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Per-Member Memory</span></div>
    <div id="memMemberList" style="display:flex;flex-direction:column;gap:6px">
      <div style="color:var(--text-muted);font-size:12px;padding:8px">No council members registered yet.</div>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="card-header"><span class="card-title">Knowledge Search</span></div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select id="memSearchMember" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px">
        <option value="all">All members</option>
      </select>
      <input type="text" id="memSearchQuery" placeholder="Search knowledge..." style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px" onkeydown="if(event.key==='Enter')searchMemory()">
      <button class="btn sm primary" onclick="searchMemory()">Search</button>
    </div>
    <div id="memSearchResults" style="max-height:300px;overflow-y:auto">
      <div style="color:var(--text-muted);font-size:12px;padding:8px">Enter a query to search council knowledge.</div>
    </div>
  </div>
</div>

<!-- Repositories -->
<div class="section" id="sec-repos">
  <div class="sec-title">Repositories</div>
  <div class="sec-sub">Reference repositories, use-case collections, and knowledge sources. Add repos to build the council's understanding.</div>
  <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
    <input type="text" id="repoUrl" placeholder="GitHub repo URL (e.g. https://github.com/owner/repo)" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 14px;outline:none">
    <input type="text" id="repoLabel" placeholder="Label (optional)" style="width:150px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 14px;outline:none">
    <button class="btn primary" onclick="addRepo()">Add Repo</button>
  </div>
  <div id="repoList" style="display:flex;flex-direction:column;gap:10px">
  </div>
</div>

<!-- Settings -->
<div class="section" id="sec-settings">
  <div class="sec-title">Settings</div>
  <div class="sec-sub">Configure routing thresholds, provider credentials, and council behavior.</div>
  <div class="settings-grid">
    <div class="setting-group">
      <h4>Smart Router</h4>
      <div class="setting-row"><div class="setting-label">Confidence Threshold<small>Below this, council evaluates escalation</small></div><div class="setting-input"><input type="number" id="set-confThreshold" value="0.6" min="0" max="1" step="0.05" onchange="updateSetting('confidenceThreshold',this.value)"></div></div>
      <div class="setting-row"><div class="setting-label">Max Cost Per Request<small>Block cloud requests above this USD</small></div><div class="setting-input"><input type="number" id="set-maxCost" value="0.50" min="0" step="0.10" onchange="updateSetting('maxCostPerRequest',this.value)"></div></div>
      <div class="setting-row"><div class="setting-label">Daily Budget (USD)<small>Maximum cloud spend per day</small></div><div class="setting-input"><input type="number" id="set-dailyBudget" value="10.00" min="0" step="1" onchange="updateSetting('maxDailySpend',this.value)"></div></div>
      <div class="setting-row"><div class="setting-label">Auto Escalate<small>Skip council for escalation</small></div><div class="setting-input"><label class="toggle"><input type="checkbox" id="set-autoEscalate" onchange="updateSetting('autoEscalate',this.checked)"><span class="slider"></span></label></div></div>
    </div>
    <div class="setting-group">
      <h4>Cloud Providers</h4>
      <div class="setting-row"><div class="setting-label">Use Cloud Models<small>Enable 3rd party LLM fallback</small></div><div class="setting-input"><label class="toggle"><input type="checkbox" id="set-useCloud" onchange="updateSetting('useCloudModels',this.checked)"><span class="slider"></span></label></div></div>
      <div class="setting-row"><div class="setting-label">OpenAI API Key<small>Also works with Together, Groq</small></div><div class="setting-input"><input type="text" id="set-openaiKey" placeholder="sk-..." style="width:160px" onchange="updateProviderSetting('openai','apiKey',this.value)"></div></div>
      <div class="setting-row"><div class="setting-label">Anthropic API Key</div><div class="setting-input"><input type="text" id="set-anthropicKey" placeholder="sk-ant-..." style="width:160px" onchange="updateProviderSetting('anthropic','apiKey',this.value)"></div></div>
      <div class="setting-row"><div class="setting-label">Google AI API Key</div><div class="setting-input"><input type="text" id="set-googleKey" placeholder="AIza..." style="width:160px" onchange="updateProviderSetting('google','apiKey',this.value)"></div></div>
    </div>
    <div class="setting-group">
      <h4>Council</h4>
      <div class="setting-row"><div class="setting-label">Consensus Threshold<small>Min avg confidence for consensus</small></div><div class="setting-input"><input type="number" id="set-consensus" value="0.7" min="0" max="1" step="0.05"></div></div>
      <div class="setting-row"><div class="setting-label">Timeout (ms)<small>Max wait per council member</small></div><div class="setting-input"><input type="number" id="set-timeout" value="30000" min="5000" step="5000"></div></div>
      <div class="setting-row"><div class="setting-label">Max Rounds<small>Debate rounds before decision</small></div><div class="setting-input"><input type="number" id="set-maxRounds" value="3" min="1" max="10"></div></div>
    </div>
    <div class="setting-group">
      <h4>Agent</h4>
      <div class="setting-row"><div class="setting-label">Default Model<small>Ollama model for local inference</small></div><div class="setting-input"><input type="text" id="set-model" value="dolphin-mistral:7b" style="width:160px"></div></div>
      <div class="setting-row"><div class="setting-label">Temperature<small>LLM response randomness</small></div><div class="setting-input"><input type="number" id="set-temp" value="0.7" min="0" max="2" step="0.1"></div></div>
      <div class="setting-row"><div class="setting-label">Max Turns<small>Agent loop iteration limit</small></div><div class="setting-input"><input type="number" id="set-maxTurns" value="50" min="1" max="500"></div></div>
    </div>
  </div>
</div>

</div>

<!-- Voice Overlay -->
<div class="voice-overlay" id="voiceOverlay">
  <button class="voice-close" onclick="toggleVoice()">End Conversation</button>
  <div class="voice-orb listening" id="voiceOrb"></div>
  <div class="voice-status" id="voiceStatus">Listening...</div>
  <div class="voice-transcript" id="voiceTranscript"></div>
</div>

<!-- Cloud Approval Dialog -->
<div id="cloudApprovalOverlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:1000;display:none;align-items:center;justify-content:center">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:500px;width:90%">
    <div style="font-size:16px;font-weight:700;margin-bottom:12px">Cloud Escalation Request</div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px">The Director wants to use a cloud LLM. This will send data externally and may incur costs.</div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;font-size:12px">
      <div style="margin-bottom:8px"><strong>Question:</strong> <span id="approvalQuestion"></span></div>
      <div style="margin-bottom:8px"><strong>Local confidence:</strong> <span id="approvalConf"></span></div>
      <div><strong>Director's reason:</strong> <span id="approvalReason"></span></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="respondCloudApproval(false)">Deny (Keep Local)</button>
      <button class="btn primary" onclick="respondCloudApproval(true)">Approve Cloud</button>
    </div>
  </div>
</div>

<script>
// ── State ──
let ws=null, sessionId=null, csrfToken=null, msgSeq=0, connected=false;
const convos=[{id:'default',title:'New Chat',messages:[],created:Date.now()}];
let activeConvoId='default';
const activityItems=[];
let unseenActivity=0;
let voiceActive=false, voiceStream=null, voiceAudioCtx=null, voiceProcessor=null;
let voiceChunkSeq=0, voiceAiAudio=null, voiceAudioQueue=[], voicePlayingTurn=-1;
let pendingCloudApproval=null;
const repos=[
  {id:'r-1',url:'https://github.com/hesamsheikh/awesome-openclaw-usecases',label:'Awesome Use Cases',description:'Community-curated real-world OpenClaw use cases: productivity, DevOps, creative, research, finance.',stars:'3.8k',categories:['Social Media','Creative','Infrastructure','Productivity','Research','Finance'],added:Date.now()}
];

// ── Tabs ──
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('sec-'+t.dataset.tab).classList.add('active');
    if(t.dataset.tab==='activity'){unseenActivity=0;document.getElementById('activityBadge').style.display='none';}
  });
});

// ── WebSocket ──
function connect(){
  ws=new WebSocket('${this.config.gatewayUrl}');
  ws.onopen=()=>{connected=true;document.getElementById('connDot').classList.add('on');document.getElementById('connText').textContent='Connected';requestStatus()};
  ws.onmessage=e=>{try{handleMessage(JSON.parse(e.data))}catch(err){console.error(err)}};
  ws.onclose=()=>{connected=false;document.getElementById('connDot').classList.remove('on');document.getElementById('connText').textContent='Reconnecting...';if(voiceActive)toggleVoice();setTimeout(connect,3000)};
  ws.onerror=()=>{document.getElementById('connText').textContent='Error'};
}
function sendWs(type,payload){if(!ws||ws.readyState!==1)return;ws.send(JSON.stringify({type,id:'m-'+(++msgSeq),payload,csrfToken}))}
function requestStatus(){sendWs('status',{})}

// ── Message Handler ──
function handleMessage(msg){
  switch(msg.type){
    case 'connected':sessionId=msg.payload.sessionId;csrfToken=msg.payload.csrfToken;break;
    case 'turn':{
      const c=msg.payload.message?.content||JSON.stringify(msg.payload);
      const meta=msg.payload.routingDecision||null;
      addChatMsg('assistant',c,meta);
      if(msg.payload.finished)document.getElementById('chatStatus').textContent='';
      break}
    case 'taskAccepted':document.getElementById('chatStatus').textContent='Processing...';break;
    case 'councilResult':{
      const t=msg.payload.directorSynthesis||msg.payload.synthesis||'';
      addChatMsg('assistant',t,{type:'council',confidence:msg.payload.confidence,participants:msg.payload.participantCount,duration:msg.payload.totalDurationMs});
      break}
    case 'routingDecision':addActivityItem(msg.payload);break;
    case 'escalationEvaluated':addEscEntry(msg.payload);break;
    case 'status':updateDashboard(msg.payload);updateCouncilView(msg.payload);updateProviderView(msg.payload);updateInstalledSkills(msg.payload);break;
    case 'skillSearchResults':renderSkillResults(msg.payload.skills,false);break;
    case 'skillInstalled':addChatMsg('system','Installed: '+(msg.payload.displayName||msg.payload.slug));requestStatus();break;
    case 'skillUninstalled':addChatMsg('system','Uninstalled: '+msg.payload.slug);requestStatus();break;
    case 'skillUpdatesAvailable':addChatMsg('system','Updates available for: '+Object.keys(msg.payload).join(', '));break;
    case 'cloudApprovalRequired':showCloudApproval(msg.payload);break;
    case 'councilMemoryStats':updateMemoryView(msg.payload);break;
    case 'modelSwapped':addChatMsg('system','Model swapped: '+msg.payload.name+' -> '+msg.payload.newModel+(msg.payload.memoryPreserved?' (memory preserved)':''));requestStatus();break;
    case 'councilLifecycle':updateCouncilStatus(msg.payload);break;
    case 'ttsResult':if(msg.payload.audio)playB64(msg.payload.audio,msg.payload.format||'wav');break;
    case 'sttResult':if(msg.payload.text)document.getElementById('chatInput').value=msg.payload.text;break;
    case 'visionResult':if(msg.payload.description)addChatMsg('assistant',msg.payload.description);break;
    case 'voiceState':updateVoiceOrb(msg.payload);break;
    case 'voiceTranscription':if(voiceActive){document.getElementById('voiceTranscript').textContent='You: '+msg.payload.text;addChatMsg('user',msg.payload.text)}break;
    case 'voiceAgentText':if(voiceActive){document.getElementById('voiceTranscript').textContent=msg.payload.text;addChatMsg('assistant',msg.payload.text)}break;
    case 'voiceTtsChunk':if(voiceActive){voiceAudioQueue.push(msg.payload);if(voicePlayingTurn!==msg.payload.turnId){voicePlayingTurn=msg.payload.turnId;playNextVChunk()}}break;
    case 'voiceBargeIn':stopVAudio();if(voiceActive)setVOrb('user');break;
    case 'pong':break;
    case 'error':addChatMsg('system','Error: '+(msg.payload.message||'Unknown'));break;
  }
}

// ── Dashboard ──
function updateDashboard(data){
  document.getElementById('d-status').textContent='Online';
  if(data.queue)document.getElementById('d-queue').textContent=data.queue.running+' / '+data.queue.pending;
  if(data.memory)document.getElementById('d-memory').textContent=data.memory.totalNodes;
  if(data.council){document.getElementById('d-council').textContent=data.council.ready+' / '+data.council.members.length;document.getElementById('d-council-sub').textContent='members ready'}
  if(data.router){
    const r=data.router;
    document.getElementById('d-routed').textContent=r.totalRequests;
    document.getElementById('d-local').textContent=r.localRequests;
    document.getElementById('d-escalated').textContent=r.escalatedRequests;
    const lp=r.totalRequests>0?(r.localRequests/r.totalRequests*100):100;
    const bar=document.getElementById('d-localBar');
    bar.style.width=lp+'%';bar.className='fill '+(lp>80?'green':lp>50?'yellow':'red');
    document.getElementById('d-avgLocalConf').textContent=r.avgLocalConfidence>0?r.avgLocalConfidence.toFixed(2):'--';
    document.getElementById('d-avgCloudConf').textContent=r.avgCloudConfidence>0?r.avgCloudConfidence.toFixed(2):'--';
    document.getElementById('d-avgLocalLat').textContent=r.avgLocalLatencyMs>0?Math.round(r.avgLocalLatencyMs)+'ms':'--';
    document.getElementById('d-avgCloudLat').textContent=r.avgCloudLatencyMs>0?Math.round(r.avgCloudLatencyMs)+'ms':'--';
    document.getElementById('d-councilEvals').textContent=r.councilEvaluations;
    document.getElementById('d-councilApprovals').textContent=r.councilApprovals;
    if(r.costSummary){
      const c=r.costSummary;
      document.getElementById('d-cost').textContent='$'+c.todayCostUsd.toFixed(2);
      document.getElementById('d-budget').textContent='$'+(c.dailyBudgetRemaining+c.todayCostUsd).toFixed(2);
      document.getElementById('d-costBar').style.width=c.dailyBudgetUsedPercent.toFixed(1)+'%';
      document.getElementById('d-costBar').className='fill '+(c.dailyBudgetUsedPercent>80?'red':c.dailyBudgetUsedPercent>50?'yellow':'blue');
    }
  }
  if(data.providers){
    const ct=document.getElementById('d-providers');ct.innerHTML='';
    data.providers.forEach(p=>{
      const isL=p.type==='ollama',pc=p.healthy?(isL?'green':'blue'):'red',pl=isL?'local':'cloud';
      ct.innerHTML+='<div class="provider-card"><div class="pname"><span class="pill '+pc+'"><span class="pill-dot"></span> '+pl+'</span> '+esc(p.name)+'</div><div class="pstat">Latency: '+(p.latencyMs>0?p.latencyMs+'ms':'--')+' | Errors: '+p.errorCount+'</div></div>';
    });
    if(!data.providers.length)ct.innerHTML='<div class="provider-card"><div class="pname">No providers</div></div>';
  }
}

// ── Chat ──
function getConvo(){return convos.find(c=>c.id===activeConvoId)||convos[0]}
function newConvo(){const id='c-'+Date.now();convos.unshift({id,title:'New Chat',messages:[],created:Date.now()});activeConvoId=id;renderConvoList();renderMsgs()}
function switchConvo(id){activeConvoId=id;renderConvoList();renderMsgs()}
function renderConvoList(){
  const el=document.getElementById('convoList');el.innerHTML='';
  convos.forEach(c=>{
    const d=document.createElement('div');d.className='convo-item'+(c.id===activeConvoId?' active':'');
    d.onclick=()=>switchConvo(c.id);
    d.innerHTML='<div>'+esc(c.title.length>28?c.title.slice(0,28)+'...':c.title)+'</div><div class="time">'+fmtTime(c.created)+'</div>';
    el.appendChild(d);
  });
}
function addChatMsg(role,content,meta){
  const convo=getConvo();const m={role,content,meta,time:Date.now()};convo.messages.push(m);
  if(role==='user'&&convo.title==='New Chat'){convo.title=content.slice(0,40);renderConvoList()}
  renderOneMsg(m);
}
function renderMsgs(){
  const ct=document.getElementById('chatMessages');ct.innerHTML='<div class="msg system">OpenClaw v2 - Local-first AI. Cloud only when the council approves.</div>';
  getConvo().messages.forEach(m=>renderOneMsg(m));
}
function renderOneMsg(m){
  const ct=document.getElementById('chatMessages'),d=document.createElement('div');d.className='msg '+m.role;
  let h='';
  if(m.role!=='system')h+='<div class="msg-role">'+esc(m.role)+'</div>';
  let t=esc(m.content);t=t.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre>$1</pre>');t=t.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  h+='<div>'+t+'</div>';
  if(m.meta){
    h+='<div class="msg-meta">';
    if(m.meta.provider){const ic=m.meta.providerType==='cloud'?'purple':'green';h+='<span class="pill '+ic+'">'+esc(m.meta.provider)+'</span>'}
    if(m.meta.type==='council')h+='<span class="pill blue">Council ('+(m.meta.participants||'?')+' members)</span>';
    if(typeof m.meta.confidenceScore==='number'){const cc=m.meta.confidenceScore>=.7?'green':m.meta.confidenceScore>=.4?'yellow':'red';h+='<span class="pill '+cc+'">conf: '+m.meta.confidenceScore.toFixed(2)+'</span>'}
    if(typeof m.meta.confidence==='number'){const cc=m.meta.confidence>=.7?'green':m.meta.confidence>=.4?'yellow':'red';h+='<span class="pill '+cc+'">conf: '+m.meta.confidence.toFixed(2)+'</span>'}
    if(m.meta.costUsd>0)h+='<span class="pill yellow">$'+m.meta.costUsd.toFixed(4)+'</span>';
    if(m.meta.latencyMs)h+='<span style="font-size:9px;color:var(--text-muted)">'+m.meta.latencyMs+'ms</span>';
    if(m.meta.duration)h+='<span style="font-size:9px;color:var(--text-muted)">'+m.meta.duration+'ms</span>';
    h+='</div>';
  }
  d.innerHTML=h;ct.appendChild(d);ct.scrollTop=ct.scrollHeight;
}
function sendChat(){
  const inp=document.getElementById('chatInput'),t=inp.value.trim();if(!t||!connected)return;
  addChatMsg('user',t);inp.value='';inp.style.height='42px';
  sendWs('task',{instruction:t});
}
function handleImage(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();r.onload=ev=>{
    const b64=ev.target.result.split(',')[1];
    const prompt=document.getElementById('chatInput').value.trim()||'Describe this image in detail.';
    addChatMsg('user','[Image: '+f.name+'] '+prompt);sendWs('vision',{image:b64,prompt});
  };r.readAsDataURL(f);
}
function autoResize(el){el.style.height='42px';el.style.height=Math.min(el.scrollHeight,140)+'px'}

// ── Council View ──
function updateCouncilView(data){
  if(!data.council||!data.council.members)return;
  const ms=data.council.members;
  renderMembers('council-tier1',ms.filter(m=>m.tier===1));
  renderMembers('council-tier2',ms.filter(m=>m.tier===2));
  renderMembers('council-tier3',ms.filter(m=>m.tier===3));
  // Populate model swap dropdown
  const sel=document.getElementById('swapMemberId');
  const prev=sel.value;sel.innerHTML='<option value="">Select member...</option>';
  ms.forEach(m=>{sel.innerHTML+='<option value="'+esc(m.id)+'">T'+m.tier+': '+esc(m.name)+' ('+esc(m.model)+')</option>'});
  if(prev)sel.value=prev;
  // Memory info
  if(data.council.memoryStats){
    document.getElementById('councilMemInfo').textContent='Memory: '+data.council.memoryStats.totalKnowledgeEntries+' entries, '+data.council.memoryStats.totalInteractions+' interactions';
  }
  // Populate memory search dropdown
  const msel=document.getElementById('memSearchMember');
  const mprev=msel.value;msel.innerHTML='<option value="all">All members</option>';
  ms.forEach(m=>{msel.innerHTML+='<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>'});
  if(mprev)msel.value=mprev;
}
function renderMembers(id,members){
  const el=document.getElementById(id);
  if(!members.length){el.innerHTML='<div class="member-row"><span class="mdot offline"></span><span class="mname" style="color:var(--text-muted)">No members</span></div>';return}
  el.innerHTML='';
  members.forEach(m=>{
    const personality=m.personality?'<span style="color:var(--text-dim);font-size:10px"> — '+esc(m.personality.title)+'</span>':'';
    const metrics=m.metrics&&m.metrics.totalQueries>0?'<span style="font-size:10px;color:var(--text-muted);margin-left:8px">q:'+m.metrics.totalQueries+' conf:'+m.metrics.avgConfidence.toFixed(2)+'</span>':'';
    el.innerHTML+='<div class="member-row"><span class="mdot '+(m.status||'offline')+'"></span><span class="mname">'+esc(m.name)+'</span><span class="mrole">'+esc(m.model)+(m.branch?' ('+m.branch+')':'')+'</span>'+personality+metrics+'</div>';
  });
}
function startCouncil(){sendWs('councilStart',{});addChatMsg('system','Starting council...')}
function stopCouncil(){sendWs('councilStop',{});addChatMsg('system','Stopping council...')}
function restartCouncil(){sendWs('councilRestart',{});addChatMsg('system','Restarting council...')}
function updateCouncilStatus(data){
  const pill=document.getElementById('councilStatusPill');
  if(data.running){pill.style.background='var(--success-dim)';pill.style.color='var(--success)';pill.innerHTML='<span class="pill-dot"></span> Running'}
  else{pill.style.background='var(--danger-dim)';pill.style.color='var(--danger)';pill.innerHTML='<span class="pill-dot"></span> Stopped'}
}
function swapModel(){
  const memberId=document.getElementById('swapMemberId').value;
  const newModel=document.getElementById('swapNewModel').value.trim();
  const backend=document.getElementById('swapBackend').value;
  if(!memberId||!newModel){addChatMsg('system','Select a member and enter a model name.');return}
  sendWs('modelSwap',{memberId,newModel,backend,reason:'Manual swap from UI'});
  addChatMsg('system','Swapping model for member...');
}
function addEscEntry(payload){
  const log=document.getElementById('escalationLog');
  const req=payload.request||{},v=payload.verdict||{};
  const d=document.createElement('div');d.className='esc-entry';
  d.innerHTML='<div>'+(v.shouldEscalate?'<span class="pill purple">UP</span>':'<span class="pill green">OK</span>')+'</div>'+
    '<div class="esc-body"><div style="font-weight:500">'+(v.shouldEscalate?'Escalated to cloud':'Kept local')+'</div>'+
    '<div style="color:var(--text-dim);margin-top:2px">'+esc(v.reason||'')+'</div>'+
    '<div style="color:var(--text-muted);margin-top:2px;font-size:10px">Conf: '+(req.localConfidence||0).toFixed(2)+' | Complexity: '+(req.detectedComplexity||0).toFixed(2)+'</div></div>'+
    '<div class="esc-time">'+fmtTime(Date.now())+'</div>';
  log.insertBefore(d,log.firstChild);
  while(log.children.length>50)log.removeChild(log.lastChild);
}

// ── Provider View ──
function updateProviderView(data){
  if(!data.providers)return;
  const ct=document.getElementById('providerDetails');ct.innerHTML='';
  data.providers.forEach(p=>{
    const isL=p.type==='ollama',pc=p.healthy?(isL?'green':'blue'):'red';
    ct.innerHTML+='<div class="provider-detail"><div class="pd-header"><div class="pd-name"><span class="pill '+pc+'"><span class="pill-dot"></span> '+(isL?'local':'cloud')+'</span> '+esc(p.name)+' <span style="color:var(--text-muted);font-size:11px">('+esc(p.type)+')</span></div></div>'+
      '<div class="pd-stats">'+
      '<div class="pd-stat"><div class="label">Status</div><div class="val" style="color:var(--'+(p.healthy?'success':'danger')+')">'+(p.healthy?'Healthy':'Unhealthy')+'</div></div>'+
      '<div class="pd-stat"><div class="label">Latency</div><div class="val">'+(p.latencyMs>0?p.latencyMs+'ms':'--')+'</div></div>'+
      '<div class="pd-stat"><div class="label">Errors</div><div class="val" style="color:'+(p.errorCount>0?'var(--danger)':'var(--text)')+'">'+p.errorCount+'</div></div>'+
      '<div class="pd-stat"><div class="label">Last Checked</div><div class="val" style="font-size:12px">'+(p.lastChecked>0?fmtTime(p.lastChecked):'never')+'</div></div>'+
      '</div></div>';
  });
  if(!data.providers.length)ct.innerHTML='<div class="provider-detail"><div class="pd-header"><div class="pd-name">No providers registered</div></div></div>';
}

// ── Activity Feed ──
function addActivityItem(decision){
  const isC=decision.providerType==='cloud',isE=decision.phase==='council_eval';
  let ic='local',icon='L';if(isC){ic='cloud';icon='C'}else if(isE){ic='council';icon='E'}
  let title=isC?'Cloud: '+(decision.provider||'?'):'Local: '+(decision.provider||'ollama');
  if(decision.escalated)title='Escalated to '+(decision.provider||'cloud');
  let detail='Confidence: '+(decision.confidenceScore||0).toFixed(2);
  if(decision.latencyMs)detail+=' | '+decision.latencyMs+'ms';
  if(decision.costUsd>0)detail+=' | $'+decision.costUsd.toFixed(4);
  if(decision.councilReasoning)detail+=' - '+decision.councilReasoning;
  activityItems.unshift({iconClass:ic,icon,title,detail,time:Date.now()});
  const at=document.querySelector('.tab.active');
  if(!at||at.dataset.tab!=='activity'){
    unseenActivity++;const b=document.getElementById('activityBadge');b.textContent=unseenActivity;b.style.display='inline-block';if(unseenActivity>5)b.className='badge warn';
  }
  renderFeed();
}
function renderFeed(){
  const f=document.getElementById('activityFeed');f.innerHTML='';
  activityItems.slice(0,100).forEach(i=>{
    f.innerHTML+='<div class="feed-item"><div class="feed-icon '+i.iconClass+'">'+i.icon+'</div><div class="feed-body"><div class="title">'+esc(i.title)+'</div><div class="detail">'+esc(i.detail)+'</div></div><div class="feed-time">'+fmtTime(i.time)+'</div></div>';
  });
  if(!activityItems.length)f.innerHTML='<div class="feed-item"><div class="feed-icon local">~</div><div class="feed-body"><div class="title">No events yet</div></div></div>';
}

// ── Settings ──
function updateSetting(k,v){sendWs('updateSetting',{key:k,value:typeof v==='string'?parseFloat(v)||v:v})}
function updateProviderSetting(p,k,v){sendWs('updateProviderSetting',{provider:p,key:k,value:v})}

// ── Voice ──
async function toggleVoice(){
  if(voiceActive){stopVoice();return}
  try{voiceStream=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true}})}catch(e){addChatMsg('system','Mic denied: '+e.message);return}
  voiceActive=true;voiceChunkSeq=0;voiceAudioQueue=[];voicePlayingTurn=-1;
  document.getElementById('voiceOverlay').classList.add('active');document.getElementById('voiceStatus').textContent='Listening...';document.getElementById('voiceTranscript').textContent='';setVOrb('listening');
  sendWs('voiceStart',{});
  voiceAudioCtx=new(window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
  const src=voiceAudioCtx.createMediaStreamSource(voiceStream);const bs=Math.round(16000*60/1000);
  voiceProcessor=voiceAudioCtx.createScriptProcessor(1024,1,1);let acc=new Float32Array(0);
  voiceProcessor.onaudioprocess=e=>{
    if(!voiceActive)return;const inp=e.inputBuffer.getChannelData(0);const nb=new Float32Array(acc.length+inp.length);nb.set(acc);nb.set(inp,acc.length);acc=nb;
    while(acc.length>=bs){const ch=acc.slice(0,bs);acc=acc.slice(bs);let en=0;for(let i=0;i<ch.length;i++)en+=ch[i]*ch[i];en=Math.sqrt(en/ch.length);
    const p16=new Int16Array(ch.length);for(let i=0;i<ch.length;i++){const s=Math.max(-1,Math.min(1,ch[i]));p16[i]=s<0?s*0x8000:s*0x7FFF}
    let bin='';const u8=new Uint8Array(p16.buffer);for(let i=0;i<u8.length;i++)bin+=String.fromCharCode(u8[i]);
    sendWs('voiceAudio',{audio:btoa(bin),speechDetected:en>0.015,seq:voiceChunkSeq++})}
  };src.connect(voiceProcessor);voiceProcessor.connect(voiceAudioCtx.destination);
}
function stopVoice(){voiceActive=false;sendWs('voiceStop',{});if(voiceStream){voiceStream.getTracks().forEach(t=>t.stop());voiceStream=null}if(voiceProcessor){voiceProcessor.disconnect();voiceProcessor=null}if(voiceAudioCtx){voiceAudioCtx.close().catch(()=>{});voiceAudioCtx=null}stopVAudio();document.getElementById('voiceOverlay').classList.remove('active')}
function setVOrb(s){document.getElementById('voiceOrb').className='voice-orb '+s}
function updateVoiceOrb(p){if(!voiceActive)return;if(p.aiSpeaking){setVOrb('speaking');document.getElementById('voiceStatus').textContent='Speaking...'}else if(p.listening){setVOrb('listening');document.getElementById('voiceStatus').textContent='Listening...'}else{setVOrb('processing');document.getElementById('voiceStatus').textContent='Thinking...'}}
function playNextVChunk(){if(!voiceAudioQueue.length)return;const c=voiceAudioQueue.shift();try{const b=atob(c.audio);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);const m={wav:'audio/wav',mp3:'audio/mpeg',opus:'audio/opus'}[c.format]||'audio/wav';const u=URL.createObjectURL(new Blob([a],{type:m}));voiceAiAudio=new Audio(u);voiceAiAudio.onended=()=>{URL.revokeObjectURL(u);voiceAiAudio=null;if(voiceAudioQueue.length)playNextVChunk()};voiceAiAudio.play().catch(()=>{voiceAiAudio=null;if(voiceAudioQueue.length)playNextVChunk()})}catch(e){if(voiceAudioQueue.length)playNextVChunk()}}
function stopVAudio(){if(voiceAiAudio){voiceAiAudio.pause();voiceAiAudio.src='';voiceAiAudio=null}voiceAudioQueue=[]}
function playB64(b,f){try{const d=atob(b);const a=new Uint8Array(d.length);for(let i=0;i<d.length;i++)a[i]=d.charCodeAt(i);const m={wav:'audio/wav',mp3:'audio/mpeg',opus:'audio/opus',webm:'audio/webm'}[f]||'audio/wav';const u=URL.createObjectURL(new Blob([a],{type:m}));const au=new Audio(u);au.play().catch(()=>{});au.onended=()=>URL.revokeObjectURL(u)}catch(e){}}

// ── Helpers ──
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function fmtTime(ts){if(!ts)return'';return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}

// ── Skills (ClawHub) ──
function searchSkills(q){
  const query=q||document.getElementById('skillSearch').value.trim();
  if(!query)return;
  document.getElementById('searchResultsTitle').textContent='Search: '+query;
  document.getElementById('skillResults').innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px">Searching...</div>';
  sendWs('skillSearch',{query,limit:20});
}
function trendingSkills(){
  document.getElementById('searchResultsTitle').textContent='Trending Skills';
  document.getElementById('skillResults').innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px">Loading...</div>';
  sendWs('skillTrending',{limit:20});
}
function installSkill(slug){sendWs('skillInstall',{slug});addChatMsg('system','Installing skill: '+slug+'...')}
function uninstallSkill(slug){sendWs('skillUninstall',{slug});addChatMsg('system','Uninstalling: '+slug)}
function updateSkill(slug){sendWs('skillUpdate',{slug});addChatMsg('system','Updating: '+slug+'...')}
function checkSkillUpdates(){sendWs('skillCheckUpdates',{});addChatMsg('system','Checking for skill updates...')}
function renderSkillResults(skills,isInstalled){
  const ct=isInstalled?document.getElementById('installedSkills'):document.getElementById('skillResults');
  ct.innerHTML='';
  if(!skills||!skills.length){ct.innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px">'+(isInstalled?'No skills installed':'No results')+'</div>';return}
  skills.forEach(s=>{
    const isLocal=isInstalled||false;
    const hasUpdate=s.updateAvailable?true:false;
    ct.innerHTML+='<div class="skill-card">'+
      '<div class="sk-icon">'+(s.emoji||'&#9881;')+'</div>'+
      '<div class="sk-body"><div class="sk-name">'+esc(s.displayName||s.slug||s.name||'?')+
      (s.highlighted?' <span class="pill purple">Featured</span>':'')+
      (hasUpdate?' <span class="pill yellow">Update: '+esc(s.updateAvailable)+'</span>':'')+
      (!s.requirementsMet&&isLocal?' <span class="pill red">Reqs unmet</span>':'')+
      '</div><div class="sk-desc">'+esc(s.description||'')+'</div>'+
      '<div class="sk-meta"><span>v'+(s.version||s.latestVersion||'?')+'</span>'+
      (s.downloads?'<span>'+s.downloads+' downloads</span>':'')+
      (s.stars?'<span>'+s.stars+' stars</span>':'')+
      (s.owner?'<span>by '+esc(s.owner.handle||'')+'</span>':'')+
      '</div></div>'+
      '<div class="sk-actions">'+
      (isLocal?(hasUpdate?'<button class="btn sm" onclick="updateSkill(\''+esc(s.slug)+'\')">Update</button>':'')+
      '<button class="btn sm" onclick="uninstallSkill(\''+esc(s.slug)+'\')">Remove</button>':
      '<button class="btn sm primary" onclick="installSkill(\''+esc(s.slug)+'\')">Install</button>')+
      '</div></div>';
  });
}
function updateInstalledSkills(data){
  if(!data.clawhub)return;
  const ch=data.clawhub;
  document.getElementById('installedCount').textContent=ch.installedCount;
  renderSkillResults(ch.skills,true);
  if(ch.updatesAvailable>0){const b=document.getElementById('skillsBadge');b.textContent=ch.updatesAvailable;b.style.display='inline-block'}
  else{document.getElementById('skillsBadge').style.display='none'}
}

// ── Cloud Approval ──
function showCloudApproval(req){
  pendingCloudApproval=req;
  document.getElementById('approvalQuestion').textContent=req.question||'';
  document.getElementById('approvalConf').textContent=(req.localConfidence||0).toFixed(2);
  document.getElementById('approvalReason').textContent=req.directorReason||'';
  document.getElementById('cloudApprovalOverlay').style.display='flex';
}
function respondCloudApproval(approved){
  if(!pendingCloudApproval)return;
  sendWs('cloudApprovalResponse',{requestId:pendingCloudApproval.requestId,approved,reason:approved?'User approved':'User denied'});
  document.getElementById('cloudApprovalOverlay').style.display='none';
  addChatMsg('system',approved?'Cloud escalation approved.':'Cloud escalation denied. Keeping local.');
  pendingCloudApproval=null;
}

// ── Memory View ──
function updateMemoryView(data){
  if(!data)return;
  document.getElementById('mem-total').textContent=data.totalKnowledgeEntries||0;
  document.getElementById('mem-interactions').textContent=(data.totalInteractions||0)+' interactions';
  document.getElementById('mem-members').textContent=data.totalMembers||0;
  let loraCount=0;
  const ct=document.getElementById('memMemberList');ct.innerHTML='';
  if(data.memberStats&&data.memberStats.length){
    data.memberStats.forEach(m=>{
      if(m.loraAdapter)loraCount++;
      ct.innerHTML+='<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--surface2);border-radius:var(--radius-sm)">'+
        '<span class="pill '+(m.tier===1?'purple':m.tier===2?'blue':'green')+'">T'+m.tier+'</span>'+
        '<div style="flex:1"><div style="font-size:12px;font-weight:500">'+esc(m.name)+'</div>'+
        '<div style="font-size:10px;color:var(--text-dim)">'+m.knowledgeCount+' knowledge entries | '+m.interactions+' interactions'+(m.loraAdapter?' | LoRA: '+esc(m.loraAdapter):'')+'</div></div>'+
        '<div style="font-size:10px;color:var(--text-muted)">'+fmtTime(m.lastActive)+'</div></div>';
    });
  }else{ct.innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px">No council members registered yet.</div>'}
  document.getElementById('mem-lora').textContent=loraCount;
}
function searchMemory(){
  const q=document.getElementById('memSearchQuery').value.trim();
  const member=document.getElementById('memSearchMember').value;
  if(!q){return}
  sendWs('memorySearch',{query:q,memberId:member==='all'?undefined:member,limit:20});
}

// ── Repositories ──
function renderRepos(){
  const ct=document.getElementById('repoList');ct.innerHTML='';
  if(!repos.length){ct.innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center">No repositories added yet. Add a GitHub repo URL above.</div>';return}
  repos.forEach(r=>{
    ct.innerHTML+='<div class="card" style="margin-bottom:0">'+
      '<div class="card-header"><span class="card-title" style="text-transform:none;font-size:13px;letter-spacing:0">'+esc(r.label||r.url)+'</span>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
      (r.stars?'<span style="font-size:10px;color:var(--text-dim)">'+esc(r.stars)+' stars</span>':'')+
      '<button class="btn sm" onclick="removeRepo(\''+esc(r.id)+'\')">Remove</button>'+
      '<a href="'+esc(r.url)+'" target="_blank" class="btn sm primary" style="text-decoration:none">View</a>'+
      '</div></div>'+
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">'+esc(r.url)+'</div>'+
      (r.description?'<div style="font-size:12px;margin-bottom:8px">'+esc(r.description)+'</div>':'')+
      (r.categories?'<div style="display:flex;gap:4px;flex-wrap:wrap">'+r.categories.map(c=>'<span class="pill blue">'+esc(c)+'</span>').join('')+'</div>':'')+
      '</div>';
  });
}
function addRepo(){
  const url=document.getElementById('repoUrl').value.trim();
  const label=document.getElementById('repoLabel').value.trim();
  if(!url){return}
  repos.push({id:'r-'+Date.now(),url,label:label||url.split('/').pop()||url,description:'',stars:'',categories:[],added:Date.now()});
  document.getElementById('repoUrl').value='';document.getElementById('repoLabel').value='';
  renderRepos();
  sendWs('repoAdded',{url,label:label||url.split('/').pop()||url});
  addChatMsg('system','Repository added: '+(label||url));
}
function removeRepo(id){
  const idx=repos.findIndex(r=>r.id===id);
  if(idx>=0){const r=repos.splice(idx,1)[0];renderRepos();sendWs('repoRemoved',{url:r.url});addChatMsg('system','Repository removed: '+r.label)}
}

// ── Init ──
renderConvoList();
renderRepos();
setInterval(requestStatus,8000);
connect();
</script>
</body>
</html>`;
  }
}

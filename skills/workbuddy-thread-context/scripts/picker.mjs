#!/usr/bin/env node
// picker.mjs —— 生成「分叉选择器」的可视化面板（widget HTML 片段）
//
// 它调用同目录的 thread.mjs 取锚点数据，然后产出一段自包含的 HTML：
// 在 WorkBuddy 会话里渲染后，点一条消息即可选定分叉点，按一下按钮就会
// 触发一句确定的指令（sendPrompt），让模型用 thread.mjs 导出交接稿。
//
// 用法:
//   node picker.mjs --id <会话id> [--text 46] [--max 400] [--recent 5]
//   node picker.mjs --id <会话id> --out 文件.html      # 不写 --out 则打到 stdout
//
// 只读本机文件；产出的 HTML 不联网、不引用任何外部资源。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THREAD = path.join(HERE, 'thread.mjs');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const id = args.id || args._[0];
if (!id) {
  console.error('用法: node picker.mjs --id <会话id> [--text 46] [--max 400] [--out 文件]');
  process.exit(1);
}

const cli = [
  THREAD, '--id', String(id), '--points', '--json', '--slim',
  '--max', String(args.max ?? 400),
  '--text', String(args.text ?? 46),
  '--recent', String(args.recent ?? 5),
];
if (args.home) cli.push('--home', String(args.home));

let data;
try {
  data = JSON.parse(execFileSync(process.execPath, cli, { encoding: 'utf8' }));
} catch (e) {
  console.error('取锚点失败：' + (e.stderr || e.message));
  process.exit(1);
}

// --only user[,notice] —— 只把选定类别的锚点打进 HTML（体积小一半以上）。
// 助手锚点若也要，点界面上的「显示全部」会重新渲染一份。
const ROLE_CODE = { user: 0, assistant: 1, notice: 2 };
if (args.only && args.only !== true) {
  const keep = String(args.only).split(',').map((w) => ROLE_CODE[w.trim()]).filter((c) => c !== undefined);
  if (keep.length && keep.length < 3) {
    data.all = data.a.length;
    data.a = data.a.filter((x) => keep.indexOf(x[2]) >= 0);
    data.only = String(args.only);
  }
}

// 内联进 <script> 的 JSON 必须躲开 </script> 与行分隔符
const payload = JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const CSS = [
  '.fk{display:flex;flex-direction:column;gap:10px;border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:1rem 1.25rem;background:var(--color-background-primary)}',
  '.fk button{font-size:12px;padding:3px 10px}',
  '.fk-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}',
  '.fk-ti{font-size:15px;font-weight:500}',
  '.fk-su{font-size:12px;color:var(--color-text-secondary);margin-top:2px}',
  '.fk-sec{font-size:11px;color:var(--color-text-tertiary);margin-right:6px}',
  '.fk-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.fk-bar input[type=text]{flex:1;min-width:150px;font-size:12px}',
  '.fk-ck{font-size:12px;color:var(--color-text-secondary);display:flex;align-items:center;gap:5px;white-space:nowrap}',
  '.fk-mo button.on{background:var(--color-background-info);color:var(--color-text-info);border-color:var(--color-border-info)}',
  '.fk-list{max-height:300px;overflow:auto;display:flex;flex-direction:column;border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md)}',
  '.fk-row{display:flex;gap:9px;align-items:baseline;padding:5px 9px;cursor:pointer;border-left:2px solid transparent}',
  '.fk-row:hover{background:var(--color-background-secondary)}',
  '.fk-row.sel{background:var(--color-background-info);border-left-color:var(--color-text-info)}',
  '.fk-row.b{background:var(--color-background-secondary)}',
  '.fk-n{font-family:var(--font-mono);font-size:11px;color:var(--color-text-tertiary);min-width:32px;text-align:right}',
  '.fk-c{font-family:var(--font-mono);font-size:11px;color:var(--color-text-tertiary);min-width:34px}',
  '.fk-w{font-size:11px;min-width:14px;text-align:center;color:var(--color-text-secondary)}',
  '.fk-t{font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.fk-row.u .fk-t{color:var(--color-text-info)}',
  '.fk-row.n .fk-t{color:var(--color-text-tertiary)}',
  '.fk-day{font-size:11px;color:var(--color-text-tertiary);padding:4px 9px;background:var(--color-background-tertiary);position:sticky;top:0}',
  '.fk-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
  '.fk-msg{font-size:12px;color:var(--color-text-secondary)}',
  '.fk-miss{font-size:12px;color:var(--color-text-danger)}',
].join('\n');

const CLIENT = [
  'var D=JSON.parse(document.getElementById("fk-d").textContent);',
  'var S=D.s,A=D.a,R=D.r;',
  'var WHO=[["我","我发的"],["咪","助手回复"],["系","系统通知（后台任务等）"]];',
  'var mode="until",pick=[],q="",onlyU=true;',
  'var list=document.getElementById("fk-list"),sum=document.getElementById("fk-msg"),go=document.getElementById("fk-go");',
  'function draw(){',
  '  var usr=0,nc=0,rep=0;for(var i=0;i<A.length;i++){if(A[i][2]===0)usr++;else if(A[i][2]===2)nc++;else rep++}',
  '  var items=A.filter(function(a){',
  '    if(onlyU&&a[2]!==0)return false;',
  '    if(q&&a[4].toLowerCase().indexOf(q)<0)return false;',
  '    return true;',
  '  });',
  '  document.getElementById("fk-cnt").textContent="共 "+A.length+" 个锚点"'
    + '+(usr?" · 我发的 "+usr+" 条":"")'
    + '+(rep?" · 回复 "+rep+" 条":"")'
    + '+(nc?" · 系统通知 "+nc+" 条":"");',
  '  var h="",day="";',
  '  for(var j=0;j<items.length;j++){',
  '    var a=items[j],d=a[1].slice(0,5);',
  '    if(d!==day){day=d;h+="<div class=\\"fk-day\\">"+d+"</div>"}',
  '    var cls="fk-row"+(a[2]===2?" n":a[2]===0?" u":"")+(pick.indexOf(a[0])>=0?(pick.length===1?" sel":" b"):"");',
  '    h+="<div class=\\""+cls+"\\" data-n=\\""+a[0]+"\\">"',
  '      +"<span class=\\"fk-n\\">#"+a[0]+"</span>"',
  '      +"<span class=\\"fk-c\\">"+a[1].slice(6)+"</span>"',
  '      +"<span class=\\"fk-w\\" title=\\""+WHO[a[2]][1]+"\\">"+WHO[a[2]][0]+"</span>"',
  '      +"<span class=\\"fk-t\\">"+esc(a[4])+"</span></div>";',
  '  }',
  '  list.innerHTML=h||"<div class=\\"fk-day\\">没有匹配的锚点</div>";',
  '  list.scrollTop=0;',
  '  var r=range();',
  '  if(!r){sum.className="fk-msg";sum.textContent=tip();go.disabled=true;return}',
  '  var n=r[1]-r[0]+1;',
  '  var tail=r[0]>1?"未纳入 #1 → #"+(r[0]-1):"";',
  '  var head=r[1]<A[A.length-1][0]?"未纳入 #"+(r[1]+1)+" → #"+A[A.length-1][0]:"到会话末尾";',
  '  sum.className="fk-msg";',
  '  sum.textContent="保留 #"+r[0]+" → #"+r[1]+"（"+n+" 条消息）· "+(r[0]===1&&r[1]===A[A.length-1][0]?"整条会话":(r[0]===1?head:tail));',
  '  go.disabled=false;',
  '}',
  'function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}',
  'function range(){',
  '  var last=A[A.length-1][0];',
  '  if(!pick.length)return null;',
  '  if(mode==="until")return [1,pick[0]];',
  '  if(mode==="from")return [pick[0],last];',
  '  if(pick.length<2)return null;',
  '  var a=Math.min(pick[0],pick[1]),b=Math.max(pick[0],pick[1]);return [a,b];',
  '}',
  'function tip(){',
  '  if(mode==="range")return pick.length?"再点一条作为另一端":"点两条消息，取中间这段";',
  '  return "点一条消息，作为分叉点";',
  '}',
  'function cmd(r){',
  '  if(mode==="until")return "--until "+pick[0]+" --export";',
  '  if(mode==="from")return "--from "+pick[0]+" --export";',
  '  return "--from "+r[0]+" --to "+r[1]+" --export";',
  '}',
  'list.addEventListener("click",function(e){',
  '  var row=e.target.closest(".fk-row");if(!row)return;',
  '  var n=Number(row.getAttribute("data-n"));',
  '  if(mode==="range"){',
  '    if(pick.length>=2)pick=[n];else if(pick.indexOf(n)>=0)pick=pick.filter(function(x){return x!==n});else pick.push(n);',
  '  } else pick=pick[0]===n?[]:[n];',
  '  draw();',
  '});',
  'document.getElementById("fk-q").addEventListener("input",function(e){q=e.target.value.trim().toLowerCase();draw()});',
  'document.getElementById("fk-u").addEventListener("change",function(e){onlyU=e.target.checked;draw()});',
  'Array.prototype.forEach.call(document.querySelectorAll(".fk-mo button"),function(b){',
  '  b.addEventListener("click",function(){',
  '    mode=b.getAttribute("data-m");pick=[];',
  '    Array.prototype.forEach.call(document.querySelectorAll(".fk-mo button"),function(x){x.className=x===b?"on":""});',
  '    draw();',
  '  });',
  '});',
  'Array.prototype.forEach.call(document.querySelectorAll(".fk-re button"),function(b){',
  '  b.addEventListener("click",function(){',
  '    var sid=b.getAttribute("data-sid");',
  '    if(typeof sendPrompt==="function")sendPrompt("渲染会话 "+sid+" 的分叉选择器");',
  '  });',
  '});',
  'go.addEventListener("click",function(){',
  '  var r=range();if(!r)return;',
  '  var c="分叉会话 "+S.id8+"： "+cmd(r)+"（保留 #"+r[0]+" → #"+r[1]+"）";',
  '  if(typeof sendPrompt==="function")sendPrompt(c+"\\n\\n导出交接稿后，告诉我怎么在新会话里续上。");',
  '  else sum.textContent="这个面板不在 WorkBuddy 里，指令请手动执行："+c;',
  '});',
  'document.getElementById("fk-mt").textContent=typeof sendPrompt==="function"?"":"（离线预览：按钮无法回传指令）";',
  'document.querySelector(".fk").addEventListener("click",function(e){',
  '  var b=e.target.closest("[data-all]");',
  '  if(b&&typeof sendPrompt==="function")sendPrompt("重新渲染会话 "+S.id8+" 的分叉选择器，这次把助手回复锚点也带上");',
  '});',
  'draw();',
].join('\n');

const recent = data.r.map((s) =>
  '<button data-sid="' + s[0] + '" title="' + s[1] + ' · ' + s[2] + 'KB">' + s[0] + '</button>'
).join('');

const moreLine = (data.only && data.all)
  ? '      <div class="fk-su">本面板只装了 ' + data.a.length + ' 个锚点；全部 ' + data.all + ' 个 <button data-all="1">显示全部 ↗</button></div>'
  : '';

const html = [
  '<style>' + CSS + '</style>',
  '<h2 class="sr-only">分叉选择器：在本会话中选定一条消息作为分叉点，切出到此为止的分支交接稿</h2>',
  '<div class="fk">',
  '  <div class="fk-top">',
  '    <div>',
  '      <div class="fk-ti">分叉选择器</div>',
  '      <div class="fk-su">' + data.s.slug + ' · ' + data.s.id8 + ' · ' + data.s.recs + ' 条记录 / ' + data.s.n + ' 个锚点 · 更新 ' + data.s.up + '</div>',
  '      <div class="fk-su" id="fk-cnt"></div>',
  moreLine,
  '    </div>',
  '    <div class="fk-bar fk-re"><span class="fk-sec">换会话</span>' + recent + '</div>',
  '  </div>',
  '  <div class="fk-bar">',
  '    <span class="fk-mo"><button class="on" data-m="until">保留到此</button> <button data-m="from">只要之后</button> <button data-m="range">取区间</button></span>',
  '    <input type="text" id="fk-q" placeholder="按内容过滤，找那个分叉点…">',
  '    <label class="fk-ck"><input type="checkbox" id="fk-u" checked> 只看我发的</label>',
  '  </div>',
  '  <div class="fk-list" id="fk-list"></div>',
  '  <div class="fk-foot">',
  '    <div class="fk-msg" id="fk-msg"></div>',
  '    <div class="fk-bar"><span class="fk-miss" id="fk-mt"></span><button id="fk-go" disabled>导出分支交接稿</button></div>',
  '  </div>',
  '</div>',
  '<script id="fk-d" type="application/json">' + payload + '</script>',
  '<script>' + CLIENT + '</script>',
].join('\n');

if (args.out && args.out !== true) {
  fs.writeFileSync(String(args.out), html, 'utf8');
  console.error('已写出 ' + String(args.out) + '（' + (html.length / 1024).toFixed(1) + 'KB，' + data.a.length + ' 个锚点）');
} else {
  process.stdout.write(html);
}

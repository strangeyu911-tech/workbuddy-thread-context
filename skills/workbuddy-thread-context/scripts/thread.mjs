#!/usr/bin/env node
// thread.mjs —— 从一个 WorkBuddy 会话的本机落盘记录里「分叉」出一段上下文
//
// 只读本机文件，不联网、不调用任何接口、不上传任何内容。
//
// 用法:
//   node thread.mjs --list [--days 3]
//   node thread.mjs --search "关键词" [--days 3] [--limit 5]
//   node thread.mjs --id <id> --points [--max 60]         # 打锚点清单
//   node thread.mjs --id <id> --until 12 --export         # 带 #1–#12（忘掉后面的）
//   node thread.mjs --id <id> --from 12 --to 20 --export  # 只取中间这段
//   node thread.mjs --id <id> --until "09-17 15:30" --export   # 按时间点分叉
//   node thread.mjs --id <id> --tail 20                   # 原样看尾部
//
// 锚点 = 会话里的 user / assistant 消息（按出现顺序编号）；工具调用与思考过程不计入锚点，
// 但切片时会把范围内的工具调用摘要一并带上（--no-noise 关掉）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const BRANCH_DIR = path.join(HOME, '.workbuddy', 'branches');

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
const DAYS = Number(args.days ?? 3);
const LIMIT = Number(args.limit ?? 5);
const WIDTH = Number(args.width ?? 500);
const SNIP = Number(args.snippet ?? 60);
const EXPORT_WIDTH = Number(args.exportWidth ?? 1200);

const USAGE = [
  'node thread.mjs --list [--days 3]',
  'node thread.mjs --search "关键词" [--days 3] [--limit 5]',
  'node thread.mjs --id <id> --points [--max 60] [--minChars 40]',
  'node thread.mjs --id <id> --points --json [--text 90] [--recent 6]   # 给分叉选择器用',
  'node thread.mjs --id <id> --until <锚点|MM-DD HH:MM> --export [--out 路径]',
  'node thread.mjs --id <id> --from <锚点> --to <锚点> --export',
  'node thread.mjs --id <id> --tail 20 [--grep 关键词] [--width 1500]',
  '',
  '通用: [--home <WorkBuddy 数据目录>]  也可用环境变量 WB_HOME 指定',
];

// 数据根目录：优先 --home / WB_HOME；否则在 ~/.workbuddy、~/.workbuddy-ai 里挑存在的那个。
function resolveHome() {
  const explicit = (typeof args.home === 'string' && args.home) || process.env.WB_HOME;
  if (explicit) return path.resolve(explicit);
  const candidates = ['.workbuddy', '.workbuddy-ai'].map((d) => path.join(HOME, d));
  const withProjects = candidates.filter((p) => fs.existsSync(path.join(p, 'projects')));
  if (withProjects.length) return withProjects[0];
  return candidates[0];
}
const WB_HOME = resolveHome();
const ROOT = path.join(WB_HOME, 'projects');

function walkSessions(days) {
  const cutoff = Date.now() - days * 86400e3;
  const found = [];
  if (!fs.existsSync(ROOT)) return found;
  for (const slug of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, slug);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const p = path.join(dir, name);
      let s;
      try { s = fs.statSync(p); } catch { continue; }
      if (s.mtimeMs < cutoff) continue;
      found.push({ slug, name, path: p, mtime: s.mtimeMs, size: s.size });
    }
  }
  return found;
}

function textOf(rec) {
  let text = '';
  const push = (x) => {
    if (typeof x === 'string') { text += x; return; }
    if (Array.isArray(x)) { x.forEach(push); return; }
    if (x && typeof x === 'object') {
      if (typeof x.text === 'string') text += x.text;
      if (Array.isArray(x.output)) push(x.output);
    }
  };
  push(rec.content);
  push(rec.rawContent);
  if (rec.arguments) text += `\n[ARGS] ${rec.arguments}`;
  if (rec.output) push(rec.output);
  if (rec.providerData && typeof rec.providerData.reasoning === 'string') {
    text += `\n[THINKING] ${rec.providerData.reasoning}`;
  }
  return text;
}

// 只取「正文」，剥离思考与工具噪音（导交接稿时用）
function proseOf(rec) {
  let text = '';
  const push = (x) => {
    if (typeof x === 'string') { text += x; return; }
    if (Array.isArray(x)) { x.forEach(push); return; }
    if (x && typeof x === 'object' && typeof x.text === 'string') text += x.text;
  };
  push(rec.content);
  return text.trim();
}

// 摘要类记录：harness 把「对话摘要」塞进了一条 role=user 的记录里。
// 它内部引用了 <user_query> 字样，会让下面的正则横跨整个摘要乱匹配，
// 必须整条丢掉（它永远不是用户真话）。
const SUMMARY_PREFIX = /^\s*<(cb_summary|conversation_history_summary)/;
// 其余 harness 注入块（不是用户说的话）
const INJECT_PREFIX = /^\s*<(cb_summary|conversation_history_summary|system-reminder|additional_data|identity_context|user_info)/;
// harness 以 role=user 投递、但并非人说的消息
const NOTICE_PREFIX = /^\s*<(task-notification|user-prompt-submit-hook|system-warning)\b/;

// 划词引用会往用户消息里塞 @selection:"…" 与 <selection_quote> 包裹。
// 引文本身要留（那是用户想看的东西），只剥掉包装与元数据属性。
const stripSelection = (t) => t
  .replace(/@selection:\s*"[^"]*"/g, '')
  .replace(/<\/?selection_quote\b[^>]*>/g, '')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

// 锚点/交接稿用的「正文」：user 消息抽 <user_query> 里的真话，剥掉工具注入块
function bodyOf(rec) {
  const raw = proseOf(rec);
  if (!raw) return '';
  if (SUMMARY_PREFIX.test(raw)) return '';
  // 真实用户消息长这样：<system-reminder data-role="user-context">…<user_query>真话</user_query>
  // 所以「先抽 query 再判前缀」——先判前缀会把真话一起丢掉。
  // 取**最后一组**（宿主把用户真话追加在记录的末尾；前面的上下文可能带同名字样）。
  if (rec.role === 'user') {
    const all = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)];
    if (all.length) return stripSelection(all[all.length - 1][1]);
  }
  if (INJECT_PREFIX.test(raw)) return '';
  return raw;
}

function readRecords(file) {
  const recs = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch { /* 跳过坏行 */ }
  }
  return recs;
}

// 本地时间（不是 UTC）。之前用 toISOString 会让显示时刻与墙上钟差 8 小时，
// 按 "MM-DD HH:MM" 分叉时会选错点。
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (t) => {
  if (!t) return '--:--';
  const d = new Date(t);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
// 带年份的本地时间戳（交接稿的「生成时间」用）
const stamp = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

function buildAnchors(recs) {
  const anchors = [];
  recs.forEach((r, i) => {
    if (r.type !== 'message' || !r.role) return;
    const t = bodyOf(r);
    if (!t) return;
    // 宿主会把「后台任务完成通知」「hook 回执」也裹成 role=user 的记录，
    // 那不是人说的话，单独归为 notice，界面上才不会被当成"我发的"。
    const kind = r.role === 'assistant'
      ? 'assistant'
      : (NOTICE_PREFIX.test(t) ? 'notice' : 'user');
    anchors.push({ n: anchors.length + 1, recIndex: i, time: r.timestamp, role: r.role, kind, text: t, chars: t.length });
  });
  return anchors;
}

// 锚点选择器：数字 / #12 / "MM-DD HH:MM" / "HH:MM"（从尾部往前找）
function resolveAnchor(spec, anchors) {
  if (spec === undefined || spec === true) return null;
  const s = String(spec).replace(/^#/, '').trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return anchors.find((a) => a.n === n) || null;
  }
  const hit = [...anchors].reverse().find((a) => clock(a.time).includes(s));
  return hit || null;
}

function clip(text, width) {
  if (text.length <= width) return text;
  const head = Math.floor(width * 0.6);
  const tail = width - head - 40;
  return `${text.slice(0, head)}\n\n…（此处省略 ${text.length - width} 字）…\n\n${text.slice(-tail)}`;
}

if (args.help || process.argv.length <= 2) {
  console.log('# 从一个 WorkBuddy 会话里分叉出一段上下文\n\n' + USAGE.map((u) => '  ' + u).join('\n'));
  process.exit(0);
}

if (args.list) {
  const sessions = walkSessions(DAYS).sort((a, b) => b.mtime - a.mtime);
  console.log(`# 数据目录 ${WB_HOME}`);
  console.log(`# 近 ${DAYS} 天有更新的会话（${sessions.length} 个，最多显示 40）`);
  for (const s of sessions.slice(0, 40)) {
    console.log(`${clock(s.mtime)} | ${(s.size / 1024).toFixed(0).padStart(5)}KB | ${s.slug} | ${s.name}`);
  }
  process.exit(0);
}

if (args.search) {
  const kw = String(args.search);
  const hits = [];
  for (const s of walkSessions(DAYS)) {
    let recs;
    try { recs = readRecords(s.path); } catch { continue; }
    const local = [];
    for (const r of recs) {
      const t = textOf(r);
      if (!t.includes(kw)) continue;
      local.push({ t: r.timestamp, role: r.role || r.type, snip: oneLine(t).slice(0, SNIP * 2) });
    }
    if (local.length) hits.push({ ...s, count: local.length, first: local[0], last: local[local.length - 1], samples: local.slice(0, 2) });
  }
  hits.sort((a, b) => b.count - a.count);
  console.log(`# 关键词「${kw}」在近 ${DAYS} 天会话中的命中（${hits.length} 个会话）`);
  for (const h of hits.slice(0, LIMIT)) {
    console.log(`\n## ${h.slug}/${h.name}`);
    console.log(`   命中 ${h.count} 处 | ${clock(h.first.t)} → ${clock(h.last.t)} | ${(h.size / 1024).toFixed(0)}KB`);
    for (const s of h.samples) console.log(`   [${clock(s.t)} ${s.role}] ${s.snip}`);
  }
  if (!hits.length) console.log('（无命中：换关键词、或用 --days 放大时间窗口）');
  process.exit(0);
}

const id = args.id || args._[0];
if (!id || id === true) { console.log(USAGE.map((u) => '  ' + u).join('\n')); process.exit(1); }

const all = walkSessions(3650).filter((s) => s.name.includes(String(id)));
if (!all.length) {
  console.log(`未找到会话 ${id}。可用 --list --days 30 看看有哪些。`);
  process.exit(1);
}
const target = all.sort((a, b) => b.mtime - a.mtime)[0];
const recs = readRecords(target.path);
const anchors = buildAnchors(recs);

// ---- 模式 A：打锚点清单 ----
if (args.points) {
  const max = Number(args.max ?? 60);
  const min = Number(args.minChars ?? 0);
  const list = anchors.filter((a) => a.chars >= min);

  // 机器可读输出：给「分叉选择器」这类界面消费（一次调用拿齐会话 + 锚点 + 同级会话列表）
  if (args.json) {
    const textLen = Number(args.text ?? 90);
    const sameSlug = walkSessions(3650)
      .filter((s) => s.slug === target.slug && s.path !== target.path)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, Number(args.recent ?? 6))
      .map((s) => ({
        id: s.name.replace(/\.jsonl$/, ''),
        id8: s.name.replace(/\.jsonl$/, '').slice(0, 8),
        clock: clock(s.mtime),
        kb: Math.round(s.size / 1024),
      }));

    // --slim：数组化 + 角色编码（0=user 1=assistant），体积约为对象形式的 55%
    if (args.slim) {
      console.log(JSON.stringify({
        s: {
          id8: target.name.replace(/\.jsonl$/, '').slice(0, 8),
          slug: target.slug,
          recs: recs.length,
          n: anchors.length,
          up: clock(target.mtime),
        },
        r: sameSlug.map((s) => [s.id8, s.clock, s.kb]),
        a: list.slice(0, max).map((a) => [a.n, clock(a.time), a.kind === 'user' ? 0 : a.kind === 'assistant' ? 1 : 2, a.chars, oneLine(a.text).slice(0, textLen)]),
        t: Math.max(0, list.length - max),
      }));
      process.exit(0);
    }

    console.log(JSON.stringify({
      session: {
        id: target.name.replace(/\.jsonl$/, ''),
        id8: target.name.replace(/\.jsonl$/, '').slice(0, 8),
        slug: target.slug,
        records: recs.length,
        anchors: anchors.length,
        updated: clock(target.mtime),
      },
      recent: sameSlug,
      anchors: list.slice(0, max).map((a) => ({
        n: a.n,
        c: clock(a.time),
        role: a.kind,
        chars: a.chars,
        text: oneLine(a.text).slice(0, textLen),
      })),
      truncated: Math.max(0, list.length - max),
    }));
    process.exit(0);
  }

  console.log(`# ${target.slug}/${target.name} | ${recs.length} 条记录 | ${anchors.length} 个锚点 | 更新 ${clock(target.mtime)}`);
  console.log('# 锚点 = user / assistant / notice（系统通知）消息。用 --until <n> 或 --from <n> --to <m> 分叉。\n');
  for (const a of list.slice(0, max)) {
    console.log(`#${String(a.n).padStart(3)} | ${clock(a.time)} | ${a.kind.padEnd(9)} | ${oneLine(a.text).slice(0, 70)}（${a.chars} 字）`);
  }
  if (list.length > max) console.log(`…（还有 ${list.length - max} 个锚点，用 --max 调大）`);
  process.exit(0);
}

// ---- 模式 B：切片导出交接稿（Fork）----
const fromA = resolveAnchor(args.from, anchors);
const toA = args.to ? resolveAnchor(args.to, anchors) : null;
const untilA = args.until ? resolveAnchor(args.until, anchors) : null;

if (args.export || args.until || args.from) {
  const start = fromA || anchors[0];
  const end = args.to ? (toA || anchors[anchors.length - 1]) : (untilA || anchors[anchors.length - 1]);
  if (!start || !end) { console.log('锚点没解析出来，先跑 --points 看编号。'); process.exit(1); }
  if (start.n > end.n) { console.log(`范围反了：#${start.n} → #${end.n}`); process.exit(1); }
  const slice = anchors.filter((a) => a.n >= start.n && a.n <= end.n);
  const includeNoise = !args.noNoise;

  const head = [
    `# 分支交接稿 · ${target.name.replace(/\.jsonl$/, '').slice(0, 8)}`,
    '',
    `- 来源会话：\`${target.path}\``,
    `- 分支范围：**#${start.n}（${clock(start.time)}） → #${end.n}（${clock(end.time)}）**，共 ${slice.length} 条消息`,
    '- 分叉语义：只带这段历史，**该点之后的对话不纳入**；原会话不受影响',
    `- 生成时间：${stamp(Date.now())}（本机落盘记录，非平台检索）`,
    '',
    '---',
    '',
  ].join('\n');

  const body = slice.map((a) => {
    const rec = recs[a.recIndex];
    const lines = [`## #${a.n} · ${clock(a.time)} · ${a.kind}`, '', clip(bodyOf(rec), EXPORT_WIDTH), ''];
    if (includeNoise) {
      const noise = [];
      for (let i = a.recIndex + 1; i < recs.length; i++) {
        const r = recs[i];
        if (r.type === 'message') break;
        if (r.type === 'function_call' && r.name) {
          const a1 = String(r.arguments || '').replace(/\s+/g, ' ').slice(0, 160);
          noise.push(`- \`${r.name}\` ${a1}`);
        }
      }
      if (noise.length) lines.push('<details><summary>期间的工具调用</summary>', '', ...noise.slice(0, 12), '', '</details>', '');
    }
    return lines.join('\n');
  }).join('\n');

  const tailNote = [
    '---',
    '',
    '> 用法：把本文件读进当前会话 = 从分支点继续。需要更长/更短的窗口就重新导出。',
    '> 未纳入的消息：' + (end.n < anchors.length ? `#${end.n + 1} → #${anchors[anchors.length - 1].n}（${anchors.length - end.n} 条）` : '无（已到会话末尾）'),
    '',
  ].join('\n');

  const md = head + body + tailNote;

  if (args.export) {
    const out = typeof args.export === 'string'
      ? args.export
      : args.out && args.out !== true
        ? String(args.out)
        : path.join(BRANCH_DIR, `${target.name.replace(/\.jsonl$/, '').slice(0, 8)}-n${start.n}${end.n !== start.n ? '-' + end.n : ''}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
    console.log(`已导出分支交接稿：${out}`);
    console.log(`范围 #${start.n}→#${end.n}（${slice.length} 条消息，${md.length} 字）；未纳入 ${anchors.length - end.n} 条`);
  } else {
    console.log(md);
  }
  process.exit(0);
}

// ---- 模式 C：原样看尾部 ----
console.log(`# ${target.slug}/${target.name} | ${recs.length} 条记录 | 更新 ${clock(target.mtime)}`);
const filtered = args.grep ? recs.filter((r) => textOf(r).includes(String(args.grep))) : recs;
const tail = Number(args.tail ?? 20);
const shown = args.grep && !args.tail ? filtered : filtered.slice(-tail);
if (args.grep) console.log(`# 关键词「${args.grep}」命中 ${filtered.length} 处，显示最后 ${shown.length} 处`);
for (const r of shown) {
  const t = textOf(r).trim();
  if (!t) continue;
  console.log(`\n=== [${clock(r.timestamp)}] ${r.role || r.type}${r.name ? ' · ' + r.name : ''}`);
  console.log(t.length > WIDTH ? t.slice(0, WIDTH) + ` …(+${t.length - WIDTH}字)` : t);
}

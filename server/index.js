require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();

const LINE_READY = !!(
  process.env.LINE_CHANNEL_ACCESS_TOKEN &&
  process.env.LINE_CHANNEL_SECRET &&
  process.env.LINE_CHANNEL_ACCESS_TOKEN !== 'dummy' &&
  process.env.LINE_CHANNEL_SECRET !== 'dummy'
);

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy',
};

const lineClient = LINE_READY
  ? new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

if (!LINE_READY) {
  console.log('[LINE] ⚠ APIキー未設定');
} else {
  console.log('[LINE] ✓ LINE API 接続済み');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── データストア ──
let members = [];  // デモデータなし。実際に登録した人だけ
let jobs = [
  {
    id: 'j1', title: '横浜・入替工事 補助1名',
    area: '神奈川県横浜市', date: '明日', time: '19:00',
    count: 1, pay: 25000, type: '入替工事',
    urgent: true, postedBy: '管理者', status: 'open',
    applicants: [], createdAt: new Date().toISOString()
  },
  {
    id: 'j2', title: '川崎・定期メンテナンス 経験者2名',
    area: '神奈川県川崎市', date: '今週土曜', time: '10:00',
    count: 2, pay: 30000, type: 'メンテナンス',
    urgent: false, postedBy: '管理者', status: 'open',
    applicants: [], createdAt: new Date().toISOString()
  },
];
let knowledge = [
  { id: 'k1', category: '機種情報', title: 'CR大海物語5 設置時の注意点', body: 'ハーネス接続は必ず電源OFFで行う。', plan: 'light', date: '2024-01-15' },
  { id: 'k2', category: '効率化Tips', title: '入替工事を30分短縮する段取り', body: '台搬入前の台番確認・工具事前配置が鍵。', plan: 'light', date: '2024-01-10' },
  { id: 'k3', category: '不具合情報', title: '最新機種の電源投入時不具合対処法', body: 'エラーコード E-03 は再起動で解消。', plan: 'light', date: '2024-01-08' },
  { id: 'k4', category: '設置ノウハウ', title: 'スロット台の配線ミスを防ぐ確認フロー', body: '完全版チェックリスト付き。', plan: 'premium', date: '2024-01-05' },
  { id: 'k5', category: '機種情報', title: '2024年上半期 新台設置注意点まとめ', body: '12機種分の注意点を一覧化。', plan: 'premium', date: '2024-01-03' },
];

// ── LINE Webhook ──
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!LINE_READY) return res.status(200).json({ message: 'LINE not configured' });

  const body = req.body;
  const signature = req.headers['x-line-signature'];

  if (!line.validateSignature(body, lineConfig.channelSecret, signature)) {
    return res.status(400).send('Invalid signature');
  }

  res.status(200).end();

  const events = JSON.parse(body).events || [];
  for (const event of events) {
    handleLineEvent(event).catch(console.error);
  }
});

async function handleLineEvent(event) {
  if (!lineClient) return;
  const userId = event.source.userId;

  // ── 友だち追加 → LINE IDを自動保存 ──
  if (event.type === 'follow') {
    // 既存会員かチェック
    const existing = members.find(m => m.lineUserId === userId);
    if (!existing) {
      // 新規でLINE IDを保存（仮登録）
      members.push({
        id: uuidv4(),
        name: 'LINE会員',
        company: '未登録',
        area: '未設定',
        plan: 'light',
        lineUserId: userId,
        status: 'active',
        registeredAt: new Date().toISOString()
      });
      console.log(`[LINE] 新規友だち追加・自動登録: ${userId}`);
    }
    await lineClient.pushMessage({ to: userId, messages: [buildWelcomeMessage()] });
  }

  // ── メッセージ受信 ──
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    let reply;
    if (text.includes('案件') || text.includes('仕事')) {
      reply = buildJobListMessage();
    } else if (text.includes('登録')) {
      reply = buildRegisterMessage();
    } else {
      reply = { type: 'text', text: '下のメニューから操作できます！\n\n📋 案件を探す\n📤 案件を出す\n📚 ナレッジ\n👤 マイページ' };
    }
    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [reply] });
  }

  // ── ポストバック（ボタンタップ） ──
  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback.data);
    if (data.get('action') === 'apply') {
      await handleApply(event.replyToken, userId, data.get('jobId'));
    }
  }
}

// ── メッセージテンプレート ──
function buildWelcomeMessage() {
  return {
    type: 'flex', altText: 'MatchLineへようこそ！',
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#0D1B35' } },
      header: {
        type: 'box', layout: 'vertical', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'MATCHLINE', weight: 'bold', size: 'xxl', color: '#D4A843' },
          { type: 'text', text: '業界特化型 工事マッチングサービス', size: 'sm', color: '#FFFFFF', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
        contents: [
          { type: 'text', text: '友だち追加ありがとうございます！', weight: 'bold', size: 'md' },
          { type: 'text', text: '急な人手不足・稼働したい時にすぐ使えるプロ限定マッチングサービスです。', size: 'sm', color: '#556080', wrap: true },
          { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: [
            { type: 'text', text: '✅ 専門知識ある業者のみ登録', size: 'sm' },
            { type: 'text', text: '✅ 案件をLINEでリアルタイム通知', size: 'sm' },
            { type: 'text', text: '✅ 月300円〜（ライトプラン）', size: 'sm' },
          ]},
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{
          type: 'button', style: 'primary', color: '#D4A843',
          action: { type: 'uri', label: '今すぐ会員登録する', uri: `${process.env.APP_URL || 'https://matchline.onrender.com'}/` },
        }],
      },
    },
  };
}

function buildInfoRow(icon, text) {
  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
    { type: 'text', text: icon, size: 'sm', flex: 0 },
    { type: 'text', text, size: 'sm', color: '#556080', flex: 1 },
  ]};
}

function buildJobListMessage() {
  const openJobs = jobs.filter(j => j.status === 'open').slice(0, 5);
  if (openJobs.length === 0) {
    return { type: 'text', text: '現在募集中の案件はありません。\n新着案件はすぐにお知らせします！' };
  }
  const bubbles = openJobs.map(job => ({
    type: 'bubble',
    styles: { header: { backgroundColor: job.urgent ? '#FF4D6A' : '#0D1B35' } },
    header: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: [
      { type: 'text', text: job.urgent ? '🔴 緊急募集' : '📋 案件情報', color: '#FFFFFF', weight: 'bold', size: 'sm' },
    ]},
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
      { type: 'text', text: job.title, weight: 'bold', size: 'md', wrap: true },
      { type: 'separator', margin: 'sm' },
      buildInfoRow('📍', job.area),
      buildInfoRow('📅', `${job.date}　${job.time}〜`),
      buildInfoRow('👤', `あと${job.count}名募集`),
      buildInfoRow('💰', `日当 ¥${job.pay.toLocaleString()}`),
    ]},
    footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{
      type: 'button', style: 'primary', color: '#0D1B35',
      action: { type: 'postback', label: 'この案件に応募する', data: `action=apply&jobId=${job.id}`, displayText: `${job.title}に応募します` },
    }]},
  }));
  return { type: 'flex', altText: `現在${openJobs.length}件の案件があります`, contents: { type: 'carousel', contents: bubbles } };
}

function buildRegisterMessage() {
  return {
    type: 'flex', altText: '会員登録のご案内',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: [
        { type: 'text', text: '会員登録のご案内', weight: 'bold', size: 'lg' },
        { type: 'text', text: '以下のボタンから登録フォームを開いてください。', size: 'sm', color: '#556080', wrap: true },
      ]},
      footer: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: [{
        type: 'button', style: 'primary', color: '#D4A843',
        action: { type: 'uri', label: '登録フォームを開く', uri: `${process.env.APP_URL || 'https://matchline.onrender.com'}/` },
      }]},
    },
  };
}

function buildJobNotificationMessage(job) {
  return {
    type: 'flex', altText: `【新着案件】${job.title}`,
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: job.urgent ? '#FF4D6A' : '#0D1B35' } },
      header: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: [
        { type: 'text', text: job.urgent ? '⚡ 緊急案件が入りました！' : '📋 新しい案件が入りました', color: '#FFFFFF', weight: 'bold', size: 'md' },
      ]},
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '18px', contents: [
        { type: 'text', text: job.title, weight: 'bold', size: 'lg', wrap: true },
        { type: 'separator', margin: 'md' },
        buildInfoRow('📍', job.area),
        buildInfoRow('📅', `${job.date}　${job.time}〜`),
        buildInfoRow('👤', `${job.count}名募集`),
        buildInfoRow('💰', `日当 ¥${job.pay.toLocaleString()}`),
        buildInfoRow('🔧', job.type),
      ]},
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
        { type: 'button', style: 'primary', color: '#D4A843',
          action: { type: 'postback', label: '✋ 応募する', data: `action=apply&jobId=${job.id}`, displayText: `${job.title}に応募します！` } },
        { type: 'button', style: 'secondary',
          action: { type: 'uri', label: '詳細を見る', uri: `${process.env.APP_URL || 'https://matchline.onrender.com'}/` } },
      ]},
    },
  };
}

async function handleApply(replyToken, userId, jobId) {
  if (!lineClient) return;
  const job = jobs.find(j => j.id === jobId);
  if (!job || job.status !== 'open') {
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: 'この案件はすでに締め切られています。' }] });
    return;
  }
  const member = members.find(m => m.lineUserId === userId);
  const name = member ? (member.name !== 'LINE会員' ? member.name : member.company) : 'LINE会員';
  if (job.applicants.find(a => a.lineUserId === userId)) {
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text: 'すでにこの案件に応募済みです。' }] });
    return;
  }
  job.applicants.push({ memberName: name, lineUserId: userId, appliedAt: new Date().toISOString() });
  if (job.applicants.length >= job.count) job.status = 'filled';
  await lineClient.replyMessage({ replyToken, messages: [{
    type: 'flex', altText: '応募完了！',
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#00C896' } },
      header: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: [
        { type: 'text', text: '✅ 応募完了！', color: '#FFFFFF', weight: 'bold', size: 'lg' },
      ]},
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '18px', contents: [
        { type: 'text', text: job.title, weight: 'bold', size: 'md', wrap: true },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: '担当者が確認次第、このLINEにご連絡します。', size: 'sm', color: '#556080', wrap: true },
      ]},
    },
  }]});
  console.log(`[LINE応募] ${name} → ${job.title}`);
}

// ── API ──
app.get('/api/jobs', (req, res) => {
  res.json({ jobs: jobs.filter(j => j.status === 'open') });
});

app.post('/api/jobs', async (req, res) => {
  const { title, area, date, time, count, pay, type, urgent } = req.body;
  if (!title || !area || !pay) return res.status(400).json({ error: '必須項目が不足しています' });

  const job = {
    id: uuidv4(), title, area,
    date: date || '未定', time: time || '19:00',
    count: Number(count) || 1, pay: Number(pay),
    type: type || '入替工事', urgent: !!urgent,
    postedBy: 'user', status: 'open',
    applicants: [], createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  console.log(`[案件] 新規投稿: ${title}`);

  let notified = 0;
  if (LINE_READY && lineClient) {
    const targets = members.filter(m => m.status === 'active' && m.lineUserId);
    if (targets.length > 0) {
      try {
        await lineClient.multicast({ to: targets.map(m => m.lineUserId), messages: [buildJobNotificationMessage(job)] });
        notified = targets.length;
        console.log(`[LINE] ${notified}名に通知送信完了`);
      } catch (err) {
        console.error('[LINE] 通知送信エラー:', err.message);
      }
    } else {
      console.log('[LINE] 通知対象会員なし');
    }
  }
  res.json({ success: true, job, notified });
});

app.post('/api/jobs/:jobId/apply', (req, res) => {
  const job = jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: '案件が見つかりません' });
  if (job.status !== 'open') return res.status(400).json({ error: 'この案件は受付終了です' });
  const { memberName, lineUserId } = req.body;
  if (lineUserId && job.applicants.find(a => a.lineUserId === lineUserId)) {
    return res.status(400).json({ error: 'すでに応募済みです' });
  }
  job.applicants.push({ memberName: memberName || '匿名', lineUserId, appliedAt: new Date().toISOString() });
  if (job.applicants.length >= job.count) job.status = 'filled';
  res.json({ success: true, message: '応募が完了しました！' });
});

app.post('/api/members', (req, res) => {
  const { name, company, area, phone, plan, lineUserId } = req.body;
  if (!name || !company || !phone) return res.status(400).json({ error: '必須項目が不足しています' });

  // 既存のLINE IDがあれば情報を更新
  if (lineUserId) {
    const existing = members.find(m => m.lineUserId === lineUserId);
    if (existing) {
      existing.name = name;
      existing.company = company;
      existing.area = area;
      existing.phone = phone;
      existing.plan = plan || 'light';
      existing.status = 'active';
      console.log(`[会員] 情報更新: ${company}`);
      return res.json({ success: true, member: existing });
    }
  }

  const member = {
    id: uuidv4(), name, company, area, phone,
    plan: plan || 'light',
    lineUserId: lineUserId || null,
    status: 'pending',
    registeredAt: new Date().toISOString(),
  };
  members.push(member);
  console.log(`[会員] 新規登録: ${company} (${name})`);
  res.json({ success: true, member });
});

app.get('/api/members', (req, res) => {
  res.json({ members });
});

app.get('/api/knowledge', (req, res) => {
  const plan = req.query.plan || 'light';
  res.json({ knowledge: plan === 'premium' ? knowledge : knowledge.filter(k => k.plan === 'light') });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', lineReady: LINE_READY, members: members.length, jobs: jobs.filter(j => j.status === 'open').length, time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   MatchLine サーバー起動中         ║
  ║   Port: ${PORT}                      ║
  ║   LINE: ${LINE_READY ? '✓ 接続済み' : '⚠ 未設定'}              ║
  ╚═══════════════════════════════════╝
  `);
});

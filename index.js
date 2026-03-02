require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();
const PORT = 56627;

app.use(express.json());
app.use(express.static('public'));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// 保存済みトークンを読み込む（環境変数 or token.json）
if (process.env.GMAIL_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    access_token: process.env.GMAIL_ACCESS_TOKEN,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    token_type: 'Bearer',
  });
} else if (fs.existsSync('token.json')) {
  const tokens = JSON.parse(fs.readFileSync('token.json'));
  oauth2Client.setCredentials(tokens);
}

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// 認証URL生成
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.modify'],
  });
  res.redirect(url);
});

// OAuthコールバック
app.get('/', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync('token.json', JSON.stringify(tokens, null, 2));
    res.redirect('/');
  } catch (err) {
    console.error('トークン取得エラー:', err.message);
    res.status(500).send('トークンの取得に失敗しました');
  }
});

// メール一覧取得
app.get('/api/emails', async (req, res) => {
  const maxResults = req.query.limit ? parseInt(req.query.limit) : 50;
  const filter = req.query.filter;

  const labelIds = ['INBOX'];
  let q = undefined;
  if (filter === 'unread') labelIds.push('UNREAD');
  if (filter === 'read') q = '-label:unread';

  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      labelIds,
      maxResults,
      ...(q && { q }),
    });

    if (!data.messages) return res.json([]);

    const messages = data.messages.slice(0, maxResults);

    const emails = await Promise.all(
      messages.map(async ({ id }) => {
        const { data: msg } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = msg.payload.headers;
        const get = (name) => headers.find(h => h.name === name)?.value || '';

        return {
          id,
          subject: get('Subject'),
          from: get('From'),
          date: get('Date'),
          snippet: msg.snippet,
        };
      })
    );

    res.json(emails);
  } catch (err) {
    console.error('メール取得エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// メール詳細取得
app.get('/api/emails/:id', async (req, res) => {
  try {
    const { data: msg } = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
    });

    const headers = msg.payload.headers;
    const get = (name) => headers.find(h => h.name === name)?.value || '';

    // 本文を取得（テキストまたはHTML）
    const getBody = (payload) => {
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
      if (payload.parts) {
        const html = payload.parts.find(p => p.mimeType === 'text/html');
        const text = payload.parts.find(p => p.mimeType === 'text/plain');
        const part = html || text;
        if (part?.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        // ネストされたパーツも探す
        for (const p of payload.parts) {
          const body = getBody(p);
          if (body) return body;
        }
      }
      return '';
    };

    res.json({
      id: msg.id,
      subject: get('Subject'),
      from: get('From'),
      to: get('To'),
      date: get('Date'),
      body: getBody(msg.payload),
      mimeType: msg.payload.mimeType,
    });
  } catch (err) {
    console.error('メール詳細エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// メール検索
app.get('/api/emails/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'クエリが必要です' });

  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 20,
    });

    if (!data.messages) return res.json([]);

    const emails = await Promise.all(
      data.messages.map(async ({ id }) => {
        const { data: msg } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = msg.payload.headers;
        const get = (name) => headers.find(h => h.name === name)?.value || '';

        return {
          id,
          subject: get('Subject'),
          from: get('From'),
          date: get('Date'),
          snippet: msg.snippet,
        };
      })
    );

    res.json(emails);
  } catch (err) {
    console.error('検索エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 受信済みアドレス一覧
app.get('/api/contacts', async (req, res) => {
  try {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 100,
    });

    if (!data.messages) return res.json([]);

    const froms = await Promise.all(
      data.messages.map(async ({ id }) => {
        const { data: msg } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From'],
        });
        return msg.payload.headers.find(h => h.name === 'From')?.value || '';
      })
    );

    // 重複を除いてメアドだけ抽出
    const unique = [...new Set(froms.filter(Boolean))];
    res.json(unique);
  } catch (err) {
    console.error('連絡先取得エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// AI推敲
app.post('/api/proofread', async (req, res) => {
  const { subject, body } = req.body;
  if (!body) return res.status(400).json({ error: '本文が必要です' });

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `以下のメールを推敲してください。誤字・脱字の修正、敬語の改善、読みやすい文章への整理を行い、推敲後の本文のみを返してください。説明や前置きは不要です。

件名: ${subject || '(なし)'}
本文:
${body}`,
      }],
    });

    res.json({ result: completion.choices[0].message.content });
  } catch (err) {
    console.error('AI推敲エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// メール送信
app.post('/api/emails/send', async (req, res) => {
  const { to, cc, bcc, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: '宛先・件名・本文が必要です' });
  }

  const lines = [
    `To: ${to}`,
    ...(cc  ? [`Cc: ${cc}`]  : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ];

  const message = lines.join('\n');

  const encoded = Buffer.from(message).toString('base64url');

  try {
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('送信エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// メール本文をRFC2822形式に変換するヘルパー
const buildRaw = ({ to, cc, bcc, subject, body }) => {
  const lines = [
    ...(to      ? [`To: ${to}`] : []),
    ...(cc      ? [`Cc: ${cc}`] : []),
    ...(bcc     ? [`Bcc: ${bcc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject || '').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body || '',
  ];
  return Buffer.from(lines.join('\n')).toString('base64url');
};

// 下書き一覧
app.get('/api/drafts', async (req, res) => {
  try {
    const { data } = await gmail.users.drafts.list({ userId: 'me', maxResults: 20 });
    if (!data.drafts) return res.json([]);

    const drafts = await Promise.all(
      data.drafts.map(async ({ id }) => {
        const { data: draft } = await gmail.users.drafts.get({
          userId: 'me', id, format: 'metadata',
          fields: 'id,message(payload/headers,snippet)',
        });
        const headers = draft.message?.payload?.headers || [];
        const get = (name) => headers.find(h => h.name === name)?.value || '';
        return { id, subject: get('Subject'), to: get('To'), snippet: draft.message?.snippet || '' };
      })
    );
    res.json(drafts);
  } catch (err) {
    console.error('下書き一覧エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 下書き保存
app.post('/api/drafts', async (req, res) => {
  const { to, cc, bcc, subject, body } = req.body;
  try {
    const { data } = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: buildRaw({ to, cc, bcc, subject, body }) } },
    });
    res.json({ id: data.id });
  } catch (err) {
    console.error('下書き保存エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 下書き取得（編集用）
app.get('/api/drafts/:id', async (req, res) => {
  try {
    const { data } = await gmail.users.drafts.get({ userId: 'me', id: req.params.id, format: 'full' });
    const headers = data.message?.payload?.headers || [];
    const get = (name) => headers.find(h => h.name === name)?.value || '';
    const getBody = (payload) => {
      if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      if (payload.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain');
        if (part?.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      return '';
    };
    res.json({ id: data.id, to: get('To'), cc: get('Cc'), bcc: get('Bcc'), subject: get('Subject'), body: getBody(data.message.payload) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下書き削除
app.delete('/api/drafts/:id', async (req, res) => {
  try {
    await gmail.users.drafts.delete({ userId: 'me', id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ローカル開発時のみサーバー起動
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`サーバー起動中: http://localhost:${PORT}`);
  });
}

module.exports = app;

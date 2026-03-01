# ねこちゃんのメールボックス

## 概要
GmailをブラウザUIで操作できるNode.jsウェブアプリ。
ポート56627で動作。

## 起動方法
```powershell
cd C:\Users\user\my-email-service; node index.js
```
ブラウザで `http://localhost:56627` を開く。

## 認証
初回または再認証が必要な場合は `http://localhost:56627/auth` にアクセス。
トークンは `token.json` に保存される。

## 機能一覧
- **受信トレイ** - 最新5件表示、「一覧を見る」で全件表示
- **未読/既読フィルター** - ラジオボタンで切り替え
- **メール詳細** - 件名クリックでモーダル表示（HTML/テキスト対応）
- **メール検索** - キーワード検索
- **メール送信** - To / Cc / Bcc 対応
- **宛先候補** - 過去の受信アドレスをdatalistで補完
- **AI推敲** - Groqで本文を推敲（採用/閉じるボタン付き）
- **下書き保存** - Gmailの下書きとして保存・一覧・読込・削除

## デザイン
- テーマカラー：薄いピンク（#ffb6c1）
- 背景：ピンクのドット柄
- ヘッダー：ドット柄オーバーレイ
- CSSで作ったねこちゃんが画面下を左右に走る（進行方向に顔が向く）

## ファイル構成
```
my-email-service/
├── index.js          # サーバー（Express + Gmail API + Groq）
├── .env              # 認証情報（CLIENT_ID, CLIENT_SECRET, GROQ_API_KEY など）
├── token.json        # Gmailアクセストークン（自動生成）
├── public/
│   └── index.html    # フロントエンド（HTML/CSS/JS）
└── package.json
```

## 環境変数（.env）
```
CLIENT_ID=...
CLIENT_SECRET=...
REDIRECT_URI=http://localhost:56627
GEMINI_API_KEY=...（未使用、Groqに切り替え済み）
GROQ_API_KEY=...
```

## 使用パッケージ
- express
- googleapis
- dotenv
- @google/generative-ai（未使用）
- groq-sdk

## APIエンドポイント
| メソッド | パス | 説明 |
|--------|------|------|
| GET | /auth | OAuth認証開始 |
| GET | / | トップページ / OAuthコールバック |
| GET | /api/emails | メール一覧（?limit=5&filter=unread など） |
| GET | /api/emails/:id | メール詳細 |
| GET | /api/emails/search | メール検索（?q=キーワード） |
| GET | /api/contacts | 受信アドレス一覧 |
| POST | /api/emails/send | メール送信 |
| POST | /api/proofread | AI推敲（Groq） |
| GET | /api/drafts | 下書き一覧 |
| POST | /api/drafts | 下書き保存 |
| GET | /api/drafts/:id | 下書き取得 |
| DELETE | /api/drafts/:id | 下書き削除 |

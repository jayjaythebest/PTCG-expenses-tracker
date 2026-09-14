# 公開展示版（read-only demo）

一個給外人看的 J Vault：**只有收藏庫、只能看、不能改**，資料是真的。
記帳、支出分析、AI 摘要在 demo 裡沒有任何入口 —— `DemoApp` 只掛 `<Collection />`，
那些畫面永遠不會被 render。

(它們的程式碼還是會被打包進去 —— `App.tsx` 是靜態 import。這不是漏洞：
bundle 本來就是公開的，而那些元件讀的表 anon 一列都拿不到。要真的把它們排除
得改成動態 import，為了幾 KB 的死碼不值得。**能不能看到資料是資料庫決定的，
不是 bundle 決定的。**)

同一個 repo、同一個 Supabase 專案,靠一個 build flag 分岔。

---

## 它是怎麼安全的

三層,由內而外:

1. **資料庫** — anon 只被授權讀 `public.collection_public` 一個 view
   (`supabase/public_demo.sql`)。`auth_lockdown.sql` 把每張表都關給
   `authenticated` 了,這個 view 是唯一開回來的東西,而且只有 `select`
   權限 —— demo 在資料庫層面就是唯讀的,前端做什麼都改不了。

2. **欄位** — RLS 過濾的是「列」不是「欄」。所以用 view 而不是 policy:
   `purchase_price`(買入價)、`notes`(自由文字,可能有賣家和成交價)、
   `grading_cert`(鑑定編號可回查送件紀錄)在 view 裡是 `null`,
   直接打 REST endpoint 也拿不到。soft-delete 的列和其他 owner 的卡片
   也在 view 裡就濾掉了。

3. **UI** — `IS_DEMO`(`src/lib/demo.ts`)拿掉所有寫入控制項,並且**不顯示
   收藏總市值**。單卡市價留著 —— 那是從二手市場抓的公開行情;總額是個人
   資產數字,而這個頁面會掛在履歷上。Demo 的 hero 改成「N 張 + 已追蹤市價
   M 張」。

   **損益也整個拿掉了**(hero 和單卡都是,`pnlOf()` 在 demo 直接回 null,
   「損益」排序選項也跟著消失)。原因不是隱私而是誠實:損益的基準是
   `current_value`(當初估價),112 張裡只有 4 張填了,算出來的百分比是
   `+1444%` / 單卡 `+7647%` 這種數字。你自己看得懂那是什麼,外人看到只會
   覺得是壞的或在吹。市價本身才是要展示的東西。

> anon key 本來就在你 production 的 bundle 裡(所有 Supabase 前端都是這樣)。
> 也就是說 view 一建立,任何載入過你正式站的人就能讀到這份 gallery,
> 不需要等 demo 網址上線。這是這個設計的前提,不是 bug。

---

## 一次性設定

### 1. 資料庫

在 Supabase SQL Editor 跑 `supabase/public_demo.sql`(可重複執行)。

跑完驗一下,被擋掉的欄位應該全是 null:

```sql
select purchase_price, notes, grading_cert, count(*)
  from public.collection_public group by 1,2,3;
```

以及 anon 讀不到表、讀得到 view:

```bash
curl "$SUPABASE_URL/rest/v1/collection_items?select=*" -H "apikey: $ANON_KEY"
curl "$SUPABASE_URL/rest/v1/collection_public?select=name" -H "apikey: $ANON_KEY"
```

Supabase 的 security advisor 會把這個 view 標成 "security definer view"。
**那正是它要做的事** —— view 以 owner 身分執行,才讀得到被 RLS 鎖住的
`collection_items`。不要照著建議把 `security_invoker` 打開,打開之後
anon 讀到的會是零列,demo 直接空白。

### 2. `demo` 分支

第二個 Vercel 專案會跟著 `vercel.json` 把 **cron 也複製一份**:每天多跑一次
`/api/snapshot-collection`、每週多跑 weekly-summary,而 demo 專案沒有
service-role key,只會一直失敗寄信;Hobby 方案還有 cron 數量上限。
Vercel 不能在專案層關掉 `vercel.json` 裡的 cron,所以用一個分支處理:

```bash
git checkout -b demo main
# 編輯 vercel.json，刪掉整個 "crons": [...] 區塊（functions 保留）
git commit -am "demo: drop crons — the production project owns the schedule"
git push -u origin demo
```

這個分支跟 `main` 的差別**只有 `vercel.json` 一個檔案**,所以之後同步就是:

```bash
git checkout demo && git merge main && git push
```

幾乎不會衝突(只有動到 `vercel.json` 的那次會)。

### 3. 第二個 Vercel 專案

Vercel → Add New → Project → 匯入同一個 repo,然後:

| 設定 | 值 |
|---|---|
| Production Branch | `demo` |
| Build Command | `npm run build:demo` ← **唯讀版就是這個開關** |
| `VITE_SUPABASE_URL` | 跟正式站同一個 |
| `VITE_SUPABASE_ANON_KEY` | 跟正式站同一個 |
| `DEMO_PUBLIC_FX` | `1` |

唯讀模式是靠 `--mode demo` 打開的(`vite.config.ts` 在該 mode 下 define
`VITE_DEMO`),**不是靠環境變數**。原因是 `.gitignore` 排除 `.env*`,
env 檔根本進不了 repo,也就到不了 Vercel 和 CI —— 旗標會剛好在最需要它的
那個 build 裡悄悄是關的。放在 vite.config.ts 就沒有這個問題。

`VITE_*` 兩個 Supabase 變數仍然是 **build time** inline 進 bundle 的,
漏了任何一個就是白畫面。改完 env 要 redeploy,不是重新整理。

`DEMO_PUBLIC_FX=1` 讓 `/api/fx` 不用 session 也能回答(見 `api/fx.ts`)。
沒有它,demo 拿不到匯率,會退回寫死的 0.2,所有台幣數字都會悄悄偏掉。
**這是唯一可以這樣開的路由** —— 它回的是公開匯率、不花 AI quota、
不碰使用者資料、兩層快取 12 小時。正式專案不要設這個變數,
也不要把這個寫法複製到任何會爬蟲或花錢的路由。

其餘 `api/` 路由在 demo 專案沒有 `SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY`,
而且都有 `requireUser`,訪客打進去只會拿到 401 / 503。demo 的 UI 本來就不會呼叫它們。

---

## 本機驗證

```bash
npm run dev:demo     # port 3001，跟正式的 npm run dev (3000) 可以同時開
```

該看到:單一頁的收藏庫、右上角「唯讀展示」、沒有新增/編輯/刪除/更新價格、
點卡片的詳細頁沒有底部動作列、hero 是張數而不是 NT$ 總額。

正式 build 不帶旗標,行為完全不變:

```bash
npm run dev
```

---

## 之後要加別的專案 demo

同一套形狀可以重用:`--mode demo` 決定唯讀、資料庫層用 view 收欄位、
第二個 Vercel 專案掛 subdomain。CV 上只放一個 portfolio index 的網址,
各專案掛在它底下(`jvault.<你的網域>`),不要在履歷上列一排連結。

# 拔爽了沒? — 玻璃顱骨 · 破壞下注

（專案代號 EXTRACTION）一款「破壞型」下注遊戲原型：一顆透明玻璃機械頭顱，共有 30 個可下注的部位（28 顆牙齒 + 2 顆玻璃眼）。
選好 BET，點擊任一部位就出手一次：牙齒用拔牙鉗拔除，眼睛用鐵鎚敲碎，破壞後揭曉該部位的返還倍率。

技術：three.js（WebGL）+ Vite，無任何外部美術或音效檔，模型、特效、音效全部由程式產生。

## 執行

Windows 直接雙擊 `start.bat`：第一次會自動安裝套件，接著啟動伺服器並開啟瀏覽器；關掉那個視窗就停止。

或手動：

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 輸出到 dist/，可直接放到任何靜態主機
```

## 上架到金碟遊樂場（GoldSaucer）

平台規格見 https://goldsaucer.ovan929.chatgpt.site/docs ：上傳 zip，根目錄要有 `index.html`；`.bin` 在允許的副檔名內；單檔 20 MB、壓縮檔 100 MB 以內；封面建議 16:10、1 MB 以內。

上架包需要的兩個檔案放在 `public/`，建置時會一起複製到 `dist/` 根目錄：

- `public/goldsaucer.json`：平台設定（入口、封面、方向）。
- `public/cover.jpg`：1600×1000 封面，由 `npm run cover` 從遊戲畫面產生（需先開著 `npm run dev`）。

打包：

```bash
npm run build
python -c "import os,zipfile;z=zipfile.ZipFile('dist/bashuang.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,n),os.path.relpath(os.path.join(r,n),'dist').replace(os.sep,'/')) for r,_,ns in os.walk('dist') for n in ns if n!='bashuang.zip'];z.close()"
```

zip 裡的路徑必須用 `/`（Windows PowerShell 5.1 的 `Compress-Archive` 會寫成 `\`，平台會拒收）。
上傳：在平台「創作者後台」建立遊戲後上傳 zip；或建立 API 權杖讓 AI 透過 `/agent/mcp` 代為上傳。

## 玩法

| 操作 | 說明 |
| --- | --- |
| 點擊牙齒 | 下注一次，拔牙鉗夾住後開始拉扯：牙齒每撐住一次，上方獎階就往上跳一格；拔出的那一刻鎖定獎金 |
| 點擊眼睛 | 下注一次，鐵鎚三連擊：裂紋 → 破洞 → 整片碎裂（慢動作）後揭曉倍率 |
| 右側下注盤 | 齒位圖，可直接點擊下注，破壞後顯示該部位結果 |
| 左側返還表 | 每個部位的倍率階梯、中獎率、最高倍率 |
| 拖曳 / 滾輪 | 旋轉、縮放鏡頭 |
| 新頭顱 | 重新裝上所有牙齒與鏡片，開始新的一局（全部破壞後會自動更換） |
| 加速 | 動畫 1.7 倍速 |

每次開啟（或重新整理）遊戲，籌碼都會重置為 10,000；只有上次選的 BET 大小會記住。籌碼低於 10 時會出現「補充籌碼」。

## 拔牙的演出

結果在下注當下就決定了，拔牙過程是把結果「演」出來：

- 每顆牙一開始的搖動都一樣，看不出好壞。
- 之後每一次用力拉，牙齒要嘛被拔出（鎖定目前獎金），要嘛撐住。撐住一次，畫面上方的獎階就亮下一格、獎金跟著跳。
- 所以倍率越高的牙越難拔、拉扯越久：牙根越燒越紅、電弧越多、鏡頭越推越近；撐過三輪以上的長局中途鉗子還會打滑一次再重夾。
- 牙齒本身的外觀跟著獎金一起升級，不是拔出來才變：×1 左右開始泛光，×5 前後轉成金色並有流光掃過，×20 以上變成彩虹稜光、表面閃爍碎鑽般的亮點；同時牙槽噴出的光柱、牙齒周圍的放射光芒與星光也逐級加強，背景逐漸壓暗。
- 5 倍以上（BIG WIN）在最後一拉前會壓暗、慢動作加心跳；拔出後牙齒變成金牙，背後放射光芒、噴金幣。20 倍以上（MEGA WIN）再加彩虹稜光、彩帶與煙火，50 倍以上顯示 JACKPOT。
- 落空的牙第一拉就鬆脫，直接顯示 ×0。

流程在 [src/game/actions.js](src/game/actions.js) 的 `extractTooth` 與 `celebrate`，特效在 [src/fx/award.js](src/fx/award.js)，畫面衝擊後製在 [src/scene/stage.js](src/scene/stage.js)。

## 賠率

賠率表在 [src/game/paytable.js](src/game/paytable.js)，每個部位一張 `[倍率, 權重]` 表，改數字即可調整。裡面有兩組權重，由最上面的 `SHOWCASE` 切換：

- **`SHOWCASE = true`（目前）特效展示用**：權重偏向高倍率，大約一半的出手是 BIG WIN 以上；門牙與犬齒各多一個最高獎（×20、×30），讓每個部位都演得到 MEGA WIN。返還遠超過下注，不收斂。
- **`SHOWCASE = false` 平衡版**：各部位理論 RTP 都在 96% 左右，波動度由前往後遞增，如下表：

| 部位 | 數量 | 中獎率 | 最高倍率 | RTP |
| --- | --- | --- | --- | --- |
| 門牙 | 8 | 100% | ×8 | 96.5% |
| 犬齒 | 4 | 66% | ×15 | 95.8% |
| 小臼齒 | 8 | 44% | ×25 | 95.8% |
| 大臼齒 | 8 | 28% | ×50 | 96.5% |
| 玻璃眼 | 2 | 18% | ×100 | 96.2% |

結果在下注當下以 `crypto.getRandomValues` 抽出，動畫只是演出；派彩在倍率揭曉的那一刻入帳。
這是純前端原型，正式上線時抽獎與帳務必須移到伺服器端。

## 模型是怎麼做的

參考 Higgsfield 的「透明玻璃頭」文章（用程式在 Blender 裡把頭顱一個零件一個零件建出來），
這裡改成直接在瀏覽器即時渲染，所以每個零件同樣是獨立物件，可以各自動作、各自被破壞。

- **雕塑件**（顱骨外殼、下顎、金色牙軌、5 種牙齒）：用距離場（SDF）描述形狀，
  由 `npm run bake` 轉成網格存到 `public/models/*.bin`。形狀定義在 [src/model/skullSdf.js](src/model/skullSdf.js)，
  牙齒與眼睛的位置在 [src/model/layout.js](src/model/layout.js)。改完形狀後重新執行 `npm run bake`。
- **機械件**（鏡頭眼、齒輪、頸部活塞、線束、核心陀螺儀、螺栓）：執行時用程式組出，見 [src/model/mechanics.js](src/model/mechanics.js)、[src/model/eyes.js](src/model/eyes.js)。
- **玻璃**：物理式穿透材質（折射 + 厚度染色），外殼接縫線在著色器內繪製；攝影棚燈光是程式產生的環境貼圖。
- **鏡片碎裂**：每片鏡片預先依撞擊點切成放射狀 + 同心圓的碎片，裂紋由內往外蔓延，見 [src/fx/shatter.js](src/fx/shatter.js)。
- **演出編排**：兩套破壞動畫與重組動畫都在 [src/game/actions.js](src/game/actions.js)。
- **音效**：真實錄音素材（見下方「音效」），載入前或載入失敗時退回 WebAudio 合成音，見 [src/audio/sfx.js](src/audio/sfx.js)。

## 音效

所有素材都是 **CC0（公共領域）**，可商用、不需標註；來源清單在 [public/sfx/CREDITS.txt](public/sfx/CREDITS.txt)：

- Kenney（kenney.nl）的 8 個音效包：衝擊、科幻、RPG、賭場、介面、數位、UI、音樂短曲。
- Freesound 上 30 個 CC0 錄音：玻璃碎裂、骨頭碎裂、伺服馬達、液壓、心跳、老虎機派彩、號角等。

[tools/sfx_build.py](tools/sfx_build.py) 負責剪輯：每個音效的來源、裁切點、疊加、淡入淡出都寫在表格裡，統一響度後輸出到 `public/sfx/`（單次音效為 MP3，循環音效為 WAV 以免接縫有空隙）。要調整就改表格重跑：

```bash
python tools/sfx_build.py <素材資料夾>   # 資料夾內需有 kflat/（Kenney 的 .ogg 攤平）與 fs/<id>.mp3
```

遊戲裡的對應：

| 時機 | 音效 |
| --- | --- |
| 待機 | 工業機械低頻嗡鳴＋齒輪滴答（循環；齒輪轉越快滴答越快） |
| 擺頭／張嘴 | 伺服馬達循環，音量與音高跟著頭部角速度；下顎張開噴氣、閉合撞擊 |
| 敲眼 | 揮擊破風、鐵鎚撞擊、玻璃裂開→破洞→大碎裂＋慢動作碎響、碎片落地、斷電、殘骸火花 |
| 拔牙 | 鉗子夾緊、吱嘎搖動、牙根研磨、骨頭碎裂（每撐住一次）、打滑、心跳、拔出、神經斷裂、牙齒落地 |
| 開獎 | 升階的「叮」逐級升高＋籌碼聲；小獎鋼鼓短曲；BIG 號角；MEGA／JACKPOT 號角＋老虎機鈴聲＋金幣雨（JACKPOT 再加天使合唱） |
| 滾分 | 金額滾動期間播老虎機出幣循環，停下時敲鐘 |

在金碟遊樂場上，待機的機械聲走平台的「音樂」開關，其他走「音效」開關；遊戲右下角的「音效」鈕是總開關。

## 目錄

```
src/
  main.js            進入點：輸入、下注流程、主迴圈
  scene/stage.js     渲染器、燈光、環境、鏡頭、後製
  model/             頭顱：形狀定義、材質、眼睛、機械結構
  fx/                碎裂、碎片物理、粒子、中獎特效（award.js）
  tools/tools.js     鐵鎚與拔牙鉗模型
  game/              賠率表、帳務、破壞動畫編排
  ui/                HUD（返還表、下注盤、BET 列）
  audio/sfx.js       合成音效
tools/
  bake.mjs           SDF → 網格
  shot.mjs           無頭瀏覽器截圖（檢查畫面用）
  smoke.mjs          自動把 30 個部位各玩一次，檢查帳務與錯誤
```

## 測試

```bash
npm run dev                 # 先開著
node tools/smoke.mjs        # 需要本機 Chrome；路徑可用環境變數 CHROME 指定
```

網址參數（除錯用）：`?nointro=1` 跳過開場組裝、`?clay=1` 灰模檢視、`?cam=x,y,z,tx,ty,tz` 固定鏡頭。

## 效能

外殼約 34 萬面、含折射與泛光，內顯在 1080p 約 40 fps。遊戲會依實際幀率自動調整解析度比例（0.6–1.5）。

#!/usr/bin/env node
/**
 * Render all 20 F1TI personality cards as standalone PNG screenshots.
 *
 * - Reads each cartoon portrait from `F1-卡通图/`, base64-encodes it.
 * - Builds a temp HTML page that renders exactly one card.
 * - Drives macOS `Google Chrome --headless` to screenshot 1200×700.
 * - Outputs `f1ti_cards/<TYPECODE>.png`.
 *
 * Run from project root:  `node tools/build-cards.mjs`
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARTOON_DIR = path.join(ROOT, 'F1-卡通图')
const OUT_DIR = path.join(ROOT, 'f1ti_cards')
const TMP_DIR = path.join(ROOT, '.cards-tmp')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CARD_W = 1200
const CARD_H = 700

// ---------------------------------------------------------------------------
// 20 F1TI archetypes — typeCode + display data + cartoon filename + 4 reasons.
// ---------------------------------------------------------------------------

const ARCHETYPES = [
  {
    code: 'ALON',  cn: '头哥',     name: 'Fernando Alonso',          png: 'FernandoAlonso.png',
    tagline: '44 岁,还在呢。', match: 92,
    tags: ['老将', '抗压', '全能', '韧性'],
    reasons: [
      '所有人都告诉你"该退了",你说我再开一年,然后又是一年。',
      '油门松还是踩,你知道,那双手已经学会了答案。',
      '别人靠天赋,你靠"还没完"——三天没睡也能榨出最后一秒。',
      '44 岁,还在呢。这不是不服老,是温和拒绝任何"应该到此为止"。',
    ],
  },
  {
    code: 'ANTO',  cn: '小孩',     name: 'Andrea Kimi Antonelli',    png: 'KimiAntonelli.png',
    tagline: '不好意思,我还不能喝香槟。', match: 88,
    tags: ['天赋', '爆发', '直觉', '真情'],
    reasons: [
      '所有人都在说"这件事很难",你脸上写的是困惑——你真没听懂"难"是什么意思。',
      '前辈花十五年悟到的东西,你第一天用野路子就做到了,完事发现奖杯上的香槟自己还不够年龄喝。',
      '你赢了当场哭,输了也当场哭,被夸两句脸就红——不是假谦虚,是真红。',
      '在一个全员戴面具的世界里,你是最后一个还没学会假装的人。',
    ],
  },
  {
    code: 'BOTT',  cn: '工具人',   name: 'Valtteri Bottas',          png: 'ValtteriBottas.png',
    tagline: 'Valtteri, 轮到你了。', match: 76,
    tags: ['稳定', '完赛', '副驾', '低戏'],
    reasons: [
      '你不抢戏,但每次车队需要一个稳的人,坐你车上的人都心安。',
      '名字一被叫出来你就让位,熟练得像个职业动作。',
      '你不是没速度,是把速度让出去的那种节奏感更难得。',
      'Valtteri, 轮到你了——这句话你已经听得不带情绪了。',
    ],
  },
  {
    code: 'GASL',  cn: '加大师',   name: 'Pierre Gasly',             png: 'PierreGasly.png',
    tagline: '小庙怎么了, 我照样成佛。', match: 90,
    tags: ['逆袭', '后程', '韧性', '翻身'],
    reasons: [
      '你被推下王座没崩溃,你在被推下去的那个坑里盖了座庙。',
      '聚光灯下憋屈,聚光灯外反而跑得最快。',
      '所有人想看你怎么爬回去,你说我在这就挺好,然后又赢一站。',
      '小庙怎么了,我照样成佛。加大师,越加越大。',
    ],
  },
  {
    code: 'HMLT',  cn: '老汉',     name: 'Lewis Hamilton',           png: 'LouisHamilton.png',
    tagline: '轮胎没了, 但我还在。', match: 95,
    tags: ['七冠', '全能', '抗压', '经验'],
    reasons: [
      '所有人劝你坐下歇歇,你说"我再推一圈",然后又推了一圈,比年轻人还快。',
      '比赛说到极限,你换个姿势继续推。下一圈永远是你最快的那一圈。',
      '你的核心驱动力是三个字 ——"还没完",温和拒绝任何"应该到此为止"的判断。',
      '老汉推车,推到终点。轮胎永远"已经没了",但车永远在前进。',
    ],
  },
  {
    code: 'KIMI',  cn: '冰人',     name: 'Kimi Räikkönen',           png: 'KimiRaikkonen.png',
    tagline: '少管我。', match: 85,
    tags: ['天赋', '极简', '自主', '不装'],
    reasons: [
      '你不预热、不解释、不社交,直接打开车门,把成绩交出来。',
      '别人在新闻发布会练表情,你在新闻发布会练沉默。',
      '问你紧张不紧张,你的回答永远是"我喝个冰淇淋去"。',
      '少管我——这不是冷漠,是把所有能量都留给方向盘。',
    ],
  },
  {
    code: 'LNDO',  cn: '急性子',   name: 'Lando Norris',             png: 'LandoNorris.png',
    tagline: '急什么急, 我已经是冠军了。', match: 89,
    tags: ['急攻', '直爽', '高光', '情绪'],
    reasons: [
      '你不喜欢等,刹车点说晚就晚,情绪也说有就有。',
      '前一秒还在跟车迷开玩笑,后一秒就在弯角内线把人挤出去了。',
      '你脸上写的所有的话,刹车点都接得住。',
      '急什么急,我已经是冠军了。',
    ],
  },
  {
    code: 'LOCK',  cn: '老四',     name: 'Charles Leclerc',          png: 'CharlesLeclerc.png',
    tagline: '差一点, 永远差那么一点。', match: 80,
    tags: ['进取', '韧性', '差一线', '中游'],
    reasons: [
      '你能跟住前面所有人,只差最后那 0.1 秒撕开排名。',
      '速度不缺,机会不属于你的那一站永远多一站。',
      '别人靠运气追上来,你靠死磕磨过去。',
      '差一点,永远差那么一点 —— 但永远还在。',
    ],
  },
  {
    code: 'MASI',  cn: '马戏',     name: 'Michael Masi',             png: 'MichaelMasi.png',
    tagline: '这就是赛车。', match: 53,
    tags: ['混乱', '不可预测', '边界', '判官'],
    reasons: [
      '第一次犯规罚五秒,理由是"不安全"。',
      '第二次同样的事不罚了,理由是"这就是赛车"。',
      '第三次又罚了,理由是"我们查过了"。查了什么?不知道。',
      '本组织保留最终解释权 —— 这五个字能堵住所有质疑。',
    ],
  },
  {
    code: 'MILK',  cn: '毒奶',     name: 'The Cursed Pundit',        png: 'MILK.png',
    tagline: '我觉得他能赢, 完了。', match: 100,
    tags: ['玄学', '反向', '低调', '稳但慢'],
    reasons: [
      '你越喜欢谁,谁越容易翻车;自己稳得反而踩不出节奏。',
      '直播里你说"这哥们今天看起来状态特别好",粉丝集体开始念经。',
      '你押的注从来不会赢,但你押的反义永远成立。',
      '我觉得他能赢,完了。',
    ],
  },
  {
    code: 'PIAS',  cn: '淡人',     name: 'Oscar Piastri',            png: 'OscarPiastri.png',
    tagline: '哦, 行。', match: 87,
    tags: ['冷静', '自主', '一致', '节奏'],
    reasons: [
      '你不靠情绪靠节奏,几圈下来对手发现自己已经被慢慢榨干。',
      '采访里被问感受,你的回答永远是三个字 ——"哦,行。"',
      '夺冠庆功也不哭,失利退赛也不哭,你的脸是车队最稳定的资产。',
      '哦,行 —— 这不是敷衍,是已经把答案藏好了。',
    ],
  },
  {
    code: 'RICO',  cn: '大牙',     name: 'Daniel Ricciardo',         png: 'DanielRicciardo.png',
    tagline: '人生苦短, 先笑为敬。', match: 78,
    tags: ['强攻', '晚刹', '笑容', '冒险'],
    reasons: [
      '你笑着开车,刹车永远晚两米,送出最离谱的内线超车。',
      '上车之前一定先吃个冰淇淋,采访之前一定先讲个冷笑话。',
      '别人开赛车开成业务,你开赛车开成段子。',
      '人生苦短,先笑为敬。',
    ],
  },
  {
    code: 'RUSS',  cn: '优等生',   name: 'George Russell',           png: 'GeorgeRussell.png',
    tagline: '请看 PPT 第 7 页。', match: 86,
    tags: ['准备', '走线', '进取', '优等'],
    reasons: [
      '你把比赛当考试,每个弯都是 PPT 第几页。',
      '别人靠手感开,你靠图表 + 数据 + 回放三件套。',
      '会议室里你的提问总比工程师多两个细节。',
      '请看 PPT 第 7 页 —— 而你已经翻到第 8 页了。',
    ],
  },
  {
    code: 'STEI',  cn: '教官',     name: 'Guenther Steiner',         png: 'GuentherSteiner.png',
    tagline: '今天的英语课开始了。', match: 82,
    tags: ['嗓门', '执行', '抗压', '教头'],
    reasons: [
      '你的嗓门是车队第二动力,带着队伍冲刺撞墙都能撞得整齐。',
      '说脏话的时候像在朗诵史诗,翻译都跟不上。',
      '问题永远是你的, 解决方案永远要别人交。',
      '今天的英语课开始了。',
    ],
  },
  {
    code: 'STRL',  cn: '少爷',     name: 'Lance Stroll',             png: 'LanceStroll.png',
    tagline: '我爸说今天会下雨。', match: 70,
    tags: ['安全', '守规', '低风险', '完赛'],
    reasons: [
      '你不出错就是赢, 不冒险就是稳, 不靠拼也能完赛。',
      '雨战你最稳, 因为你爸早上发短信说"今天会下雨"。',
      '别人靠成绩留座位, 你靠"出生"留座位 —— 也是一种实力。',
      '我爸说今天会下雨。',
    ],
  },
  {
    code: 'TIFS',  cn: '受苦人',   name: 'Tifosi',                   png: 'Tifosi.png',
    tagline: '明年, 明年一定行。', match: 75,
    tags: ['韧性', '痴情', '等待', '抗挫'],
    reasons: [
      '你像一个永远等明年的人, 被现实磨出了别人没有的韧性。',
      '红色一上场你就喊到嗓子破, 红色一退场你就开始怀疑人生。',
      '别人换队你换不了, 退役你也跟不了 —— 红色就是你的姓氏。',
      '明年, 明年一定行。',
    ],
  },
  {
    code: 'TOTO',  cn: '马桶',     name: 'Toto Wolff',               png: 'TotoWolff.png',
    tagline: '耳机是消耗品。', match: 91,
    tags: ['准备', '自主', '进取', '表达'],
    reasons: [
      '你的指令像耳机一样脆, 但每个判断都对, 强势又准确。',
      '车队任何成绩, 笑容只给三秒, 然后就开始想下一站怎么再赢一次。',
      '失败那天你能砸三副耳机, 第二天 7 点准时进会议室。',
      '耳机是消耗品 —— 但赢不是。',
    ],
  },
  {
    code: 'VETL',  cn: '歪头',     name: 'Sebastian Vettel',         png: 'SebastianVettel.png',
    tagline: '转了, 但没关系。', match: 79,
    tags: ['经验', '节制', '守规', '老冠军'],
    reasons: [
      '你不再求最快, 但你能用一句话把后辈讲明白。',
      '车头转一下不要紧, 重要的是你头偏一下也不要紧。',
      '退役那天你穿了件 T 恤上写"等等啊地球", 大家忽然都安静了。',
      '转了, 但没关系。',
    ],
  },
  {
    code: 'VSTP',  cn: '汽车人',   name: 'Max Verstappen',           png: 'MaxVerstappen.png',
    tagline: '你们太慢了。', match: 96,
    tags: ['顶速', '攻击', '自主', '抗压'],
    reasons: [
      '你只认一个道理:快就是对的, 慢就是错的, 废话比慢还错。',
      '别人搞人际关系的时候你在精进业务, 别人下班的时候你换台设备继续精进业务。',
      '通讯录短得像俳句, 衣柜里永远同款同色, 但论干活, 在场所有人加一起是你的背景板。',
      '你不藏想法 —— 说完顺手把活干了, 然后消失。',
    ],
  },
  {
    code: 'ZHOU',  cn: '先行者',   name: 'Zhou Guanyu',              png: 'ZhouGuanyu.png',
    tagline: '总要有人先走这一步。', match: 73,
    tags: ['先行', '稳中', '低调', '起步'],
    reasons: [
      '你不一定第一, 但你给后面来的人留好了车道。',
      '没人替你扛旗子, 你自己扛, 还顺便给下一位多举三秒。',
      '你的速度也许不会写进历史, 但你的"出现"已经写进了。',
      '总要有人先走这一步 —— 你只是没问别人愿不愿。',
    ],
  },
]

// Dummy telemetry — varied so each card looks "lived-in".
const dummyTelemetry = (i) => ({
  bestLapMs: 78000 + (i * 1373) % 18000, // 1:18 .. 1:36
  topSpeedKmh: 248 + ((i * 7) % 60),     // 248-308
  wallHits: i % 3,                       // 0/1/2
  carHits: (i + 1) % 4,                  // 0..3
  finalPosition: ((i * 3) % 4) + 1,      // 1..4
  fieldSize: 4,
})

const formatLap = (ms) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor(ms % 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// HTML template — renders one card.
// ---------------------------------------------------------------------------

function buildHtml(arc, telemetry, photoDataUrl) {
  const lap = formatLap(telemetry.bestLapMs)
  const speed = `${Math.round(telemetry.topSpeedKmh)} km/h`
  const reasonsHtml = arc.reasons
    .map((r) => `<div class="bullet">· ${r}</div>`)
    .join('')
  const tagsHtml = arc.tags.map((t) => `# ${t}`).join('   ')
  return `<!doctype html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${CARD_W}px; height: ${CARD_H}px;
    background: #0a0e1a; overflow: hidden;
    font-family: "PingFang SC", "Hiragino Sans GB", "Heiti SC",
                 -apple-system, "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    position: absolute; inset: 24px;
    background: #fff;
    border: 5px solid #b71c1c;
    border-radius: 6px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.5);
    overflow: hidden;
  }
  .innerRing {
    position: absolute; inset: 9px;
    border: 1.5px solid #b71c1c;
    border-radius: 3px;
    pointer-events: none;
  }
  .col {
    position: absolute; inset: 22px;
    display: flex; flex-direction: row;
    gap: 22px; align-items: stretch;
  }
  .photoBox {
    flex: 0 0 38%;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .photoBox img {
    max-width: 100%; max-height: 100%;
    object-fit: contain;
  }
  .panel {
    flex: 1 1 0; min-width: 0;
    display: flex; flex-direction: column; gap: 10px;
  }
  .header {
    display: flex; align-items: center; gap: 12px;
  }
  .header .line {
    flex: 1 1 0; height: 0; border-top: 1.8px solid #b71c1c;
    position: relative;
  }
  .header .line::before {
    content: ''; position: absolute; top: -4px; width: 7px; height: 7px;
    background: #b71c1c; transform: rotate(45deg);
  }
  .header .line.l::before { right: 0; }
  .header .line.r::before { left: 0; }
  .header .text {
    color: #b71c1c; font-weight: 700;
    font-size: 18px; letter-spacing: 7px; padding: 0 6px;
    white-space: nowrap;
  }
  .nameBox {
    position: relative;
    display: flex; align-items: center; justify-content: center;
    padding: 22px 36px;
    margin: 8px 8px 0;
  }
  .bracket {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 22px; height: 100%;
    border: 4px solid #b71c1c;
  }
  .bracket.l { left: 0; border-right: none; }
  .bracket.r { right: 0; border-left: none; }
  .driverName {
    color: #b71c1c; font-weight: 900;
    font-size: 52px; letter-spacing: 4px;
    white-space: nowrap; line-height: 1.05;
    text-align: center;
  }
  .typeLine {
    text-align: center;
    color: #3a1a1a; font-weight: 700;
    font-size: 24px; letter-spacing: 6px;
    margin-top: 4px;
  }
  .stats {
    display: flex; justify-content: center; align-items: stretch;
    gap: 24px; margin: 6px 8px;
    padding: 8px 0;
    border-top: 1px solid rgba(183,28,28,0.18);
    border-bottom: 1px solid rgba(183,28,28,0.18);
  }
  .stat { flex: 1 1 0; text-align: center; }
  .stat .v {
    color: #b71c1c; font-weight: 800;
    font-size: 22px; letter-spacing: 1px; line-height: 1;
  }
  .stat .l {
    color: #7a4040; font-size: 12px;
    letter-spacing: 3px; margin-top: 4px;
  }
  .reasons {
    display: flex; flex-direction: column; gap: 4px;
    padding: 4px 6px 6px;
    color: #3a1a1a; font-size: 15px; line-height: 1.6;
  }
  .bullet {
    padding: 3px 4px 5px;
    border-bottom: 1px dashed rgba(183,28,28,0.18);
  }
  .tags {
    text-align: center;
    color: #b71c1c; font-size: 14px;
    letter-spacing: 3px; margin-top: 6px;
  }
</style></head>
<body>
  <div class="card">
    <div class="innerRing"></div>
    <div class="col">
      <div class="photoBox"><img src="${photoDataUrl}" alt=""></div>
      <div class="panel">
        <div class="header">
          <div class="line l"></div>
          <div class="text">你 的 赛 车 人 格</div>
          <div class="line r"></div>
        </div>
        <div class="nameBox">
          <span class="bracket l"></span>
          <div class="driverName">${arc.name.toUpperCase()}</div>
          <span class="bracket r"></span>
        </div>
        <div class="typeLine">${arc.cn}</div>
        <div class="stats">
          <div class="stat"><div class="v">${lap}</div><div class="l">单圈用时</div></div>
          <div class="stat"><div class="v">${speed}</div><div class="l">最高时速</div></div>
          <div class="stat"><div class="v">${arc.match}%</div><div class="l">匹配度</div></div>
        </div>
        <div class="header">
          <div class="line l"></div>
          <div class="text">为 何 你 是 这 个 类 型</div>
          <div class="line r"></div>
        </div>
        <div class="reasons">${reasonsHtml}</div>
        <div class="tags">${tagsHtml}</div>
      </div>
    </div>
  </div>
  <script>
    // Auto-shrink driver name to fit the bracket box.
    const dn = document.querySelector('.driverName')
    const nb = document.querySelector('.nameBox')
    requestAnimationFrame(() => {
      const limit = nb.clientWidth - 80
      let size = 52
      while (dn.scrollWidth > limit && size > 18) {
        size -= 1
        dn.style.fontSize = size + 'px'
      }
      if (dn.scrollWidth > limit) {
        dn.style.whiteSpace = 'normal'
        dn.style.letterSpacing = '1px'
      }
    })
  </script>
</body></html>`
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(TMP_DIR, { recursive: true })

let okCount = 0
let failCount = 0
ARCHETYPES.forEach((arc, i) => {
  const photoPath = path.join(CARTOON_DIR, arc.png)
  if (!fs.existsSync(photoPath)) {
    console.warn(`✗ ${arc.code}: portrait not found at ${photoPath}`)
    failCount++
    return
  }
  const photoB64 = fs.readFileSync(photoPath).toString('base64')
  const photoUrl = `data:image/png;base64,${photoB64}`
  const html = buildHtml(arc, dummyTelemetry(i), photoUrl)
  const tmpHtml = path.join(TMP_DIR, `${arc.code}.html`)
  fs.writeFileSync(tmpHtml, html)
  const outPng = path.join(OUT_DIR, `${arc.code}-${arc.cn}.png`)
  try {
    execSync(
      `"${CHROME}" --headless --disable-gpu --hide-scrollbars ` +
      `--screenshot="${outPng}" ` +
      `--window-size=${CARD_W},${CARD_H} ` +
      `--virtual-time-budget=2000 ` +
      `"file://${tmpHtml}"`,
      { stdio: 'pipe' },
    )
    console.log(`✓ ${arc.code} (${arc.cn})  →  ${path.relative(ROOT, outPng)}`)
    okCount++
  } catch (e) {
    console.error(`✗ ${arc.code}: ${e.message}`)
    failCount++
  }
})

console.log(`\nDone: ${okCount}/${ARCHETYPES.length} cards rendered into ${path.relative(ROOT, OUT_DIR)}/`)
if (failCount === 0) {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
} else {
  console.log(`(temp HTML kept in ${path.relative(ROOT, TMP_DIR)}/ for debugging)`)
}

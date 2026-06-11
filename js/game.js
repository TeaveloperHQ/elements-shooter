/*
 * game.js — 원소 슈터: 펭귄 남극 대원정 (Elements Shooter: Penguin Antarctic March)
 *
 * 펭귄 분대를 이끌고 빙판 길을 따라 다가오는 얼음 몬스터 호드를 막는다.
 * 화면은 원근(depth) 좌표계: 적은 지평선(소실점)에서 작게 나타나 커지며 접근,
 * 펭귄은 전방(화면 안쪽)으로 눈덩이를 쏜다.
 *
 * 좌우 한 쌍의 "원소 게이트"가 계속 내려오고, 쏠수록 숫자가 커진다.
 * 안전한 원소 게이트로 통과하면 펭귄/무기가 강해지고, 충분히 채우면 보너스 아이템.
 * 방사능·독성 원소 게이트는 통과할수록 불리해진다.
 */
(function () {
  "use strict";

  // ===================== 기본 설정 =====================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, dpr = 1;

  function resize() {
    const wrap = document.getElementById("game-wrap");
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildSnow();
    buildBergs();
  }
  window.addEventListener("resize", resize);

  // ===================== 사운드(WebAudio 간이 신스) =====================
  let actx = null;
  function initAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { actx = null; }
  }
  // 한 음 재생(주파수, 길이, 파형, 음량, 끝주파수=슬라이드)
  function beep(freq, dur, type, vol, freqEnd) {
    if (!actx) return;
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(vol || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur);
  }
  const SND = {
    kill: function () { beep(440, 0.07, "square", 0.035, 660); },
    explode: function () { beep(150, 0.28, "sawtooth", 0.08, 50); },
    breach: function () { beep(110, 0.22, "sawtooth", 0.09, 45); },
    boss: function () { beep(70, 0.5, "sawtooth", 0.10, 110); },
    item: function () { beep(680, 0.10, "triangle", 0.06, 1020); },
    combo: function (n) { beep(520 + n * 40, 0.06, "square", 0.04, 760 + n * 40); },
  };

  // ===================== 원근(perspective) 좌표 =====================
  // p(깊이): 0 = 지평선(멀다, 작다), 1 = 플레이어 라인(가깝다, 크다)
  function horizonY() { return H * 0.30; }
  function playerLineY() { return H - 84; }
  function roadHalfTop() { return W * 0.05; }   // 소실점 근처 길 반폭
  function roadHalfBot() { return W * 0.46; }   // 플레이어 앞 길 반폭

  function projY(p) { return horizonY() + (playerLineY() - horizonY()) * p; }
  function projScale(p) { return 0.28 + 1.0 * p; }            // 멀면 작게
  function halfAt(p) { return roadHalfTop() + (roadHalfBot() - roadHalfTop()) * p; }
  function laneToX(p, lane) { return W / 2 + lane * halfAt(p); }
  function xToLane(x) { return (x - W / 2) / roadHalfBot(); }  // 바닥(p=1) 기준

  // 게이트 벽 높이(원근에 따라 가까울수록 높아짐)
  function gateWallH(p) { return 78 * projScale(p); }

  // 게이트 한 칸(좌/우): 바닥에서 위로 서 있는 벽(빌보드)
  function panelGeom(pr, side) {
    const p = pr.p;
    const vx = W / 2;
    const half = halfAt(p);
    const baseY = projY(p);              // 바닥에 닿는 선
    const topY = baseY - gateWallH(p);   // 위로 솟은 높이
    let x0, x1;
    if (side < 0) { x0 = vx - half; x1 = vx; }
    else { x0 = vx; x1 = vx + half; }
    return { x0: x0, x1: x1, baseY: baseY, topY: topY,
             cx: (x0 + x1) / 2, cy: (baseY + topY) / 2,
             scale: projScale(p), half: half };
  }

  // ===================== 게임 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, bullets, enemies, gates, particles, flashes, items, texts, eBullets;
  let score, learned;
  let spawnTimer, gateTimer, fireTimer, elapsed;
  let scrollY = 0;
  let shake = 0;
  let lineFlash = 0;     // 방어선 돌파 시 빨강 번쩍
  let screenFlash = 0;   // 피격 시 화면 빨강 플래시
  let boss = null;       // 현재 보스(없으면 null)
  let bossNextAt = 0;    // 다음 보스 등장 시각(초)
  let combo = 0, comboTimer = 0;   // 연속 처치 콤보
  let hitStop = 0;       // 큰 이벤트 시 짧은 정지(손맛)
  let runCoins = 0;      // 이번 판에 모은 코인

  // ===================== 메타(영구 저장) =====================
  const UPGRADE_MAX = 8;
  const UP_BASE = { squad: 80, weapon: 60, shield: 70 };
  const META = {
    coins: 0, high: 0, dex: {}, up: { squad: 0, weapon: 0, shield: 0 },
    load: function () {
      try {
        this.coins = +(localStorage.getItem("es_coins") || 0) || 0;
        this.high = +(localStorage.getItem("es_high") || 0) || 0;
        this.dex = JSON.parse(localStorage.getItem("es_dex") || "{}") || {};
        this.up.squad = +(localStorage.getItem("es_up_squad") || 0) || 0;
        this.up.weapon = +(localStorage.getItem("es_up_weapon") || 0) || 0;
        this.up.shield = +(localStorage.getItem("es_up_shield") || 0) || 0;
      } catch (e) {}
    },
    save: function () {
      try {
        localStorage.setItem("es_coins", this.coins);
        localStorage.setItem("es_high", this.high);
        localStorage.setItem("es_dex", JSON.stringify(this.dex));
        localStorage.setItem("es_up_squad", this.up.squad);
        localStorage.setItem("es_up_weapon", this.up.weapon);
        localStorage.setItem("es_up_shield", this.up.shield);
      } catch (e) {}
    },
  };
  function upgradeCost(kind) { return UP_BASE[kind] * (META.up[kind] + 1); }

  let snow = [];
  let bergs = [];

  function newGame() {
    player = {
      x: W / 2, targetX: W / 2, y: 0,
      squad: 3 + META.up.squad,
      weapon: 1 + META.up.weapon,
      shield: META.up.shield * 2,
      fireRate: 1,
      bob: 0,
    };
    runCoins = 0;
    bullets = [];
    enemies = [];
    gates = [];
    particles = [];
    flashes = [];
    items = [];
    texts = [];
    eBullets = [];
    boss = null;
    bossNextAt = 35;
    combo = 0;
    comboTimer = 0;
    hitStop = 0;
    score = 0;
    learned = {};
    spawnTimer = 0;
    gateTimer = 1.0;
    fireTimer = 0;
    elapsed = 0;
    shake = 0;
    lineFlash = 0;
    screenFlash = 0;
    updateHUD();
  }

  // ===================== 입력 =====================
  let keyLeft = false, keyRight = false;

  function pointerMove(clientX) {
    const rect = canvas.getBoundingClientRect();
    player.targetX = clientX - rect.left;
  }
  canvas.addEventListener("mousemove", function (e) {
    if (state === STATE.PLAY) pointerMove(e.clientX);
  });
  canvas.addEventListener("touchmove", function (e) {
    if (state === STATE.PLAY && e.touches[0]) { pointerMove(e.touches[0].clientX); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchstart", function (e) {
    if (state === STATE.PLAY && e.touches[0]) pointerMove(e.touches[0].clientX);
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") keyLeft = true;
    if (e.key === "ArrowRight") keyRight = true;
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft") keyLeft = false;
    if (e.key === "ArrowRight") keyRight = false;
  });

  // ===================== 화면 전환 =====================
  const startScreen = document.getElementById("start-screen");
  const overScreen = document.getElementById("over-screen");

  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("retry-btn").addEventListener("click", function () {
    overScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");   // 다시 도전 → 상점 화면으로
  });

  // ---------- 상점/메타 UI ----------
  function refreshMetaUI() {
    const dexTotal = (typeof ELEMENTS !== "undefined") ? ELEMENTS.length : 15;
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("coin-total", META.coins);
    set("high-score", META.high);
    set("dex-count", Object.keys(META.dex).length);
    set("dex-max", dexTotal);

    const labels = { squad: "🐧 시작 펭귄", weapon: "🔫 시작 무기", shield: "🛡 시작 보호막" };
    ["squad", "weapon", "shield"].forEach(function (kind) {
      const btn = document.getElementById("up-" + kind);
      if (!btn) return;
      const lvl = META.up[kind], maxed = lvl >= UPGRADE_MAX, cost = upgradeCost(kind);
      const info = btn.querySelector(".up-info");
      btn.classList.toggle("maxed", maxed);
      btn.classList.toggle("cant", !maxed && META.coins < cost);
      if (info) info.textContent = maxed ? "Lv." + lvl + " MAX" : "Lv." + lvl + " · 🪙" + cost;
    });
  }

  function buyUpgrade(kind) {
    const lvl = META.up[kind];
    if (lvl >= UPGRADE_MAX) return;
    const cost = upgradeCost(kind);
    if (META.coins < cost) { SND.breach(); return; }
    META.coins -= cost; META.up[kind]++; META.save();
    SND.item();
    refreshMetaUI();
  }
  ["squad", "weapon", "shield"].forEach(function (kind) {
    const btn = document.getElementById("up-" + kind);
    if (btn) btn.addEventListener("click", function () { initAudio(); buyUpgrade(kind); });
  });

  function startGame() {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    newGame();
    state = STATE.PLAY;
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
  }
  function gameOver() {
    state = STATE.OVER;
    const finalScore = Math.floor(score);
    document.getElementById("final-score").textContent = finalScore;

    // 코인 적립 + 도감 갱신 + 최고점수
    META.coins += runCoins;
    for (const sym in learned) META.dex[sym] = true;
    const isRecord = finalScore > META.high;
    if (isRecord) META.high = finalScore;
    META.save();

    document.getElementById("run-coins").innerHTML =
      "🪙 이번 판 코인 <b>+" + runCoins + "</b>" + (isRecord ? "　🏆 <b>신기록!</b>" : "");

    const names = Object.keys(learned);
    document.getElementById("elements-learned").innerHTML =
      names.length ? "오늘 만난 원소: <b>" + names.join(", ") + "</b>"
                   : "이번엔 원소를 만나지 못했어요!";

    refreshMetaUI();
    overScreen.classList.remove("hidden");
  }

  // ===================== HUD / 토스트 =====================
  function updateHUD() {
    document.getElementById("hud-squad").textContent = player.squad;
    document.getElementById("hud-weapon").textContent = player.weapon;
    document.getElementById("hud-shield").textContent = player.shield;
    document.getElementById("hud-coins").textContent = runCoins;
    document.getElementById("hud-score").textContent = Math.floor(score);
  }

  let toastTimer = null;
  function showToast(text, trap) {
    const t = document.getElementById("toast");
    t.textContent = text;
    t.classList.toggle("trap", !!trap);
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  // ===================== 게이트 =====================
  // 좌우 한 쌍(한쪽은 안전 원소, 한쪽은 위험 원소)이 지평선에서 길을 막는 벽처럼
  // 원근으로 다가온다. 쏘면 숫자가 커지고, 안전 게이트를 목표치까지 채우면 폭발 + 아이템.
  function spawnGatePair() {
    const buff = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
    const trap = TRAP_ELEMENTS[(Math.random() * TRAP_ELEMENTS.length) | 0];
    const leftIsBuff = Math.random() < 0.5;
    gates.push({
      p: 0.0,
      vp: 0.085 + Math.random() * 0.02,
      applied: false,
      panels: [
        makePanel(-1, leftIsBuff ? buff : trap),
        makePanel(+1, leftIsBuff ? trap : buff),
      ],
    });
  }
  function makePanel(side, el) {
    const buff = el.kind === "buff";
    const base = 2 + ((Math.random() * 5) | 0);   // 시작 숫자 ±(2~6)
    return {
      side: side, el: el,
      count: buff ? base : -base,
      goal: 10,            // 안전 게이트를 이만큼 채우면 폭발 + 아이템
      bursted: false,
    };
  }
  function burstPanel(pr, panel) {
    panel.bursted = true;
    const g = panelGeom(pr, panel.side);
    spawnParticles(g.cx, g.cy, panel.el.color, 24, 240);
    spawnParticles(g.cx, g.cy, "#ffffff", 14, 280);
    spawnItem(g.cx, g.cy);
    runCoins += 5;
    shake = Math.min(16, shake + 11);
    hitStop = 0.06; SND.explode();
    learned[panel.el.symbol] = true;
    showToast("💥 " + panel.el.symbol + " " + panel.el.name + " 폭발! 아이템 획득!", false);
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;
    scrollY = (scrollY + dt * 90) % 80;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);
    if (lineFlash > 0) lineFlash = Math.max(0, lineFlash - dt);
    if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - dt);
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }

    const speed = 560;
    if (keyLeft) player.targetX -= speed * dt;
    if (keyRight) player.targetX += speed * dt;
    player.targetX = Math.max(30, Math.min(W - 30, player.targetX));
    player.x += (player.targetX - player.x) * Math.min(1, dt * 14);
    player.y = playerLineY();
    player.bob += dt * 9;

    const fireInterval = Math.max(0.08, 0.42 - player.fireRate * 0.03);
    fireTimer -= dt;
    if (fireTimer <= 0) { fireTimer = fireInterval; fireVolley(); }

    // 보스가 없을 때만 잡몹 스폰(보스 중엔 조금만)
    const spawnInterval = Math.max(0.45, 1.5 - elapsed * 0.013) * (boss ? 2.2 : 1);
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = spawnInterval; spawnEnemy(); }

    // 보스 웨이브
    if (!boss && elapsed >= bossNextAt) spawnBoss();

    gateTimer -= dt;
    if (gateTimer <= 0) { gateTimer = 5.5; spawnGatePair(); }

    updateBullets(dt);
    updateEnemies(dt);
    updateEBullets(dt);
    if (boss) updateBoss(dt);
    updateGates(dt);
    updateItems(dt);
    updateParticles(dt);
    updateTexts(dt);
    updateSnow(dt);
    updateFlashes(dt);

    score += dt * 6;
    updateHUD();
  }

  // ---------- 사격: 전방(소실점)으로 ----------
  function fireVolley() {
    const n = Math.min(player.squad, 7);
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const sx = player.x - spread / 2 + spread * t;
      const lane = xToLane(sx);
      bullets.push({ lane: lane, p: 0.96, vp: 1.7, dmg: player.weapon, spin: Math.random() * 6 });
      const muzzleY = playerLineY() - 34 * projScale(0.96);
      flashes.push({ x: sx, y: muzzleY, life: 0.08 });
    }
  }

  // ---------- 적: 지평선에서 등장 → 접근 ----------
  // 종류: normal(기본) / fast(빠름) / tank(탱키) / splitter(분열) / shell(얼음껍질) / ranged(원거리)
  function spawnEnemy() {
    const baseHp = 2 + Math.floor(elapsed / 14);
    const t = Math.min(1, elapsed / 60);   // 시간이 지날수록 특수 적 비중 ↑
    const r = Math.random();
    let kind = "normal";
    if (r < 0.16 + t * 0.10) kind = "fast";
    else if (r < 0.30 + t * 0.12) kind = "tank";
    else if (r < 0.42 + t * 0.10) kind = "splitter";
    else if (r < 0.52 + t * 0.10) kind = "shell";
    else if (r < 0.60 + t * 0.08) kind = "ranged";
    enemies.push(makeEnemy(kind, baseHp, -0.9 + Math.random() * 1.8, 0));
  }

  function makeEnemy(kind, baseHp, lane, p) {
    const e = { kind: kind, lane: lane, p: p, hit: 0,
                sway: Math.random() * 6.28, swaySpd: 1.5 + Math.random() * 1.5 };
    const acc = elapsed * 0.0014;
    switch (kind) {
      case "fast":  e.r = 12; e.hp = Math.max(1, baseHp - 1); e.vp = 0.22 + Math.random() * 0.05 + acc; break;
      case "tank":  e.r = 25; e.hp = baseHp * 3;              e.vp = 0.065 + Math.random() * 0.02 + acc * 0.6; break;
      case "splitter": e.r = 18; e.hp = Math.ceil(baseHp * 1.4); e.vp = 0.10 + Math.random() * 0.03 + acc; break;
      case "shell": e.r = 17; e.hp = baseHp; e.shell = baseHp + 3; e.vp = 0.085 + Math.random() * 0.03 + acc; break;
      case "ranged": e.r = 15; e.hp = baseHp; e.vp = 0.06 + Math.random() * 0.02 + acc * 0.6; e.shootTimer = 1.4 + Math.random(); break;
      case "shard": e.r = 9;  e.hp = 1; e.vp = 0.20 + Math.random() * 0.06 + acc; break;
      default:      e.r = 15; e.hp = baseHp; e.vp = 0.10 + Math.random() * 0.05 + acc;
    }
    e.maxHp = e.hp; e.shellMax = e.shell || 0; e.big = (kind === "tank");
    return e;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.p -= b.vp * dt;        // 멀어진다(소실점으로)
      b.spin += dt * 12;
      if (b.p <= 0.02) { bullets.splice(i, 1); continue; }

      const bx = laneToX(b.p, b.lane);
      const by = projY(b.p);
      let hit = false;

      // 게이트(원근 벽) 충돌 → 숫자 키우기 / 폭발
      for (const pr of gates) {
        if (pr.applied) continue;
        const gBot = projY(pr.p), gTop = gBot - gateWallH(pr.p);
        if (by <= gBot && by >= gTop) {
          const half = halfAt(pr.p), vx = W / 2;
          let side = 0;
          if (bx >= vx - half && bx < vx) side = -1;
          else if (bx > vx && bx <= vx + half) side = 1;
          if (side !== 0) {
            const panel = pr.panels[0].side === side ? pr.panels[0] : pr.panels[1];
            if (!panel.bursted) {
              if (panel.el.kind === "buff") {
                panel.count = Math.min(40, panel.count + 1);
                if (panel.count >= panel.goal) burstPanel(pr, panel);
              } else {
                panel.count = Math.max(-40, panel.count - 1);
              }
              spawnParticles(bx, by, panel.el.color, 4, 90);
              hit = true;
            }
          }
        }
        if (hit) break;
      }
      if (hit) { bullets.splice(i, 1); continue; }

      // 보스 충돌
      if (boss) {
        const bs = projScale(boss.p);
        const bxx = laneToX(boss.p, boss.lane), byy = projY(boss.p) - boss.r * bs * 0.6;
        const rad = boss.r * bs + 6 * projScale(b.p);
        const dx = bx - bxx, dy = by - byy;
        if (dx * dx + dy * dy <= rad * rad) {
          boss.hp -= b.dmg; boss.hit = 0.1;
          spawnParticles(bx, by, "#ffd0d0", 4, 130);
          if (boss.hp <= 0) killBoss();
          bullets.splice(i, 1);
          continue;
        }
      }

      // 적 충돌(원근 화면좌표 기준)
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const es = projScale(e.p);
        const ex = laneToX(e.p, e.lane), ey = projY(e.p);
        const rad = e.r * es + 6 * projScale(b.p);
        const dx = bx - ex, dy = by - ey;
        if (dx * dx + dy * dy <= rad * rad) {
          if (e.shell > 0) {
            // 얼음 껍질 먼저 깨야 함
            e.shell -= b.dmg; e.hit = 0.12;
            spawnParticles(bx, by, "#cfeaff", 5, 140);
            if (e.shell <= 0) {
              spawnParticles(ex, ey, "#ffffff", 10, 200);
              spawnText(ex, ey - e.r * es, "껍질 깨짐!", "#cfeaff", 12);
            }
          } else {
            e.hp -= b.dmg; e.hit = 0.12;
            spawnParticles(bx, by, "#dff3ff", 4, 120);
            if (e.hp <= 0) killEnemy(j);
          }
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  function comboMult() { return 1 + Math.floor(combo / 5); }   // 5연속마다 +1배

  function killEnemy(j) {
    const e = enemies[j];
    const ex = laneToX(e.p, e.lane), ey = projY(e.p);
    spawnParticles(ex, ey, "#bfe6ff", e.big ? 18 : 10, 160);
    spawnParticles(ex, ey, "#ffffff", e.big ? 10 : 5, 200);
    // 콤보: 연속 처치할수록 배율 ↑
    combo++; comboTimer = 2.2;
    const mult = comboMult();
    const base = e.kind === "tank" ? 30 : (e.kind === "shard" ? 5 : 10);
    const pts = base * mult;
    score += pts;
    runCoins += e.kind === "tank" ? 4 : (e.kind === "shard" ? 1 : 1);
    spawnText(ex, ey - e.r * projScale(e.p), "+" + pts, mult > 1 ? "#ffe678" : "#eaffd0", e.big ? 16 : 13);
    SND.kill();
    if (combo > 1 && combo % 5 === 0) SND.combo(combo / 5);
    enemies.splice(j, 1);

    // 분열형: 죽으면 작은 파편 2마리로 쪼개짐
    if (e.kind === "splitter") {
      const baseHp = 1;
      enemies.push(makeEnemy("shard", baseHp, Math.max(-0.95, e.lane - 0.18), e.p));
      enemies.push(makeEnemy("shard", baseHp, Math.min(0.95, e.lane + 0.18), e.p));
    }
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      // 가까울수록 빠르게(원근 가속)
      e.p += e.vp * (0.45 + e.p * 1.1) * dt;
      e.sway += dt * e.swaySpd;
      if (e.hit > 0) e.hit -= dt;

      // 원거리형: 멀리서 눈덩이를 던진다
      if (e.kind === "ranged") {
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && e.p > 0.2 && e.p < 0.8) {
          e.shootTimer = 2.2;
          spawnEnemyShot(e.lane, e.p);
        }
      }

      if (e.p >= 1) {
        const bx = laneToX(1, e.lane);
        if (player.shield > 0) {
          player.shield--;
          spawnText(bx, playerLineY() - 22, "🛡 -1", "#7fd0ff", 18);
          spawnParticles(bx, playerLineY(), "#7fd0ff", 12, 200);
        } else {
          player.squad--;
          spawnText(bx, playerLineY() - 22, "-1 🐧", "#ff6b6b", 24);
          spawnParticles(bx, playerLineY(), "#ff8a8a", 16, 220);
          screenFlash = 0.35;
        }
        combo = 0; SND.breach();
        lineFlash = 0.5;
        shake = Math.min(18, shake + 11);
        enemies.splice(i, 1);
        if (player.squad <= 0) { player.squad = 0; updateHUD(); gameOver(); return; }
      }
    }
  }

  // ---------- 적 발사체(원거리/보스) ----------
  function spawnEnemyShot(lane, p) {
    eBullets.push({ lane: lane, p: p, vp: 0.42, r: 7 });
  }
  function updateEBullets(dt) {
    for (let i = eBullets.length - 1; i >= 0; i--) {
      const b = eBullets[i];
      b.p += b.vp * (0.5 + b.p * 0.9) * dt;
      if (b.p >= 1) {
        const bx = laneToX(1, b.lane);
        if (player.shield > 0) {
          player.shield--;
          spawnText(bx, playerLineY() - 22, "🛡 -1", "#7fd0ff", 18);
        } else {
          player.squad--;
          spawnText(bx, playerLineY() - 22, "-1 🐧", "#ff6b6b", 22);
          screenFlash = 0.3;
        }
        spawnParticles(bx, playerLineY(), "#9ab8d0", 12, 200);
        combo = 0; SND.breach();
        lineFlash = 0.45; shake = Math.min(16, shake + 9);
        eBullets.splice(i, 1);
        if (player.squad <= 0) { player.squad = 0; updateHUD(); gameOver(); return; }
      }
    }
  }

  // ---------- 보스 ----------
  function spawnBoss() {
    const hp = 60 + elapsed * 2.2;
    boss = {
      lane: 0, p: 0.0, vp: 0.028,
      hp: hp, maxHp: hp, r: 42, hit: 0,
      sway: 0, shootTimer: 2.2, bounce: 0,
    };
    showToast("❄ 북극곰 우두머리 등장! 집중 사격!", true);
    shake = Math.min(20, shake + 14);
    screenFlash = 0.25;
    SND.boss();
  }
  function updateBoss(dt) {
    boss.p += boss.vp * (0.6 + boss.p * 0.5) * dt;
    boss.sway += dt * 1.2;
    boss.lane = Math.sin(boss.sway) * 0.5;
    if (boss.hit > 0) boss.hit -= dt;

    boss.shootTimer -= dt;
    if (boss.shootTimer <= 0 && boss.p > 0.15) {
      boss.shootTimer = Math.max(0.7, 1.8 - elapsed * 0.004);
      // 부채꼴로 3발
      spawnEnemyShot(boss.lane - 0.3, boss.p);
      spawnEnemyShot(boss.lane, boss.p);
      spawnEnemyShot(boss.lane + 0.3, boss.p);
    }

    if (boss.p >= 1) {
      // 방어선 도달 → 큰 피해 후 뒤로 물러남
      const dmg = Math.min(player.squad, 2);
      player.squad -= dmg;
      spawnText(laneToX(1, boss.lane), playerLineY() - 26, "-" + dmg + " 🐧", "#ff5a5a", 26);
      spawnParticles(laneToX(1, boss.lane), playerLineY(), "#ff8a8a", 24, 260);
      combo = 0; SND.breach();
      lineFlash = 0.6; screenFlash = 0.45; shake = Math.min(22, shake + 16);
      boss.p = 0.55;
      updateHUD();
      if (player.squad <= 0) { player.squad = 0; updateHUD(); gameOver(); }
    }
  }
  function killBoss() {
    const bx = laneToX(boss.p, boss.lane), by = projY(boss.p);
    spawnParticles(bx, by, "#bfe6ff", 50, 320);
    spawnParticles(bx, by, "#ffffff", 30, 360);
    score += 1500;
    runCoins += 30;
    spawnText(bx, by, "보스 처치! +1500", "#ffe678", 26);
    // 화면 정리 + 보상
    enemies.length = 0; eBullets.length = 0;
    spawnItem(player.x, playerLineY() - 50);
    spawnItem(player.x - 40, playerLineY() - 50);
    shake = Math.min(24, shake + 18); screenFlash = 0.5;
    hitStop = 0.14; SND.explode();
    boss = null;
    bossNextAt = elapsed + 40;
    updateHUD();
  }

  function updateGates(dt) {
    for (let i = gates.length - 1; i >= 0; i--) {
      const pr = gates[i];
      pr.p += pr.vp * (0.45 + pr.p * 1.0) * dt;   // 가까울수록 빠르게
      if (!pr.applied && pr.p >= 1) {
        pr.applied = true;
        const side = player.x < W / 2 ? -1 : 1;
        const panel = pr.panels[0].side === side ? pr.panels[0] : pr.panels[1];
        if (!panel.bursted) applyGate(panel);
      }
      if (pr.p > 1.08) gates.splice(i, 1);
    }
  }

  function applyGate(panel) {
    const el = panel.el;
    const sign = el.kind === "buff" ? 1 : -1;
    const n = Math.abs(panel.count);
    learned[el.symbol] = true;

    switch (el.effect) {
      case "squad":    player.squad = Math.max(0, player.squad + sign * n); break;
      case "weapon":   player.weapon = Math.max(1, Math.min(30, player.weapon + sign * n)); break;
      case "firerate": player.fireRate = Math.max(1, Math.min(12, player.fireRate + sign * n)); break;
      case "shield":   player.shield = Math.max(0, player.shield + sign * n); break;
      case "bomb": {
        let kills = n * 3;
        enemies.sort(function (a, b) { return b.p - a.p; });
        while (kills-- > 0 && enemies.length) killEnemy(0);
        shake = Math.min(16, shake + 10);
        break;
      }
      case "score":    score += sign * n * 300; break;
    }

    // 효과를 펭귄 위에 떠오르는 텍스트로
    const icon = { squad: "🐧", weapon: "🔫", firerate: "⚡", shield: "🛡", bomb: "💥", score: "⭐" }[el.effect] || "";
    const label = (sign > 0 ? "+" : "−") + n + " " + icon;
    spawnText(player.x, playerLineY() - 40, label, sign > 0 ? "#aef0c0" : "#ff8a8a", 22);

    showToast(el.symbol + " " + el.name + " — " + el.fact, el.kind === "trap");
    spawnParticles(player.x, playerLineY() - 10, el.color, 16, 180);
    updateHUD();
    if (player.squad <= 0) gameOver();
  }

  // ---------- 보너스 아이템 ----------
  function spawnItem(x, y) {
    // 무작위 보상: 보호막 / 폭탄 / 점수
    const roll = Math.random();
    let type, label;
    if (roll < 0.4) { type = "shield"; label = "🛡"; player.shield += 3; spawnText(x, y - 24, "보호막 +3", "#7fd0ff", 16); }
    else if (roll < 0.7) { type = "bomb"; label = "💥";
      let kills = 8; enemies.sort(function (a, b) { return b.p - a.p; });
      while (kills-- > 0 && enemies.length) killEnemy(0);
      shake = Math.min(16, shake + 10); spawnText(x, y - 24, "폭탄!", "#ffd070", 16);
    } else { type = "score"; label = "⭐"; score += 800; spawnText(x, y - 24, "+800", "#ffe678", 16); }
    SND.item();
    items.push({ x: x, y: y, life: 1.0, label: label, type: type });
  }
  function updateItems(dt) {
    for (let i = items.length - 1; i >= 0; i--) {
      items[i].y -= 40 * dt;
      items[i].life -= dt;
      if (items[i].life <= 0) items.splice(i, 1);
    }
  }

  // ===================== 파티클 / 머즐 / 눈 / 빙산 =====================
  function spawnParticles(x, y, color, n, spd) {
    spd = spd || 160;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * spd, vy: (Math.random() - 0.5) * spd - 30,
        life: 0.4 + Math.random() * 0.35, max: 0.75,
        color: color, r: 1.5 + Math.random() * 2,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function updateFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dt;
      if (flashes[i].life <= 0) flashes.splice(i, 1);
    }
  }

  // ---------- 플로팅 텍스트(획득/손실/콤보) ----------
  function spawnText(x, y, str, color, size) {
    texts.push({ x: x, y: y, str: str, color: color || "#ffffff",
      size: size || 18, life: 1.0, vy: -46 });
  }
  function updateTexts(dt) {
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.y += t.vy * dt; t.vy += 40 * dt; t.life -= dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }
  function drawTexts() {
    ctx.textAlign = "center";
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 1.4));
      ctx.font = "bold " + t.size + "px sans-serif";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "start";
  }
  function buildSnow() {
    snow = [];
    const n = Math.round((W * H) / 9000);
    for (let i = 0; i < n; i++) {
      snow.push({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2.2,
        vy: 14 + Math.random() * 26, vx: -8 + Math.random() * 16, a: 0.3 + Math.random() * 0.5 });
    }
  }
  function updateSnow(dt) {
    for (const s of snow) {
      s.y += s.vy * dt;
      s.x += s.vx * dt + Math.sin((s.y + s.x) * 0.02) * 6 * dt;
      if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
      if (s.x < -4) s.x = W + 4; else if (s.x > W + 4) s.x = -4;
    }
  }
  function buildBergs() {
    bergs = [];
    let x = -20;
    while (x < W + 40) {
      const w = 40 + Math.random() * 70;
      bergs.push({ x: x, w: w, h: 24 + Math.random() * 46 });
      x += w * (0.7 + Math.random() * 0.5);
    }
  }

  // ===================== 렌더 =====================
  function render() {
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground();

    if (state === STATE.PLAY || state === STATE.OVER) {
      drawGates();
      drawEnemies();
      if (boss) drawBoss();
      drawBullets();
      drawEBullets();
      drawParticles();
      drawItems();
      drawPlayer();
      drawFlashes();
      drawDefenseLine();
      drawTexts();
    }
    drawSnow();
    ctx.restore();

    drawOverlayFx();
  }

  // 화면 고정 연출(흔들림 영향 안 받게 restore 후)
  function drawOverlayFx() {
    if (screenFlash > 0) {
      ctx.fillStyle = "rgba(255, 40, 40, " + (screenFlash * 0.5) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // 보스 상단 배너 + HP바
    if (state === STATE.PLAY && boss) {
      const m = 40, y = 44, bw = W - m * 2, bh = 12;
      ctx.fillStyle = "rgba(10,24,40,0.65)";
      ctx.fillRect(m - 4, y - 16, bw + 8, bh + 22);
      ctx.textAlign = "center";
      ctx.fillStyle = "#cfe8ff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("❄ 북극곰 우두머리", W / 2, y - 4);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(m, y, bw, bh);
      ctx.fillStyle = "#ff5a6a";
      ctx.fillRect(m, y, bw * Math.max(0, boss.hp / boss.maxHp), bh);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(m, y, bw, bh);
      ctx.textAlign = "start";
    }
    // 콤보 표시(3연속부터)
    if (state === STATE.PLAY && combo >= 3) {
      const mult = comboMult();
      const a = Math.min(1, comboTimer / 2.2);
      ctx.textAlign = "center";
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffe678";
      ctx.font = "bold 26px sans-serif";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.5)";
      const s = combo + " 콤보!" + (mult > 1 ? "  x" + mult : "");
      ctx.strokeText(s, W / 2, H * 0.34);
      ctx.fillText(s, W / 2, H * 0.34);
      ctx.globalAlpha = 1; ctx.textAlign = "start";
    }

    // 펭귄이 적을 때 위험 비네팅 + 경고
    if (state === STATE.PLAY && player && player.squad <= 2) {
      const pulse = 0.22 + (Math.sin(elapsed * 6) * 0.5 + 0.5) * 0.18;
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.72);
      vg.addColorStop(0, "rgba(255,0,0,0)");
      vg.addColorStop(1, "rgba(255,0,0," + pulse + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";
      ctx.globalAlpha = 0.6 + (Math.sin(elapsed * 6) * 0.5 + 0.5) * 0.4;
      ctx.fillStyle = "#ff5a5a";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("⚠ 펭귄이 사라지면 게임 오버!", W / 2, 84);
      ctx.globalAlpha = 1; ctx.textAlign = "start";
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, "#0a2a4a");
    sky.addColorStop(0.28, "#16456e");
    sky.addColorStop(0.45, "#2d7fa8");
    sky.addColorStop(0.55, "#bfe8f2");
    sky.addColorStop(1.0, "#eaf6ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const hy = horizonY();

    // 오로라
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const yy = hy * (0.35 + i * 0.18);
      const grad = ctx.createLinearGradient(0, yy - 30, 0, yy + 30);
      const col = i % 2 ? "rgba(120,255,200," : "rgba(140,200,255,";
      grad.addColorStop(0, col + "0)");
      grad.addColorStop(0.5, col + "0.18)");
      grad.addColorStop(1, col + "0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x, yy + Math.sin(x * 0.03 + i * 2 + elapsed * 0.5) * 14);
      ctx.lineTo(W, yy + 60); ctx.lineTo(0, yy + 60);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 태양
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const sg = ctx.createRadialGradient(W * 0.74, hy * 0.6, 4, W * 0.74, hy * 0.6, 60);
    sg.addColorStop(0, "rgba(255,255,255,0.95)");
    sg.addColorStop(0.4, "rgba(200,235,255,0.5)");
    sg.addColorStop(1, "rgba(200,235,255,0)");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(W * 0.74, hy * 0.6, 60, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 빙산 실루엣
    ctx.fillStyle = "rgba(180, 215, 235, 0.85)";
    for (const b of bergs) {
      ctx.beginPath();
      ctx.moveTo(b.x, hy); ctx.lineTo(b.x + b.w * 0.5, hy - b.h); ctx.lineTo(b.x + b.w, hy);
      ctx.closePath(); ctx.fill();
    }

    // 빙판 길(원근) — 소실점에서 퍼지는 사다리꼴
    const vx = W / 2;
    ctx.fillStyle = "#dff1ff";
    ctx.beginPath();
    ctx.moveTo(vx - roadHalfTop(), hy);
    ctx.lineTo(vx + roadHalfTop(), hy);
    ctx.lineTo(vx + roadHalfBot(), playerLineY());
    ctx.lineTo(vx + roadHalfBot(), H);
    ctx.lineTo(vx - roadHalfBot(), H);
    ctx.lineTo(vx - roadHalfBot(), playerLineY());
    ctx.closePath();
    ctx.fill();

    // 길 바깥 빙원
    ctx.fillStyle = "#eaf6ff";
    ctx.beginPath();
    ctx.moveTo(0, hy); ctx.lineTo(vx - roadHalfTop(), hy);
    ctx.lineTo(vx - roadHalfBot(), H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, hy); ctx.lineTo(vx + roadHalfTop(), hy);
    ctx.lineTo(vx + roadHalfBot(), H); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // 길 가장자리 라인
    ctx.strokeStyle = "rgba(90, 150, 200, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vx - roadHalfTop(), hy); ctx.lineTo(vx - roadHalfBot(), H);
    ctx.moveTo(vx + roadHalfTop(), hy); ctx.lineTo(vx + roadHalfBot(), H);
    ctx.stroke();

    // 가로 줄무늬(전진감)
    ctx.strokeStyle = "rgba(120, 170, 210, 0.22)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      let t = ((i / 14) + (scrollY / 80) / 14) % 1;
      const y = hy + (H - hy) * (t * t);
      const half = roadHalfTop() + (roadHalfBot() - roadHalfTop()) * t;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.beginPath(); ctx.moveTo(vx - half, y); ctx.lineTo(vx + half, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 중앙 점선
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      let t0 = ((i / 10) + (scrollY / 80) / 10) % 1;
      let t1 = Math.min(1, t0 + 0.04);
      ctx.globalAlpha = Math.min(1, t0 * 2);
      ctx.beginPath();
      ctx.moveTo(vx, hy + (H - hy) * (t0 * t0));
      ctx.lineTo(vx, hy + (H - hy) * (t1 * t1));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const vg = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    vg.addColorStop(0, "rgba(0,10,25,0.35)");
    vg.addColorStop(1, "rgba(0,10,25,0)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H * 0.25);
  }

  function drawSnow() {
    ctx.fillStyle = "#ffffff";
    for (const s of snow) {
      ctx.globalAlpha = s.a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDefenseLine() {
    const y = playerLineY() + 8;
    const danger = lineFlash > 0;
    if (danger) {
      // 돌파 순간 빨간 띠
      ctx.fillStyle = "rgba(255, 50, 50, " + (lineFlash * 0.5) + ")";
      ctx.fillRect(0, y - 10, W, 20);
    }
    ctx.strokeStyle = danger ? "rgba(255, 80, 80, " + (0.5 + lineFlash) + ")"
                             : "rgba(90, 150, 210, 0.45)";
    ctx.setLineDash([10, 8]); ctx.lineWidth = danger ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------- 펭귄 분대(전방을 향함 = 등을 보임) ----------
  function drawPlayer() {
    const n = Math.min(player.squad, 7);
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = player.x - spread / 2 + spread * t;
      const bob = Math.sin(player.bob + i * 1.3) * 2;
      drawPenguinBack(x, player.y + bob, 1.05, i === Math.floor(n / 2));
    }
    if (player.shield > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 220, 255, 0.7)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y - 8, spread / 2 + 22, Math.PI * 0.92, Math.PI * 2.08);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 카메라를 등지고 전방을 향한 펭귄: 얼굴 대신 검은 등/뒤통수, 앞쪽으로 발사대
  function drawPenguinBack(x, y, s, leader) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // 그림자
    ctx.fillStyle = "rgba(40, 80, 120, 0.22)";
    ctx.beginPath(); ctx.ellipse(0, 5, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

    // 발(앞쪽으로 살짝 보임)
    ctx.fillStyle = "#f5a623";
    ctx.beginPath(); ctx.ellipse(-4, 4, 3.2, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 4, 3.2, 2, 0, 0, Math.PI * 2); ctx.fill();

    // 몸통(등 — 검정)
    ctx.fillStyle = "#1b2733";
    ctx.beginPath(); ctx.ellipse(0, -9, 10.5, 13, 0, 0, Math.PI * 2); ctx.fill();
    // 등 가운데 살짝 밝은 음영
    ctx.fillStyle = "rgba(90,120,150,0.25)";
    ctx.beginPath(); ctx.ellipse(0, -9, 5, 9, 0, 0, Math.PI * 2); ctx.fill();

    // 날개(양옆)
    ctx.fillStyle = "#11202b";
    ctx.beginPath(); ctx.ellipse(-10, -8, 3, 8, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10, -8, 3, 8, -0.25, 0, Math.PI * 2); ctx.fill();

    // 뒤통수(검정, 얼굴 없음)
    ctx.fillStyle = "#1b2733";
    ctx.beginPath(); ctx.arc(0, -20, 7, 0, Math.PI * 2); ctx.fill();

    // 눈덩이 발사대(앞쪽 위로)
    ctx.fillStyle = "#cdd9e3";
    ctx.fillRect(-2.2, -30, 4.4, 12);
    ctx.fillStyle = "#9fb4c6";
    ctx.fillRect(-2.2, -30, 4.4, 3);

    if (leader) {
      ctx.fillStyle = "#e23b3b";
      ctx.fillRect(-5.5, -29, 11, 3);
      ctx.beginPath(); ctx.arc(0, -29, 5.5, Math.PI, 0); ctx.fill();
    }
    ctx.restore();
  }

  // 북극곰 종류별 털 색(밝은쪽, 그늘쪽)
  const ENEMY_COLORS = {
    normal:   ["#ffffff", "#ccdcea"],
    fast:     ["#eafffb", "#aee3da"],
    tank:     ["#ffffff", "#b7c6da"],
    splitter: ["#fdf3ff", "#d8c4ea"],
    shell:    ["#ffffff", "#ccdcea"],
    ranged:   ["#fff4e6", "#e6c8a6"],
    shard:    ["#fdf3ff", "#d8c4ea"],
  };

  // ---------- 얼음 몬스터 ----------
  function drawEnemies() {
    // 먼 것부터 그려 가까운 게 위에 오도록
    const sorted = enemies.slice().sort(function (a, b) { return a.p - b.p; });
    for (const e of sorted) {
      const sc = projScale(e.p);
      const sway = Math.sin(e.sway) * (e.big ? 3 : 2);
      const ex = laneToX(e.p, e.lane) + sway;
      const ey = projY(e.p);
      const r = e.r * sc;

      ctx.save();
      ctx.translate(ex, ey);

      ctx.fillStyle = "rgba(40,80,120,0.18)";
      ctx.beginPath(); ctx.ellipse(0, r * 0.9, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();

      const c = ENEMY_COLORS[e.kind] || ENEMY_COLORS.normal;
      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r * 1.1);
      if (e.hit > 0) { grad.addColorStop(0, "#ffffff"); grad.addColorStop(1, "#ffd0d0"); }
      else { grad.addColorStop(0, c[0]); grad.addColorStop(1, c[1]); }
      const ol = "rgba(60,90,120,0.45)";
      const lw = Math.max(1, 1.5 * sc);

      // 어깨/덩치(머리 뒤)
      ctx.fillStyle = c[1];
      ctx.beginPath(); ctx.ellipse(0, r * 0.6, r * 1.05, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();

      // 귀
      ctx.fillStyle = grad; ctx.strokeStyle = ol; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.6, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.6, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(120,150,180,0.5)";
      ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.56, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.56, r * 0.16, 0, Math.PI * 2); ctx.fill();

      // 머리
      ctx.fillStyle = grad; ctx.strokeStyle = ol; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // 주둥이
      ctx.fillStyle = "rgba(228,240,250,0.96)";
      ctx.beginPath(); ctx.ellipse(0, r * 0.42, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      // 코
      ctx.fillStyle = "#161b22";
      ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 0.17, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      // 입(으르렁)
      ctx.strokeStyle = "#3a4654"; ctx.lineWidth = Math.max(1, 1.4 * sc);
      ctx.beginPath();
      ctx.moveTo(0, r * 0.3); ctx.lineTo(0, r * 0.5);
      ctx.moveTo(0, r * 0.5); ctx.quadraticCurveTo(-r * 0.22, r * 0.66, -r * 0.34, r * 0.48);
      ctx.moveTo(0, r * 0.5); ctx.quadraticCurveTo(r * 0.22, r * 0.66, r * 0.34, r * 0.48);
      ctx.stroke();
      // 송곳니
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-r * 0.14, r * 0.5); ctx.lineTo(-r * 0.08, r * 0.66); ctx.lineTo(-r * 0.02, r * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.14, r * 0.5); ctx.lineTo(r * 0.08, r * 0.66); ctx.lineTo(r * 0.02, r * 0.5);
      ctx.closePath(); ctx.fill();

      // 화난 눈
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.4, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
      // 찡그린 눈썹
      ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = Math.max(1.5, 2.2 * sc);
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, -r * 0.46); ctx.lineTo(-r * 0.16, -r * 0.22);
      ctx.moveTo(r * 0.62, -r * 0.46); ctx.lineTo(r * 0.16, -r * 0.22);
      ctx.stroke();

      // 원거리형: 머리 위 발사 노즐
      if (e.kind === "ranged") {
        ctx.fillStyle = "#8a5a2a";
        ctx.fillRect(-r * 0.18, -r * 1.35, r * 0.36, r * 0.55);
      }
      // 얼음 껍질(안 깨진 동안)
      if (e.shell > 0) {
        ctx.strokeStyle = "rgba(225,248,255,0.95)";
        ctx.fillStyle = "rgba(205,238,255,0.28)";
        ctx.lineWidth = Math.max(1.5, 2.5 * sc);
        ctx.beginPath(); ctx.arc(0, 0, r * 1.28, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();

      // 체력바
      if (e.hp < e.maxHp) {
        ctx.fillStyle = "rgba(10,30,50,0.55)";
        ctx.fillRect(ex - r, ey - r - 9, r * 2, 4);
        ctx.fillStyle = "#6fe0a0";
        ctx.fillRect(ex - r, ey - r - 9, r * 2 * (e.hp / e.maxHp), 4);
      }
    }
  }

  // ---------- 눈덩이 총알(원근) ----------
  function drawBullets() {
    for (const b of bullets) {
      const sc = projScale(b.p);
      const bx = laneToX(b.p, b.lane), by = projY(b.p);
      const rr = 3.4 * sc + 1;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rr * 2.6);
      g.addColorStop(0, "rgba(200,240,255,0.9)");
      g.addColorStop(1, "rgba(160,220,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, rr * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- 적 발사체 ----------
  function drawEBullets() {
    for (const b of eBullets) {
      const sc = projScale(b.p);
      const bx = laneToX(b.p, b.lane), by = projY(b.p);
      const rr = b.r * sc + 1;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rr * 2.2);
      g.addColorStop(0, "rgba(160,200,235,0.85)");
      g.addColorStop(1, "rgba(120,160,210,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, rr * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#cfe0ee";
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(40,70,100,0.6)"; ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ---------- 보스: 북극곰 우두머리 ----------
  function drawBoss() {
    const sc = projScale(boss.p);
    const r = boss.r * sc;
    const bx = laneToX(boss.p, boss.lane);
    const by = projY(boss.p) - r * 0.6;

    // 그림자
    ctx.fillStyle = "rgba(20,50,80,0.25)";
    ctx.beginPath(); ctx.ellipse(bx, by + r * 0.95, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();

    // 거대 북극곰 우두머리
    ctx.save();
    ctx.translate(bx, by);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 4, 0, 0, r * 1.1);
    if (boss.hit > 0) { grad.addColorStop(0, "#ffffff"); grad.addColorStop(1, "#ffcaca"); }
    else { grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.65, "#e2eefb"); grad.addColorStop(1, "#b3c6dd"); }
    const ol = "rgba(40,70,110,0.55)";

    // 어깨/덩치
    ctx.fillStyle = "#cdddec";
    ctx.beginPath(); ctx.ellipse(0, r * 0.7, r * 1.25, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();

    // 귀
    ctx.fillStyle = grad; ctx.strokeStyle = ol; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.62, r * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.62, r * 0.36, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(120,150,180,0.5)";
    ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.58, r * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.58, r * 0.17, 0, Math.PI * 2); ctx.fill();

    // 머리
    ctx.fillStyle = grad; ctx.strokeStyle = ol; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 주둥이 + 코 + 으르렁 입 + 송곳니
    ctx.fillStyle = "rgba(230,242,252,0.97)";
    ctx.beginPath(); ctx.ellipse(0, r * 0.44, r * 0.52, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#141a21";
    ctx.beginPath(); ctx.ellipse(0, r * 0.22, r * 0.18, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#33414f"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.32); ctx.lineTo(0, r * 0.54);
    ctx.moveTo(0, r * 0.54); ctx.quadraticCurveTo(-r * 0.24, r * 0.7, -r * 0.36, r * 0.5);
    ctx.moveTo(0, r * 0.54); ctx.quadraticCurveTo(r * 0.24, r * 0.7, r * 0.36, r * 0.5);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(-r * 0.16, r * 0.54); ctx.lineTo(-r * 0.09, r * 0.72); ctx.lineTo(-r * 0.02, r * 0.54); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.16, r * 0.54); ctx.lineTo(r * 0.09, r * 0.72); ctx.lineTo(r * 0.02, r * 0.54); ctx.closePath(); ctx.fill();

    // 화난 눈
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d01e2e";
    ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.08, r * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.4, -r * 0.08, r * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.64, -r * 0.48); ctx.lineTo(-r * 0.16, -r * 0.2);
    ctx.moveTo(r * 0.64, -r * 0.48); ctx.lineTo(r * 0.16, -r * 0.2);
    ctx.stroke();

    // 왕관
    ctx.fillStyle = "#ffd24a";
    ctx.strokeStyle = "#c79520"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.86); ctx.lineTo(-r * 0.34, -r * 1.3);
    ctx.lineTo(-r * 0.08, -r * 0.98); ctx.lineTo(r * 0.2, -r * 1.36);
    ctx.lineTo(r * 0.46, -r * 0.96); ctx.lineTo(r * 0.6, -r * 0.84);
    ctx.lineTo(-r * 0.6, -r * 0.84); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff5a6a";
    ctx.beginPath(); ctx.arc(0, -r * 0.92, r * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 머리 위 떠있는 HP바
    const bw = r * 2.2, bh = 6 * sc + 2;
    const bxx = bx - bw / 2, byy = by - r * 1.5;
    ctx.fillStyle = "rgba(10,30,50,0.6)";
    ctx.fillRect(bxx, byy, bw, bh);
    ctx.fillStyle = "#ff5a6a";
    ctx.fillRect(bxx, byy, bw * Math.max(0, boss.hp / boss.maxHp), bh);
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
    ctx.strokeRect(bxx, byy, bw, bh);
  }

  function drawFlashes() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of flashes) {
      const a = Math.max(0, f.life / 0.08);
      ctx.fillStyle = "rgba(220,245,255," + (a * 0.8) + ")";
      ctx.beginPath(); ctx.arc(f.x, f.y, 7 * a + 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawItems() {
    ctx.textAlign = "center";
    for (const it of items) {
      ctx.globalAlpha = Math.min(1, it.life * 1.5);
      ctx.font = "26px sans-serif";
      ctx.fillText(it.label, it.x, it.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  function drawGates() {
    ctx.textAlign = "center";
    const sorted = gates.slice().sort(function (a, b) { return a.p - b.p; });  // 먼 것부터
    for (const pr of sorted) {
      for (const panel of pr.panels) {
        if (panel.bursted) continue;
        const isBuff = panel.el.kind === "buff";
        const g = panelGeom(pr, panel.side);
        const wallW = g.x1 - g.x0, wallH = g.baseY - g.topY;

        // 바닥 그림자(서 있는 느낌)
        ctx.fillStyle = "rgba(20, 50, 80, 0.25)";
        ctx.beginPath();
        ctx.ellipse(g.cx, g.baseY, wallW * 0.45, 5 * g.scale, 0, 0, Math.PI * 2);
        ctx.fill();

        // 세로 벽(빌보드)
        const grad = ctx.createLinearGradient(0, g.topY, 0, g.baseY);
        if (isBuff) { grad.addColorStop(0, "rgba(120, 210, 255, 0.55)"); grad.addColorStop(1, "rgba(30, 110, 200, 0.7)"); }
        else { grad.addColorStop(0, "rgba(255, 150, 150, 0.55)"); grad.addColorStop(1, "rgba(170, 45, 55, 0.7)"); }
        ctx.fillStyle = grad;
        ctx.fillRect(g.x0, g.topY, wallW, wallH);

        // 기둥 + 상단 광택
        ctx.strokeStyle = isBuff ? "rgba(170, 230, 255, 0.95)" : "rgba(255, 160, 160, 0.95)";
        ctx.lineWidth = Math.max(1.5, 3 * g.scale);
        ctx.strokeRect(g.x0, g.topY, wallW, wallH);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(g.x0, g.topY, wallW, Math.max(3, 7 * g.scale));

        // 폭발 게이지(안전 게이트, 벽 상단)
        if (isBuff) {
          const prog = Math.min(1, panel.count / panel.goal);
          const bw = wallW * 0.7, bh = Math.max(3, 5 * g.scale);
          const bx = g.cx - bw / 2, byy = g.topY + 5 * g.scale;
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(bx, byy, bw, bh);
          ctx.fillStyle = prog >= 1 ? "#fff09a" : "#ffe678";
          ctx.fillRect(bx, byy, bw * prog, bh);
        }

        // 큰 숫자(+N / −N)
        const fs = Math.max(13, 32 * g.scale);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold " + fs + "px sans-serif";
        const num = (panel.count >= 0 ? "+" : "−") + Math.abs(panel.count);
        ctx.fillText(num, g.cx, g.cy + fs * 0.35);

        // 이름(벽 아래)
        ctx.fillStyle = "#eaf6ff";
        ctx.font = Math.max(8, 12 * g.scale) + "px sans-serif";
        ctx.fillText(panel.el.symbol + " " + panel.el.name, g.cx, g.baseY - 5 * g.scale);
      }
    }
    ctx.textAlign = "start";
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ===================== 메인 루프 =====================
  let lastT = 0;
  function loop(ts) {
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0;
    lastT = ts;
    if (state === STATE.PLAY) {
      if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);  // 짧은 정지(손맛)
      else update(dt);
    }
    render();
    requestAnimationFrame(loop);
  }

  META.load();
  refreshMetaUI();
  resize();
  requestAnimationFrame(loop);
})();

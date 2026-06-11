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
    jump: function () { beep(300, 0.12, "square", 0.04, 640); },
    fish: function () { beep(760, 0.09, "triangle", 0.05, 1100); },
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

  // ===================== 게임 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, bullets, enemies, obstacles, particles, flashes, items, texts, eBullets;
  let score, learned;
  let spawnTimer, obsTimer, fireTimer, elapsed;
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
      jumpY: 0, vz: 0, onGround: true,   // 점프 상태
      fish: 0,                            // 모은 정어리
    };
    runCoins = 0;
    bullets = [];
    enemies = [];
    obstacles = [];
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
    obsTimer = 1.4;
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
  function jump() {
    if (state !== STATE.PLAY || !player.onGround) return;
    player.vz = 560;          // 위로 솟는 초기 속도
    player.onGround = false;
    SND.jump();
  }
  canvas.addEventListener("mousemove", function (e) {
    if (state === STATE.PLAY) pointerMove(e.clientX);
  });
  canvas.addEventListener("mousedown", function () { jump(); });   // 클릭 = 점프
  canvas.addEventListener("touchmove", function (e) {
    if (state === STATE.PLAY && e.touches[0]) { pointerMove(e.touches[0].clientX); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchstart", function (e) {
    if (state === STATE.PLAY && e.touches[0]) pointerMove(e.touches[0].clientX);
    jump();                                                        // 탭 = 점프
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") keyLeft = true;
    if (e.key === "ArrowRight") keyRight = true;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "Spacebar") { jump(); e.preventDefault(); }
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
      "🐟 정어리 <b>" + player.fish + "</b>마리　🪙 코인 <b>+" + runCoins + "</b>" +
      (isRecord ? "　🏆 <b>신기록!</b>" : "");

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
    document.getElementById("hud-fish").textContent = player.fish;
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

  // ===================== 함정 & 정어리 =====================
  // 빙판 길로 다가오는 장애물:
  //  - 함정(trap): 위험 원소(방사능·독성). 점프로 넘어야 한다. 못 넘으면 페널티.
  //  - 정어리(sardine): 안전 원소 배지를 단 물고기. 땅에서 주우면 강화 + 원소 학습.
  const TRAP_HALF = 0.45;   // 구덩이 반폭(길 반폭 대비) — 최대 너비가 길의 약 절반
  function spawnObstacle() {
    // 약 55% 함정, 45% 정어리
    if (Math.random() < 0.55) {
      const el = TRAP_ELEMENTS[(Math.random() * TRAP_ELEMENTS.length) | 0];
      const lane = (-1 + ((Math.random() * 3) | 0)) * 0.5;   // -0.5 / 0 / 0.5
      obstacles.push({ type: "trap", el: el, lane: lane, p: 0.0,
        vp: 0.085 + Math.random() * 0.02, done: false });
    } else {
      const el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      obstacles.push({ type: "sardine", el: el, lane: -0.7 + Math.random() * 1.4,
        p: 0.0, vp: 0.085 + Math.random() * 0.02, done: false, bob: Math.random() * 6.28 });
    }
  }

  // 원소 효과 적용(sign +1 = 강화, -1 = 페널티)
  function applyElementEffect(el, sign) {
    const v = Math.max(1, Math.abs(el.value));
    switch (el.effect) {
      case "squad":    player.squad = Math.max(0, player.squad + sign * v); break;
      case "weapon":   player.weapon = Math.max(1, Math.min(30, player.weapon + sign * v)); break;
      case "firerate": player.fireRate = Math.max(1, Math.min(12, player.fireRate + sign * v)); break;
      case "shield":   player.shield = Math.max(0, player.shield + sign * v); break;
      case "bomb": {
        let kills = v * 4;
        enemies.sort(function (a, b) { return b.p - a.p; });
        while (kills-- > 0 && enemies.length) killEnemy(0);
        shake = Math.min(16, shake + 10);
        break;
      }
      case "score":    score += sign * Math.abs(el.value) * 2; break;
    }
    const icon = { squad: "🐧", weapon: "🔫", firerate: "⚡", shield: "🛡", bomb: "💥", score: "⭐" }[el.effect] || "";
    const mag = el.effect === "score" ? Math.abs(el.value) * 2 : v;
    spawnText(player.x, playerLineY() - player.jumpY - 44, (sign > 0 ? "+" : "−") + mag + " " + icon,
      sign > 0 ? "#aef0c0" : "#ff8a8a", 22);
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

    // 점프 물리(jumpY = 바닥에서 떠오른 높이, px)
    if (!player.onGround) {
      player.jumpY += player.vz * dt;
      player.vz -= 1700 * dt;            // 중력
      if (player.jumpY <= 0) { player.jumpY = 0; player.vz = 0; player.onGround = true; }
    }

    const fireInterval = Math.max(0.08, 0.42 - player.fireRate * 0.03);
    fireTimer -= dt;
    if (fireTimer <= 0) { fireTimer = fireInterval; fireVolley(); }

    // 보스가 없을 때만 잡몹 스폰(보스 중엔 조금만)
    const spawnInterval = Math.max(0.45, 1.5 - elapsed * 0.013) * (boss ? 2.2 : 1);
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = spawnInterval; spawnEnemy(); }

    // 보스 웨이브
    if (!boss && elapsed >= bossNextAt) spawnBoss();

    obsTimer -= dt;
    if (obsTimer <= 0) { obsTimer = Math.max(1.1, 2.3 - elapsed * 0.01); spawnObstacle(); }

    updateBullets(dt);
    updateEnemies(dt);
    updateEBullets(dt);
    if (boss) updateBoss(dt);
    updateObstacles(dt);
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
                sway: Math.random() * 6.28, swaySpd: 1.5 + Math.random() * 1.5,
                walk: Math.random() * 6.28 };
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

      // 보스 충돌
      if (boss) {
        const bs = projScale(boss.p);
        const bxx = laneToX(boss.p, boss.lane), byy = projY(boss.p) - boss.r * bs * 1.15;
        const rad = boss.r * bs * 1.6 + 6 * projScale(b.p);
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
        const ex = laneToX(e.p, e.lane), ey = projY(e.p) - e.r * es * 1.1;  // 몸통 중심
        const rad = e.r * es * 1.55 + 6 * projScale(b.p);
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
      e.walk += dt * (5 + e.vp * 20);   // 걸음 속도
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
      sway: 0, shootTimer: 2.2, bounce: 0, walk: 0,
    };
    showToast("❄ 북극곰 우두머리 등장! 집중 사격!", true);
    shake = Math.min(20, shake + 14);
    screenFlash = 0.25;
    SND.boss();
  }
  function updateBoss(dt) {
    boss.p += boss.vp * (0.6 + boss.p * 0.5) * dt;
    boss.sway += dt * 1.2;
    boss.walk += dt * 3;
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

  function updateObstacles(dt) {
    const AIRBORNE = 18;   // 이 높이 이상 떠 있으면 점프 중으로 판정
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.p += o.vp * (0.45 + o.p * 1.0) * dt;   // 가까울수록 빠르게
      if (o.type === "sardine") o.bob += dt * 6;

      if (!o.done && o.p >= 1) {
        o.done = true;
        const ox = laneToX(1, o.lane);
        if (o.type === "trap") hitTrap(o, ox);
        else collectSardine(o, ox, AIRBORNE);
      }
      if (o.p > 1.1) obstacles.splice(i, 1);
    }
  }

  // 함정: 점프로 넘거나 옆으로 피하면 안전, 구덩이 위에 서 있으면 페널티
  function hitTrap(o, ox) {
    const el = o.el;
    const tHalf = halfAt(1) * TRAP_HALF;       // 구덩이 화면 반폭(p=1)
    const overHole = Math.abs(player.x - ox) < tHalf + 10;

    if (player.jumpY > 18) {
      // 점프로 넘음 → 학습 + 보너스
      learned[el.symbol] = true;
      score += 30; runCoins += 1;
      spawnText(player.x, playerLineY() - player.jumpY - 40, "점프! +30", "#aef0c0", 18);
      spawnParticles(player.x, playerLineY(), "#bfe6ff", 8, 150);
      showToast(el.symbol + " " + el.name + " — " + el.fact, true);
      SND.item();
    } else if (overHole) {
      // 구덩이에 빠짐 → 페널티 + 위험 원소 설명
      learned[el.symbol] = true;
      applyElementEffect(el, -1);
      spawnParticles(ox, playerLineY(), "#9ab8d0", 16, 220);
      combo = 0; lineFlash = 0.5; screenFlash = 0.32;
      shake = Math.min(18, shake + 11);
      SND.breach();
      showToast("⚠ " + el.symbol + " " + el.name + " — " + el.fact, true);
    } else {
      // 옆으로 피함 → 무사
      spawnText(player.x, playerLineY() - 40, "회피!", "#cfe6ff", 16);
    }
    updateHUD();
    if (player.squad <= 0) gameOver();
  }

  // 정어리: 땅에서 가까이 있으면 줍기(강화+학습), 점프 중이면 놓침
  function collectSardine(o, ox, AIRBORNE) {
    const n = Math.min(player.squad, 7);
    const catchR = 40 + Math.min(120, 18 + n * 12) / 2;
    if (player.jumpY <= AIRBORNE && Math.abs(player.x - ox) < catchR) {
      const el = o.el;
      learned[el.symbol] = true;
      applyElementEffect(el, 1);
      player.fish++;
      runCoins += 2; score += 50;
      spawnParticles(ox, playerLineY() - 12, el.color, 14, 180);
      SND.fish();
      // 정어리 10마리마다 펭귄 +1
      if (player.fish % 10 === 0) {
        player.squad++;
        spawnText(player.x, playerLineY() - 64, "정어리 10마리! 🐧+1", "#ffe678", 18);
      }
      showToast(el.symbol + " " + el.name + " — " + el.fact, false);
    }
    updateHUD();
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
      drawObstacles();
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
    const lift = player.jumpY;
    const shS = 1 - Math.min(0.55, lift / 150);   // 점프하면 그림자 작아짐
    // 바닥 그림자(점프해도 땅에 남음)
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = player.x - spread / 2 + spread * t;
      ctx.fillStyle = "rgba(40,80,120," + (0.22 * shS) + ")";
      ctx.beginPath(); ctx.ellipse(x, player.y + 6, 12 * shS, 4 * shS, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 펭귄(점프 높이만큼 위로)
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = player.x - spread / 2 + spread * t;
      const phase = player.bob + i * 1.3;
      const bob = Math.abs(Math.sin(phase)) * 1.5;
      drawPenguinBack(x, player.y - lift + bob, 1.12, i === Math.floor(n / 2), phase);
    }
    if (player.shield > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 220, 255, 0.7)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y - lift - 8, spread / 2 + 22, Math.PI * 0.92, Math.PI * 2.08);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 카메라를 등지고 전방을 향한 펭귄: 검은 등/뒤통수 + 뒤뚱 걷기 + 발사대
  function drawPenguinBack(x, y, s, leader, phase) {
    const wad = Math.sin(phase) * 0.09;                       // 좌우 뒤뚱
    const stepL = Math.max(0, Math.sin(phase)) * 2;           // 발 번갈아 듦
    const stepR = Math.max(0, Math.sin(phase + Math.PI)) * 2;
    const flap = Math.sin(phase) * 0.18;                      // 날개 펄럭

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wad);
    ctx.scale(s, s);

    // 발(번갈아 듦)
    ctx.fillStyle = "#f5a623";
    ctx.beginPath(); ctx.ellipse(-4, 5 - stepL, 3.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 5 - stepR, 3.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();

    // 꼬리
    ctx.fillStyle = "#11202b";
    ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, 3); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();

    // 몸통(등) — 세로 그라데이션
    const bodyGrad = ctx.createLinearGradient(0, -22, 0, 5);
    bodyGrad.addColorStop(0, "#2c3b4b");
    bodyGrad.addColorStop(1, "#131e28");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath(); ctx.ellipse(0, -9, 11, 14, 0, 0, Math.PI * 2); ctx.fill();
    // 등 하이라이트
    ctx.fillStyle = "rgba(120,150,180,0.2)";
    ctx.beginPath(); ctx.ellipse(-2, -12, 4, 7, -0.2, 0, Math.PI * 2); ctx.fill();

    // 날개(펄럭)
    ctx.fillStyle = "#0e1a24";
    ctx.save(); ctx.translate(-10, -8); ctx.rotate(flap); ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 8, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(10, -8); ctx.rotate(-flap); ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 8, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    // 뒤통수(얼굴 없음)
    ctx.fillStyle = "#1b2733";
    ctx.beginPath(); ctx.arc(0, -21, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(120,150,180,0.16)";
    ctx.beginPath(); ctx.arc(-2, -23, 3, 0, Math.PI * 2); ctx.fill();

    // 눈덩이 발사대
    ctx.fillStyle = "#cdd9e3"; ctx.fillRect(-2.4, -32, 4.8, 13);
    ctx.fillStyle = "#9fb4c6"; ctx.fillRect(-2.4, -32, 4.8, 3);
    ctx.fillStyle = "#7f95a8"; ctx.beginPath(); ctx.arc(0, -32, 2.6, Math.PI, 0); ctx.fill();

    if (leader) {
      // 대장: 빨간 모자 + 금색 방울
      ctx.fillStyle = "#e23b3b"; ctx.fillRect(-6, -30, 12, 3);
      ctx.beginPath(); ctx.arc(0, -30, 6, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(0, -37, 1.9, 0, Math.PI * 2); ctx.fill();
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

  // ---------- 북극곰 그리기 헬퍼(발이 원점, 위로 그림) ----------
  function drawBearHead(cx, cy, r, L, D, ol, lw) {
    ctx.save();
    ctx.translate(cx, cy);
    // 입체 음영(좌상단 하이라이트 → 우하단 그늘)
    const hg = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.15, r * 0.1, r * 0.1, r * 1.25);
    hg.addColorStop(0, "#ffffff"); hg.addColorStop(0.55, L); hg.addColorStop(1, D);
    // 귀
    ctx.fillStyle = hg; ctx.strokeStyle = ol; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.66, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.66, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(120,150,180,0.5)";
    ctx.beginPath(); ctx.arc(-r * 0.66, -r * 0.62, r * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.66, -r * 0.62, r * 0.16, 0, Math.PI * 2); ctx.fill();
    // 머리
    ctx.fillStyle = hg; ctx.strokeStyle = ol; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 턱밑 그늘(몸통과 만나는 부분, 입체감)
    ctx.fillStyle = "rgba(60,90,125,0.18)";
    ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.8, r * 0.5, 0, 0, Math.PI); ctx.fill();
    // 주둥이(돌출, 하이라이트)
    const mg = ctx.createRadialGradient(0, r * 0.28, r * 0.1, 0, r * 0.42, r * 0.55);
    mg.addColorStop(0, "#ffffff"); mg.addColorStop(1, "rgba(214,230,244,0.96)");
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.ellipse(0, r * 0.42, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#161b22";
    ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 0.17, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    // 으르렁 입 + 송곳니
    ctx.strokeStyle = "#3a4654"; ctx.lineWidth = Math.max(1, lw * 0.9);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.3); ctx.lineTo(0, r * 0.5);
    ctx.moveTo(0, r * 0.5); ctx.quadraticCurveTo(-r * 0.22, r * 0.66, -r * 0.34, r * 0.48);
    ctx.moveTo(0, r * 0.5); ctx.quadraticCurveTo(r * 0.22, r * 0.66, r * 0.34, r * 0.48);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(-r * 0.14, r * 0.5); ctx.lineTo(-r * 0.08, r * 0.66); ctx.lineTo(-r * 0.02, r * 0.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.14, r * 0.5); ctx.lineTo(r * 0.08, r * 0.66); ctx.lineTo(r * 0.02, r * 0.5); ctx.closePath(); ctx.fill();
    // 화난 눈 + 눈썹
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.12, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c0392b";
    ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.4, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = Math.max(1.5, lw * 1.3);
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.46); ctx.lineTo(-r * 0.16, -r * 0.22);
    ctx.moveTo(r * 0.62, -r * 0.46); ctx.lineTo(r * 0.16, -r * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  function drawBearCrown(cx, cy, r) {
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#c79520"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0); ctx.lineTo(-r * 0.34, -r * 0.5);
    ctx.lineTo(-r * 0.08, -r * 0.12); ctx.lineTo(r * 0.2, -r * 0.55);
    ctx.lineTo(r * 0.46, -r * 0.1); ctx.lineTo(r * 0.6, 0.02);
    ctx.lineTo(-r * 0.6, 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff5a6a";
    ctx.beginPath(); ctx.arc(0, -r * 0.08, r * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 사족보행 북극곰(카메라 쪽으로 달려듦) + 걷기 애니메이션. 발이 원점(0,0).
  // 머리/어깨가 앞(아래·크게), 등이 뒤(위), 네 다리로 바닥을 짚는다.
  function drawPolarBear(r, light, dark, walk, hitFlash, isBoss) {
    const L = hitFlash ? "#ffffff" : light;
    const D = hitFlash ? "#ffd2d2" : dark;
    const ol = "rgba(50,80,115,0.5)";
    const lw = Math.max(1, r * 0.08);

    // 사족 보행 사이클: 앞다리/뒷다리 번갈아
    const fS = Math.sin(walk), bS = Math.sin(walk + Math.PI);
    const fSw = fS * r * 0.2, bSw = bS * r * 0.2;          // 앞뒤 스윙
    const fLift = Math.max(0, fS) * r * 0.16;              // 발 들어올림
    const bLift = Math.max(0, bS) * r * 0.16;
    const bob = Math.abs(Math.sin(walk)) * r * 0.05;

    // 큰 몸통 + 작은 머리
    const bodyCY = -r * 1.2 - bob;     // 등(뒤·위, 크게)
    const bRX = r * 1.32, bRY = r * 1.02;
    const headR = r * 0.6;             // 머리(작게)
    const headCY = -r * 0.5 - bob * 0.5;   // 머리(앞·아래)

    ctx.lineCap = "round";

    // 뒷다리(뒤·어둡게) — 큰 몸 뒤쪽에서 바닥으로
    ctx.strokeStyle = D; ctx.lineWidth = r * 0.4;
    ctx.beginPath(); ctx.moveTo(-bRX * 0.52, bodyCY + bRY * 0.45); ctx.lineTo(-bRX * 0.56 + bSw, -bLift); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bRX * 0.52, bodyCY + bRY * 0.45); ctx.lineTo(bRX * 0.56 + bSw, -bLift); ctx.stroke();

    // 몸통(입체 그라데이션, 어깨 hump)
    const bg = ctx.createRadialGradient(-bRX * 0.35, bodyCY - bRY * 0.45, r * 0.2, 0, bodyCY, bRX * 1.15);
    bg.addColorStop(0, "#ffffff"); bg.addColorStop(0.55, L); bg.addColorStop(1, D);
    ctx.fillStyle = bg; ctx.strokeStyle = ol; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.ellipse(0, bodyCY, bRX, bRY, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 어깨 hump 하이라이트
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.ellipse(-bRX * 0.18, bodyCY - bRY * 0.4, bRX * 0.5, bRY * 0.38, 0, 0, Math.PI * 2); ctx.fill();

    // 앞다리(앞·밝게) — 어깨에서 바닥으로
    ctx.strokeStyle = L; ctx.lineWidth = r * 0.46;
    ctx.beginPath(); ctx.moveTo(-bRX * 0.34, bodyCY + bRY * 0.6); ctx.lineTo(-bRX * 0.42 + fSw, -fLift); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bRX * 0.34, bodyCY + bRY * 0.6); ctx.lineTo(bRX * 0.42 + fSw, -fLift); ctx.stroke();
    ctx.fillStyle = "rgba(70,100,135,0.45)";   // 앞발
    ctx.beginPath(); ctx.ellipse(-bRX * 0.42 + fSw, -fLift, r * 0.22, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bRX * 0.42 + fSw, -fLift, r * 0.22, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();

    // 머리(작게, 앞·아래) + 왕관
    drawBearHead(0, headCY, headR, L, D, ol, lw);
    if (isBoss) drawBearCrown(0, headCY - headR, headR);

    return { topY: bodyCY - bRY * 1.05, headCY: headCY, headR: headR };
  }

  // ---------- 북극곰 적 ----------
  function drawEnemies() {
    // 먼 것부터 그려 가까운 게 위에 오도록
    const sorted = enemies.slice().sort(function (a, b) { return a.p - b.p; });
    for (const e of sorted) {
      const sc = projScale(e.p);
      const wob = Math.sin(e.sway) * (e.big ? 3 : 2);
      const ex = laneToX(e.p, e.lane) + wob;
      const ey = projY(e.p);
      const r = e.r * sc;
      const c = ENEMY_COLORS[e.kind] || ENEMY_COLORS.normal;

      ctx.save();
      ctx.translate(ex, ey);

      // 그림자(발밑)
      ctx.fillStyle = "rgba(40,80,120,0.2)";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();

      const info = drawPolarBear(r, c[0], c[1], e.walk, e.hit > 0, false);

      const ty = info.topY;
      // 원거리형: 등에 눈 대포
      if (e.kind === "ranged") {
        ctx.fillStyle = "#8a5a2a";
        ctx.fillRect(-r * 0.16, ty, r * 0.32, r * 0.55);
        ctx.fillStyle = "#5e3c1c";
        ctx.fillRect(-r * 0.16, ty, r * 0.32, r * 0.16);
      }
      // 얼음 껍질(안 깨진 동안) — 몸 전체를 감싸는 얼음막
      if (e.shell > 0) {
        ctx.strokeStyle = "rgba(225,248,255,0.95)";
        ctx.fillStyle = "rgba(205,238,255,0.22)";
        ctx.lineWidth = Math.max(1.5, 2.5 * sc);
        ctx.beginPath(); ctx.ellipse(0, ty * 0.5, r * 1.55, -ty * 0.6, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();

      // 체력바(머리 위)
      if (e.hp < e.maxHp) {
        const barY = ey + info.topY - 6;
        ctx.fillStyle = "rgba(10,30,50,0.55)";
        ctx.fillRect(ex - r, barY, r * 2, 4);
        ctx.fillStyle = "#6fe0a0";
        ctx.fillRect(ex - r, barY, r * 2 * (e.hp / e.maxHp), 4);
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
    const ey = projY(boss.p);

    // 그림자(발밑)
    ctx.fillStyle = "rgba(20,50,80,0.28)";
    ctx.beginPath(); ctx.ellipse(bx, ey, r * 1.4, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    // 거대 북극곰 우두머리(전신 + 걷기 + 왕관)
    ctx.save();
    ctx.translate(bx, ey);
    const info = drawPolarBear(r, "#ffffff", "#b3c6dd", boss.walk, boss.hit > 0, true);
    ctx.restore();

    // 머리 위 떠있는 HP바
    const bw = r * 2.4, bh = 6 * sc + 2;
    const bxx = bx - bw / 2, byy = ey + info.topY - r * 0.5;
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

  function drawObstacles() {
    const sorted = obstacles.slice().sort(function (a, b) { return a.p - b.p; });  // 먼 것부터
    for (const o of sorted) {
      if (o.type === "trap") drawTrap(o);
      else drawSardine(o);
    }
  }

  // 원소 배지(원형 칩 + 기호)
  function drawElementBadge(x, y, r, el, danger) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = danger ? "rgba(180,45,55,0.95)" : "rgba(40,120,205,0.95)";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = danger ? "#ffc0c0" : "#bfe8ff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold " + (r * 1.05) + "px sans-serif";
    ctx.fillText(el.symbol, x, y + r * 0.36);
    ctx.textAlign = "start";
    ctx.restore();
  }

  // 함정: 빙판의 얼음 구덩이(짙은 얼음색) + 위험 원소 배지
  function drawTrap(o) {
    const sc = projScale(o.p);
    const y = projY(o.p);
    const cx = laneToX(o.p, o.lane);
    const rx = halfAt(o.p) * TRAP_HALF;   // 길의 약 절반 폭으로 제한
    const ry = rx * 0.42;

    ctx.save();
    // 얼음 구덩이(짙은 청록 → 옅은 얼음색, 깊이감)
    const g = ctx.createRadialGradient(cx, y - ry * 0.2, 1, cx, y, rx);
    g.addColorStop(0, "#0e3550");
    g.addColorStop(0.55, "#19567a");
    g.addColorStop(1, "#3f86ad");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // 물/얼음 반짝임(안쪽)
    ctx.fillStyle = "rgba(180,225,245,0.35)";
    ctx.beginPath(); ctx.ellipse(cx - rx * 0.25, y - ry * 0.25, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // 깨진 얼음 가장자리(밝은 테)
    ctx.strokeStyle = "rgba(225,245,255,0.9)";
    ctx.lineWidth = Math.max(1.5, 2.5 * sc);
    ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    // 갈라진 얼음 조각(가장자리 위)
    ctx.fillStyle = "rgba(230,247,255,0.95)";
    for (let k = -2; k <= 2; k++) {
      const px = cx + k * rx * 0.4;
      ctx.beginPath();
      ctx.moveTo(px - 3 * sc, y - ry); ctx.lineTo(px, y - ry - 5 * sc); ctx.lineTo(px + 3 * sc, y - ry);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 위험 원소 배지(구덩이 위에 떠 있음)
    const badgeY = y - ry - 20 * sc - 6;
    drawElementBadge(cx, badgeY, 14 * sc + 8, o.el, true);
    // 경고
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#ff8a8a"; ctx.textAlign = "center";
    ctx.font = "bold " + (9 * sc + 6) + "px sans-serif";
    ctx.fillText("⚠ 점프!", cx, badgeY - (14 * sc + 8) - 4);
    ctx.textAlign = "start"; ctx.restore();
  }

  // 정어리: 은빛 물고기 + 안전 원소 배지
  function drawSardine(o) {
    const sc = projScale(o.p);
    const x = laneToX(o.p, o.lane);
    const y = projY(o.p) - (6 + Math.sin(o.bob) * 2.5) * sc;
    const L = 8 * sc + 3;   // 작은 물고기

    // 바닥 그림자
    ctx.fillStyle = "rgba(40,80,120,0.18)";
    ctx.beginPath(); ctx.ellipse(x, projY(o.p), L * 0.8, 2.5 * sc + 1, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    // 꼬리
    ctx.fillStyle = "#7fa8c4";
    ctx.beginPath(); ctx.moveTo(L * 0.8, 0); ctx.lineTo(L * 1.35, -L * 0.45); ctx.lineTo(L * 1.35, L * 0.45); ctx.closePath(); ctx.fill();
    // 몸통(은빛)
    const fg = ctx.createLinearGradient(0, -L * 0.5, 0, L * 0.5);
    fg.addColorStop(0, "#e6f2fb"); fg.addColorStop(0.5, "#bcd6e8"); fg.addColorStop(1, "#86aac6");
    ctx.fillStyle = fg; ctx.strokeStyle = "rgba(40,70,100,0.5)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.ellipse(0, 0, L, L * 0.52, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 옆줄 + 지느러미
    ctx.strokeStyle = "rgba(90,140,180,0.6)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.moveTo(-L * 0.5, 0); ctx.lineTo(L * 0.6, 0); ctx.stroke();
    // 눈
    ctx.fillStyle = "#10202b"; ctx.beginPath(); ctx.arc(-L * 0.55, -L * 0.1, L * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 안전 원소 배지(물고기 위)
    drawElementBadge(x, y - L - 14 * sc - 4, 11 * sc + 7, o.el, false);
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

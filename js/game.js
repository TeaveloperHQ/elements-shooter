/*
 * game.js — 펭귄 남극 대원정 (Antarctic Adventure 스타일 러너 + 원소 학습)
 *
 * 펭귄이 빙판 길을 달린다. 얼음 구덩이는 점프로 넘고,
 * 원소 기호가 달린 깃발을 모은다.
 *   - 안전 원소 깃발(파랑): 주우면 점수 + 원소 학습
 *   - 위험 원소 깃발(빨강): 방사능·독성! 주우면 목숨을 잃는다 → 피해야 한다
 * 배경 디자인은 유지(오로라/태양/빙산/빙판/눈).
 */
(function () {
  "use strict";

  // ===================== 기본 =====================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const wrap = document.getElementById("game-wrap");
    W = wrap.clientWidth; H = wrap.clientHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildSnow(); buildBergs();
  }
  window.addEventListener("resize", resize);

  // ===================== 사운드 =====================
  let actx = null;
  function initAudio() { if (actx) return; try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  function beep(freq, dur, type, vol, freqEnd) {
    if (!actx) return;
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "square"; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
  }
  const SND = {
    jump: function () { beep(300, 0.13, "square", 0.04, 660); },
    flag: function () { beep(720, 0.10, "triangle", 0.05, 1080); },
    bad:  function () { beep(150, 0.25, "sawtooth", 0.08, 60); },
    fall: function () { beep(110, 0.28, "sawtooth", 0.09, 45); },
    coin: function () { beep(900, 0.07, "triangle", 0.04, 1200); },
    base: function () { beep(520, 0.10, "square", 0.05, 880); },
  };

  // ===================== 원근 좌표 =====================
  function horizonY() { return H * 0.30; }
  function playerLineY() { return H - 92; }
  function roadHalfTop() { return W * 0.05; }
  function roadHalfBot() { return W * 0.46; }
  function projY(p) { return horizonY() + (playerLineY() - horizonY()) * p; }
  function projScale(p) { return 0.28 + 1.0 * p; }
  function halfAt(p) { return roadHalfTop() + (roadHalfBot() - roadHalfTop()) * p; }
  // 트랙 "맵": 코스의 좌우 위치를 달린 거리(z)의 함수로 정의 → 설계된 커브가 다가온다
  const LOOKAHEAD = 1500;                 // 지평선이 앞으로 얼마나 멀리 보이는지(월드 단위)
  function trackOffset(z) {
    return 0.62 * Math.sin(z * 0.0012) + 0.38 * Math.sin(z * 0.00051 + 2.0);
  }
  // 깊이 p에서 길 중심의 화면 X. 가까운 쪽(p=1)은 카메라 기준 중앙, 먼 쪽은 코스만큼 휜다.
  function curveCenterX(p) {
    const d = distance || 0;
    const z = d + (1 - p) * LOOKAHEAD;
    let off = (trackOffset(z) - trackOffset(d)) * W * 0.34;
    off = Math.max(-W * 0.42, Math.min(W * 0.42, off));
    return W / 2 + off;
  }
  function laneToX(p, lane) { return curveCenterX(p) + lane * halfAt(p); }


  // ===================== 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, items, particles, texts;
  let score, distance, learned, runCoins;
  let spawnTimer, elapsed, speed, scrollY, shake, screenFlash;
  let curveT = 0;
  let decorTimer = 0;
  let lastStage = 0;        // 스테이지(약 4000거리마다 명물이 바뀜)
  let stored = [];          // 상단에 모은 정어리 통조림

  // 스테이지별 전세계 명물(얼음조각으로 등장)
  const STAGE_LEN = 4000;
  const LANDMARKS = [
    { key: "eiffel", name: "프랑스 에펠탑" },
    { key: "pyramid", name: "이집트 피라미드" },
    { key: "liberty", name: "미국 자유의 여신상" },
    { key: "pisa", name: "이탈리아 피사의 사탑" },
    { key: "windmill", name: "네덜란드 풍차" },
    { key: "moai", name: "이스터섬 모아이" },
    { key: "clock", name: "영국 빅벤" },
    { key: "taj", name: "인도 타지마할" },
  ];
  function stageLandmark() { return LANDMARKS[Math.floor(distance / STAGE_LEN) % LANDMARKS.length]; }
  let snow = [], bergs = [], scenery = [];

  // ===================== 메타(영구 저장) =====================
  const UPGRADE_MAX = 8;
  const UP_BASE = { life: 90, jump: 70, magnet: 80 };
  const META = {
    coins: 0, high: 0, dex: {}, up: { life: 0, jump: 0, magnet: 0 },
    load: function () {
      try {
        this.coins = +(localStorage.getItem("es_coins") || 0) || 0;
        this.high = +(localStorage.getItem("es_high") || 0) || 0;
        this.dex = JSON.parse(localStorage.getItem("es_dex") || "{}") || {};
        this.up.life = +(localStorage.getItem("es_up_life") || 0) || 0;
        this.up.jump = +(localStorage.getItem("es_up_jump") || 0) || 0;
        this.up.magnet = +(localStorage.getItem("es_up_magnet") || 0) || 0;
      } catch (e) {}
    },
    save: function () {
      try {
        localStorage.setItem("es_coins", this.coins);
        localStorage.setItem("es_high", this.high);
        localStorage.setItem("es_dex", JSON.stringify(this.dex));
        localStorage.setItem("es_up_life", this.up.life);
        localStorage.setItem("es_up_jump", this.up.jump);
        localStorage.setItem("es_up_magnet", this.up.magnet);
      } catch (e) {}
    },
  };
  function upgradeCost(kind) { return UP_BASE[kind] * (META.up[kind] + 1); }

  // ===================== 새 게임 =====================
  function newGame() {
    player = {
      x: W / 2, targetX: W / 2, y: 0,
      run: 0,                              // 달리기 위상
      jumpY: 0, vz: 0, onGround: true,
      jumpV: 540 + META.up.jump * 45,      // 점프력(업그레이드)
      lives: 3 + META.up.life,
      stun: 0,
    };
    items = []; particles = []; texts = []; scenery = []; stored = [];
    score = 0; distance = 0; learned = {}; runCoins = 0;
    spawnTimer = 0.8; elapsed = 0; speed = 150; scrollY = 0; shake = 0; screenFlash = 0; curveT = 0; decorTimer = 0.3; lastStage = 0;
    updateHUD();
  }

  // ===================== 입력 =====================
  let keyLeft = false, keyRight = false;
  function pointerMove(clientX) { const r = canvas.getBoundingClientRect(); player.targetX = clientX - r.left; }
  function jump() {
    if (state !== STATE.PLAY || !player.onGround) return;
    player.vz = player.jumpV; player.onGround = false; SND.jump();
  }
  canvas.addEventListener("mousemove", function (e) { if (state === STATE.PLAY) pointerMove(e.clientX); });
  canvas.addEventListener("mousedown", function () { jump(); });
  canvas.addEventListener("touchmove", function (e) {
    if (state === STATE.PLAY && e.touches[0]) { pointerMove(e.touches[0].clientX); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchstart", function (e) {
    if (state === STATE.PLAY && e.touches[0]) pointerMove(e.touches[0].clientX);
    jump();
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
    overScreen.classList.add("hidden"); startScreen.classList.remove("hidden");
  });

  function startGame() {
    initAudio(); if (actx && actx.state === "suspended") actx.resume();
    newGame(); state = STATE.PLAY;
    startScreen.classList.add("hidden"); overScreen.classList.add("hidden");
  }
  function gameOver() {
    state = STATE.OVER;
    const dist = Math.floor(distance / 10);
    const finalScore = Math.floor(score);
    document.getElementById("final-score").textContent = finalScore;

    META.coins += runCoins;
    for (const sym in learned) META.dex[sym] = true;
    const rec = finalScore > META.high;
    if (rec) META.high = finalScore;
    META.save();

    document.getElementById("run-coins").innerHTML =
      "🏁 거리 <b>" + dist + "m</b>　🪙 코인 <b>+" + runCoins + "</b>" + (rec ? "　🏆 <b>신기록!</b>" : "");
    const names = Object.keys(learned);
    document.getElementById("elements-learned").innerHTML =
      names.length ? "오늘 만난 원소: <b>" + names.join(", ") + "</b>" : "이번엔 원소를 만나지 못했어요!";
    refreshMetaUI();
    overScreen.classList.remove("hidden");
  }

  // ===================== HUD / 토스트 =====================
  function updateHUD() {
    document.getElementById("hud-lives").textContent = player.lives;
    document.getElementById("hud-dist").textContent = Math.floor(distance / 10);
    document.getElementById("hud-elem").textContent = Object.keys(learned).length;
    document.getElementById("hud-score").textContent = Math.floor(score);
  }
  let toastTimer = null;
  function showToast(text, danger) {
    const t = document.getElementById("toast");
    t.textContent = text; t.classList.toggle("trap", !!danger); t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  // ===================== 스폰 =====================
  // 크레바스: 매번 다른 들쭉날쭉한 외곽선
  function makeJagged() {
    const n = 14 + ((Math.random() * 6) | 0);
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(0.58 + Math.random() * 0.55);
    return arr;
  }
  function spawnObstacle() {
    const r = Math.random();
    if (r < 0.35) {
      // 얼음 크레바스 — 크기 1/3 ~ 2/3, 랜덤 갈라진 모양
      const lane = (-1 + ((Math.random() * 3) | 0)) * 0.4;   // -0.4 / 0 / 0.4
      const w = (1 / 3) + Math.random() * (1 / 3);
      items.push({ type: "hole", lane: lane, p: 0, vp: 0.10, done: false, w: w, shape: makeJagged() });
    } else if (r < 0.86) {
      // 정어리 통조림 (겉면에 원소 기호)
      const el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      items.push({ type: "can", el: el, lane: -0.75 + Math.random() * 1.5,
        p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    } else {
      // 통조림 따개 — 가능하면 모아둔 통조림과 일치하는 원소로(매칭 유도)
      let el;
      if (stored.length && Math.random() < 0.72) {
        const c = stored[(Math.random() * stored.length) | 0];
        el = BUFF_ELEMENTS.find(function (e) { return e.symbol === c.symbol; }) || BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      } else {
        el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      }
      items.push({ type: "opener", el: el, lane: -0.7 + Math.random() * 1.4,
        p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    }
  }

  // 길가 풍경(장식, 충돌 없음) — 명물 얼음조각 + 소품
  function spawnScenery() {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.22) {
      // 이번 스테이지의 전세계 명물(크게, 멀리)
      const lm = stageLandmark();
      scenery.push({ type: "landmark", key: lm.key, lane: side * (1.75 + Math.random() * 0.7),
        p: 0, vp: 0.10, flip: side < 0 });
    } else {
      const types = ["igloo", "mound", "spikes", "penguin", "mound", "spikes", "sign"];
      const type = types[(Math.random() * types.length) | 0];
      scenery.push({ type: type, lane: side * (1.25 + Math.random() * 0.7),
        p: 0, vp: 0.10, flip: side < 0 });
    }
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;
    speed = 150 + elapsed * 3.2;                  // 점점 빨라짐
    distance += speed * dt;
    scrollY = (scrollY + speed * dt * 0.6) % 80;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);
    if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - dt);
    if (player.stun > 0) player.stun -= dt;

    // 이동(스턴 중엔 둔해짐)
    const mv = (player.stun > 0 ? 300 : 560);
    if (keyLeft) player.targetX -= mv * dt;
    if (keyRight) player.targetX += mv * dt;
    player.targetX = Math.max(28, Math.min(W - 28, player.targetX));
    player.x += (player.targetX - player.x) * Math.min(1, dt * 14);
    player.y = playerLineY();
    player.run += dt * (5 + speed * 0.02);

    // 점프 물리
    if (!player.onGround) {
      player.jumpY += player.vz * dt;
      player.vz -= 1700 * dt;
      if (player.jumpY <= 0) { player.jumpY = 0; player.vz = 0; player.onGround = true; }
    }

    // 스폰(속도에 비례해 잦아짐)
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = Math.max(0.6, 1.5 - elapsed * 0.012); spawnObstacle(); }

    // 스테이지 전환 알림
    const st = Math.floor(distance / STAGE_LEN);
    if (st !== lastStage) {
      lastStage = st;
      showToast("🗺 스테이지 " + (st + 1) + " — " + stageLandmark().name + " 얼음조각 지대 ❄", false);
      SND.base();
    }

    // 길가 풍경 스폰/이동
    decorTimer -= dt;
    if (decorTimer <= 0) { decorTimer = 0.4 + Math.random() * 0.4; spawnScenery(); }
    for (let i = scenery.length - 1; i >= 0; i--) {
      const d = scenery[i];
      d.p += d.vp * (0.5 + d.p * 1.0) * dt;
      if (d.p > 1.18) scenery.splice(i, 1);
    }

    // 점수 = 거리
    score = distance / 8;

    updateItems(dt);
    updateParticles(dt);
    updateTexts(dt);
    updateSnow(dt);
    updateHUD();
  }

  function updateItems(dt) {
    const AIR = 16;
    for (let i = items.length - 1; i >= 0; i--) {
      const o = items[i];
      o.p += o.vp * (0.5 + o.p * 1.0) * dt;
      if (o.type === "can" || o.type === "opener") o.wave += dt * 5;

      // 자석: 통조림/따개를 끌어당김
      if ((o.type === "can" || o.type === "opener") && META.up.magnet > 0 && o.p > 0.6 && player.onGround) {
        const ox = laneToX(o.p, o.lane);
        const range = 30 + META.up.magnet * 16;
        if (Math.abs(player.x - ox) < range) {
          o.lane += (((player.x - curveCenterX(o.p)) / halfAt(o.p)) - o.lane) * Math.min(1, dt * 4);
        }
      }

      if (!o.done && o.p >= 1) {
        o.done = true;
        const ox = laneToX(1, o.lane);
        if (o.type === "hole") hitHole(o, ox, AIR);
        else if (o.type === "can") collectCan(o, ox, AIR);
        else eatOpener(o, ox, AIR);
      }
      if (o.p > 1.1) items.splice(i, 1);
    }
  }

  function hitHole(o, ox, AIR) {
    const holeHalf = halfAt(1) * o.w;
    if (player.jumpY > AIR) {
      // 점프로 넘음
      score += 5; runCoins += 1;
      spawnText(player.x, playerLineY() - player.jumpY - 36, "점프!", "#aef0c0", 18);
      spawnParticles(ox, playerLineY(), "#bfe6ff", 6, 130);
    } else if (Math.abs(player.x - ox) < holeHalf + 8) {
      // 구덩이에 빠짐
      loseLife("구덩이에 빠졌다!");
      spawnParticles(ox, playerLineY(), "#9ab8d0", 16, 220);
    }
    // 옆으로 비켜서 있으면 무사
  }

  // 정어리 통조림: 주우면 상단 보관함에 쌓인다
  function collectCan(o, ox, AIR) {
    const el = o.el;
    const catchR = 36 + META.up.magnet * 8;
    if (player.jumpY <= AIR && Math.abs(player.x - ox) < catchR) {
      learned[el.symbol] = true;
      stored.push({ symbol: el.symbol, name: el.name, color: el.color });
      score += 30; runCoins += 1;
      spawnParticles(ox, playerLineY() - 20, el.color, 10, 150);
      spawnText(player.x, playerLineY() - 56, "🥫 " + el.symbol, "#cfe6ff", 18);
      SND.flag();
      showToast(el.symbol + " " + el.name + " 통조림 획득! (위에 모임)", false);
      updateHUD();
    }
  }

  // 상단 보관함에서 i번째 통조림의 화면 X
  function storedSlotX(i) {
    const n = Math.max(1, Math.min(stored.length, 9));
    const cw = 24, gap = 5, totalW = n * (cw + gap) - gap;
    const sx = W / 2 - totalW / 2;
    return sx + Math.min(i, n - 1) * (cw + gap) + cw / 2;
  }

  // 통조림 따개: 따개와 "같은 원소" 통조림이 있어야 그 통조림이 열린다.
  function eatOpener(o, ox, AIR) {
    const catchR = 34 + META.up.magnet * 6;
    if (player.jumpY > AIR || Math.abs(player.x - ox) >= catchR) return;
    learned[o.el.symbol] = true;

    if (stored.length === 0) {
      spawnText(player.x, playerLineY() - 56, "통조림이 없어요!", "#ffcf9a", 16);
      SND.bad();
      showToast("따개만 먹으면 의미 없어요 — 먼저 정어리 통조림을 모으세요!", true);
      return;
    }
    const idx = stored.findIndex(function (c) { return c.symbol === o.el.symbol; });
    if (idx === -1) {
      spawnText(player.x, playerLineY() - 56, o.el.symbol + " 통조림 없음!", "#ffcf9a", 16);
      SND.bad();
      showToast("⚠ " + o.el.symbol + " " + o.el.name + " 따개 — 일치하는 통조림이 위에 없어요!", true);
      return;
    }
    // 일치 → 그 통조림만 개봉
    const slotX = storedSlotX(idx);
    const c = stored.splice(idx, 1)[0];
    score += 200; runCoins += 2;
    spawnText(slotX, 64, "🐟", "#bcd6e8", 22);
    spawnParticles(slotX, 64, "#cfe6f5", 12, 190);
    spawnText(player.x, playerLineY() - 62, "🐟 " + c.symbol + " 개봉! +200", "#ffe678", 22);
    shake = Math.min(12, shake + 6);
    SND.base();
    showToast("🥫 " + c.symbol + " " + c.name + " — 따개와 일치! 정어리 +200", false);
    updateHUD();
  }

  function loseLife(msg) {
    if (player.stun > 0) return;          // 무적 중이면 무시
    player.lives--;
    player.stun = 0.9;
    screenFlash = 0.4; shake = Math.min(18, shake + 12);
    spawnText(player.x, playerLineY() - 50, "-1 ❤", "#ff6b6b", 24);
    SND.fall();
    if (msg) showToast(msg, true);
    updateHUD();
    if (player.lives <= 0) gameOver();
  }

  // ===================== 파티클 / 텍스트 / 눈 =====================
  function spawnParticles(x, y, color, n, spd) {
    spd = spd || 160;
    for (let i = 0; i < n; i++) particles.push({
      x: x, y: y, vx: (Math.random() - 0.5) * spd, vy: (Math.random() - 0.5) * spd - 30,
      life: 0.4 + Math.random() * 0.35, max: 0.75, color: color, r: 1.5 + Math.random() * 2,
    });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function spawnText(x, y, str, color, size) { texts.push({ x: x, y: y, str: str, color: color || "#fff", size: size || 18, life: 1.0, vy: -46 }); }
  function updateTexts(dt) {
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]; t.y += t.vy * dt; t.vy += 40 * dt; t.life -= dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }
  function buildSnow() {
    snow = [];
    const n = Math.round((W * H) / 9000);
    for (let i = 0; i < n; i++) snow.push({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2.2,
      vy: 14 + Math.random() * 26, vx: -8 + Math.random() * 16, a: 0.3 + Math.random() * 0.5 });
  }
  function updateSnow(dt) {
    for (const s of snow) {
      s.y += s.vy * dt; s.x += s.vx * dt + Math.sin((s.y + s.x) * 0.02) * 6 * dt;
      if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
      if (s.x < -4) s.x = W + 4; else if (s.x > W + 4) s.x = -4;
    }
  }
  function buildBergs() {
    bergs = []; let x = -20;
    while (x < W + 40) { const w = 40 + Math.random() * 70; bergs.push({ x: x, w: w, h: 24 + Math.random() * 46 }); x += w * (0.7 + Math.random() * 0.5); }
  }

  // ===================== 렌더 =====================
  function render() {
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground();
    if (state === STATE.PLAY || state === STATE.OVER) {
      drawScenery();
      drawItems();
      drawParticles();
      drawPlayer();
      drawTexts();
    }
    drawSnow();
    ctx.restore();
    drawOverlayFx();
  }

  function drawOverlayFx() {
    if (screenFlash > 0) { ctx.fillStyle = "rgba(255,40,40," + (screenFlash * 0.45) + ")"; ctx.fillRect(0, 0, W, H); }
    if (state === STATE.PLAY || state === STATE.OVER) drawStored();
    if (state === STATE.PLAY && player.lives <= 1) {
      const pulse = 0.18 + (Math.sin(elapsed * 6) * 0.5 + 0.5) * 0.16;
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
      vg.addColorStop(0, "rgba(255,0,0,0)"); vg.addColorStop(1, "rgba(255,0,0," + pulse + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, "#0a2a4a"); sky.addColorStop(0.28, "#16456e");
    sky.addColorStop(0.45, "#2d7fa8"); sky.addColorStop(0.55, "#bfe8f2"); sky.addColorStop(1.0, "#eaf6ff");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const hy = horizonY();

    // 오로라
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const yy = hy * (0.35 + i * 0.18);
      const grad = ctx.createLinearGradient(0, yy - 30, 0, yy + 30);
      const col = i % 2 ? "rgba(120,255,200," : "rgba(140,200,255,";
      grad.addColorStop(0, col + "0)"); grad.addColorStop(0.5, col + "0.18)"); grad.addColorStop(1, col + "0)");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x, yy + Math.sin(x * 0.03 + i * 2 + elapsed * 0.5) * 14);
      ctx.lineTo(W, yy + 60); ctx.lineTo(0, yy + 60); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 태양
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const sg = ctx.createRadialGradient(W * 0.74, hy * 0.6, 4, W * 0.74, hy * 0.6, 60);
    sg.addColorStop(0, "rgba(255,255,255,0.95)"); sg.addColorStop(0.4, "rgba(200,235,255,0.5)"); sg.addColorStop(1, "rgba(200,235,255,0)");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(W * 0.74, hy * 0.6, 60, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    // 빙산
    ctx.fillStyle = "rgba(180, 215, 235, 0.85)";
    for (const b of bergs) { ctx.beginPath(); ctx.moveTo(b.x, hy); ctx.lineTo(b.x + b.w * 0.5, hy - b.h); ctx.lineTo(b.x + b.w, hy); ctx.closePath(); ctx.fill(); }

    // 빙판 길(굽이치는 트랙) — 슬라이스로 그린다
    const pBottom = (H - hy) / (playerLineY() - hy);   // 화면 맨 아래까지의 깊이
    const N = 28;
    // 길 바깥 빙원
    ctx.fillStyle = "#eaf6ff";
    ctx.fillRect(0, hy, W, H - hy);
    // 곡선 길 슬라이스
    ctx.fillStyle = "#dff1ff";
    for (let i = 0; i < N; i++) {
      const p0 = (i / N) * pBottom, p1 = ((i + 1) / N) * pBottom;
      const y0 = projY(p0), y1 = projY(p1);
      const c0 = curveCenterX(p0), c1 = curveCenterX(p1);
      const h0 = halfAt(p0), h1 = halfAt(p1);
      ctx.beginPath();
      ctx.moveTo(c0 - h0, y0); ctx.lineTo(c0 + h0, y0);
      ctx.lineTo(c1 + h1, y1); ctx.lineTo(c1 - h1, y1);
      ctx.closePath(); ctx.fill();
    }
    // 가장자리 라인
    ctx.strokeStyle = "rgba(90, 150, 200, 0.5)"; ctx.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const sgn = s === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p), y = projY(p);
        if (i === 0) ctx.moveTo(c + sgn * h, y); else ctx.lineTo(c + sgn * h, y);
      }
      ctx.stroke();
    }
    // 가로 줄무늬(스크롤)
    ctx.strokeStyle = "rgba(120, 170, 210, 0.22)"; ctx.lineWidth = 1.5;
    for (let k = 0; k < 16; k++) {
      const u = ((k / 16) + (scrollY / 80) / 16) % 1;
      const p = u * pBottom, y = projY(p), c = curveCenterX(p), h = halfAt(p);
      ctx.globalAlpha = Math.min(1, u * 2);
      ctx.beginPath(); ctx.moveTo(c - h, y); ctx.lineTo(c + h, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 중앙 점선(곡선 따라)
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const u0 = ((k / 12) + (scrollY / 80) / 12) % 1, u1 = Math.min(1, u0 + 0.035);
      const p0 = u0 * pBottom, p1 = u1 * pBottom;
      ctx.globalAlpha = Math.min(1, u0 * 2);
      ctx.beginPath(); ctx.moveTo(curveCenterX(p0), projY(p0)); ctx.lineTo(curveCenterX(p1), projY(p1)); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const vgr = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    vgr.addColorStop(0, "rgba(0,10,25,0.35)"); vgr.addColorStop(1, "rgba(0,10,25,0)");
    ctx.fillStyle = vgr; ctx.fillRect(0, 0, W, H * 0.25);
  }

  function drawSnow() {
    ctx.fillStyle = "#ffffff";
    for (const s of snow) { ctx.globalAlpha = s.a; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // ---------- 길가 남극 풍경 ----------
  function drawScenery() {
    const sorted = scenery.slice().sort(function (a, b) { return a.p - b.p; });
    for (const d of sorted) {
      const base = projScale(d.p);
      const x = laneToX(d.p, d.lane);
      const y = projY(d.p);
      if (d.type === "landmark") {
        ctx.fillStyle = "rgba(40,80,120,0.16)";
        ctx.beginPath(); ctx.ellipse(x, y, 24 * base, 5 * base, 0, 0, Math.PI * 2); ctx.fill();
        drawLandmark(d.key, x, y, base * 2.7, d.flip);
        continue;
      }
      const sc = base * 1.15;
      ctx.fillStyle = "rgba(40,80,120,0.16)";
      ctx.beginPath(); ctx.ellipse(x, y, 16 * sc, 4 * sc, 0, 0, Math.PI * 2); ctx.fill();
      if (d.type === "igloo") drawIgloo(x, y, sc);
      else if (d.type === "mound") drawMound(x, y, sc);
      else if (d.type === "spikes") drawSpikes(x, y, sc);
      else if (d.type === "sign") drawSign(x, y, sc);
      else drawSitPenguin(x, y, sc, d.flip);
    }
  }

  // ---------- 전세계 명물 얼음조각 ----------
  function iceGrad(yTop) {
    const g = ctx.createLinearGradient(0, yTop, 0, 0);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.55, "#dcebf6"); g.addColorStop(1, "#a6c6dd");
    return g;
  }
  function drawLandmark(key, x, y, s, flip) {
    const u = 8 * s;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(120,160,195,0.6)";
    ctx.lineWidth = Math.max(1, s);
    if (key === "eiffel") lmEiffel(u);
    else if (key === "pyramid") lmPyramid(u);
    else if (key === "liberty") lmLiberty(u);
    else if (key === "pisa") lmPisa(u);
    else if (key === "windmill") lmWindmill(u);
    else if (key === "moai") lmMoai(u);
    else if (key === "clock") lmClock(u);
    else lmTaj(u);
    // 눈 반짝임
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(-u * 0.3, -u * 5.6, u * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function lmEiffel(u) {
    ctx.fillStyle = iceGrad(-u * 7);
    ctx.beginPath();
    ctx.moveTo(-2 * u, 0); ctx.lineTo(-0.9 * u, -2.4 * u); ctx.lineTo(-0.35 * u, -4.8 * u); ctx.lineTo(-0.12 * u, -7 * u);
    ctx.lineTo(0.12 * u, -7 * u); ctx.lineTo(0.35 * u, -4.8 * u); ctx.lineTo(0.9 * u, -2.4 * u); ctx.lineTo(2 * u, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(-1.4 * u, -2.5 * u, 2.8 * u, 0.35 * u);
    ctx.fillRect(-0.8 * u, -4.9 * u, 1.6 * u, 0.3 * u);
    // 아치
    ctx.fillStyle = "rgba(70,110,150,0.35)";
    ctx.beginPath(); ctx.moveTo(-1.1 * u, 0); ctx.quadraticCurveTo(0, -1.8 * u, 1.1 * u, 0); ctx.closePath(); ctx.fill();
  }
  function lmPyramid(u) {
    ctx.fillStyle = iceGrad(-u * 5.5);
    ctx.beginPath(); ctx.moveTo(-3.2 * u, 0); ctx.lineTo(0, -5.5 * u); ctx.lineTo(3.2 * u, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 블록 라인
    ctx.strokeStyle = "rgba(120,160,195,0.4)";
    ctx.beginPath();
    for (let k = 1; k < 5; k++) { const yy = -k * u; const hw = 3.2 * u * (1 - k / 5.5); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); }
    ctx.stroke();
    // 작은 피라미드
    ctx.fillStyle = iceGrad(-u * 3);
    ctx.beginPath(); ctx.moveTo(2.4 * u, 0); ctx.lineTo(3.6 * u, -3 * u); ctx.lineTo(4.8 * u, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function lmLiberty(u) {
    ctx.fillStyle = iceGrad(-u * 7.5);
    ctx.fillRect(-1.6 * u, -2 * u, 3.2 * u, 2 * u); ctx.strokeRect(-1.6 * u, -2 * u, 3.2 * u, 2 * u);   // 받침
    ctx.beginPath(); ctx.moveTo(-1.3 * u, -2 * u); ctx.lineTo(-0.6 * u, -5.4 * u); ctx.lineTo(0.6 * u, -5.4 * u); ctx.lineTo(1.3 * u, -2 * u); ctx.closePath(); ctx.fill(); ctx.stroke();  // 로브
    ctx.beginPath(); ctx.arc(0, -6 * u, 0.62 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();  // 머리
    // 왕관 가시
    ctx.fillStyle = iceGrad(-u * 7.5);
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 0.28 * u - 0.1 * u, -6.5 * u); ctx.lineTo(k * 0.28 * u, -7.2 * u); ctx.lineTo(k * 0.28 * u + 0.1 * u, -6.5 * u); ctx.closePath(); ctx.fill(); }
    // 든 팔 + 횃불
    ctx.lineWidth = Math.max(1.5, 1.2 * u); ctx.strokeStyle = "#dcebf6"; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0.5 * u, -5 * u); ctx.lineTo(1.2 * u, -7.2 * u); ctx.stroke();
    ctx.fillStyle = "#ffe6a0"; ctx.beginPath(); ctx.arc(1.25 * u, -7.6 * u, 0.4 * u, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(120,160,195,0.6)"; ctx.lineWidth = Math.max(1, u * 0.12);
  }
  function lmPisa(u) {
    ctx.save(); ctx.rotate(-0.13);
    ctx.fillStyle = iceGrad(-u * 6);
    ctx.fillRect(-1.1 * u, -6 * u, 2.2 * u, 6 * u); ctx.strokeRect(-1.1 * u, -6 * u, 2.2 * u, 6 * u);
    ctx.strokeStyle = "rgba(120,160,195,0.4)";
    for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(-1.1 * u, -k * u); ctx.lineTo(1.1 * u, -k * u); ctx.stroke(); }
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(-1.0 * u, -6.6 * u, 2.0 * u, 0.6 * u);
    ctx.restore();
  }
  function lmWindmill(u) {
    ctx.fillStyle = iceGrad(-u * 5);
    ctx.beginPath(); ctx.moveTo(-1.7 * u, 0); ctx.lineTo(-1.1 * u, -5 * u); ctx.lineTo(1.1 * u, -5 * u); ctx.lineTo(1.7 * u, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = iceGrad(-u * 6.2);
    ctx.beginPath(); ctx.moveTo(-1.2 * u, -5 * u); ctx.lineTo(0, -6.2 * u); ctx.lineTo(1.2 * u, -5 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 날개(회전)
    ctx.save(); ctx.translate(0, -5 * u); ctx.rotate(elapsed * 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.strokeStyle = "rgba(120,160,195,0.6)";
    for (let b = 0; b < 4; b++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.5 * u, -0.4 * u); ctx.lineTo(0.4 * u, -3.2 * u); ctx.lineTo(-0.2 * u, -3 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "#7fa8c4"; ctx.beginPath(); ctx.arc(0, -5 * u, 0.4 * u, 0, Math.PI * 2); ctx.fill();
  }
  function lmMoai(u) {
    ctx.fillStyle = iceGrad(-u * 6);
    ctx.beginPath();
    ctx.moveTo(-1.5 * u, 0); ctx.lineTo(-1.7 * u, -3.5 * u); ctx.quadraticCurveTo(-1.7 * u, -6 * u, 0, -6 * u);
    ctx.quadraticCurveTo(1.7 * u, -6 * u, 1.7 * u, -3.5 * u); ctx.lineTo(1.5 * u, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 눈썹/코
    ctx.fillStyle = "rgba(80,120,160,0.35)";
    ctx.fillRect(-1.2 * u, -4.4 * u, 2.4 * u, 0.5 * u);
    ctx.beginPath(); ctx.moveTo(-0.3 * u, -4 * u); ctx.lineTo(0.3 * u, -4 * u); ctx.lineTo(0, -2.2 * u); ctx.closePath(); ctx.fill();
    ctx.fillRect(-0.9 * u, -1.5 * u, 1.8 * u, 0.4 * u);
  }
  function lmClock(u) {
    ctx.fillStyle = iceGrad(-u * 6.5);
    ctx.fillRect(-1.3 * u, -6.5 * u, 2.6 * u, 6.5 * u); ctx.strokeRect(-1.3 * u, -6.5 * u, 2.6 * u, 6.5 * u);
    ctx.fillStyle = iceGrad(-u * 8);
    ctx.beginPath(); ctx.moveTo(-1.3 * u, -6.5 * u); ctx.lineTo(0, -8 * u); ctx.lineTo(1.3 * u, -6.5 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 시계
    ctx.fillStyle = "#eef6ff"; ctx.beginPath(); ctx.arc(0, -5.2 * u, 0.95 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#5f7e98"; ctx.lineWidth = Math.max(1, u * 0.16); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0, -5.9 * u); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0.5 * u, -5 * u); ctx.stroke();
    ctx.strokeStyle = "rgba(120,160,195,0.6)"; ctx.lineWidth = Math.max(1, u * 0.12);
  }
  function lmTaj(u) {
    ctx.fillStyle = iceGrad(-u * 6);
    ctx.fillRect(-2.2 * u, -2.2 * u, 4.4 * u, 2.2 * u); ctx.strokeRect(-2.2 * u, -2.2 * u, 4.4 * u, 2.2 * u);   // 기단
    // 중앙 양파돔
    ctx.beginPath();
    ctx.moveTo(-1.3 * u, -2.2 * u); ctx.quadraticCurveTo(-1.6 * u, -4.4 * u, 0, -5.2 * u);
    ctx.quadraticCurveTo(1.6 * u, -4.4 * u, 1.3 * u, -2.2 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#dcebf6"; ctx.beginPath(); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0, -6 * u); ctx.stroke();
    // 미나렛 4개
    ctx.fillStyle = iceGrad(-u * 5);
    for (const mx of [-2.6, -2.0, 2.0, 2.6]) { ctx.fillRect(mx * u - 0.2 * u, -5 * u, 0.4 * u, 5 * u); ctx.strokeRect(mx * u - 0.2 * u, -5 * u, 0.4 * u, 5 * u); }
  }
  function drawIgloo(x, y, s) {
    const r = 17 * s;
    ctx.fillStyle = "#f2f8ff"; ctx.strokeStyle = "rgba(120,160,200,0.55)"; ctx.lineWidth = Math.max(1, s);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.92, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 블록 라인
    ctx.beginPath();
    for (let a = 1; a < 4; a++) { const yy = y - (a / 4) * r * 0.9; const hw = Math.sqrt(Math.max(0, 1 - Math.pow((y - yy) / (r * 0.92), 2))) * r; ctx.moveTo(x - hw, yy); ctx.lineTo(x + hw, yy); }
    ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.9);
    ctx.stroke();
    // 입구
    ctx.fillStyle = "#2a4a66";
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.42, r * 0.5, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  }
  function drawMound(x, y, s) {
    const r = 15 * s;
    const g = ctx.createLinearGradient(0, y - r, 0, y);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#dbe9f5");
    ctx.fillStyle = g; ctx.strokeStyle = "rgba(150,185,215,0.5)"; ctx.lineWidth = Math.max(1, s);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function drawSpikes(x, y, s) {
    const r = 14 * s;
    for (let k = -1; k <= 1; k++) {
      const px = x + k * r * 0.55, h = r * (k === 0 ? 1.5 : 1.0);
      const g = ctx.createLinearGradient(px, y - h, px, y);
      g.addColorStop(0, "#dff0ff"); g.addColorStop(1, "#7fb0d4");
      ctx.fillStyle = g; ctx.strokeStyle = "rgba(80,130,175,0.5)"; ctx.lineWidth = Math.max(1, s);
      ctx.beginPath(); ctx.moveTo(px - r * 0.32, y); ctx.lineTo(px, y - h); ctx.lineTo(px + r * 0.32, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  function drawSign(x, y, s) {
    const poleH = 30 * s;
    ctx.strokeStyle = "#9a6b3a"; ctx.lineWidth = Math.max(1.5, 2.5 * s); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - poleH); ctx.stroke();
    ctx.fillStyle = "#e8c349"; ctx.strokeStyle = "rgba(120,90,30,0.6)"; ctx.lineWidth = Math.max(1, s);
    const w = 22 * s, h = 13 * s;
    ctx.fillRect(x - w / 2, y - poleH - h, w, h); ctx.strokeRect(x - w / 2, y - poleH - h, w, h);
    ctx.fillStyle = "#5a3d12"; ctx.textAlign = "center"; ctx.font = "bold " + (8 * s + 3) + "px sans-serif";
    ctx.fillText("S", x, y - poleH - h * 0.32); ctx.textAlign = "start";
  }
  function drawSitPenguin(x, y, s, flip) {
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
    ctx.fillStyle = "#1b2733";
    ctx.beginPath(); ctx.ellipse(0, -8, 8, 11, 0, 0, Math.PI * 2); ctx.fill();   // 몸
    ctx.fillStyle = "#f4fbff";
    ctx.beginPath(); ctx.ellipse(1, -6, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();  // 배
    ctx.fillStyle = "#1b2733"; ctx.beginPath(); ctx.arc(2, -16, 5, 0, Math.PI * 2); ctx.fill();  // 머리
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(4, -17, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#10171f"; ctx.beginPath(); ctx.arc(4.4, -17, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5a623"; ctx.beginPath(); ctx.moveTo(6, -16); ctx.lineTo(9, -15); ctx.lineTo(6, -14); ctx.closePath(); ctx.fill();  // 부리
    ctx.fillStyle = "#f5a623"; ctx.beginPath(); ctx.ellipse(0, 3, 4, 1.8, 0, 0, Math.PI * 2); ctx.fill();  // 발
    ctx.restore();
  }

  // ---------- 아이템(구덩이/깃발) ----------
  function drawItems() {
    const sorted = items.slice().sort(function (a, b) { return a.p - b.p; });
    for (const o of sorted) {
      if (o.type === "hole") drawHole(o);
      else if (o.type === "can") drawCan(o);
      else drawOpener(o);
    }
  }

  function drawHole(o) {
    const sc = projScale(o.p), y = projY(o.p);
    const cx = laneToX(o.p, o.lane);
    const rx = halfAt(o.p) * o.w, ry = rx * 0.22;   // 넓고 납작
    const shp = o.shape, n = shp.length;
    function outline() {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i % n) / n * Math.PI * 2, rr = shp[i % n];
        const px = cx + Math.cos(a) * rx * rr, py = y + Math.sin(a) * ry * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.save();
    const g = ctx.createRadialGradient(cx, y - ry * 0.2, 1, cx, y, rx);
    g.addColorStop(0, "#0e3550"); g.addColorStop(0.55, "#19567a"); g.addColorStop(1, "#3f86ad");
    ctx.fillStyle = g; outline(); ctx.fill();
    ctx.fillStyle = "rgba(180,225,245,0.3)"; ctx.beginPath(); ctx.ellipse(cx - rx * 0.3, y - ry * 0.3, rx * 0.3, ry * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(225,245,255,0.9)"; ctx.lineWidth = Math.max(1.5, 2.2 * sc); ctx.lineJoin = "round";
    outline(); ctx.stroke();
    ctx.restore();
    // 점프 안내
    ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = "#cfe6ff"; ctx.textAlign = "center";
    ctx.font = "bold " + (9 * sc + 6) + "px sans-serif"; ctx.fillText("⬆ 점프", cx, y - ry - 8 * sc);
    ctx.textAlign = "start"; ctx.restore();
  }

  // 줍기 표적 마커: 펭귄과 정렬되면 초록으로 빛난다(정확히 먹는지 보이게)
  function drawCatchMarker(x, gy, sc, o) {
    if (o.p < 0.45 || !player) return;
    const cr = 36 + META.up.magnet * 8;
    const aligned = player.onGround && Math.abs(player.x - x) < cr;
    ctx.fillStyle = aligned ? "rgba(120,240,150,0.32)" : "rgba(150,190,220,0.16)";
    ctx.beginPath(); ctx.ellipse(x, gy, 10 * sc, 3.2 * sc, 0, 0, Math.PI * 2); ctx.fill();
    if (aligned) {
      ctx.strokeStyle = "rgba(150,255,180,0.95)"; ctx.lineWidth = Math.max(1.5, 2 * sc);
      ctx.beginPath(); ctx.ellipse(x, gy, 12.5 * sc, 4 * sc, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 정어리 통조림(원소 기호)
  function drawCan(o) {
    const sc = projScale(o.p);
    const x = laneToX(o.p, o.lane), gy = projY(o.p);
    drawCatchMarker(x, gy, sc, o);
    const cw = 24 * sc, ch = 17 * sc;
    const top = gy - ch - (3 + Math.sin(o.wave) * 2) * sc;
    ctx.fillStyle = "rgba(40,80,120,0.18)"; ctx.beginPath(); ctx.ellipse(x, gy, cw * 0.5, 2.5 * sc, 0, 0, Math.PI * 2); ctx.fill();
    // 몸통(은색)
    const g = ctx.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
    g.addColorStop(0, "#8fa3b5"); g.addColorStop(0.5, "#f0f6fb"); g.addColorStop(1, "#8fa3b5");
    ctx.fillStyle = g; ctx.fillRect(x - cw / 2, top, cw, ch);
    // 라벨 밴드 + 원소 기호
    ctx.fillStyle = "#2f8fe0"; ctx.fillRect(x - cw / 2, top + ch * 0.26, cw, ch * 0.5);
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.font = "bold " + (ch * 0.42) + "px sans-serif";
    ctx.fillText(o.el.symbol, x, top + ch * 0.62);
    // 뚜껑(타원) + 림
    ctx.fillStyle = "#e3edf5"; ctx.strokeStyle = "rgba(90,120,150,0.5)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.ellipse(x, top, cw / 2, 3 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, top + ch, cw / 2, 3 * sc, 0, 0, Math.PI); ctx.stroke();
    ctx.textAlign = "start";
  }

  // 통조림 따개(돌려 따는 도구 모양 + 원소 이름 한글 태그)
  function drawOpener(o) {
    const sc = projScale(o.p);
    const x = laneToX(o.p, o.lane), gy = projY(o.p);
    drawCatchMarker(x, gy, sc, o);
    const bob = Math.sin(o.wave) * 2 * sc;
    const hy = gy - 16 * sc + bob;     // 도구 본체 중심

    // 그림자
    ctx.fillStyle = "rgba(40,80,120,0.18)"; ctx.beginPath(); ctx.ellipse(x, gy, 14 * sc, 3 * sc, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, hy);
    // 빨간 손잡이(두 다리)
    ctx.fillStyle = "#d8444f"; ctx.strokeStyle = "rgba(120,30,40,0.5)"; ctx.lineWidth = Math.max(1, sc);
    ctx.fillRect(-7 * sc, 3 * sc, 5 * sc, 15 * sc); ctx.strokeRect(-7 * sc, 3 * sc, 5 * sc, 15 * sc);
    ctx.fillRect(2 * sc, 3 * sc, 5 * sc, 15 * sc); ctx.strokeRect(2 * sc, 3 * sc, 5 * sc, 15 * sc);
    // 금속 헤드(타원)
    ctx.fillStyle = "#e1e8ef"; ctx.strokeStyle = "rgba(90,120,150,0.6)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.ellipse(0, 0, 13 * sc, 8 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 톱니 절단 바퀴(왼쪽)
    const gx = -5 * sc, gr = 5.2 * sc, teeth = 8;
    ctx.fillStyle = "#8fa1b2"; ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = i / (teeth * 2) * Math.PI * 2, rr = (i % 2 ? gr * 0.6 : gr);
      const px = gx + Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#5f7080"; ctx.beginPath(); ctx.arc(gx, 0, gr * 0.32, 0, Math.PI * 2); ctx.fill();
    // 나비 손잡이(오른쪽 돌리는 키)
    ctx.fillStyle = "#b9c4cf"; ctx.strokeStyle = "rgba(90,120,150,0.5)";
    ctx.beginPath(); ctx.ellipse(8 * sc, -2 * sc, 3.4 * sc, 1.8 * sc, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8 * sc, 2 * sc, 3.4 * sc, 1.8 * sc, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();

    // 한글 원소 이름 태그(도구 위)
    const ty = hy - 16 * sc;
    const fs = 8 * sc + 5;
    ctx.font = "bold " + fs + "px sans-serif";
    const tw = ctx.measureText(o.el.name).width + 12 * sc;
    ctx.fillStyle = "rgba(18,28,42,0.88)"; ctx.fillRect(x - tw / 2, ty - fs, tw, fs + 5 * sc);
    ctx.strokeStyle = "rgba(255,210,150,0.8)"; ctx.lineWidth = Math.max(1, sc); ctx.strokeRect(x - tw / 2, ty - fs, tw, fs + 5 * sc);
    ctx.fillStyle = "#ffe6b0"; ctx.textAlign = "center";
    ctx.fillText(o.el.name, x, ty - 1 * sc);
    ctx.textAlign = "start";
  }

  // 상단 통조림 보관함
  function drawStored() {
    if (!stored.length) return;
    const n = Math.min(stored.length, 9);
    const cw = 24, gap = 5, totalW = n * (cw + gap) - gap;
    const sx = W / 2 - totalW / 2, y = 50;
    ctx.fillStyle = "rgba(10,24,40,0.4)";
    ctx.fillRect(sx - 8, y - 4, totalW + (stored.length > n ? 40 : 16), 30);
    for (let i = 0; i < n; i++) drawMiniCan(sx + i * (cw + gap) + cw / 2, y + 13, stored[i]);
    if (stored.length > n) {
      ctx.fillStyle = "#cfe6ff"; ctx.textAlign = "left"; ctx.font = "bold 12px sans-serif";
      ctx.fillText("+" + (stored.length - n), sx + totalW + 8, y + 18); ctx.textAlign = "start";
    }
  }
  function drawMiniCan(cx, cy, c) {
    const w = 20, h = 16;
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, "#8fa3b5"); g.addColorStop(0.5, "#f0f6fb"); g.addColorStop(1, "#8fa3b5");
    ctx.fillStyle = g; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = "#e3edf5"; ctx.beginPath(); ctx.ellipse(cx, cy - h / 2, w / 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2f8fe0"; ctx.fillRect(cx - w / 2, cy - 4, w, 9);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 9px sans-serif"; ctx.fillText(c.symbol, cx, cy + 3.5);
    ctx.textAlign = "start";
  }

  // ---------- 펭귄(뒤에서 본 달리기) ----------
  function drawPlayer() {
    const x = player.x, y = player.y, lift = player.jumpY;
    // 줍기 가능 구역(바닥에서만 작동)
    if (state === STATE.PLAY && player.onGround) {
      const cr = 36 + META.up.magnet * 8;
      ctx.strokeStyle = "rgba(150,230,180,0.45)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.ellipse(x, y + 9, cr, 8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    const shS = 1 - Math.min(0.55, lift / 150);
    ctx.fillStyle = "rgba(40,80,120," + (0.24 * shS) + ")";
    ctx.beginPath(); ctx.ellipse(x, y + 7, 16 * shS, 5 * shS, 0, 0, Math.PI * 2); ctx.fill();
    drawPenguin(x, y - lift, 1.7, player.run, player.stun > 0);
  }

  function drawPenguin(x, y, s, phase, stun) {
    const wad = Math.sin(phase) * 0.07;
    const stepL = Math.max(0, Math.sin(phase)) * 3;
    const stepR = Math.max(0, Math.sin(phase + Math.PI)) * 3;
    const flap = Math.sin(phase) * 0.16;
    ctx.save();
    ctx.translate(x, y);
    if (stun) ctx.globalAlpha = 0.45 + 0.4 * Math.sin(phase * 5);
    ctx.rotate(wad);
    ctx.scale(s, s);

    // 발(번갈아)
    ctx.fillStyle = "#f5a623";
    ctx.beginPath(); ctx.ellipse(-4, 5 - stepL, 3.6, 2.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 5 - stepR, 3.6, 2.3, 0, 0, Math.PI * 2); ctx.fill();
    // 꼬리
    ctx.fillStyle = "#11202b"; ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, 3); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
    // 몸통(등)
    const bg = ctx.createLinearGradient(0, -23, 0, 5);
    bg.addColorStop(0, "#2c3b4b"); bg.addColorStop(1, "#131e28");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, -9, 11, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(120,150,180,0.2)"; ctx.beginPath(); ctx.ellipse(-2, -12, 4, 7, -0.2, 0, Math.PI * 2); ctx.fill();
    // 날개(펄럭)
    ctx.fillStyle = "#0e1a24";
    ctx.save(); ctx.translate(-10, -8); ctx.rotate(flap); ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 8, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(10, -8); ctx.rotate(-flap); ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 8, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // 빨간 목도리
    ctx.fillStyle = "#e23b3b"; ctx.fillRect(-8, -16, 16, 3.5);
    ctx.beginPath(); ctx.moveTo(6, -14); ctx.lineTo(11, -8 + flap * 6); ctx.lineTo(8, -13); ctx.closePath(); ctx.fill();
    // 뒤통수
    ctx.fillStyle = "#1b2733"; ctx.beginPath(); ctx.arc(0, -22, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(120,150,180,0.16)"; ctx.beginPath(); ctx.arc(-2, -24, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max)); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function drawTexts() {
    ctx.textAlign = "center";
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 1.4));
      ctx.font = "bold " + t.size + "px sans-serif";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "start";
  }

  // ===================== 상점/메타 UI =====================
  function refreshMetaUI() {
    const dexTotal = (typeof ELEMENTS !== "undefined") ? ELEMENTS.length : 15;
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("coin-total", META.coins); set("high-score", META.high);
    set("dex-count", Object.keys(META.dex).length); set("dex-max", dexTotal);

    const labels = { life: "❤ 시작 목숨", jump: "⬆ 점프력", magnet: "🧲 자석" };
    ["life", "jump", "magnet"].forEach(function (kind) {
      const btn = document.getElementById("up-" + kind);
      if (!btn) return;
      const lvl = META.up[kind], maxed = lvl >= UPGRADE_MAX, cost = upgradeCost(kind);
      btn.classList.toggle("maxed", maxed);
      btn.classList.toggle("cant", !maxed && META.coins < cost);
      btn.innerHTML = labels[kind] + "<br /><span class=\"up-info\">" + (maxed ? "Lv." + lvl + " MAX" : "Lv." + lvl + " · 🪙" + cost) + "</span>";
    });
  }
  function buyUpgrade(kind) {
    const lvl = META.up[kind];
    if (lvl >= UPGRADE_MAX) return;
    const cost = upgradeCost(kind);
    if (META.coins < cost) { SND.bad(); return; }
    META.coins -= cost; META.up[kind]++; META.save(); SND.coin(); refreshMetaUI();
  }
  ["life", "jump", "magnet"].forEach(function (kind) {
    const btn = document.getElementById("up-" + kind);
    if (btn) btn.addEventListener("click", function () { initAudio(); buyUpgrade(kind); });
  });

  // ===================== 루프 =====================
  let lastT = 0;
  function loop(ts) {
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0;
    lastT = ts;
    if (state === STATE.PLAY) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  META.load();
  refreshMetaUI();
  resize();
  requestAnimationFrame(loop);
})();

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
    buildSnow(); buildBergs(); buildStars(); buildIce();
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
  let lastCanyonStage = -1; // 거대 협곡을 스폰한 스테이지(끝자락에 1번)
  let bannerT = 0, bannerText = "", bannerStage = 0;   // 스테이지 도착 배너
  let supplyStage = -1, supply = [];                    // 협곡 전 보급
  let stored = [];          // 상단에 모은 정어리 통조림

  // 남극 → 북극 세계 일주: 스테이지마다 나라별 명물(얼음조각)
  const STAGE_LEN = 6800;
  const STAGES = [
    { key: "iceberg",   name: "남극",      icon: "🐧", tint: null },
    { key: "moai",      name: "이스터섬",  icon: "🗿", tint: "rgba(80,200,180,0.12)" },
    { key: "liberty",   name: "미국",      icon: "🗽", tint: "rgba(120,160,210,0.10)" },
    { key: "clock",     name: "영국",      icon: "🎡", tint: "rgba(150,160,175,0.16)" },
    { key: "eiffel",    name: "프랑스",    icon: "🗼", tint: "rgba(210,150,200,0.14)" },
    { key: "windmill",  name: "네덜란드",  icon: "🌷", tint: "rgba(120,200,170,0.12)" },
    { key: "pisa",      name: "이탈리아",  icon: "🍕", tint: "rgba(255,180,120,0.16)" },
    { key: "pyramid",   name: "이집트",    icon: "🐫", tint: "rgba(255,170,80,0.22)" },
    { key: "taj",       name: "인도",      icon: "🕌", tint: "rgba(255,150,110,0.20)" },
    { key: "northpole", name: "북극",      icon: "❄️", tint: "rgba(150,210,255,0.16)" },
  ];
  function stageIndex() { return Math.min(STAGES.length - 1, Math.max(0, Math.floor((distance || 0) / STAGE_LEN))); }
  function stageLandmark() { return STAGES[stageIndex()]; }
  let snow = [], bergs = [], scenery = [], stars = [], iceFx = [];
  let galleryMode = false;

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
  const MAX_ENERGY = 100, HOP_COST = 12, FLY_DRAIN = 18, HUNGER = 2.5;
  function newGame() {
    player = {
      x: W / 2, targetX: W / 2, y: 0,
      run: 0,                              // 달리기 위상
      jumpY: 0, vz: 0, onGround: true,
      jumpV: 540 + META.up.jump * 45,      // 점프(hop) 속도(업그레이드로 강화)
      flapT: 0,                            // 날갯짓 위상
      energy: 55,                          // 에너지/배고픔 — 점프·비행에 필요(통조림을 까야 충전)
      lives: 1 + META.up.life,
      stun: 0, tumble: 0,
      falling: false, fallT: 0, fallY: 0, fallVy: 0, fallSpin: 0, holeX: 0,
    };
    holdJump = false;
    items = []; particles = []; texts = []; scenery = []; stored = [];
    score = 0; distance = 0; learned = {}; runCoins = 0;
    spawnTimer = 1.8; elapsed = 0; speed = 150; scrollY = 0; shake = 0; screenFlash = 0; curveT = 0; decorTimer = 0.3; lastStage = 0; lastCanyonStage = -1; bannerT = 0; supplyStage = -1; supply = [];
    updateHUD();
  }

  // ===================== 입력 =====================
  let keyLeft = false, keyRight = false, holdJump = false, hungryToast = 0;
  function pointerMove(clientX) { const r = canvas.getBoundingClientRect(); player.targetX = clientX - r.left; }
  function press() {   // 점프(에너지 있어야 가능)
    if (state !== STATE.PLAY) return;
    if (player.onGround) {
      if (player.energy >= HOP_COST) {
        player.vz = player.jumpV; player.onGround = false; player.energy -= HOP_COST; SND.jump();
      } else if (hungryToast <= 0) {
        hungryToast = 1.2;
        spawnText(player.x, playerLineY() - 40, "배고파요! 🥫", "#ffcf9a", 18);
        SND.bad();
      }
    }
  }
  canvas.addEventListener("mousemove", function (e) { if (state === STATE.PLAY) pointerMove(e.clientX); });
  canvas.addEventListener("mousedown", function () { holdJump = true; press(); });
  window.addEventListener("mouseup", function () { holdJump = false; });
  canvas.addEventListener("touchmove", function (e) {
    if (state === STATE.PLAY && e.touches[0]) { pointerMove(e.touches[0].clientX); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchstart", function (e) {
    if (state === STATE.PLAY && e.touches[0]) pointerMove(e.touches[0].clientX);
    holdJump = true; press();
  });
  canvas.addEventListener("touchend", function () { holdJump = false; });
  canvas.addEventListener("touchcancel", function () { holdJump = false; });
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") keyLeft = true;
    if (e.key === "ArrowRight") keyRight = true;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "Spacebar") { holdJump = true; press(); e.preventDefault(); }
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft") keyLeft = false;
    if (e.key === "ArrowRight") keyRight = false;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "Spacebar") holdJump = false;
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
      // 보통 크레바스 — 점프로 넘기, 옆으로 피하기 가능 (큰 협곡은 스테이지 끝에만)
      const lane = (-1 + ((Math.random() * 3) | 0)) * 0.4;
      items.push({ type: "hole", lane: lane, p: 0, vp: 0.10, done: false, cleared: false,
        w: (1 / 3) + Math.random() * (1 / 3), len: 0.03, shape: makeJagged() });
    } else if (r < 0.86) {
      // 정어리 통조림 (겉면에 원소 기호)
      const el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      items.push({ type: "can", el: el, lane: -0.75 + Math.random() * 1.5,
        p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    } else {
      // 통조림 따개(황금 열쇠) — 먹을 때마다 통조림 하나 개봉
      items.push({ type: "opener", lane: -0.7 + Math.random() * 1.4,
        p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    }
  }

  // 거대 협곡(스테이지 끝) — 길을 가로지름. 점프로는 못 넘고 에너지 모아 비행으로 건너야 함
  function spawnCanyon() {
    items.push({ type: "hole", lane: 0, p: 0, vp: 0.10, done: false, cleared: false,
      w: 1.0, len: 0.26 + Math.random() * 0.08, shape: makeJagged() });
    showToast("⚠ 거대 협곡! 에너지를 모아 날아서 건너세요!", true);
  }
  // 협곡 전 보급 아이템(중앙 근처에 배치해 줍기 쉽게)
  function spawnSupply(kind) {
    if (kind === "can") {
      const el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
      items.push({ type: "can", el: el, lane: -0.3 + Math.random() * 0.6, p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    } else {
      items.push({ type: "opener", lane: -0.25 + Math.random() * 0.5, p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
    }
  }

  // 길가 풍경(장식, 충돌 없음) — 명물 얼음조각 + 소품
  function spawnScenery() {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.26) {
      // 이번 스테이지의 전세계 명물(길 옆에 보이도록)
      const lm = stageLandmark();
      scenery.push({ type: "landmark", key: lm.key, lane: side * (1.18 + Math.random() * 0.35),
        p: 0, vp: 0.10, flip: side < 0 });
    } else {
      const types = ["igloo", "mound", "spikes", "penguin", "mound", "spikes", "sign"];
      const type = types[(Math.random() * types.length) | 0];
      scenery.push({ type: type, lane: side * (1.12 + Math.random() * 0.4),
        p: 0, vp: 0.10, flip: side < 0 });
    }
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    // 크레바스 추락 연출 진행 중엔 일반 진행 정지
    if (player.falling) {
      player.fallT += dt;
      player.fallVy += 1100 * dt; player.fallY += player.fallVy * dt;
      player.fallSpin += dt * 7.5;
      player.flapT += dt * 34;
      if (player.fallT > 0.5 && Math.random() < 0.4) spawnParticles(player.holeX, playerLineY(), "#dff0ff", 2, 120);
      updateParticles(dt); updateTexts(dt);
      if (player.fallT > 1.3) gameOver();
      return;
    }
    elapsed += dt;
    speed = 150 + elapsed * 3.2;                  // 점점 빨라짐
    distance += speed * dt;
    scrollY = (scrollY + speed * dt * 0.6) % 80;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);
    if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - dt);
    if (player.stun > 0) player.stun -= dt;
    if (player.tumble > 0) player.tumble -= dt;
    if (bannerT > 0) bannerT -= dt;

    // 이동(스턴 중엔 둔해짐)
    const mv = (player.stun > 0 ? 300 : 560);
    if (keyLeft) player.targetX -= mv * dt;
    if (keyRight) player.targetX += mv * dt;
    player.targetX = Math.max(28, Math.min(W - 28, player.targetX));
    player.x += (player.targetX - player.x) * Math.min(1, dt * 14);
    player.y = playerLineY();
    player.run += dt * (5 + speed * 0.02);

    if (hungryToast > 0) hungryToast -= dt;
    // 배고픔: 가만히 있어도 에너지가 서서히 줄어든다(통조림을 먹어야 함)
    player.energy = Math.max(0, player.energy - HUNGER * dt);

    // 점프/비행 물리 — 점프 버튼을 누르고 있고 에너지가 있으면 날갯짓으로 떠 있다
    const flying = !player.onGround && holdJump && player.energy > 0;
    if (!player.onGround) {
      player.flapT += dt * 24;
      if (flying) {
        player.vz += 2000 * dt;                       // 양력(날갯짓)
        player.vz = Math.min(player.vz, 260);
        if (player.jumpY > 175) player.vz = Math.min(player.vz, 0);   // 고도 상한
        player.energy = Math.max(0, player.energy - FLY_DRAIN * dt);  // 비행 연료 소모
      }
      player.jumpY += player.vz * dt;
      player.vz -= 1700 * dt;                          // 중력
      if (player.jumpY <= 0) { player.jumpY = 0; player.vz = 0; player.onGround = true; }
    }

    // 스폰(속도에 비례해 잦아짐)
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = Math.max(0.6, 1.5 - elapsed * 0.012); spawnObstacle(); }

    // 스테이지 전환 알림
    const st = Math.floor(distance / STAGE_LEN);
    if (st !== lastStage) {
      lastStage = st;
      if (st < STAGES.length) {
        const s = STAGES[st];
        bannerT = 2.5; bannerStage = st + 1; bannerText = s.icon + " " + s.name;
        SND.base();
      }
    }
    const inStage = distance - st * STAGE_LEN;
    // 협곡 직전 보급: 통조림 2 + 따개 2를 순서대로 흘려보내 연료 모을 기회 보장
    if (supplyStage !== st && inStage > STAGE_LEN * 0.6) {
      supplyStage = st;
      supply.push({ t: 0.0, kind: "can" }, { t: 1.0, kind: "can" },
                   { t: 2.6, kind: "opener" }, { t: 3.9, kind: "opener" });
    }
    for (let i = supply.length - 1; i >= 0; i--) {
      supply[i].t -= dt;
      if (supply[i].t <= 0) { spawnSupply(supply[i].kind); supply.splice(i, 1); }
    }
    // 거대 협곡: 끝자락 + 에너지가 충분할 때만(못 건너는 협곡은 안 나옴)
    if (lastCanyonStage !== st && inStage > STAGE_LEN * 0.9 && player.energy >= 40) {
      lastCanyonStage = st;
      spawnCanyon();
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

      // ----- 크레바스: 길이(len)만큼 플레이어 선을 지나가는 동안 계속 판정 -----
      if (o.type === "hole") {
        const frontP = o.p, backP = o.p - o.len;
        const big = o.len > 0.1;
        const overLine = backP <= 1 && frontP >= 1;          // 플레이어 선이 구덩이 위
        if (overLine && player.onGround) {
          const ox = laneToX(1, o.lane), holeHalf = halfAt(1) * o.w;
          const dist = Math.abs(player.x - ox);
          if (dist < holeHalf + 6) {
            if (big || dist < holeHalf * 0.45) {
              // 정가운데(또는 거대 협곡)로 빠짐 → 추락 연출
              startFall(ox);
              return;
            } else if (!o.tripped) {
              // 가장자리 돌부리에 걸림 → 넘어지고 에너지 감소(생존)
              o.tripped = true;
              tripPenguin(ox);
            }
          }
        }
        if (!o.cleared && backP > 1) {                        // 무사 통과
          o.cleared = true;
          const big = o.len > 0.1;
          score += big ? 80 : 5; runCoins += big ? 2 : 1;
          if (big) spawnText(player.x, playerLineY() - player.jumpY - 36, "건넜다!", "#aef0c0", 22);
        }
        if (backP > 1.06) items.splice(i, 1);
        continue;
      }

      // ----- 통조림 / 따개 -----
      o.wave += dt * 5;
      if (META.up.magnet > 0 && o.p > 0.6 && player.onGround) {
        const ox = laneToX(o.p, o.lane), range = 30 + META.up.magnet * 16;
        if (Math.abs(player.x - ox) < range) {
          o.lane += (((player.x - curveCenterX(o.p)) / halfAt(o.p)) - o.lane) * Math.min(1, dt * 4);
        }
      }
      if (!o.done && o.p >= 1) {
        o.done = true;
        const ox = laneToX(1, o.lane);
        const eaten = (o.type === "can") ? collectCan(o, ox, AIR) : eatOpener(o, ox, AIR);
        if (eaten) { items.splice(i, 1); continue; }
      }
      if (o.p > 1.1) items.splice(i, 1);
    }
  }

  // 돌부리에 걸려 넘어짐: 에너지 감소 + 비틀거림(아웃은 아님)
  function tripPenguin(ox) {
    player.energy = Math.max(0, player.energy - 22);
    player.stun = 0.7;
    player.tumble = 0.6;
    screenFlash = 0.22; shake = Math.min(16, shake + 9);
    spawnParticles(ox, playerLineY(), "#dfe9f2", 12, 180);
    spawnText(player.x, playerLineY() - 44, "돌부리에 걸려 넘어짐! 💫", "#ffcf9a", 18);
    SND.bad();
    updateHUD();
  }

  // 크레바스 추락 연출 시작(아케이드식): 펭귄이 구덩이로 빙글빙글 빨려들고 얼음 파편 솟구침
  function startFall(ox) {
    player.falling = true; player.fallT = 0; player.fallY = 0; player.fallVy = 40; player.fallSpin = 0;
    player.holeX = ox; player.onGround = false;
    screenFlash = 0.55; shake = Math.min(26, shake + 20);
    SND.fall();
    spawnText(ox, playerLineY() - 70, "으악! 빠졌다!", "#ff6b6b", 26);
    // 얼음 파편 솟구침
    spawnParticles(ox, playerLineY(), "#ffffff", 16, 320);
    spawnParticles(ox, playerLineY(), "#bfe6ff", 14, 260);
    for (let k = 0; k < 8; k++) {   // 큰 얼음 조각(위로)
      particles.push({ x: ox + (Math.random() - 0.5) * 40, y: playerLineY(),
        vx: (Math.random() - 0.5) * 220, vy: -180 - Math.random() * 160,
        life: 0.7 + Math.random() * 0.3, max: 1.0, color: "#eaf6ff", r: 3 + Math.random() * 3 });
    }
    updateHUD();
  }

  // 정어리 통조림: 주우면 상단 보관함에 쌓인다. 먹으면 true 반환(즉시 제거).
  function collectCan(o, ox, AIR) {
    const el = o.el;
    const catchR = 36 + META.up.magnet * 8;
    if (player.jumpY > AIR || Math.abs(player.x - ox) >= catchR) return false;
    learned[el.symbol] = true;
    stored.push({ symbol: el.symbol, name: el.name, color: el.color });
    score += 30; runCoins += 1;
    spawnParticles(player.x, playerLineY() - 20, el.color, 10, 150);
    spawnText(player.x, playerLineY() - 58, el.name + "!", el.color, 24);   // 한글 원소 이름 외치기
    SND.flag();
    showToast(el.symbol + " = " + el.name + " 통조림 획득! (위에 모임)", false);
    updateHUD();
    return true;
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
    if (player.jumpY > AIR || Math.abs(player.x - ox) >= catchR) return false;
    if (stored.length === 0) {
      spawnText(player.x, playerLineY() - 56, "통조림이 없어요!", "#ffcf9a", 16);
      SND.bad();
      showToast("따개만 먹으면 의미 없어요 — 먼저 정어리 통조림을 모으세요!", true);
      return true;
    }
    // 통조림 하나 개봉(가장 최근 것) → 정어리를 먹어 에너지 충전
    const slotX = storedSlotX(stored.length - 1);
    const c = stored.pop();
    learned[c.symbol] = true;
    score += 200; runCoins += 2;
    player.energy = Math.min(MAX_ENERGY, player.energy + 40);   // 정어리 식사 → 에너지 ↑(유일한 충전원)
    spawnText(slotX, 99, "🐟", "#bcd6e8", 22);
    spawnParticles(slotX, 99, "#cfe6f5", 12, 190);
    spawnText(player.x, playerLineY() - 64, c.name + " 냠냠! +200", "#ffe678", 22);
    spawnText(player.x, playerLineY() - 90, "🍴 에너지 ↑", "#aef0c0", 16);
    shake = Math.min(12, shake + 6);
    SND.base();
    showToast(c.symbol + " = " + c.name + " 통조림 개봉! 정어리 +200 · 에너지 ↑", false);
    updateHUD();
    return true;
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
  function buildStars() {
    stars = [];
    const n = Math.round(W / 14);
    for (let i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * horizonY() * 0.78,
      r: 0.5 + Math.random() * 1.1, a: 0.3 + Math.random() * 0.6, tw: Math.random() * 6.28 });
  }
  function buildIce() {
    // 길 위 얼음 디테일(반짝임/잔금) — 깊이 u(0..1)와 레인으로 고정, 스크롤된다
    iceFx = [];
    const n = 22;
    for (let i = 0; i < n; i++) iceFx.push({
      u: Math.random(), lane: -0.82 + Math.random() * 1.64,
      kind: Math.random() < 0.55 ? "sparkle" : "crack",
      r: 0.6 + Math.random() * 1.1, a: Math.random() * Math.PI,
    });
  }
  function buildBergs() {
    bergs = [];
    // 뒤(멀고 어두움) → 앞(가깝고 밝음) 2겹, 모양/높이/봉우리 위치 제각각
    for (let layer = 0; layer < 2; layer++) {
      let x = -40 - layer * 30;
      while (x < W + 50) {
        const w = (layer ? 55 : 38) + Math.random() * (layer ? 85 : 55);
        const h = (layer ? 34 : 20) + Math.random() * (layer ? 58 : 36);
        bergs.push({ x: x, w: w, h: h, layer: layer,
          peak: 0.42 + Math.random() * 0.16, cap: Math.random() < 0.78 });
        x += w * (0.55 + Math.random() * 0.4);
      }
    }
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
    if (state === STATE.PLAY || state === STATE.OVER) { drawNav(); drawStored(); drawEnergyGauge(); drawStageBanner(); }
  }

  // 스테이지 도착 배너(슬라이드 인 → 유지 → 페이드 아웃)
  function drawStageBanner() {
    if (state !== STATE.PLAY || bannerT <= 0) return;
    const T = 2.5;
    let off = 0, alpha = 1;
    if (bannerT > T - 0.4) off = (1 - (T - bannerT) / 0.4) * W * 0.6;   // 슬라이드 인
    else if (bannerT < 0.6) { alpha = bannerT / 0.6; off = (1 - bannerT / 0.6) * W * 0.5; }
    const cy = H * 0.32, bw = W * 0.84, bh = 58, bx = W / 2 - bw / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(off, 0);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, "rgba(14,48,86,0)"); grad.addColorStop(0.16, "rgba(14,48,86,0.94)");
    grad.addColorStop(0.84, "rgba(14,48,86,0.94)"); grad.addColorStop(1, "rgba(14,48,86,0)");
    ctx.fillStyle = grad; ctx.fillRect(bx, cy - bh / 2, bw, bh);
    ctx.strokeStyle = "rgba(255,212,120,0.85)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx + bw * 0.1, cy - bh / 2); ctx.lineTo(bx + bw * 0.9, cy - bh / 2);
    ctx.moveTo(bx + bw * 0.1, cy + bh / 2); ctx.lineTo(bx + bw * 0.9, cy + bh / 2); ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe08a"; ctx.font = "bold 13px sans-serif";
    ctx.fillText("STAGE " + bannerStage, W / 2, cy - 9);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 23px sans-serif";
    ctx.fillText(bannerText, W / 2, cy + 17);
    ctx.textAlign = "start";
    ctx.restore();
  }

  // 에너지/배고픔 게이지 — 통조림을 먹으면 차고, 점프·비행·시간으로 줄어든다
  function drawEnergyGauge() {
    if (state !== STATE.PLAY) return;
    const frac = Math.max(0, Math.min(1, player.energy / MAX_ENERGY));
    const gx = 16, gw = 13, gh = 96, gy = H - 142;
    const low = frac < 0.18;
    ctx.fillStyle = "rgba(10,24,40,0.5)"; ctx.fillRect(gx - 4, gy - 18, gw + 8, gh + 34);
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(gx, gy, gw, gh);
    const fh = gh * frac;
    if (frac > 0.01) {
      const grad = ctx.createLinearGradient(0, gy + gh, 0, gy);
      if (low) { grad.addColorStop(0, "#ff6b6b"); grad.addColorStop(1, "#ffb070"); }
      else { grad.addColorStop(0, "#6fe0a0"); grad.addColorStop(0.6, "#9fe6ff"); grad.addColorStop(1, "#aef0c0"); }
      ctx.fillStyle = grad; ctx.fillRect(gx, gy + gh - fh, gw, fh);
    }
    ctx.strokeStyle = "rgba(150,200,180,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(gx, gy, gw, gh);
    ctx.textAlign = "center"; ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = low && (Math.sin(elapsed * 8) > 0) ? "#ff8a8a" : "#cfe6ff";
    ctx.fillText(low ? "🍴" : "⚡", gx + gw / 2, gy - 5);
    ctx.fillStyle = low ? "#ff8a8a" : "#aef0c0"; ctx.font = "bold 9px sans-serif";
    ctx.fillText(low ? "허기" : (frac > 0.5 ? "비행" : "에너지"), gx + gw / 2, gy + gh + 12);
    ctx.textAlign = "start";
  }

  // 네비게이션: 남극→북극 경로 + 스테이지 노드 + 현재 위치 마커
  function drawNav() {
    const yL = 56, x0 = 28, x1 = W - 28, w = x1 - x0;
    const n = STAGES.length;
    const prog = Math.max(0, Math.min(1, distance / (STAGE_LEN * (n - 1))));

    // 패널
    ctx.fillStyle = "rgba(10,24,40,0.5)";
    ctx.fillRect(x0 - 16, yL - 20, w + 32, 38);

    // 전체 경로(점선) + 진행 경로
    ctx.strokeStyle = "rgba(175,210,238,0.45)"; ctx.lineWidth = 3; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x0, yL); ctx.lineTo(x1, yL); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#6fd3ff"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x0, yL); ctx.lineTo(x0 + w * prog, yL); ctx.stroke();

    // 스테이지 노드 + 아이콘
    ctx.textAlign = "center";
    for (let i = 0; i < n; i++) {
      const nx = x0 + w * (i / (n - 1));
      const reached = distance >= STAGE_LEN * i;
      ctx.fillStyle = reached ? "#6fd3ff" : "rgba(200,220,240,0.45)";
      ctx.beginPath(); ctx.arc(nx, yL, (i === 0 || i === n - 1) ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = reached ? 1 : 0.5;
      ctx.font = "11px sans-serif"; ctx.fillText(STAGES[i].icon, nx, yL - 8);
      ctx.globalAlpha = 1;
    }

    // 현재 위치 마커(펭귄)
    const mx = x0 + w * prog;
    ctx.fillStyle = "#ffe678"; ctx.beginPath(); ctx.arc(mx, yL, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = "10px sans-serif"; ctx.fillStyle = "#1b2733"; ctx.fillText("🐧", mx, yL + 3.5);

    // 끝 라벨 + 현재 스테이지
    ctx.fillStyle = "#bcd6e8"; ctx.font = "bold 9px sans-serif";
    ctx.fillText("남극", x0, yL + 15); ctx.fillText("북극", x1, yL + 15);
    ctx.fillStyle = "#eaf6ff"; ctx.font = "bold 11px sans-serif";
    ctx.fillText("🗺 " + stageLandmark().icon + " " + stageLandmark().name, W / 2, yL + 15);
    ctx.textAlign = "start";
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, "#0a2a4a"); sky.addColorStop(0.28, "#16456e");
    sky.addColorStop(0.45, "#2d7fa8"); sky.addColorStop(0.55, "#bfe8f2"); sky.addColorStop(1.0, "#eaf6ff");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const hy = horizonY();

    // 별(은은하게 반짝)
    for (const st of stars) {
      ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(elapsed * 2 + st.tw));
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

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

    // 설산 — 2겹(뒤→앞), 좌면 밝음/우면 그늘 + 꼭대기 눈모자
    for (const b of bergs) {
      const px = b.x + b.w * b.peak, top = hy - b.h;
      const lx = b.x, rx2 = b.x + b.w;
      const lit = b.layer ? "rgba(150,190,222,0.92)" : "rgba(206,230,247,0.96)";
      const shade = b.layer ? "rgba(116,160,198,0.92)" : "rgba(168,204,232,0.96)";
      // 왼면(밝음) / 오른면(그늘)
      ctx.fillStyle = lit;
      ctx.beginPath(); ctx.moveTo(lx, hy); ctx.lineTo(px, top); ctx.lineTo(px, hy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(rx2, hy); ctx.lineTo(px, hy); ctx.closePath(); ctx.fill();
      // 능선 하이라이트
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, hy); ctx.stroke();
      // 꼭대기 눈모자 — 봉우리 경사를 따라, 아래는 물결 설선
      if (b.cap) {
        const f = 0.34;                              // 눈선 높이(꼭대기에서 비율)
        const yS = top + b.h * f;
        const xl = px + (lx - px) * f, xr = px + (rx2 - px) * f;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(xr, yS);
        ctx.lineTo(px + (xr - px) * 0.45, yS - b.h * 0.05);
        ctx.lineTo(px - (px - xl) * 0.2, yS + b.h * 0.04);
        ctx.lineTo(px - (px - xl) * 0.6, yS - b.h * 0.02);
        ctx.lineTo(xl, yS);
        ctx.closePath(); ctx.fill();
      }
    }

    // 지평선 안개(하늘↔빙원 부드럽게 + 깊이감)
    const fog = ctx.createLinearGradient(0, hy - 26, 0, hy + 30);
    fog.addColorStop(0, "rgba(225,242,252,0)"); fog.addColorStop(0.5, "rgba(228,243,252,0.75)"); fog.addColorStop(1, "rgba(230,244,253,0)");
    ctx.fillStyle = fog; ctx.fillRect(0, hy - 26, W, 56);

    // 빙판 길(굽이치는 트랙) — 슬라이스로 그린다
    const pBottom = (H - hy) / (playerLineY() - hy);   // 화면 맨 아래까지의 깊이
    const N = 28;
    // 길 바깥 빙원(은은한 그라데이션)
    const plain = ctx.createLinearGradient(0, hy, 0, H);
    plain.addColorStop(0, "#d6e8f6"); plain.addColorStop(1, "#f1f9ff");
    ctx.fillStyle = plain;
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
    // 길 가장자리 눈둑(흰 도드라짐) — 길이 텅 비어 보이지 않게 입체감
    for (let s = 0; s < 2; s++) {
      const sgn = s === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p), y = projY(p); if (i === 0) ctx.moveTo(c + sgn * h, y); else ctx.lineTo(c + sgn * h, y); }
      for (let i = N; i >= 0; i--) { const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p), y = projY(p), bw = 5 + 9 * projScale(p); ctx.lineTo(c + sgn * (h + bw), y); }
      ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
    }
    // 안쪽 그늘(둑 밑)
    ctx.strokeStyle = "rgba(120, 165, 205, 0.4)"; ctx.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const sgn = s === 0 ? -1 : 1; ctx.beginPath();
      for (let i = 0; i <= N; i++) { const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p), y = projY(p); if (i === 0) ctx.moveTo(c + sgn * (h - 1.5), y); else ctx.lineTo(c + sgn * (h - 1.5), y); }
      ctx.stroke();
    }
    // 길 중앙 광택(은은한 빛띠)
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const sheen = ctx.createLinearGradient(0, hy, 0, H);
    sheen.addColorStop(0, "rgba(255,255,255,0)"); sheen.addColorStop(0.7, "rgba(210,240,255,0.10)"); sheen.addColorStop(1, "rgba(230,248,255,0.22)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p) * 0.5, y = projY(p); if (i === 0) ctx.moveTo(c - h, y); else ctx.lineTo(c - h, y); }
    for (let i = N; i >= 0; i--) { const p = (i / N) * pBottom, c = curveCenterX(p), h = halfAt(p) * 0.5, y = projY(p); ctx.lineTo(c + h, y); }
    ctx.closePath(); ctx.fill(); ctx.restore();
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

    // 길 위 얼음 디테일(반짝임/잔금) — 깊이 따라 스크롤
    for (const f of iceFx) {
      const u = (f.u + (scrollY / 80)) % 1;
      const p = u * pBottom, sc = projScale(p);
      const fx = laneToX(p, f.lane), fy = projY(p);
      const a = Math.min(1, u * 1.8);
      if (f.kind === "sparkle") {
        ctx.globalAlpha = a * 0.55 * (0.6 + 0.4 * Math.sin(elapsed * 3 + f.a));
        ctx.fillStyle = "#ffffff";
        oSparkle(fx, fy, (f.r + 0.5) * sc * 1.6, "#ffffff");
      } else {
        ctx.globalAlpha = a * 0.22; ctx.strokeStyle = "#9fc4e0"; ctx.lineWidth = Math.max(1, sc);
        const dx = Math.cos(f.a) * 7 * sc, dy = Math.sin(f.a) * 2.5 * sc;
        ctx.beginPath(); ctx.moveTo(fx - dx, fy - dy); ctx.lineTo(fx + dx, fy + dy); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const vgr = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    vgr.addColorStop(0, "rgba(0,10,25,0.35)"); vgr.addColorStop(1, "rgba(0,10,25,0)");
    ctx.fillStyle = vgr; ctx.fillRect(0, 0, W, H * 0.25);

    // 스테이지(나라)별 색감 — 은은한 분위기 틴트
    const tint = stageLandmark().tint;
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); }
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
    // 발밑 눈더미(접지감)
    ctx.fillStyle = "rgba(238,247,253,0.96)";
    ctx.beginPath(); ctx.ellipse(0, 0, u * 2.7, u * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(150,190,220,0.25)";
    ctx.beginPath(); ctx.ellipse(0, u * 0.18, u * 2.7, u * 0.32, 0, 0, Math.PI); ctx.fill();
    if (key === "eiffel") lmEiffel(u);
    else if (key === "pyramid") lmPyramid(u);
    else if (key === "liberty") lmLiberty(u);
    else if (key === "pisa") lmPisa(u);
    else if (key === "windmill") lmWindmill(u);
    else if (key === "moai") lmMoai(u);
    else if (key === "clock") lmClock(u);
    else if (key === "iceberg") lmIceberg(u);
    else if (key === "northpole") lmNorthpole(u);
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
    // 철골 격자(대각선)
    ctx.save();
    ctx.strokeStyle = "rgba(110,150,190,0.45)"; ctx.lineWidth = Math.max(0.6, u * 0.05);
    for (let k = 0; k < 5; k++) {
      const y0 = -k * 1.4 * u, y1 = -(k + 1) * 1.4 * u;
      const w0 = (2 - k * 0.38) * u, w1 = (2 - (k + 1) * 0.38) * u;
      if (y1 < -7 * u) break;
      ctx.beginPath(); ctx.moveTo(-w0, y0); ctx.lineTo(w1, y1); ctx.moveTo(w0, y0); ctx.lineTo(-w1, y1); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(-1.4 * u, -2.5 * u, 2.8 * u, 0.35 * u);
    ctx.fillRect(-0.8 * u, -4.9 * u, 1.6 * u, 0.3 * u);
    // 아치
    ctx.fillStyle = "rgba(70,110,150,0.35)";
    ctx.beginPath(); ctx.moveTo(-1.1 * u, 0); ctx.quadraticCurveTo(0, -1.8 * u, 1.1 * u, 0); ctx.closePath(); ctx.fill();
    // 꼭대기 반짝
    ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(0, -7 * u, u * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  function lmPyramid(u) {
    // 왼면(밝음) + 오른면(그늘)으로 입체
    ctx.fillStyle = iceGrad(-u * 5.5);
    ctx.beginPath(); ctx.moveTo(-3.2 * u, 0); ctx.lineTo(0, -5.5 * u); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(120,158,192,0.6)";
    ctx.beginPath(); ctx.moveTo(0, -5.5 * u); ctx.lineTo(3.2 * u, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(120,160,195,0.6)";
    ctx.beginPath(); ctx.moveTo(-3.2 * u, 0); ctx.lineTo(0, -5.5 * u); ctx.lineTo(3.2 * u, 0); ctx.closePath(); ctx.stroke();
    // 블록 라인
    ctx.strokeStyle = "rgba(110,150,190,0.35)";
    ctx.beginPath();
    for (let k = 1; k < 5; k++) { const yy = -k * u; const hw = 3.2 * u * (1 - k / 5.5); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); }
    ctx.stroke();
    // 능선 하이라이트
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, u * 0.08);
    ctx.beginPath(); ctx.moveTo(0, -5.5 * u); ctx.lineTo(0, 0); ctx.stroke();
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
  function lmIceberg(u) {
    // 각진 빙산
    ctx.fillStyle = iceGrad(-u * 5);
    ctx.beginPath();
    ctx.moveTo(-3.2 * u, 0); ctx.lineTo(-2.2 * u, -2.6 * u); ctx.lineTo(-0.6 * u, -5 * u);
    ctx.lineTo(0.8 * u, -3.4 * u); ctx.lineTo(2.4 * u, -4.4 * u); ctx.lineTo(3.2 * u, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 면 갈라짐
    ctx.strokeStyle = "rgba(120,160,195,0.4)";
    ctx.beginPath();
    ctx.moveTo(-0.6 * u, -5 * u); ctx.lineTo(-0.2 * u, 0);
    ctx.moveTo(2.4 * u, -4.4 * u); ctx.lineTo(1.4 * u, 0);
    ctx.stroke();
    // 물 반사선
    ctx.strokeStyle = "rgba(180,225,245,0.5)"; ctx.lineWidth = Math.max(1, u * 0.1);
    ctx.beginPath(); ctx.moveTo(-3 * u, 0.3 * u); ctx.lineTo(3 * u, 0.3 * u); ctx.stroke();
  }
  function lmNorthpole(u) {
    // 빨강/흰 줄무늬 기둥
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = (k % 2) ? "#e23b3b" : "#ffffff";
      ctx.fillRect(-0.6 * u, -(k + 1) * u, 1.2 * u, u);
    }
    ctx.strokeStyle = "rgba(120,160,195,0.55)"; ctx.strokeRect(-0.6 * u, -6 * u, 1.2 * u, 6 * u);
    // 꼭대기 황금 구
    ctx.fillStyle = "#ffe678"; ctx.strokeStyle = "rgba(150,110,20,0.6)";
    ctx.beginPath(); ctx.arc(0, -6.5 * u, 0.7 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 표지판 N
    ctx.fillStyle = "#caa46a"; ctx.fillRect(0.6 * u, -5.4 * u, 2.8 * u, 1.5 * u);
    ctx.strokeStyle = "rgba(120,90,30,0.6)"; ctx.strokeRect(0.6 * u, -5.4 * u, 2.8 * u, 1.5 * u);
    ctx.fillStyle = "#5a3d12"; ctx.font = "bold " + (u * 0.95) + "px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("N", 2 * u, -4.3 * u); ctx.textAlign = "start";
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
    if (o.len <= 0.1) { drawCrevasse(o); return; }   // 보통: 랜덤 들쭉날쭉
    drawCanyon(o);                                     // 큰 협곡: 가로지르는 띠
  }

  // 보통 크레바스 — 매번 다른 랜덤(들쭉날쭉) 외곽선
  function drawCrevasse(o) {
    const sc = projScale(o.p), y = projY(o.p);
    const cx = laneToX(o.p, o.lane);
    const rx = halfAt(o.p) * o.w, ry = rx * 0.26;
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
    // 안쪽 깊은 그늘(깊이감)
    ctx.fillStyle = "rgba(4,18,34,0.5)";
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i % n) / n * Math.PI * 2, rr = shp[i % n] * 0.58; const px = cx + Math.cos(a) * rx * rr, py = y + Math.sin(a) * ry * rr + ry * 0.2; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.fill();
    // 세로 빙벽 결(단면 디테일)
    ctx.strokeStyle = "rgba(150,200,235,0.4)"; ctx.lineWidth = Math.max(0.8, sc * 0.9); ctx.lineCap = "round";
    for (let k = -2; k <= 2; k++) {
      const px = cx + k * rx * 0.3, len = 0.45 + shp[(k + 5) % n] * 0.35;
      ctx.beginPath(); ctx.moveTo(px, y - ry * 0.5); ctx.lineTo(px, y + ry * len); ctx.stroke();
    }
    // 위 가장자리 고드름(아래로)
    ctx.fillStyle = "rgba(228,246,255,0.88)";
    for (let k = -2; k <= 2; k++) {
      const px = cx + k * rx * 0.28 + rx * 0.06, ty = y - ry * 0.62, il = (3 + shp[(k + 3) % n] * 4) * sc;
      ctx.beginPath(); ctx.moveTo(px - 2 * sc, ty); ctx.lineTo(px + 2 * sc, ty); ctx.lineTo(px, ty + il); ctx.closePath(); ctx.fill();
    }
    // 깨진 얼음 테
    ctx.strokeStyle = "rgba(225,245,255,0.9)"; ctx.lineWidth = Math.max(1.5, 2.2 * sc); ctx.lineJoin = "round";
    outline(); ctx.stroke();
    // 가장자리 서리 알갱이
    ctx.fillStyle = "rgba(236,248,255,0.85)";
    for (let k = 0; k < 5; k++) { const a = 0.4 + k * 1.3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * 0.9, y + Math.sin(a) * ry * 0.9, Math.max(0.8, 1.1 * sc), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = "#cfe6ff"; ctx.textAlign = "center";
    ctx.font = "bold " + (9 * sc + 6) + "px sans-serif"; ctx.fillText("⬆ 점프", cx, y - ry - 8 * sc);
    ctx.textAlign = "start"; ctx.restore();
  }

  // 거대 협곡 — 길을 가로지르는 들쭉날쭉 띠
  function drawCanyon(o) {
    const fP = o.p, bP = Math.max(0.02, o.p - o.len);
    const fy = projY(fP), by = projY(bP);
    const fcx = laneToX(fP, o.lane), bcx = laneToX(bP, o.lane);
    const frx = halfAt(fP) * o.w, brx = halfAt(bP) * o.w;
    const sc = projScale(fP), shp = o.shape, n = shp.length;

    ctx.save();
    // 어두운 얼음 밴드(앞↔뒤 사다리꼴)
    const g = ctx.createLinearGradient(0, by, 0, fy);
    g.addColorStop(0, "#3f86ad"); g.addColorStop(0.5, "#19567a"); g.addColorStop(1, "#0e3550");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fcx - frx, fy); ctx.lineTo(fcx + frx, fy);
    ctx.lineTo(bcx + brx, by); ctx.lineTo(bcx - brx, by);
    ctx.closePath(); ctx.fill();
    // 안쪽 깊은 그늘(깊이감)
    ctx.fillStyle = "rgba(4,18,34,0.45)";
    ctx.beginPath();
    ctx.moveTo(fcx - frx * 0.8, fy - (fy - by) * 0.16); ctx.lineTo(fcx + frx * 0.8, fy - (fy - by) * 0.16);
    ctx.lineTo(bcx + brx * 0.82, by + (fy - by) * 0.1); ctx.lineTo(bcx - brx * 0.82, by + (fy - by) * 0.1);
    ctx.closePath(); ctx.fill();
    // 세로 빙벽 결(앞↔뒤를 잇는 얼음 기둥)
    ctx.strokeStyle = "rgba(150,200,235,0.32)"; ctx.lineWidth = Math.max(0.8, sc * 0.9); ctx.lineCap = "round";
    for (let k = 0; k <= 6; k++) {
      const f = k / 6;
      const tx = bcx + (f - 0.5) * 2 * brx * 0.85, bxn = fcx + (f - 0.5) * 2 * frx * 0.85;
      ctx.beginPath(); ctx.moveTo(tx, by); ctx.lineTo(bxn, fy); ctx.stroke();
    }
    // 뒤 가장자리 고드름(아래로)
    ctx.fillStyle = "rgba(228,246,255,0.85)";
    for (let k = 0; k <= 6; k++) {
      const f = (k + 0.5) / 7, tx = bcx + (f - 0.5) * 2 * brx * 0.8, il = (3 + shp[k % n] * 4) * sc;
      ctx.beginPath(); ctx.moveTo(tx - 2 * sc, by); ctx.lineTo(tx + 2 * sc, by); ctx.lineTo(tx, by + il); ctx.closePath(); ctx.fill();
    }
    // 앞 가장자리 들쭉날쭉 얼음 테
    ctx.strokeStyle = "rgba(225,245,255,0.9)"; ctx.lineWidth = Math.max(1.5, 2.2 * sc); ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const t = i / n; const xx = (fcx - frx) + 2 * frx * t; const j = (shp[i % n] - 0.85) * 6 * sc; if (i === 0) ctx.moveTo(xx, fy + j); else ctx.lineTo(xx, fy + j); }
    ctx.stroke();
    // 뒤 가장자리
    ctx.strokeStyle = "rgba(180,215,240,0.6)"; ctx.lineWidth = Math.max(1, 1.6 * sc);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const t = i / n; const xx = (bcx - brx) + 2 * brx * t; const j = (shp[(i + 3) % n] - 0.85) * 5 * sc; if (i === 0) ctx.moveTo(xx, by + j); else ctx.lineTo(xx, by + j); }
    ctx.stroke();
    ctx.restore();

    // 안내(거대 협곡은 비행 필요)
    ctx.save(); ctx.globalAlpha = 0.85; ctx.textAlign = "center";
    ctx.fillStyle = "#ffd07a";
    ctx.font = "bold " + (11 * sc + 6) + "px sans-serif";
    ctx.fillText("🪽 날아서 건너기!", fcx, fy - 7 * sc);
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
    const cw = 26 * sc, ch = 18 * sc;
    const top = gy - ch - (3 + Math.sin(o.wave) * 2) * sc;
    ctx.fillStyle = "rgba(40,80,120,0.18)"; ctx.beginPath(); ctx.ellipse(x, gy, cw * 0.5, 2.5 * sc, 0, 0, Math.PI * 2); ctx.fill();
    // 몸통(은색)
    const g = ctx.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
    g.addColorStop(0, "#8093a5"); g.addColorStop(0.45, "#f4f9fd"); g.addColorStop(0.6, "#e6eef6"); g.addColorStop(1, "#7e92a4");
    ctx.fillStyle = g; ctx.fillRect(x - cw / 2, top, cw, ch);
    // 세로 광택
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(x - cw * 0.34, top, cw * 0.1, ch);
    // 라벨 밴드 + 원소 기호
    ctx.fillStyle = "#2f8fe0"; ctx.fillRect(x - cw / 2, top + ch * 0.26, cw, ch * 0.5);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x - cw / 2, top + ch * 0.26, cw, ch * 0.08);
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.font = "bold " + (ch * 0.42) + "px sans-serif";
    ctx.fillText(o.el.symbol, x, top + ch * 0.6);
    // 라벨 아래 작은 정어리 그림
    const fy = top + ch * 0.9, fl = cw * 0.16;
    ctx.fillStyle = "#bcd6e8";
    ctx.beginPath(); ctx.ellipse(x - cw * 0.04, fy, fl, ch * 0.085, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + cw * 0.1, fy); ctx.lineTo(x + cw * 0.21, fy - ch * 0.06); ctx.lineTo(x + cw * 0.21, fy + ch * 0.06); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#10202b"; ctx.beginPath(); ctx.arc(x - cw * 0.15, fy - ch * 0.01, ch * 0.025, 0, Math.PI * 2); ctx.fill();
    // 뚜껑(타원) + 림
    ctx.fillStyle = "#eef4fa"; ctx.strokeStyle = "rgba(90,120,150,0.5)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.ellipse(x, top, cw / 2, 3 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.ellipse(x - cw * 0.18, top - 0.5 * sc, cw * 0.16, 1.4 * sc, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, top + ch, cw / 2, 3 * sc, 0, 0, Math.PI); ctx.stroke();
    ctx.textAlign = "start";
  }

  // 통조림 따개(돌려 따는 도구 모양 + 원소 이름 한글 태그)
  // 통조림 따개(손잡이 두 개 + 톱니 절단바퀴 + 나비 노브 — 확실한 캔 오프너)
  // 4점 반짝임
  function oSparkle(cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.32, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.32, cy); ctx.closePath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy + r * 0.32); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy - r * 0.32); ctx.closePath();
    ctx.fill();
  }

  // 통조림 따개 — 아이시/귀여운 스타일(둥근 틸 손잡이 + 흰 헤드 + 톱니바퀴 + 금색 나비 노브)
  function drawOpener(o) {
    const sc = projScale(o.p);
    const x = laneToX(o.p, o.lane), gy = projY(o.p);
    drawCatchMarker(x, gy, sc, o);
    const bob = Math.sin(o.wave) * 2.5 * sc;
    const cy = gy - 22 * sc + bob;

    // 그림자
    ctx.fillStyle = "rgba(40,80,120,0.18)"; ctx.beginPath(); ctx.ellipse(x, gy, 11 * sc, 2.8 * sc, 0, 0, Math.PI * 2); ctx.fill();

    // 부드러운 후광
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const aura = ctx.createRadialGradient(x, cy, 1, x, cy, 22 * sc);
    aura.addColorStop(0, "rgba(170,230,255,0.45)"); aura.addColorStop(1, "rgba(170,230,255,0)");
    ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(x, cy, 22 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(Math.sin(o.wave) * 0.08);

    // 손잡이(둥근 틸 캡슐)
    const hg = ctx.createLinearGradient(-4 * sc, 2 * sc, 4 * sc, 17 * sc);
    hg.addColorStop(0, "#8fd6ff"); hg.addColorStop(1, "#2f8fe0");
    ctx.fillStyle = hg; ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, sc);
    ctx.beginPath(); ctx.ellipse(0, 9 * sc, 3.6 * sc, 8 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.beginPath(); ctx.ellipse(-1.3 * sc, 6 * sc, 1.1 * sc, 3 * sc, 0, 0, Math.PI * 2); ctx.fill();

    // 헤드(둥근 흰/아이시 몸체 + 파란 테)
    const headg = ctx.createRadialGradient(-2.5 * sc, -3.5 * sc, 1, 0, -2 * sc, 9 * sc);
    headg.addColorStop(0, "#ffffff"); headg.addColorStop(1, "#dceaf6");
    ctx.fillStyle = headg; ctx.strokeStyle = "#6fc3ff"; ctx.lineWidth = Math.max(1.5, 1.9 * sc);
    ctx.beginPath(); ctx.ellipse(0, -2 * sc, 8.5 * sc, 6 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 톱니 절단바퀴(연한 파랑 + 별 중심)
    const gr = 4 * sc, teeth = 8, gx = -4.5 * sc, gyy = -5 * sc;
    ctx.fillStyle = "#a9e0ff"; ctx.strokeStyle = "rgba(70,130,180,0.5)"; ctx.lineWidth = Math.max(1, sc * 0.7);
    ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = i / (teeth * 2) * Math.PI * 2, rr = (i % 2 ? gr * 0.62 : gr);
      const px = gx + Math.cos(a) * rr, py = gyy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    oSparkle(gx, gyy, 1.7 * sc, "#ffffff");

    // 나비 돌림 노브(푸른 둥근 날개)
    ctx.fillStyle = "#7fd0ff"; ctx.strokeStyle = "#2f8fe0"; ctx.lineWidth = Math.max(1, sc * 0.8);
    ctx.beginPath(); ctx.ellipse(7.8 * sc, -3.6 * sc, 3.2 * sc, 2 * sc, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(7.8 * sc, 0.4 * sc, 3.2 * sc, 2 * sc, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#eaf6ff"; ctx.beginPath(); ctx.arc(7.8 * sc, -1.6 * sc, 1.1 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 반짝임
    oSparkle(x + 10 * sc, cy - 9 * sc, 1.8 * sc, "rgba(255,255,255,0.9)");
    oSparkle(x - 9 * sc, cy + 3 * sc, 1.1 * sc, "rgba(255,255,255,0.7)");
  }

  // 상단 통조림 보관함
  function drawStored() {
    if (!stored.length) return;
    const n = Math.min(stored.length, 9);
    const cw = 24, gap = 5, totalW = n * (cw + gap) - gap;
    const sx = W / 2 - totalW / 2, y = 86;
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

    // 추락 연출: 어두운 얼음 구덩이 + 빙글빙글 가라앉는 펭귄
    if (player.falling) {
      const ox = player.holeX, gy = playerLineY();
      // 깨진 얼음 구덩이
      const g = ctx.createRadialGradient(ox, gy, 2, ox, gy, 50);
      g.addColorStop(0, "#06182a"); g.addColorStop(0.6, "#103a56"); g.addColorStop(1, "#2f6f95");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ox, gy, 50, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(230,247,255,0.9)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, rr = 1 + (i % 2 ? -0.12 : 0.06); const px = ox + Math.cos(a) * 50 * rr, py = gy + Math.sin(a) * 17 * rr; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.closePath(); ctx.stroke();
      // 그냥 아래로 빠지는 펭귄(살짝 앞으로 기운 채)
      ctx.save();
      const scl = Math.max(0.45, 1 - player.fallY / 220);
      ctx.translate(ox, gy - 20 + player.fallY);
      ctx.rotate(0.16);
      ctx.scale(scl, scl);
      drawPenguin(0, 8, 1.6, player.run, false, false, player.flapT, 0, true, 1);
      ctx.restore();
      // 구덩이 앞쪽 어두운 테(펭귄 하단을 가려 들어가는 느낌)
      ctx.fillStyle = "rgba(8,26,42,0.6)";
      ctx.beginPath(); ctx.ellipse(ox, gy + 9, 50, 11, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }

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
    const flying = !player.onGround && holdJump && player.energy > 0;
    const air = !player.onGround;
    const stretch = air ? Math.max(0.9, Math.min(1.13, 1 + player.vz / 1700)) : 1;
    drawPenguin(x, y - lift, 2.0, player.run, player.stun > 0, flying, player.flapT, player.tumble, air, stretch);
  }

  function drawPenguin(x, y, s, phase, stun, fly, flapPhase, tumble, air, stretch) {
    const fall = (tumble && tumble > 0) ? Math.min(1, tumble / 0.6) : 0;
    let wad = Math.sin(phase) * 0.07;
    if (fall > 0) wad = -0.75 * fall + Math.sin(tumble * 26) * 0.12 * fall;   // 앞으로 휘청
    const stepL = Math.max(0, Math.sin(phase)) * 3;
    const stepR = Math.max(0, Math.sin(phase + Math.PI)) * 3;
    // 날 때는 날개를 크게 펄럭 / 넘어질 땐 날개 버둥
    const flap = fall > 0 ? Math.sin(tumble * 30) * 0.9
      : (fly ? (0.9 + Math.sin(flapPhase) * 0.9) : Math.sin(phase) * 0.16);
    const wingLen = fly ? 11 : 8;
    ctx.save();
    ctx.translate(x, y + fall * 5);
    if (stun && fall <= 0) ctx.globalAlpha = 0.45 + 0.4 * Math.sin(phase * 5);
    ctx.rotate(wad);
    ctx.scale(s, s * (stretch || 1));

    // 발(번갈아 — 공중에선 모음)
    ctx.fillStyle = "#f5a623"; ctx.strokeStyle = "#c87f12"; ctx.lineWidth = 0.8;
    const fl = (fly || air) ? -1 : stepL, fr = (fly || air) ? -1 : stepR;
    ctx.beginPath(); ctx.ellipse(-4, 5 - fl, 3.8, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(4, 5 - fr, 3.8, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 꼬리
    ctx.fillStyle = "#11202b"; ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, 3); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
    // 몸통(등) + 테두리
    const bg = ctx.createLinearGradient(-8, -23, 8, 5);
    bg.addColorStop(0, "#33455a"); bg.addColorStop(0.5, "#22303f"); bg.addColorStop(1, "#101a24");
    ctx.fillStyle = bg; ctx.strokeStyle = "rgba(10,16,24,0.5)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -8, 12.5, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();   // 통통한 몸
    // 흰 배 가장자리(양옆 살짝 보임) — 검은 덩어리 느낌 완화
    ctx.fillStyle = "rgba(244,251,255,0.9)";
    ctx.beginPath(); ctx.ellipse(-7.8, -6, 2.5, 8, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7.8, -6, 2.5, 8, -0.12, 0, Math.PI * 2); ctx.fill();
    // 등 림라이트(좌상단 빛)
    ctx.fillStyle = "rgba(150,185,215,0.28)"; ctx.beginPath(); ctx.ellipse(-3.5, -12, 4, 7, -0.25, 0, Math.PI * 2); ctx.fill();
    // 날개(날 땐 크게 펄럭)
    ctx.fillStyle = "#0e1a24";
    ctx.save(); ctx.translate(-10.5, -9); ctx.rotate(flap); ctx.beginPath(); ctx.ellipse(-wingLen * 0.4, 0, 3.5, wingLen, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(10.5, -9); ctx.rotate(-flap); ctx.beginPath(); ctx.ellipse(wingLen * 0.4, 0, 3.5, wingLen, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // 날 때 반짝이는 활공 효과
    if (fly) {
      ctx.fillStyle = "rgba(180,235,255,0.5)";
      ctx.beginPath(); ctx.arc(0, 8, 5, 0, Math.PI * 2); ctx.fill();
    }
    // 빨간 목도리 + 매듭 + 펄럭이는 자락
    ctx.fillStyle = "#e23b3b"; ctx.strokeStyle = "#a82626"; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(0, -15, 9.2, 2.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c92f2f"; ctx.beginPath();
    ctx.moveTo(6, -14); ctx.lineTo(11.5 + flap * 4, -9 + flap * 7); ctx.lineTo(8, -12.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.arc(0, -15.5, 1.7, 0, Math.PI * 2); ctx.fill();
    // 뒤통수(둥글게) + 하이라이트
    ctx.fillStyle = "#1b2733"; ctx.strokeStyle = "rgba(10,16,24,0.5)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, -20.5, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(150,185,215,0.25)"; ctx.beginPath(); ctx.arc(-2.8, -22.5, 3.2, 0, Math.PI * 2); ctx.fill();
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
    if (state === STATE.PLAY && !galleryMode) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  META.load();
  refreshMetaUI();
  resize();
  requestAnimationFrame(loop);

  // 스크린샷/디버그용: ?auto 면 자동 시작
  if (location.search.indexOf("auto") >= 0 || location.hash.indexOf("auto") >= 0) {
    startGame();
  }
  // ?over: 게임오버 화면 미리보기
  if (location.search.indexOf("over") >= 0) {
    startGame(); distance = 3120; score = 1480; runCoins = 26;
    learned = { Fe: 1, Cu: 1, Ti: 1, Au: 1, He: 1 };
    gameOver();
  }
  // ?fall: 추락 연출 한 프레임 미리보기(정지)
  if (location.search.indexOf("fall") >= 0) {
    startGame(); state = STATE.PLAY; galleryMode = true;
    startFall(W / 2); player.fallY = 46; player.fallSpin = 2.0; player.fallT = 0.55;
  }
  // ?gallery: 아이템 스프라이트를 정적으로 배치해 한 프레임에 모두 확인
  if (location.search.indexOf("gallery") >= 0) {
    startGame(); state = STATE.PLAY; galleryMode = true;
    player.energy = 72;
    const m = location.search.match(/stage=(\d+)/);
    if (m) distance = (+m[1]) * STAGE_LEN + 100;   // 색감 확인용 스테이지 강제
    if (location.search.indexOf("banner") >= 0) { const s = stageLandmark(); bannerT = 1.4; bannerStage = stageIndex() + 1; bannerText = s.icon + " " + s.name; }
    items = [
      { type: "can", el: BUFF_ELEMENTS[0], lane: -0.55, p: 0.42, vp: 0, done: false, wave: 0.5 },
      { type: "can", el: BUFF_ELEMENTS[2], lane: 0.55, p: 0.30, vp: 0, done: false, wave: 2.0 },
      { type: "opener", lane: 0.05, p: 0.62, vp: 0, done: false, wave: 1.0 },
      { type: "hole", lane: -0.4, p: 0.5, vp: 0, len: 0.03, w: 0.5, shape: makeJagged(), done: false, cleared: false },
      { type: "hole", lane: 0, p: 0.93, vp: 0, len: 0.28, w: 1.0, shape: makeJagged(), done: false, cleared: false },
    ];
    stored = [{ symbol: "Fe", name: "철", color: "#9aa7b0" }, { symbol: "Cu", name: "구리", color: "#d98f5a" }, { symbol: "Au", name: "금", color: "#e8c349" }];
    scenery = [
      { type: "landmark", key: stageLandmark().key, lane: -1.3, p: 0.5, vp: 0, flip: false },
      { type: "landmark", key: stageLandmark().key, lane: 1.32, p: 0.66, vp: 0, flip: true },
      { type: "igloo", lane: -1.3, p: 0.34, vp: 0, flip: false },
      { type: "penguin", lane: 1.28, p: 0.4, vp: 0, flip: true },
    ];
  }
})();

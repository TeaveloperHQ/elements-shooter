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
  // 지면 위 물체의 깊이 전진 속도 — 도로 가로줄(scrollY) 스크롤과 정확히 일치시킨다
  // 가로줄 위상: (scrollY/80)/16, scrollY += speed*dt*0.6  ⇒  du/dt = speed*0.6/1280, dp = pBottom*du
  function groundDP() {
    const pB = (H - horizonY()) / (playerLineY() - horizonY());
    return pB * speed * 0.6 / 1280;
  }
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
  const STATE = { MENU: 0, PLAY: 1, OVER: 2, RELAY: 3 };
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
  // ----- 보스(랩) -----
  let lap = 0;                          // 0:남극→북극(북극곰), 1:북극→남극(바다표범), 2:반복(난이도↑)
  let bosses = [], shots = [];          // 보스들 / 투사체(캔·눈덩이)
  let bossActive = false, bossTriggeredLap = -1, bossCanTimer = 0;
  let minaT = 0, minaFwT = 0, minaStage = -1;          // 서울 'mina' 이스터에그(점프 트리거 → 불꽃놀이)

  // 남극 → 북극 세계 일주: 스테이지마다 나라별 명물(얼음조각)
  const STAGE_LEN = 6800;
  const STAGES = [
    { key: "iceberg",   name: "남극",      icon: "🐧", tint: null },
    { key: "moai",      name: "이스터섬",  icon: "🗿", tint: "rgba(80,200,180,0.12)" },
    { key: "liberty",   name: "미국",      icon: "🗽", tint: "rgba(120,160,210,0.10)" },
    { key: "clock",     name: "영국",      icon: "🎡", tint: "rgba(150,160,175,0.16)" },
    { key: "eiffel",    name: "프랑스",    icon: "🗼", tint: "rgba(210,150,200,0.14)" },
    { key: "korea",     name: "한국",      icon: "🇰🇷", tint: "rgba(120,180,160,0.12)" },
    { key: "windmill",  name: "네덜란드",  icon: "🌷", tint: "rgba(120,200,170,0.12)" },
    { key: "pisa",      name: "이탈리아",  icon: "🍕", tint: "rgba(255,180,120,0.16)" },
    { key: "pyramid",   name: "이집트",    icon: "🐫", tint: "rgba(255,170,80,0.22)" },
    { key: "taj",       name: "인도",      icon: "🕌", tint: "rgba(255,150,110,0.20)" },
    { key: "northpole", name: "북극",      icon: "❄️", tint: "rgba(150,210,255,0.16)" },
  ];
  const LAP_LEN = STAGES.length * STAGE_LEN;            // 한 바퀴(남극~북극) 길이
  function lapDist() { return (distance || 0) - lap * LAP_LEN; }            // 이번 랩에서 달린 거리
  function stageOrdinal() { return Math.min(STAGES.length - 1, Math.max(0, Math.floor(lapDist() / STAGE_LEN))); }
  // 진행 순서(ordinal)와 실제 나라(index): 짝수 랩은 남극→북극, 홀수 랩은 북극→남극으로 뒤집힘
  function stageIndex() { const o = stageOrdinal(); return (lap % 2 === 0) ? o : (STAGES.length - 1 - o); }
  function stageLandmark() { return STAGES[stageIndex()]; }
  function bossKind() { return (lap % 2 === 0) ? "bear" : "seal"; }
  function bossName() { return bossKind() === "bear" ? "북극곰" : "바다표범"; }
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
      falling: false, fallT: 0, fallY: 0, fallVy: 0, fallSpin: 0, holeX: 0, fallFromX: 0, fallDir: 1, fallHole: null,
    };
    holdJump = false;
    items = []; particles = []; texts = []; scenery = []; stored = [];
    score = 0; distance = 0; learned = {}; runCoins = 0;
    spawnTimer = 1.8; elapsed = 0; speed = 150; scrollY = 0; shake = 0; screenFlash = 0; curveT = 0; decorTimer = 0.3; lastStage = 0; lastCanyonStage = -1; bannerT = 0; supplyStage = -1; supply = [];
    lap = 0; bosses = []; shots = []; bossActive = false; bossTriggeredLap = -1; bossCanTimer = 0;
    minaT = 0; minaFwT = 0; minaStage = -1;
    updateHUD();
  }

  // ===================== 입력 =====================
  let keyLeft = false, keyRight = false, holdJump = false, hungryToast = 0;
  function pointerMove(clientX) { const r = canvas.getBoundingClientRect(); player.targetX = clientX - r.left; }
  function press() {   // 점프(에너지 있어야 가능) / 보스전에선 캔 던지기
    if (state !== STATE.PLAY) return;
    if (bossActive) { throwCan(); return; }
    if (player.onGround) {
      if (player.energy >= HOP_COST) {
        player.vz = player.jumpV; player.onGround = false; player.energy -= HOP_COST; SND.jump();
      } else if (hungryToast <= 0) {
        hungryToast = 1.2;
        spawnText(player.x, playerLineY() - 40, "배고파요!", "#ffcf9a", 18);
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

  // 모바일 화면 버튼(터치 기기에서만 표시)
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0 || location.search.indexOf("touch") >= 0) {
    document.body.classList.add("touch");
  }
  function bindHold(id, on, off) {
    const el = document.getElementById(id); if (!el) return;
    const down = function (e) { e.preventDefault(); on(); };
    const up = function (e) { if (e) e.preventDefault(); off(); };
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  bindHold("btn-left", function () { keyLeft = true; }, function () { keyLeft = false; });
  bindHold("btn-right", function () { keyRight = true; }, function () { keyRight = false; });
  bindHold("btn-jump", function () { holdJump = true; press(); }, function () { holdJump = false; });

  // 손잡이(왼손/오른손) 옵션 — 삼각 버튼 클러스터를 좌/우로
  let handed = "r";
  try { handed = localStorage.getItem("es_hand") || "r"; } catch (e) {}
  const tcEl = document.getElementById("touch-controls");
  const handBtn = document.getElementById("hand-toggle");
  function applyHand() {
    if (tcEl) { tcEl.classList.toggle("rh", handed === "r"); tcEl.classList.toggle("lh", handed === "l"); }
    if (handBtn) handBtn.textContent = (handed === "r") ? "오른손잡이" : "왼손잡이";
  }
  applyHand();
  if (handBtn) handBtn.addEventListener("click", function () {
    handed = (handed === "r") ? "l" : "r";
    try { localStorage.setItem("es_hand", handed); } catch (e) {}
    applyHand();
  });

  // ===================== 화면 전환 =====================
  const startScreen = document.getElementById("start-screen");
  const overScreen = document.getElementById("over-screen");
  const relayScreen = document.getElementById("relay-screen");
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("retry-btn").addEventListener("click", function () {
    overScreen.classList.add("hidden"); startScreen.classList.remove("hidden");
  });
  document.getElementById("relay-btn").addEventListener("click", advanceLap);

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
  // 협곡 단면의 '랜덤 그물(균열망)' — 생성 시 한 번만 결정, 이후엔 원근으로 크기만 변함
  // 정규화 좌표: x −1~1, y 0(위)~1(아래). 지터된 격자 노드 + 고정 대각 균열.
  function makeStrata() {
    const cols = 7 + ((Math.random() * 4) | 0);        // 가로 칸 많게=가로로 좁은 셀(7~10)
    const rows = 2 + ((Math.random() * 2) | 0);        // 세로 칸 적게=세로로 긴 셀(2~3)
    const nodes = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const edge = (c === 0 || c === cols);          // 좌우 끝은 흔들지 않음(테두리 정렬)
        const jx = edge ? 0 : (Math.random() - 0.5) * (2 / cols) * 0.6;
        const jy = (r === 0 || r === rows) ? 0 : (Math.random() - 0.5) * (1 / rows) * 0.7;
        row.push({ x: -1 + (c / cols) * 2 + jx, y: r / rows + jy });
      }
      nodes.push(row);
    }
    const jit = [];                                    // 셀(면)별 명암 지터 — 색차 경계용(고정)
    for (let r = 0; r < rows; r++) { const jr = []; for (let c = 0; c < cols; c++) jr.push((Math.random() * 2 - 1) * 9); jit.push(jr); }
    return { nodes: nodes, rows: rows, cols: cols, jit: jit };
  }
  function spawnObstacle() {
    let r = Math.random();
    // 겹침 방지: 협곡이 떠 있거나, 다른 구덩이가 아직 가까이(p<0.28) 있으면 크레바스 대신 통조림
    if (r < 0.35 && items.some(function (o) { return o.canyon || (o.type === "hole" && o.p < 0.28); })) r = 0.6;
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
    // 접근 중인 보통 크레바스 제거(길 전체를 가로지르는 협곡과 겹치지 않게)
    items = items.filter(function (o) { return !(o.type === "hole" && !o.canyon && o.p < 0.92); });
    items.push({ type: "hole", canyon: true, lane: 0, p: 0, vp: 0.10, done: false, cleared: false,
      w: 1.3, len: 0.08, shape: makeJagged() });
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
      scenery.push({ type: "landmark", key: lm.key, icon: lm.icon, lane: side * (1.18 + Math.random() * 0.35),
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
      player.fallSpin += dt * player.fallDir * 13;           // 굴러떨어지는 회전
      if (player.fallT < 0.42) player.fallY += 26 * dt;      // 가장자리에서 가운데로 구르며 살짝 가라앉음
      else { player.fallVy += 1500 * dt; player.fallY += player.fallVy * dt; }   // 가운데 도달 후 본격 추락
      player.flapT += dt * 30;
      if (player.fallT > 0.5 && Math.random() < 0.4) spawnParticles(player.holeX, playerLineY(), "#dff0ff", 2, 120);
      updateParticles(dt); updateTexts(dt);
      if (player.fallT > 1.4) gameOver();
      return;
    }
    elapsed += dt;
    speed = 150 + elapsed * 3.2;                  // 점점 빨라짐
    if (!bossActive) distance += speed * dt;      // 보스전 중엔 스테이지 진행 정지(도로는 계속 흐름)
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

    if (bossActive) {
      updateBoss(dt);
    } else {
      // 스폰(속도에 비례해 잦아짐)
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawnTimer = Math.max(0.6, 1.5 - elapsed * 0.012); spawnObstacle(); }

      // 스테이지 전환 알림(랩/방향 인식)
      const ord = stageOrdinal();
      if (ord !== lastStage) {
        lastStage = ord;
        const s = stageLandmark();
        bannerT = 2.5; bannerStage = ord + 1; bannerText = s.icon + " " + s.name;
        SND.base();
      }
      const inStage = lapDist() - ord * STAGE_LEN;
      const lastOrd = STAGES.length - 1;
      // 협곡 직전 보급(마지막 스테이지 제외)
      if (ord < lastOrd && supplyStage !== ord && inStage > STAGE_LEN * 0.6) {
        supplyStage = ord;
        supply.push({ t: 0.0, kind: "can" }, { t: 1.0, kind: "can" },
                     { t: 2.6, kind: "opener" }, { t: 3.9, kind: "opener" });
      }
      // 거대 협곡(마지막 스테이지 제외 — 거기선 보스가 기다림)
      // 기준: 펭귄 에너지가 아니라 '도로가 보급(통조림·따개)을 뿌렸는가'.
      // → 가장자리에 숨어 안 먹어도 협곡은 나온다(회피 악용 방지)
      if (ord < lastOrd && lastCanyonStage !== ord && inStage > STAGE_LEN * 0.9 && supplyStage === ord) {
        lastCanyonStage = ord;
        spawnCanyon();
      }
      // 보스 등장: 마지막 스테이지 중반
      if (ord === lastOrd && inStage > STAGE_LEN * 0.4 && bossTriggeredLap !== lap) {
        startBoss();
      }
      // 서울 비밀 지점: 한국 스테이지 중반에 💜 마커를 한 번 흘려보냄(점프하면 이스터에그)
      if (stageLandmark().key === "korea" && minaStage !== lap * 100 + ord && inStage > STAGE_LEN * 0.5) {
        minaStage = lap * 100 + ord;
        items.push({ type: "secret", lane: 0, p: 0, vp: 0.10, pulse: 0, done: false });
      }
    }
    // mina 이스터에그 진행 중: 배경 불꽃놀이
    if (minaT > 0) {
      minaT -= dt; minaFwT -= dt;
      if (minaFwT <= 0) { minaFwT = 0.32; firework(); }
    }
    for (let i = supply.length - 1; i >= 0; i--) {
      supply[i].t -= dt;
      if (supply[i].t <= 0) { spawnSupply(supply[i].kind); supply.splice(i, 1); }
    }

    // 길가 풍경 스폰/이동
    decorTimer -= dt;
    if (decorTimer <= 0) { decorTimer = 0.4 + Math.random() * 0.4; spawnScenery(); }
    for (let i = scenery.length - 1; i >= 0; i--) {
      const d = scenery[i];
      if (d.vp > 0) d.p += groundDP() * dt;          // 도로 가로줄과 같은 속도
      if (d.p > 1.35) scenery.splice(i, 1);            // 화면 아래로 넘어간 뒤 제거
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
      if (o.vp > 0) o.p += groundDP() * dt;          // 도로 가로줄과 같은 속도(따로 안 놀게)

      // ----- 서울 비밀 지점(💜): 그 위에서 점프하면 mina 이스터에그 -----
      if (o.type === "secret") {
        o.pulse += dt * 4;
        if (!o.done && o.p >= 0.95) {
          const ox = laneToX(1, o.lane);
          if (player.jumpY > 16 && Math.abs(player.x - ox) < 48) { o.done = true; triggerMina(); items.splice(i, 1); continue; }
        }
        if (o.p > 1.35) items.splice(i, 1);
        continue;
      }

      // ----- 크레바스: 길이(len)만큼 플레이어 선을 지나가는 동안 계속 판정 -----
      if (o.type === "hole") {
        const frontP = o.p, backP = o.p - o.len;
        const big = !!o.canyon;
        const overLine = backP <= 1 && frontP >= 1;          // 플레이어 선이 구덩이 위
        if (overLine && player.onGround) {
          const ox = laneToX(1, o.lane), holeHalf = halfAt(1) * o.w;
          const dist = Math.abs(player.x - ox);
          if (dist < holeHalf + 6) {
            if (big || dist < holeHalf * 0.45) {
              // 정가운데(또는 거대 협곡)로 빠짐 → 추락 연출
              startFall(ox, o);
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
          const big = !!o.canyon;
          score += big ? 80 : 5; runCoins += big ? 2 : 1;
          if (big) spawnText(player.x, playerLineY() - player.jumpY - 36, "건넜다!", "#aef0c0", 22);
        }
        if (backP > 1.3) items.splice(i, 1);             // 화면 아래로 넘어간 뒤 제거
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
      if (o.p > 1.35) items.splice(i, 1);              // 화면 아래로 넘어간 뒤 제거
    }
  }

  // 돌부리에 걸려 넘어짐: 에너지 감소 + 비틀거림(아웃은 아님)
  function tripPenguin(ox) {
    player.energy = Math.max(0, player.energy - 22);
    player.stun = 0.7;
    player.tumble = 0.6;
    screenFlash = 0.22; shake = Math.min(16, shake + 9);
    spawnParticles(ox, playerLineY(), "#dfe9f2", 12, 180);
    spawnText(player.x, playerLineY() - 44, "걸려 넘어짐! 💫", "#ffcf9a", 18);
    SND.bad();
    updateHUD();
  }

  // 크레바스 추락 연출 시작(아케이드식): 펭귄이 구덩이로 빙글빙글 빨려들고 얼음 파편 솟구침
  function startFall(ox, hole) {
    player.falling = true; player.fallT = 0; player.fallY = 0; player.fallVy = 0; player.fallSpin = 0;
    player.holeX = ox; player.fallFromX = player.x;            // 빠진 위치 기억 → 가운데(ox)로 굴러감
    player.fallDir = (ox >= player.x) ? 1 : -1;                // 구르는 방향
    player.fallHole = hole || null;                           // 빠질 크레바스(안으로 사라지게 클립)
    player.onGround = false;
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
    stored.push({ symbol: el.symbol, name: el.name, color: el.color, period: el.period, group: el.group, number: el.number });
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

  // ===================== 보스전(랩 끝 — 추격전) =====================
  function playerLane() { return (player.x - curveCenterX(1)) / halfAt(1); }   // 펭귄 현재 레인(-1~1)

  function bossCount() { return Math.min(4, 1 + lap); }                       // 랩 오를수록 보스 마리 ↑
  function startBoss() {
    bossActive = true; bossTriggeredLap = lap;
    items = items.filter(function (o) { return o.type !== "hole"; });          // 남은 크레바스 제거
    supply = [];
    const count = bossCount(), hp = 7 + lap * 2;                               // 마리 수↑·마리당 HP는 약간↓
    bosses = [];
    for (let i = 0; i < count; i++) {
      const baseLane = (count === 1) ? 0 : (-0.62 + 1.24 * i / (count - 1));
      bosses.push({ kind: bossKind(), hp: hp, maxHp: hp, baseLane: baseLane, lane: baseLane, p: 0.42 + (i % 2) * 0.06,
        bob: i * 1.4, atkT: 1.1 + i * 0.6, hitFlash: 0, intro: 1.4, win: 0, throwT: 0, aimLane: 0, dead: false });
    }
    bossCanTimer = 0;
    bannerT = 2.6; bannerStage = 0; bannerText = "⚔ " + bossName() + (count > 1 ? " ×" + count : "") + " 등장!";
    showToast("🥫 모아둔 통조림을 던져 " + bossName() + (count > 1 ? " " + count + "마리" : "") + "를 쓰러뜨리세요! (탭=던지기)", true);
    SND.fall();
  }

  function throwCan() {
    if (!bosses.length) return;
    if (!stored.length) {
      spawnText(player.x, playerLineY() - 56, "통조림이 없어요!", "#ffcf9a", 16);
      SND.bad(); return;
    }
    const c = stored.pop();
    shots.push({ kind: "can", lane: playerLane(), p: 0.98, sym: c.symbol, group: c.group, spin: 0 });
    spawnParticles(player.x, playerLineY() - 26, "#ffe08a", 6, 140);
    SND.jump(); updateHUD();
  }

  function updateBoss(dt) {
    if (!bosses.length) return;
    // 탄약 보충(공용): 다 떨어져도 잡게 통조림을 가끔 흘려보냄
    bossCanTimer -= dt;
    if (bossCanTimer <= 0) {
      bossCanTimer = 2.4;
      if (stored.length < 6) {
        const el = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
        items.push({ type: "can", el: el, lane: -0.7 + Math.random() * 1.4, p: 0, vp: 0.10, done: false, wave: Math.random() * 6.28 });
      }
    }
    let allDone = true;
    for (const b of bosses) {
      b.bob += dt;
      if (b.hitFlash > 0) b.hitFlash -= dt;
      if (b.intro > 0) b.intro -= dt;
      if (b.dead) { if (b.win > 0) { b.win -= dt; b.p += dt * 0.25; allDone = false; } continue; }
      allDone = false;
      b.lane = b.baseLane + Math.sin(b.bob * (0.9 + lap * 0.06)) * 0.22;        // 베이스 레인 주변에서 휘청
      b.p = 0.42 + Math.sin(b.bob * 0.7) * 0.05;
      if (b.throwT > 0) {                                                       // 공격: 와인드업→발사
        const prev = b.throwT; b.throwT -= dt;
        if (prev > 0.22 && b.throwT <= 0.22) {
          const water = (b.kind === "seal");
          const mz = projY(b.p) - 16 * projScale(b.p);
          shots.push({ kind: water ? "water" : "snow", lane: b.lane, p: b.p, aim: b.aimLane, vp: 0.85 + lap * 0.08, wob: Math.random() * 6.28 });
          spawnParticles(laneToX(b.p, b.lane), mz, water ? "#8fe0ff" : "#eaf4ff", water ? 12 : 7, water ? 200 : 150);
          SND.bad();
        }
      }
      if (b.intro <= 0 && b.throwT <= 0) {
        b.atkT -= dt;
        if (b.atkT <= 0) { b.atkT = Math.max(0.6, 1.8 - lap * 0.18) + Math.random() * 0.5; b.throwT = 0.5; b.aimLane = playerLane() + (Math.random() - 0.5) * 0.5; }
      }
      if (b.hp <= 0) {
        b.dead = true; b.win = 1.2;
        spawnParticles(laneToX(b.p, b.lane), projY(b.p), "#ffffff", 22, 240);
        shake = Math.min(20, shake + 10); SND.flag();
      }
    }
    updateShots(dt);
    if (allDone) {                                                             // 전부 격파 → 귀환 화면
      spawnText(W / 2, H * 0.4, "🏆 " + bossName() + " 전부 격파!", "#ffe678", 28);
      SND.base(); bossCleared();
    }
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (s.kind === "can") {                    // 펭귄 → 보스(깊이 감소). 여러 보스 중 명중 판정
        s.p -= 1.15 * dt; s.spin += dt * 16;
        let hit = false;
        for (const b of bosses) {
          if (b.dead || s.p > b.p) continue;
          const sx = laneToX(b.p, s.lane), bx = laneToX(b.p, b.lane);
          if (Math.abs(sx - bx) < 34 * projScale(b.p)) {
            b.hp = Math.max(0, b.hp - 1); b.hitFlash = 0.18;
            spawnParticles(bx, projY(b.p), "#bcd6e8", 10, 180);
            spawnText(bx, projY(b.p) - 24, "−1", "#ff8a8a", 18);
            SND.flag(); hit = true; break;
          }
        }
        if (hit || s.p < 0.18) shots.splice(i, 1);
        continue;
      }
      // 눈덩이: 보스 → 펭귄(깊이 증가, 펭귄 쪽으로 약간 조준)
      s.p += s.vp * dt;
      s.lane += (s.aim - s.lane) * Math.min(1, dt * 2.2);
      if (s.p >= 0.98) {
        const sx = laneToX(1, s.lane);
        if (Math.abs(player.x - sx) < 26 && player.jumpY < 30) loseLife(bossName() + "의 공격에 맞았다!");
        else spawnParticles(sx, playerLineY() + 6, s.kind === "water" ? "#8fe0ff" : "#e8f4ff", 10, 170);
        shots.splice(i, 1);
      }
    }
  }

  // 보스 격파 → 귀환 메시지 화면(일시정지)
  function bossCleared() {
    const beatBear = (lap % 2 === 0);            // 짝수 랩: 남극→북극, 북극곰 격파(북극 정복)
    const t = document.getElementById("relay-title");
    const m = document.getElementById("relay-msg");
    if (beatBear) {
      t.textContent = "🐻‍❄️ 북극 정복!";
      m.innerHTML = "📡 남극 기지에서 긴급 통신<br>「펭귄 대원, 남극에 비상사태! 즉시 귀환하라.」<br><br>🧭 방향을 돌려 <b>남극</b>으로!<br>이번 보스는 <b>바다표범</b> 🦭";
    } else {
      t.textContent = "🦭 남극 정복!";
      m.innerHTML = "📡 북극 기지에서 긴급 통신<br>「다시 북극에 문제 발생! 돌아와 달라.」<br><br>🧭 방향을 돌려 <b>북극</b>으로!<br>이번 보스는 <b>북극곰</b> 🐻‍❄️";
    }
    bossActive = false; bosses = []; shots = [];
    state = STATE.RELAY;
    relayScreen.classList.remove("hidden");
  }
  // 귀환 화면 [계속] → 다음 랩 시작(방향 반전·난이도↑)
  function advanceLap() {
    relayScreen.classList.add("hidden");
    lap++;
    distance = lap * LAP_LEN + 60;
    bossActive = false; bosses = []; shots = [];
    lastStage = -1; supplyStage = -1; lastCanyonStage = -1; bossTriggeredLap = -1;
    spawnTimer = 1.2; bossCanTimer = 0;
    items = items.filter(function (o) { return o.type !== "hole"; });
    score += 600 * lap; runCoins += 8 * lap;
    bannerT = 2.8; bannerStage = 0;
    bannerText = (lap % 2 === 1) ? "🧭 북극 → 남극 (난이도 ↑)" : "🧭 남극 → 북극 (난이도 ↑)";
    state = STATE.PLAY;
    updateHUD();
  }

  // ----- 보스/투사체 렌더 -----
  function drawBoss() {
    if (!bosses.length) return;
    const order = bosses.slice().sort(function (a, b) { return a.p - b.p; });   // 먼 보스부터
    for (const bo of order) {
      const x = laneToX(bo.p, bo.lane), y = projY(bo.p), s = projScale(bo.p) * 2.2;
      ctx.save();
      ctx.translate(x, y);
      if (bo.win > 0) { const f = 1 - bo.win / 1.2; ctx.rotate(f * 0.6); ctx.globalAlpha = Math.max(0, 1 - f); }
      if (bo.kind === "bear") drawBear(s, bo.bob, bo.hitFlash > 0, bo.throwT);
      else drawSeal(s, bo.bob, bo.hitFlash > 0, bo.throwT);
      ctx.restore();
    }
  }
  // 던지기 진행도(throwT)에 따른 팔/몸 스윙: 와인드업(뒤로) → 릴리즈(앞으로)
  function throwArmAngle(throwT, neutral, up, fwd) {
    if (throwT > 0.22) { const w = (0.5 - throwT) / 0.28; return neutral + (up - neutral) * Math.min(1, w); }
    if (throwT > 0) { const r = (0.22 - throwT) / 0.22; return up + (fwd - up) * r; }
    return neutral;
  }

  // 북극곰 — 어깨에 붙은 팔, 오른팔은 던지기 와인드업→릴리즈로 스윙
  function drawBear(s, t, hurt, throwT) {
    const lit = hurt ? "#ffe0e0" : "#f6fbff", body = hurt ? "#f4bcbc" : "#dde9f6", shade = hurt ? "#e09c9c" : "#bdd2e8";
    const claw = "#9fb3c6";
    const winding = throwT > 0.22;
    ctx.save(); ctx.scale(s, s); ctx.translate(0, Math.sin(t * 6) * 1.4);
    // 그림자
    ctx.fillStyle = "rgba(40,80,120,0.22)"; ctx.beginPath(); ctx.ellipse(0, 29, 25, 6, 0, 0, Math.PI * 2); ctx.fill();
    // 뒷다리 + 발톱
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.ellipse(-11, 23, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11, 23, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = claw;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(-11 + i * 4, 31, 1.2, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(11 + i * 4, 31, 1.2, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
    // 쉬는 왼팔(어깨에서 아래로) — 몸통 뒤에서 살짝 보이게 먼저
    function paw(len) { ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(0, len, 5.2, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = claw; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(i * 2.3, len + 10, 1, 2.2, 0, 0, Math.PI * 2); ctx.fill(); } }
    ctx.save(); ctx.translate(-15, -7); ctx.rotate(0.32); paw(9); ctx.restore();
    // 몸통(밝음) — 깔끔한 음영(몸 안으로 클립)
    ctx.fillStyle = lit; ctx.strokeStyle = shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 5, 20, 23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 5, 20, 23, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.ellipse(-2, 10, 11, 15, 0, 0, Math.PI * 2); ctx.fill();   // 가운데 밝은 가슴·배
    ctx.fillStyle = "rgba(120,150,182,0.26)"; ctx.beginPath(); ctx.ellipse(17, 4, 9, 21, 0, 0, Math.PI * 2); ctx.fill();   // 오른쪽 가장자리 부드러운 그늘
    ctx.restore();
    ctx.fillStyle = lit; ctx.beginPath(); ctx.ellipse(0, -12, 15, 11, 0, Math.PI, 0); ctx.fill();                          // 어깨 험프
    // 머리 + 낮고 작은 귀
    ctx.fillStyle = lit; ctx.strokeStyle = shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, -23, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-10, -31, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(10, -31, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#c9d9ea"; ctx.beginPath(); ctx.arc(-10, -31, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(10, -31, 1.8, 0, Math.PI * 2); ctx.fill();
    // 주둥이(앞으로 돌출)
    ctx.fillStyle = lit; ctx.strokeStyle = shade; ctx.beginPath(); ctx.ellipse(0, -15, 8.5, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#11181f"; ctx.beginPath(); ctx.ellipse(0, -17.5, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill();   // 코
    ctx.strokeStyle = "rgba(30,40,52,0.6)"; ctx.lineWidth = 0.8;                                                // 입
    ctx.beginPath(); ctx.moveTo(0, -15.5); ctx.lineTo(0, -12.5); ctx.moveTo(0, -12.5); ctx.quadraticCurveTo(-3.5, -11.5, -4.5, -13.5); ctx.moveTo(0, -12.5); ctx.quadraticCurveTo(3.5, -11.5, 4.5, -13.5); ctx.stroke();
    // 눈(사납게) + 하이라이트
    ctx.fillStyle = "#11181f";
    ctx.beginPath(); ctx.ellipse(-6, -25, 2, 2.6, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, -25, 2, 2.6, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(-6.6, -26, 0.7, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(5.4, -26, 0.7, 0, Math.PI * 2); ctx.fill();
    // 던지는 오른팔(앞쪽) — 어깨 피벗에서 스윙. 와인드업 땐 눈덩이를 들고 있음
    ctx.save();
    ctx.translate(15, -8);
    ctx.rotate(throwArmAngle(throwT, 0.35, -2.2, 0.7));
    paw(11);
    if (winding) { ctx.fillStyle = "#f2f9ff"; ctx.strokeStyle = "#cfe3f2"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 22, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.restore();
  }

  // 바다표범 — 물대포(입에서 물 분사). 와인드업 땐 뒤로 젖혔다가 릴리즈에 앞으로 분사
  function drawSeal(s, t, hurt, throwT) {
    const lit = hurt ? "#ffd6d6" : "#b3c3d2", body = hurt ? "#e6a8a8" : "#8ca2b6", shade = hurt ? "#d49090" : "#6c8398";
    const lunge = -throwArmAngle(throwT, 0, 1, -1.4);     // 와인드업 +(뒤로 젖힘)/릴리즈 -(앞으로)
    const firing = throwT > 0 && throwT <= 0.22;
    ctx.save(); ctx.scale(s, s); ctx.translate(0, Math.sin(t * 5) * 1.3 - lunge * 1.5);
    ctx.fillStyle = "rgba(40,80,120,0.22)"; ctx.beginPath(); ctx.ellipse(0, 29, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
    // 꼬리 지느러미(뒤, 양갈래)
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(-1, 24); ctx.quadraticCurveTo(-13, 31, -9, 23); ctx.quadraticCurveTo(-4, 23, -1, 25); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(1, 24); ctx.quadraticCurveTo(13, 31, 9, 23); ctx.quadraticCurveTo(4, 23, 1, 25); ctx.closePath(); ctx.fill();
    // 몸통 + 그늘면
    ctx.fillStyle = lit; ctx.strokeStyle = shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 6, 18, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 6, 18, 22, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "rgba(244,250,255,0.45)"; ctx.beginPath(); ctx.ellipse(-1, 12, 10, 14, 0, 0, Math.PI * 2); ctx.fill();   // 밝은 배(반대 음영)
    ctx.fillStyle = "rgba(70,92,112,0.28)"; ctx.beginPath(); ctx.ellipse(15, 4, 8, 20, 0, 0, Math.PI * 2); ctx.fill();      // 오른쪽 가장자리 그늘
    ctx.fillStyle = "rgba(64,84,104,0.45)";                                                                                  // 등쪽에만 점박이(배 제외)
    const spots = [[-8, -4], [-3, -8], [4, -6], [8, -1], [-10, 2], [10, 5]];
    for (const sp of spots) { ctx.beginPath(); ctx.ellipse(sp[0], sp[1], 1.6, 1.2, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // 앞 지느러미
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.ellipse(-15, 9, 5, 12, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(15, 9, 5, 12, -0.5, 0, Math.PI * 2); ctx.fill();
    // 머리(와인드업 때 살짝 뒤로 젖힘)
    ctx.save(); ctx.translate(0, -16); ctx.rotate(lunge * 0.18);
    ctx.fillStyle = lit; ctx.strokeStyle = shade; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 주둥이 / 입(분사 중엔 크게 벌림)
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 6, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (firing) { ctx.fillStyle = "#0d2230"; ctx.beginPath(); ctx.ellipse(0, 7, 3.6, 3, 0, 0, Math.PI * 2); ctx.fill();   // 벌린 입
      ctx.fillStyle = "rgba(140,220,255,0.9)"; ctx.beginPath(); ctx.moveTo(-2.5, 8); ctx.lineTo(2.5, 8); ctx.lineTo(1.2, 16); ctx.lineTo(-1.2, 16); ctx.closePath(); ctx.fill(); }   // 입에서 물줄기
    else { ctx.fillStyle = "#11181f"; ctx.beginPath(); ctx.ellipse(0, 5, 3, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "rgba(20,28,40,0.7)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, 9); ctx.stroke(); }
    // 큰 눈 + 하이라이트
    ctx.fillStyle = "#11181f"; ctx.beginPath(); ctx.arc(-6, -3, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(6, -3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(-7, -4, 1, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(5, -4, 1, 0, Math.PI * 2); ctx.fill();
    // 수염
    ctx.strokeStyle = "rgba(240,248,255,0.75)"; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(-13, 5); ctx.moveTo(-3, 7); ctx.lineTo(-13, 8); ctx.moveTo(3, 6); ctx.lineTo(13, 5); ctx.moveTo(3, 7); ctx.lineTo(13, 8); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawShots() {
    for (const s of shots) {
      const x = laneToX(s.p, s.lane), y = projY(s.p), sc = projScale(s.p);
      if (s.kind === "can") {
        ctx.save(); ctx.translate(x, y - 8 * sc); ctx.rotate(s.spin); ctx.scale(sc, sc);
        ctx.fillStyle = "#cfd8e0"; ctx.strokeStyle = "#8a98a4"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(-7, -9, 14, 18); ctx.fill(); ctx.stroke();
        ctx.fillStyle = groupColor(s.group); ctx.fillRect(-7, -3, 14, 6);   // 족별 라벨
        ctx.fillStyle = "#16273a"; ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(s.sym || "", 0, 2); ctx.textAlign = "start";
        ctx.restore();
      } else if (s.kind === "water") {            // 바다표범 물대포
        ctx.save(); ctx.translate(x, y - 10 * sc);
        ctx.fillStyle = "rgba(120,210,255,0.32)"; ctx.beginPath(); ctx.ellipse(0, -7 * sc, 4.5 * sc, 11 * sc, 0, 0, Math.PI * 2); ctx.fill();   // 물줄기 꼬리
        const wob = Math.sin((s.wob || 0) + s.p * 20) * 1.5 * sc;
        ctx.fillStyle = "rgba(80,185,245,0.92)"; ctx.strokeStyle = "rgba(205,240,255,0.85)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(wob, 0, 7 * sc, 8 * sc, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.beginPath(); ctx.arc(wob - 2 * sc, -2 * sc, 2 * sc, 0, Math.PI * 2); ctx.fill();   // 하이라이트
        ctx.restore();
      } else {                                     // 눈덩이(북극곰)
        ctx.save(); ctx.translate(x, y - 10 * sc);
        ctx.fillStyle = "rgba(180,210,235,0.45)"; ctx.beginPath(); ctx.arc(0, 0, 9 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f2f9ff"; ctx.strokeStyle = "#bcd6e8"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 6.5 * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawBossHP() {
    if (!bosses.length) return;
    let hp = 0, max = 0, alive = 0;
    for (const b of bosses) { hp += Math.max(0, b.hp); max += b.maxHp; if (!b.dead) alive++; }
    const bw = W * 0.62, bx = W / 2 - bw / 2, by = 92, bh = 14;
    ctx.save();
    ctx.fillStyle = "rgba(10,24,40,0.6)"; ctx.fillRect(bx - 6, by - 22, bw + 12, bh + 28);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffdada"; ctx.font = "bold 13px sans-serif";
    ctx.fillText((bosses[0].kind === "bear" ? "🐻‍❄ " : "🦭 ") + bossName() + (bosses.length > 1 ? " ×" + alive : ""), W / 2, by - 7);
    ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(bx, by, bw, bh);
    const frac = max > 0 ? Math.max(0, hp / max) : 0;
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, "#ff6b6b"); g.addColorStop(1, "#ffa86b");
    ctx.fillStyle = g; ctx.fillRect(bx, by, bw * frac, bh);
    // 보스별 칸 구분선
    if (bosses.length > 1) { ctx.strokeStyle = "rgba(10,24,40,0.7)"; ctx.lineWidth = 1; for (let i = 1; i < bosses.length; i++) { const lx = bx + bw * i / bosses.length; ctx.beginPath(); ctx.moveTo(lx, by); ctx.lineTo(lx, by + bh); ctx.stroke(); } }
    ctx.strokeStyle = "rgba(255,210,210,0.85)"; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = "#ffe08a"; ctx.font = "bold 12px sans-serif";   // 던질 통조림(탄약) 수
    ctx.fillText("🥫 " + stored.length, W / 2, by + bh + 13);
    ctx.textAlign = "start"; ctx.restore();
  }

  // ===================== 파티클 / 텍스트 / 눈 =====================
  function spawnParticles(x, y, color, n, spd) {
    spd = spd || 160;
    for (let i = 0; i < n; i++) particles.push({
      x: x, y: y, vx: (Math.random() - 0.5) * spd, vy: (Math.random() - 0.5) * spd - 30,
      life: 0.4 + Math.random() * 0.35, max: 0.75, color: color, r: 1.5 + Math.random() * 2,
    });
  }
  // 서울 'mina' 이스터에그 발동
  function triggerMina() {
    minaT = 6.5; minaFwT = 0;                       // 외침 없이 — 롯데타워 표시 + 불꽃놀이만
    shake = Math.min(12, shake + 6); SND.flag();
  }
  function firework() {
    const fx = 40 + Math.random() * (W - 80), fy = 26 + Math.random() * (horizonY() * 0.72);
    const cols = ["#ff6bb0", "#ffd34e", "#7ad9ff", "#9cff8f", "#c77ad9", "#ff8f6b"];
    const col = cols[(Math.random() * cols.length) | 0], nn = 22;
    for (let i = 0; i < nn; i++) { const a = i / nn * Math.PI * 2, sp = 70 + Math.random() * 70; particles.push({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 24, life: 0.85 + Math.random() * 0.5, max: 1.35, color: col, r: 1.6 + Math.random() * 1.6 }); }
    particles.push({ x: fx, y: fy, vx: 0, vy: 0, life: 0.25, max: 0.4, color: "#ffffff", r: 4 });
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
    if (state !== STATE.MENU) {
      drawHoles();                 // 크레바스/협곡: 도로 위 · 나머지보다 아래
      drawScenery();
      drawItems();                 // 통조림/따개(구덩이 위에 뜸)
      if (bossActive) { drawBoss(); drawShots(); }
      drawParticles();
      drawPlayer();
      if (hungryToast > 0 && state === STATE.PLAY && player) drawBasicCan(player.x, playerLineY() - player.jumpY - 60 + Math.sin(elapsed * 10) * 2, 1.1);
      drawTexts();
    }
    drawSnow();
    ctx.restore();
    drawOverlayFx();
  }

  function drawOverlayFx() {
    if (screenFlash > 0) { ctx.fillStyle = "rgba(255,40,40," + (screenFlash * 0.45) + ")"; ctx.fillRect(0, 0, W, H); }
    if (state !== STATE.MENU) { drawNav(); if (!bossActive) drawStored(); drawEnergyGauge(); drawStageBanner(); }
    if (bossActive && state === STATE.PLAY) drawBossHP();
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
    if (bannerStage > 0) {
      ctx.fillStyle = "#ffe08a"; ctx.font = "bold 13px sans-serif";
      ctx.fillText("STAGE " + bannerStage, W / 2, cy - 9);
    }
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 23px sans-serif";
    ctx.fillText(bannerText, W / 2, cy + (bannerStage > 0 ? 17 : 8));
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
    // 지도는 항상 남극(좌)→북극(우) 고정. 마커는 '현재 나라'(방향 반전 시 우→좌로 이동)
    const ordF = Math.max(0, Math.min(n - 1, lapDist() / STAGE_LEN));
    const geo = (lap % 2 === 0) ? ordF : (n - 1 - ordF);
    const prog = geo / (n - 1);
    const fwd = (lap % 2 === 0);

    // 패널
    ctx.fillStyle = "rgba(10,24,40,0.5)";
    ctx.fillRect(x0 - 16, yL - 20, w + 32, 38);

    // 전체 경로(점선) + 진행 경로(출발지 쪽에서 마커까지)
    ctx.strokeStyle = "rgba(175,210,238,0.45)"; ctx.lineWidth = 3; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x0, yL); ctx.lineTo(x1, yL); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#6fd3ff"; ctx.lineWidth = 3; ctx.lineCap = "round";
    const mx = x0 + w * prog;
    ctx.beginPath(); ctx.moveTo(fwd ? x0 : x1, yL); ctx.lineTo(mx, yL); ctx.stroke();

    // 스테이지 노드 + 아이콘
    ctx.textAlign = "center";
    for (let i = 0; i < n; i++) {
      const nx = x0 + w * (i / (n - 1));
      const reached = fwd ? (geo >= i - 0.001) : (geo <= i + 0.001);
      ctx.fillStyle = reached ? "#6fd3ff" : "rgba(200,220,240,0.45)";
      ctx.beginPath(); ctx.arc(nx, yL, (i === 0 || i === n - 1) ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = reached ? 1 : 0.5;
      ctx.font = "11px sans-serif"; ctx.fillText(STAGES[i].icon, nx, yL - 8);
      ctx.globalAlpha = 1;
    }

    // 현재 위치 마커(펭귄)
    ctx.fillStyle = "#ffe678"; ctx.beginPath(); ctx.arc(mx, yL, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = "10px sans-serif"; ctx.fillStyle = "#1b2733"; ctx.fillText("🐧", mx, yL + 3.5);

    // 끝 라벨 + 현재 스테이지
    ctx.fillStyle = "#bcd6e8"; ctx.font = "bold 9px sans-serif";
    ctx.fillText("남극", x0, yL + 15); ctx.fillText("북극", x1, yL + 15);
    ctx.fillStyle = "#eaf6ff"; ctx.font = "bold 11px sans-serif";
    ctx.fillText("🗺 " + stageLandmark().icon + " " + stageLandmark().name, W / 2, yL + 15);
    ctx.textAlign = "start";
  }

  // ===================== 나라별 지평선 배경 =====================
  function drawBackdrop(hy) {
    const ord = Math.max(0, Math.min(STAGES.length - 1, lapDist() / STAGE_LEN));
    const ordi = Math.floor(ord), frac = ord - ordi;
    const idxOf = function (o) { o = Math.max(0, Math.min(STAGES.length - 1, o)); return (lap % 2 === 0) ? o : (STAGES.length - 1 - o); };
    drawStageScene(STAGES[idxOf(ordi)].key, hy, 1);
    if (frac > 0.82 && ordi < STAGES.length - 1) {     // 경계에서 다음 나라 크로스페이드
      const t = (frac - 0.82) / 0.18; drawStageScene(STAGES[idxOf(ordi + 1)].key, hy, t * t * (3 - 2 * t));
    }
  }
  function drawStageScene(key, hy, a) {
    ctx.save(); ctx.globalAlpha = a;
    if (key === "moai") bgMoai(hy);
    else if (key === "liberty") bgCity(hy);
    else if (key === "clock") bgLondon(hy);
    else if (key === "eiffel") bgEiffel(hy);
    else if (key === "windmill") bgWindmill(hy);
    else if (key === "pisa") bgItaly(hy);
    else if (key === "pyramid") bgEgypt(hy);
    else if (key === "taj") bgTaj(hy);
    else if (key === "korea") bgKorea(hy);
    else drawSnowMountains(hy);                          // iceberg(남극)·northpole(북극)
    ctx.restore();
  }
  function drawSnowMountains(hy) {
    for (const b of bergs) {
      const px = b.x + b.w * b.peak, top = hy - b.h, lx = b.x, rx2 = b.x + b.w;
      ctx.fillStyle = b.layer ? "rgba(150,190,222,0.92)" : "rgba(206,230,247,0.96)";
      ctx.beginPath(); ctx.moveTo(lx, hy); ctx.lineTo(px, top); ctx.lineTo(px, hy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = b.layer ? "rgba(116,160,198,0.92)" : "rgba(168,204,232,0.96)";
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(rx2, hy); ctx.lineTo(px, hy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, hy); ctx.stroke();
      if (b.cap) {
        const f = 0.34, yS = top + b.h * f, xl = px + (lx - px) * f, xr = px + (rx2 - px) * f;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(xr, yS);
        ctx.lineTo(px + (xr - px) * 0.45, yS - b.h * 0.05); ctx.lineTo(px - (px - xl) * 0.2, yS + b.h * 0.04);
        ctx.lineTo(px - (px - xl) * 0.6, yS - b.h * 0.02); ctx.lineTo(xl, yS); ctx.closePath(); ctx.fill();
      }
    }
  }
  // 두 톤 건물 블록
  function bgBldg(x, hy, w, h, lit, shade, win) {
    ctx.fillStyle = lit; ctx.fillRect(x, hy - h, w, h);
    ctx.fillStyle = shade; ctx.fillRect(x + w * 0.62, hy - h, w * 0.38, h);
    if (win) { ctx.fillStyle = "rgba(222,238,255,0.45)"; for (let yy = hy - h + 6; yy < hy - 5; yy += 9) for (let xx = x + 4; xx < x + w - 4; xx += 8) ctx.fillRect(xx, yy, 3, 4); }
  }
  // 이스터섬 — 풀 언덕 + 모아이 석상들
  function bgMoai(hy) {
    ctx.fillStyle = "rgba(120,170,150,0.9)";
    ctx.beginPath(); ctx.moveTo(0, hy); for (let x = 0; x <= W; x += 36) ctx.lineTo(x, hy - 9 - Math.sin(x * 0.013) * 7); ctx.lineTo(W, hy); ctx.closePath(); ctx.fill();
    const pos = [[0.15, 54], [0.39, 68], [0.63, 56], [0.85, 46]];
    for (const p of pos) {
      const cx = W * p[0], h = p[1], w = h * 0.5, base = hy - 5;
      const dir = (cx < W * 0.5) ? 1 : -1;            // 도로 안쪽을 바라보는 옆얼굴
      ctx.save(); ctx.translate(cx, base); ctx.scale(dir, 1);
      const X = w, Y = h;
      // 옆얼굴 실루엣(큰 머리 + 돌출 이마/긴 코/턱 + 몸통)
      ctx.fillStyle = "rgba(104,112,120,0.96)";
      ctx.beginPath();
      ctx.moveTo(-0.36 * X, -0.92 * Y);               // 뒤통수 위
      ctx.lineTo(0.12 * X, -1.0 * Y);                 // 정수리(앞으로 기욺)
      ctx.lineTo(0.46 * X, -0.82 * Y);                // 이마
      ctx.lineTo(0.54 * X, -0.75 * Y);                // 눈썹(돌출)
      ctx.lineTo(0.37 * X, -0.71 * Y);                // 눈 우묵
      ctx.lineTo(0.44 * X, -0.67 * Y);                // 콧대
      ctx.lineTo(0.62 * X, -0.5 * Y);                 // 코끝(길게 돌출)
      ctx.lineTo(0.37 * X, -0.47 * Y);                // 코 밑
      ctx.lineTo(0.47 * X, -0.41 * Y);                // 입
      ctx.lineTo(0.5 * X, -0.33 * Y);                 // 턱(돌출)
      ctx.lineTo(0.3 * X, -0.27 * Y);                 // 턱 밑
      ctx.lineTo(0.32 * X, 0);                        // 몸통 앞
      ctx.lineTo(-0.36 * X, 0);                       // 뒤통수 아래(몸통 뒤)
      ctx.closePath(); ctx.fill();
      // 뒤쪽 그늘면
      ctx.fillStyle = "rgba(80,88,96,0.92)";
      ctx.beginPath(); ctx.moveTo(-0.36 * X, -0.92 * Y); ctx.lineTo(-0.06 * X, -0.96 * Y); ctx.lineTo(-0.06 * X, 0); ctx.lineTo(-0.36 * X, 0); ctx.closePath(); ctx.fill();
      // 눈 그늘(눈썹 밑)
      ctx.fillStyle = "rgba(52,58,66,0.7)";
      ctx.beginPath(); ctx.moveTo(0.36 * X, -0.73 * Y); ctx.lineTo(0.47 * X, -0.75 * Y); ctx.lineTo(0.42 * X, -0.68 * Y); ctx.closePath(); ctx.fill();
      // 긴 귀(옆면)
      ctx.strokeStyle = "rgba(74,82,90,0.85)"; ctx.lineWidth = Math.max(1.2, w * 0.07);
      ctx.beginPath(); ctx.moveTo(0.04 * X, -0.78 * Y); ctx.lineTo(0.06 * X, -0.52 * Y); ctx.stroke();
      ctx.restore();
    }
  }
  // 미국 — 금문교 + 도시 스카이라인 + 자유의 여신상
  function bgCity(hy) {
    const lit = "rgba(120,150,186,0.95)", shade = "rgba(86,116,156,0.95)";
    const bs = [[0.03, 30, 36], [0.11, 46, 44], [0.19, 64, 52], [0.30, 40, 40], [0.55, 50, 46], [0.66, 72, 56], [0.77, 44, 42], [0.88, 58, 50]];
    for (const b of bs) bgBldg(W * b[0], hy, b[1], b[2], lit, shade, true);
    // 금문교(좌측 전경) — 붉은 현수교
    (function () {
      const gx0 = -W * 0.02, gx1 = W * 0.38, t1 = W * 0.09, t2 = W * 0.29, deckY = hy - 12, topY = hy - 78;
      const red = "rgba(198,76,52,0.96)", redD = "rgba(150,52,38,0.96)";
      const cableY = function (xx) { const tt = (xx - t1) / (t2 - t1); return topY + (deckY + 5 - topY) * 4 * tt * (1 - tt); };
      ctx.fillStyle = redD; ctx.fillRect(gx0, deckY, gx1 - gx0, 3);                 // 데크
      ctx.strokeStyle = red; ctx.lineWidth = 2.4; ctx.lineJoin = "round";           // 메인 케이블
      ctx.beginPath(); ctx.moveTo(gx0, deckY - 1); ctx.lineTo(t1, topY);
      ctx.quadraticCurveTo((t1 + t2) / 2, deckY + 8, t2, topY); ctx.lineTo(gx1, deckY - 1); ctx.stroke();
      ctx.strokeStyle = "rgba(198,76,52,0.55)"; ctx.lineWidth = 0.8;                 // 행어(수직 케이블)
      for (let i = 1; i < 9; i++) { const xx = t1 + (t2 - t1) * i / 9; ctx.beginPath(); ctx.moveTo(xx, cableY(xx)); ctx.lineTo(xx, deckY); ctx.stroke(); }
      for (const tx of [t1, t2]) {                                                  // 주탑(가로보 2단)
        ctx.fillStyle = red; ctx.fillRect(tx - 2.6, topY - 6, 5.2, hy - (topY - 6));
        ctx.fillStyle = redD; ctx.fillRect(tx - 6, topY + 8, 12, 2.6); ctx.fillRect(tx - 6, topY + 30, 12, 2.6);
      }
    })();
    const cx = W * 0.43, base = hy, h = 80, g = "rgba(150,198,178,0.96)";
    ctx.fillStyle = g; ctx.fillRect(cx - 12, base - h * 0.18, 24, h * 0.18);
    ctx.beginPath(); ctx.moveTo(cx - 9, base - h * 0.18); ctx.lineTo(cx - 5, base - h * 0.7); ctx.lineTo(cx + 5, base - h * 0.7); ctx.lineTo(cx + 9, base - h * 0.18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, base - h * 0.74, 5, 0, Math.PI * 2); ctx.fill();
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(cx, base - h * 0.79); ctx.lineTo(cx + i * 3, base - h * 0.87); ctx.lineTo(cx + i * 3 + 1.5, base - h * 0.79); ctx.closePath(); ctx.fill(); }
    ctx.fillRect(cx + 3, base - h * 0.94, 3, h * 0.24);
    ctx.fillStyle = "rgba(255,222,140,0.95)"; ctx.beginPath(); ctx.arc(cx + 4.5, base - h * 0.95, 4, 0, Math.PI * 2); ctx.fill();
  }
  // 영국 — 빅벤 + 런던아이 + 건물
  function bgLondon(hy) {
    const lit = "rgba(150,166,188,0.95)", shade = "rgba(110,126,150,0.95)";
    const bs = [[0.03, 40, 36], [0.12, 50, 42], [0.74, 48, 42], [0.86, 42, 34]];
    for (const b of bs) bgBldg(W * b[0], hy, b[1], b[2], lit, shade, true);
    const bx = W * 0.27, bw = 24, bh = 124;
    bgBldg(bx, hy, bw, bh, lit, shade, false);
    ctx.fillStyle = shade; ctx.beginPath(); ctx.moveTo(bx, hy - bh); ctx.lineTo(bx + bw / 2, hy - bh - 20); ctx.lineTo(bx + bw, hy - bh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(247,240,212,0.95)"; ctx.beginPath(); ctx.arc(bx + bw / 2, hy - bh + 22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(60,70,90,0.85)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + bw / 2, hy - bh + 22); ctx.lineTo(bx + bw / 2, hy - bh + 17); ctx.moveTo(bx + bw / 2, hy - bh + 22); ctx.lineTo(bx + bw / 2 + 4, hy - bh + 22); ctx.stroke();
    const wx = W * 0.62, wy = hy - 56, wr = 46;
    ctx.fillStyle = shade; ctx.fillRect(wx - 2, wy, 4, hy - wy);
    ctx.strokeStyle = "rgba(160,188,216,0.9)"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.cos(an) * wr, wy + Math.sin(an) * wr); ctx.stroke(); }
    ctx.fillStyle = "rgba(205,228,246,0.85)"; for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.arc(wx + Math.cos(an) * wr, wy + Math.sin(an) * wr, 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  // 프랑스 — 에펠탑 + 건물
  function bgEiffel(hy) {
    const lit = "rgba(140,160,186,0.95)", shade = "rgba(104,124,154,0.95)";
    const bs = [[0.05, 52, 32], [0.16, 40, 28], [0.74, 46, 32], [0.85, 54, 36]];
    for (const b of bs) bgBldg(W * b[0], hy, b[1], b[2], lit, shade, true);
    const cx = W * 0.45, base = hy, h0 = 138, topW = 4, midW = 15, botW = 48;
    ctx.fillStyle = "rgba(120,140,168,0.96)";
    ctx.beginPath(); ctx.moveTo(cx - botW / 2, base);
    ctx.quadraticCurveTo(cx - midW * 0.6, base - h0 * 0.45, cx - topW / 2, base - h0);
    ctx.lineTo(cx + topW / 2, base - h0); ctx.quadraticCurveTo(cx + midW * 0.6, base - h0 * 0.45, cx + botW / 2, base);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade; ctx.fillRect(cx - botW * 0.5, base - h0 * 0.26, botW, 4); ctx.fillRect(cx - midW * 0.62, base - h0 * 0.52, midW * 1.24, 3);
    ctx.fillStyle = "rgba(120,140,168,0.96)"; ctx.fillRect(cx - 1.4, base - h0 - 12, 2.8, 12);
  }
  // 네덜란드 — 평지 + 풍차 + 튤립
  function bgWindmill(hy) {
    ctx.fillStyle = "rgba(132,182,150,0.85)"; ctx.fillRect(0, hy - 8, W, 8);
    const pos = [[0.22, 56], [0.5, 70], [0.78, 52]];
    for (const p of pos) {
      const cx = W * p[0], h = p[1], w = h * 0.34, base = hy - 4;
      ctx.fillStyle = "rgba(150,166,186,0.96)"; ctx.beginPath(); ctx.moveTo(cx - w / 2, base); ctx.lineTo(cx - w * 0.32, base - h * 0.7); ctx.lineTo(cx + w * 0.32, base - h * 0.7); ctx.lineTo(cx + w / 2, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(110,128,152,0.96)"; ctx.fillRect(cx + w * 0.04, base - h * 0.7, w * 0.28, h * 0.7);
      ctx.fillStyle = "rgba(92,82,92,0.95)"; ctx.beginPath(); ctx.moveTo(cx - w * 0.36, base - h * 0.7); ctx.lineTo(cx, base - h * 0.92); ctx.lineTo(cx + w * 0.36, base - h * 0.7); ctx.closePath(); ctx.fill();
      const ay = base - h * 0.78, r = h * 0.5;
      ctx.strokeStyle = "rgba(70,80,96,0.95)"; ctx.lineWidth = 2.4;
      for (let i = 0; i < 4; i++) { const an = 0.5 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(cx, ay); ctx.lineTo(cx + Math.cos(an) * r, ay + Math.sin(an) * r); ctx.stroke(); }
    }
    const cols = ["#e8788a", "#e8c349", "#d96a6a", "#c77ad9"];
    for (let i = 0; i < 26; i++) { const x = 10 + i * (W - 20) / 25; ctx.fillStyle = "rgba(80,150,110,0.9)"; ctx.fillRect(x - 0.5, hy - 6, 1, 5); ctx.fillStyle = cols[i % 4]; ctx.fillRect(x - 1.5, hy - 8, 3, 3); }
  }
  // 이탈리아 — 콜로세움 + 피사의 사탑 + 사이프러스
  function bgItaly(hy) {
    const lit = "rgba(210,198,170,0.96)", shade = "rgba(172,156,128,0.96)";
    const ox = W * 0.66, oy = hy - 30, ow = 88, oh = 36;
    ctx.fillStyle = lit; ctx.beginPath(); ctx.ellipse(ox, oy, ow / 2, oh / 2, 0, Math.PI, 0); ctx.lineTo(ox + ow / 2, hy); ctx.lineTo(ox - ow / 2, hy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade; for (let i = 0; i < 7; i++) { const x = ox - ow / 2 + 7 + i * ((ow - 14) / 6); ctx.fillRect(x, oy - 4, 2.4, oh * 0.5 + 8); }
    ctx.fillStyle = "rgba(70,112,82,0.9)"; for (const cx2 of [W * 0.05, W * 0.12, W * 0.9]) { ctx.beginPath(); ctx.moveTo(cx2, hy); ctx.lineTo(cx2 - 5, hy - 8); ctx.quadraticCurveTo(cx2, hy - 48, cx2 + 5, hy - 8); ctx.closePath(); ctx.fill(); }
    const bx = W * 0.32, th = 122, tw = 20;
    ctx.save(); ctx.translate(bx, hy); ctx.rotate(0.1);
    ctx.fillStyle = lit; ctx.fillRect(-tw / 2, -th, tw, th); ctx.fillStyle = shade; ctx.fillRect(tw * 0.1, -th, tw * 0.4, th);
    ctx.strokeStyle = "rgba(150,140,116,0.8)"; ctx.lineWidth = 1; for (let y = -th + 14; y < -6; y += 14) { ctx.beginPath(); ctx.moveTo(-tw / 2, y); ctx.lineTo(tw / 2, y); ctx.stroke(); }
    ctx.restore();
  }
  // 이집트 — 사구 + 피라미드
  function bgEgypt(hy) {
    ctx.fillStyle = "rgba(234,202,150,0.88)"; ctx.beginPath(); ctx.moveTo(0, hy); for (let x = 0; x <= W; x += 28) ctx.lineTo(x, hy - 6 - Math.sin(x * 0.02 + 1) * 5); ctx.lineTo(W, hy); ctx.closePath(); ctx.fill();
    const py = [[0.3, 150, 98], [0.52, 112, 72], [0.72, 92, 58]];
    for (const p of py) {
      const cx = W * p[0], w = p[1], h = p[2], base = hy - 2;
      ctx.fillStyle = "rgba(222,188,134,0.96)"; ctx.beginPath(); ctx.moveTo(cx, base - h); ctx.lineTo(cx - w / 2, base); ctx.lineTo(cx, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(186,150,100,0.96)"; ctx.beginPath(); ctx.moveTo(cx, base - h); ctx.lineTo(cx + w / 2, base); ctx.lineTo(cx, base); ctx.closePath(); ctx.fill();
    }
  }
  // 인도 — 타지마할
  function bgTaj(hy) {
    const cx = W * 0.5, base = hy - 2, lit = "rgba(240,234,226,0.97)", shade = "rgba(208,198,188,0.97)";
    function minaret(mx, h) { ctx.fillStyle = lit; ctx.fillRect(mx - 4, base - h, 8, h); ctx.fillStyle = shade; ctx.fillRect(mx + 1, base - h, 3, h); ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(mx, base - h, 6, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(mx, base - h - 3, 3.5, 0, Math.PI * 2); ctx.fill(); }
    minaret(cx - 88, 74); minaret(cx + 88, 74); minaret(cx - 60, 74); minaret(cx + 60, 74);
    ctx.fillStyle = lit; ctx.fillRect(cx - 46, base - 56, 92, 56);
    ctx.fillStyle = shade; ctx.fillRect(cx + 12, base - 56, 34, 56);
    ctx.fillStyle = lit; for (const sx of [cx - 34, cx + 34]) { ctx.beginPath(); ctx.arc(sx, base - 56, 8, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = lit; ctx.beginPath(); ctx.moveTo(cx - 22, base - 56); ctx.bezierCurveTo(cx - 26, base - 86, cx - 10, base - 96, cx, base - 98); ctx.bezierCurveTo(cx + 10, base - 96, cx + 26, base - 86, cx + 22, base - 56); ctx.closePath(); ctx.fill();
    ctx.fillRect(cx - 1.5, base - 110, 3, 13);
    ctx.fillStyle = "rgba(110,112,124,0.5)"; ctx.beginPath(); ctx.moveTo(cx - 12, base); ctx.lineTo(cx - 12, base - 30); ctx.arc(cx, base - 30, 12, Math.PI, 0); ctx.lineTo(cx + 12, base); ctx.closePath(); ctx.fill();
  }
  // 한국 — 뒷산 + N서울타워 + 경복궁(곡선 기와지붕 누각)
  function bgKorea(hy) {
    // 뒷산(한국은 산이 많음)
    ctx.fillStyle = "rgba(120,152,182,0.5)";
    for (const m of [[0.1, 40], [0.28, 30], [0.86, 48], [0.97, 34]]) { const cx = W * m[0], h = m[1]; ctx.beginPath(); ctx.moveTo(cx - h, hy); ctx.lineTo(cx, hy - h); ctx.lineTo(cx + h, hy); ctx.closePath(); ctx.fill(); }
    // N서울타워(우측)
    const tx = W * 0.82, th = 92;
    ctx.strokeStyle = "rgba(120,140,165,0.9)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx, hy); ctx.lineTo(tx, hy - th); ctx.stroke();
    ctx.fillStyle = "rgba(150,170,195,0.92)"; ctx.fillRect(tx - 5, hy - th - 9, 10, 11);
    ctx.fillRect(tx - 1.5, hy - th - 28, 3, 19);
    // 롯데월드타워(좌측, 한국에서 제일 높음 — 위로 좁아지는 곡선 실루엣)
    const ltx = W * 0.16, lth = 132, lbw = 22;
    ctx.fillStyle = "rgba(150,172,200,0.92)";
    ctx.beginPath();
    ctx.moveTo(ltx - lbw / 2, hy);
    ctx.quadraticCurveTo(ltx - lbw * 0.28, hy - lth * 0.6, ltx - lbw * 0.14, hy - lth);
    ctx.lineTo(ltx + lbw * 0.14, hy - lth);
    ctx.quadraticCurveTo(ltx + lbw * 0.28, hy - lth * 0.6, ltx + lbw / 2, hy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(120,144,176,0.9)"; ctx.fillRect(ltx + lbw * 0.04, hy - lth, lbw * 0.22, lth);   // 유리 음영
    ctx.fillStyle = "rgba(150,172,200,0.92)"; ctx.fillRect(ltx - 1, hy - lth - 14, 2, 14);                // 첨탑
    // 💜 mina 이스터에그: 롯데타워에 세로로 MINA
    if (minaT > 0) {
      const g = 0.55 + 0.45 * Math.sin(elapsed * 9);
      ctx.save(); ctx.textAlign = "center";
      ctx.shadowColor = "rgba(255,120,200,0.9)"; ctx.shadowBlur = 10 + 6 * g;
      ctx.fillStyle = "rgba(255," + (120 + 80 * g | 0) + ",210,0.96)";
      ctx.font = "bold 17px sans-serif";
      const ml = ["M", "I", "N", "A"];
      for (let i = 0; i < 4; i++) ctx.fillText(ml[i], ltx, hy - lth + 30 + i * 27);
      ctx.textAlign = "start"; ctx.restore();
    }
    // 경복궁 광화문 — 넓고 낮은 한식 지붕(완만한 처마) + 단청(녹·적) 2층
    const cx = W * 0.42, base = hy, bw = 134;
    // 한식 기와지붕: 넓고 낮으며 처마 끝만 살짝 들림 + 용마루·치미 + 단청 처마밑
    function roof(yEave, w, h) {
      ctx.fillStyle = "rgba(74,84,102,0.96)";
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, yEave - h * 0.04);
      ctx.lineTo(cx - w * 0.22, yEave - h);                       // 완만한 경사
      ctx.lineTo(cx + w * 0.22, yEave - h);                       // 넓은 수평 용마루
      ctx.lineTo(cx + w / 2, yEave - h * 0.04);
      ctx.quadraticCurveTo(cx + w * 0.40, yEave + h * 0.12, cx + w * 0.47, yEave - h * 0.02);  // 처마끝 살짝 들림
      ctx.lineTo(cx - w * 0.47, yEave - h * 0.02);
      ctx.quadraticCurveTo(cx - w * 0.40, yEave + h * 0.12, cx - w / 2, yEave - h * 0.04);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(52,60,76,0.96)"; ctx.fillRect(cx - w * 0.23, yEave - h - 2, w * 0.46, 4);   // 용마루
      ctx.beginPath(); ctx.moveTo(cx - w * 0.27, yEave - h - 1); ctx.lineTo(cx - w * 0.30, yEave - h - 8); ctx.lineTo(cx - w * 0.21, yEave - h - 1); ctx.closePath(); ctx.fill();  // 좌 치미
      ctx.beginPath(); ctx.moveTo(cx + w * 0.27, yEave - h - 1); ctx.lineTo(cx + w * 0.30, yEave - h - 8); ctx.lineTo(cx + w * 0.21, yEave - h - 1); ctx.closePath(); ctx.fill();  // 우 치미
      ctx.fillStyle = "rgba(66,128,116,0.95)"; ctx.fillRect(cx - w * 0.45, yEave - h * 0.02, w * 0.9, 3);  // 단청 처마밑(녹)
      ctx.fillStyle = "rgba(184,78,66,0.9)"; for (let i = 0; i < 9; i++) { const x = cx - w * 0.42 + i * (w * 0.84 / 8); ctx.fillRect(x - 1, yEave - h * 0.02, 2, 3); }  // 붉은 점
    }
    // 단청 몸체(녹청 바탕 + 위 붉은 띠 + 붉은 기둥)
    function dancheong(yTop, w, hh) {
      ctx.fillStyle = "rgba(64,128,116,0.95)"; ctx.fillRect(cx - w / 2, yTop, w, hh);
      ctx.fillStyle = "rgba(170,72,64,0.95)"; ctx.fillRect(cx - w / 2, yTop, w, hh * 0.34);
      ctx.fillStyle = "rgba(225,215,195,0.8)"; ctx.fillRect(cx - w / 2, yTop + hh * 0.34, w, 1.4);
      ctx.fillStyle = "rgba(150,68,58,0.95)"; const n = Math.max(4, Math.round(w / 18));
      for (let i = 0; i <= n; i++) { const x = cx - w / 2 + w * i / n; ctx.fillRect(x - 1.6, yTop + hh * 0.36, 3.2, hh * 0.64); }
    }
    // 석축(돌담) + 홍예문 3
    ctx.fillStyle = "rgba(186,182,174,0.96)"; ctx.fillRect(cx - bw / 2, base - 30, bw, 30);
    ctx.fillStyle = "rgba(158,154,148,0.96)"; ctx.fillRect(cx + bw * 0.16, base - 30, bw * 0.34, 30);
    ctx.fillStyle = "rgba(36,42,50,0.62)";
    for (const ax of [cx - bw * 0.28, cx, cx + bw * 0.28]) { ctx.beginPath(); ctx.moveTo(ax - 9, base); ctx.lineTo(ax - 9, base - 15); ctx.arc(ax, base - 15, 9, Math.PI, 0); ctx.lineTo(ax + 9, base); ctx.closePath(); ctx.fill(); }
    // 1층 단청 + 넓은 낮은 지붕 / 2층(작게)
    dancheong(base - 49, bw * 0.84, 19);
    roof(base - 49, bw * 1.16, 15);
    dancheong(base - 77, bw * 0.5, 13);
    roof(base - 77, bw * 0.74, 13);
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

    // 나라별 지평선 배경(스테이지 따라 바뀜 + 경계에서 크로스페이드)
    drawBackdrop(hy);

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
        ctx.beginPath(); ctx.ellipse(x, y, 22 * base, 5 * base, 0, 0, Math.PI * 2); ctx.fill();
        if (d.key === "pisa") drawPizzeria(x, y, base);     // 이탈리아: 피자 대신 피자리아 가게
        else if (d.key === "korea") drawHanok(x, y, base);  // 한국: 일본성 이모지 대신 한옥
        else drawLandmarkIcon(d.icon || stageLandmark().icon, d.name || "", x, y, base);
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

  // ---------- 명물: 빙판 받침대 위 아이콘(서리 글로우) ----------
  function drawLandmarkIcon(icon, name, x, y, base) {
    const s = base;
    // 얼음 받침대(원기둥 단)
    ctx.fillStyle = "rgba(206,228,244,0.95)";
    ctx.fillRect(x - 14 * s, y - 9 * s, 28 * s, 9 * s);
    ctx.fillStyle = "rgba(247,252,255,0.97)"; ctx.strokeStyle = "rgba(120,160,195,0.5)"; ctx.lineWidth = Math.max(1, s);
    ctx.beginPath(); ctx.ellipse(x, y - 9 * s, 14 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(150,190,220,0.4)";
    ctx.beginPath(); ctx.ellipse(x, y, 14 * s, 4 * s, 0, 0, Math.PI); ctx.fill();
    // 명물 아이콘(서리 글로우)
    const fs = 46 * s + 6;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = fs + "px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','EmojiOne Color',sans-serif";
    ctx.shadowColor = "rgba(190,228,255,0.95)"; ctx.shadowBlur = 9 * s; ctx.shadowOffsetY = -1;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(icon, x, y - 11 * s);
    ctx.restore();
    // 살짝 반짝임
    oSparkle(x + 11 * s, y - fs * 0.7, 2 * s, "rgba(255,255,255,0.85)");
  }

  // ---------- 이탈리아 길가: 피자리아 가게 ----------
  function drawPizzeria(x, y, s) {
    const w = 34 * s, h = 30 * s, bx = x - w / 2, by = y - h;
    // 벽
    ctx.fillStyle = "#ecdfc6"; ctx.strokeStyle = "rgba(120,100,72,0.5)"; ctx.lineWidth = Math.max(1, s);
    ctx.fillRect(bx, by, w, h); ctx.strokeRect(bx, by, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.06)"; ctx.fillRect(bx + w * 0.62, by, w * 0.38, h);   // 우측 음영
    // 붉은 기와 지붕
    ctx.fillStyle = "#b5532f"; ctx.beginPath(); ctx.moveTo(bx - 4 * s, by); ctx.lineTo(x, by - 9 * s); ctx.lineTo(bx + w + 4 * s, by); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.moveTo(x, by - 9 * s); ctx.lineTo(bx + w + 4 * s, by); ctx.lineTo(x, by); ctx.closePath(); ctx.fill();
    // 간판 "PIZZERIA"(녹색)
    ctx.fillStyle = "#2e7d46"; ctx.fillRect(bx + 1.5 * s, by + 2.5 * s, w - 3 * s, 7 * s);
    ctx.fillStyle = "#fff"; ctx.font = "bold " + (4.4 * s) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("PIZZERIA", x, by + 6.2 * s);
    // 삼색 차양(녹-백-적)
    const ay = by + 11 * s, aw = w + 3 * s, ax = x - aw / 2, ah = 5.5 * s, n = 9, tri = ["#2e7d46", "#ffffff", "#d23b34"];
    for (let i = 0; i < n; i++) { ctx.fillStyle = tri[i % 3]; ctx.beginPath(); ctx.moveTo(ax + aw * i / n, ay); ctx.lineTo(ax + aw * (i + 1) / n, ay); ctx.lineTo(ax + aw * (i + 0.5) / n, ay + ah); ctx.closePath(); ctx.fill(); }
    // 문
    ctx.fillStyle = "#6b4a2a"; ctx.fillRect(x + w * 0.12, y - 13 * s, 9 * s, 13 * s);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + w * 0.12 + 1 * s, y - 13 * s, 2 * s, 13 * s);
    // 둥근 피자 간판(도우+페퍼로니)
    const pr = 6.5 * s, pcx = bx + w * 0.26, pcy = y - 9 * s;
    ctx.fillStyle = "#e7b24c"; ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c98a2e"; ctx.lineWidth = Math.max(0.8, s); ctx.stroke();
    ctx.fillStyle = "#d23b34"; for (const d of [[-2, -1], [2, 0], [-1, 2.5], [2.4, 2.4], [0, -2.8]]) { ctx.beginPath(); ctx.arc(pcx + d[0] * s, pcy + d[1] * s, 1.1 * s, 0, Math.PI * 2); ctx.fill(); }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }

  // ---------- 한국 길가: 한옥(석축·단청·곡선 기와지붕) ----------
  function drawHanok(x, y, s) {
    const w = 36 * s, bx = x - w / 2;
    // 석축(돌 기단)
    ctx.fillStyle = "#cdc7bb"; ctx.strokeStyle = "rgba(110,104,92,0.5)"; ctx.lineWidth = Math.max(1, s);
    ctx.fillRect(bx, y - 9 * s, w, 9 * s); ctx.strokeRect(bx, y - 9 * s, w, 9 * s);
    // 단청 몸체(녹청 + 붉은 띠 + 붉은 기둥)
    const pw = w * 0.84, pbx = x - pw / 2, pty = y - 9 * s - 12 * s, ph = 12 * s;
    ctx.fillStyle = "#3f8f80"; ctx.fillRect(pbx, pty, pw, ph);
    ctx.fillStyle = "#a8473f"; ctx.fillRect(pbx, pty, pw, ph * 0.32);
    ctx.fillStyle = "rgba(235,228,210,0.85)"; ctx.fillRect(pbx, pty + ph * 0.32, pw, 1 * s);
    ctx.fillStyle = "#8c4038"; for (let i = 0; i <= 5; i++) { const px = pbx + pw * i / 5; ctx.fillRect(px - 1.4 * s, pty + ph * 0.34, 2.8 * s, ph * 0.66); }
    // 곡선 기와지붕(넓고 낮음, 처마 끝 살짝 들림) + 용마루
    const ry = pty, rw = w * 1.18, rh = 12 * s;
    ctx.fillStyle = "#46566e";
    ctx.beginPath();
    ctx.moveTo(x - rw / 2, ry - rh * 0.04);
    ctx.lineTo(x - rw * 0.2, ry - rh);
    ctx.lineTo(x + rw * 0.2, ry - rh);
    ctx.lineTo(x + rw / 2, ry - rh * 0.04);
    ctx.quadraticCurveTo(x + rw * 0.4, ry + rh * 0.16, x + rw * 0.47, ry);
    ctx.lineTo(x - rw * 0.47, ry);
    ctx.quadraticCurveTo(x - rw * 0.4, ry + rh * 0.16, x - rw / 2, ry - rh * 0.04);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#33415a"; ctx.fillRect(x - rw * 0.2, ry - rh - 1.5 * s, rw * 0.4, 3 * s);   // 용마루
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.moveTo(x, ry - rh); ctx.lineTo(x + rw / 2, ry - rh * 0.04); ctx.lineTo(x, ry); ctx.closePath(); ctx.fill();   // 우측 음영
    // 가운데 문(검정)
    ctx.fillStyle = "rgba(40,46,54,0.7)"; ctx.fillRect(x - 4 * s, y - 9 * s, 8 * s, 9 * s);
  }

  // ---------- 전세계 명물 얼음조각(미사용: 아이콘 방식으로 대체) ----------
  function iceGrad(yTop) {
    const g = ctx.createLinearGradient(0, yTop, 0, 0);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.55, "#dcebf6"); g.addColorStop(1, "#a6c6dd");
    return g;
  }
  // 2.5D: 도형을 우상단으로 압출한 깔끔한 측면 슬랩 + 앞면
  const LM_SIDE = "rgba(118,156,193,0.97)";
  function lmSolid(buildPath, front, u) {
    const dx = 0.5 * u, dy = -0.42 * u, N = 8;
    // 측면 슬랩(뒤→앞 빈틈없이, 단일 톤)
    ctx.fillStyle = "#8fb0cd";
    for (let s = N; s >= 1; s--) { const t = s / N; ctx.save(); ctx.translate(dx * t, dy * t); buildPath(); ctx.fill(); ctx.restore(); }
    // 앞면 + 외곽선
    ctx.fillStyle = front; buildPath(); ctx.fill();
    ctx.strokeStyle = "rgba(74,112,150,0.7)"; ctx.lineWidth = Math.max(1, u * 0.055); buildPath(); ctx.stroke();
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
    lmSolid(function () { ctx.beginPath(); ctx.rect(-1.6 * u, -2 * u, 3.2 * u, 2 * u); }, iceGrad(-u * 3), u);   // 받침
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.3 * u, -2 * u); ctx.lineTo(-0.6 * u, -5.4 * u); ctx.lineTo(0.6 * u, -5.4 * u); ctx.lineTo(1.3 * u, -2 * u); ctx.closePath(); }, iceGrad(-u * 5), u);   // 로브
    lmSolid(function () { ctx.beginPath(); ctx.arc(0, -6 * u, 0.62 * u, 0, Math.PI * 2); }, iceGrad(-u * 6.6), u);   // 머리
    ctx.fillStyle = iceGrad(-u * 7.5);
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
    lmSolid(function () { ctx.beginPath(); ctx.rect(-1.1 * u, -6 * u, 2.2 * u, 6 * u); }, iceGrad(-u * 6), u);
    ctx.strokeStyle = "rgba(120,160,195,0.4)";
    for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(-1.1 * u, -k * u); ctx.lineTo(1.1 * u, -k * u); ctx.stroke(); }
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(-1.0 * u, -6.6 * u, 2.0 * u, 0.6 * u);
    ctx.restore();
  }
  function lmWindmill(u) {
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.7 * u, 0); ctx.lineTo(-1.1 * u, -5 * u); ctx.lineTo(1.1 * u, -5 * u); ctx.lineTo(1.7 * u, 0); ctx.closePath(); }, iceGrad(-u * 5), u);
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.2 * u, -5 * u); ctx.lineTo(0, -6.2 * u); ctx.lineTo(1.2 * u, -5 * u); ctx.closePath(); }, iceGrad(-u * 6.2), u);
    // 날개(회전)
    ctx.save(); ctx.translate(0, -5 * u); ctx.rotate(elapsed * 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.strokeStyle = "rgba(120,160,195,0.6)";
    for (let b = 0; b < 4; b++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.5 * u, -0.4 * u); ctx.lineTo(0.4 * u, -3.2 * u); ctx.lineTo(-0.2 * u, -3 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "#7fa8c4"; ctx.beginPath(); ctx.arc(0, -5 * u, 0.4 * u, 0, Math.PI * 2); ctx.fill();
  }
  function lmMoai(u) {
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.5 * u, 0); ctx.lineTo(-1.7 * u, -3.5 * u); ctx.quadraticCurveTo(-1.7 * u, -6 * u, 0, -6 * u); ctx.quadraticCurveTo(1.7 * u, -6 * u, 1.7 * u, -3.5 * u); ctx.lineTo(1.5 * u, 0); ctx.closePath(); }, iceGrad(-u * 6), u);
    // 눈썹/코
    ctx.fillStyle = "rgba(80,120,160,0.35)";
    ctx.fillRect(-1.2 * u, -4.4 * u, 2.4 * u, 0.5 * u);
    ctx.beginPath(); ctx.moveTo(-0.3 * u, -4 * u); ctx.lineTo(0.3 * u, -4 * u); ctx.lineTo(0, -2.2 * u); ctx.closePath(); ctx.fill();
    ctx.fillRect(-0.9 * u, -1.5 * u, 1.8 * u, 0.4 * u);
  }
  function lmClock(u) {
    lmSolid(function () { ctx.beginPath(); ctx.rect(-1.3 * u, -6.5 * u, 2.6 * u, 6.5 * u); }, iceGrad(-u * 6.5), u);
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.3 * u, -6.5 * u); ctx.lineTo(0, -8 * u); ctx.lineTo(1.3 * u, -6.5 * u); ctx.closePath(); }, iceGrad(-u * 8), u);
    // 시계(앞면)
    ctx.fillStyle = "#eef6ff"; ctx.beginPath(); ctx.arc(0, -5.2 * u, 0.95 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#5f7e98"; ctx.lineWidth = Math.max(1, u * 0.16); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0, -5.9 * u); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0.5 * u, -5 * u); ctx.stroke();
    ctx.strokeStyle = "rgba(120,160,195,0.6)"; ctx.lineWidth = Math.max(1, u * 0.12);
  }
  function lmTaj(u) {
    // 미나렛 4개(가는 기둥)
    for (const mx of [-2.6, -2.0, 2.0, 2.6]) lmSolid(function () { ctx.beginPath(); ctx.rect(mx * u - 0.2 * u, -5 * u, 0.4 * u, 5 * u); }, iceGrad(-u * 5), u);
    // 기단
    lmSolid(function () { ctx.beginPath(); ctx.rect(-2.2 * u, -2.2 * u, 4.4 * u, 2.2 * u); }, iceGrad(-u * 4), u);
    // 중앙 양파돔(압출)
    lmSolid(function () { ctx.beginPath(); ctx.moveTo(-1.3 * u, -2.2 * u); ctx.quadraticCurveTo(-1.6 * u, -4.4 * u, 0, -5.2 * u); ctx.quadraticCurveTo(1.6 * u, -4.4 * u, 1.3 * u, -2.2 * u); ctx.closePath(); }, iceGrad(-u * 5.2), u);
    ctx.strokeStyle = "rgba(120,160,195,0.6)"; ctx.lineWidth = Math.max(1, u * 0.12);
    ctx.beginPath(); ctx.moveTo(0, -5.2 * u); ctx.lineTo(0, -6 * u); ctx.stroke();
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
    // 측면 압출(입체)
    ctx.fillStyle = LM_SIDE;
    for (let s = 1; s <= 5; s++) { const t = s / 5; ctx.save(); ctx.translate(0.8 * u * t, -0.52 * u * t); ctx.beginPath(); ctx.rect(-0.6 * u, -6 * u, 1.2 * u, 6 * u); ctx.fill(); ctx.restore(); }
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
  // 구덩이(크레바스/협곡)만 — 도로 바로 위 레이어
  function drawHoles() {
    const holes = items.filter(function (o) { return o.type === "hole"; }).sort(function (a, b) { return a.p - b.p; });
    for (const o of holes) drawHole(o);
  }
  function drawItems() {
    const sorted = items.slice().sort(function (a, b) { return a.p - b.p; });
    for (const o of sorted) {
      if (o.type === "hole") continue;             // 구덩이는 drawHoles에서 먼저(아래 레이어)
      if (o.type === "can") drawCan(o);
      else if (o.type === "secret") drawSecret(o);
      else drawOpener(o);
    }
  }

  function drawHole(o) {
    if (o.canyon) drawCanyon(o); else drawCrevasse(o);
  }

  // 서울 비밀 지점 마커 — 오징어게임 바닥 무늬(원·삼각·사각). 여기서 점프하면 이스터에그
  function drawSecret(o) {
    const x = laneToX(o.p, o.lane), y = projY(o.p), sc = projScale(o.p);
    const pulse = 0.6 + 0.4 * Math.sin(o.pulse || 0);
    const u = 6.5 * sc;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.5);                         // 바닥에 그린 듯 원근으로 눌림
    ctx.globalAlpha = 0.5 + 0.4 * pulse;
    ctx.strokeStyle = "#ff2e74"; ctx.lineWidth = Math.max(1.4, 1.9 * sc); ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); ctx.rect(-u, 0.2 * u, 2 * u, 1.7 * u); ctx.stroke();                 // 몸통(사각)
    ctx.beginPath(); ctx.moveTo(-u, 0.2 * u); ctx.lineTo(0, -1.4 * u); ctx.lineTo(u, 0.2 * u); ctx.stroke();   // 삼각
    ctx.beginPath(); ctx.arc(0, -2.3 * u, 0.95 * u, 0, Math.PI * 2); ctx.stroke();        // 머리(원)
    ctx.restore();
  }

  // 보통 크레바스 — 매번 다른 랜덤(들쭉날쭉) 외곽선
  // 들쭉날쭉 얼음 구멍(크레바스/협곡 공용)
  function drawIceHole(cx, cy, rx, ry, sc, shp, strata) {
    const n = shp.length;
    function outline() {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const a = (i % n) / n * Math.PI * 2, rr = shp[i % n]; const px = cx + Math.cos(a) * rx * rr, py = cy + Math.sin(a) * ry * rr; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.closePath();
    }
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy - ry * 0.2, 1, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, "#081f33"); g.addColorStop(0.5, "#143f5e"); g.addColorStop(1, "#3a7ca2");
    ctx.fillStyle = g; outline(); ctx.fill();
    // 안쪽 깊은 그늘
    ctx.fillStyle = "rgba(3,14,28,0.55)";
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i % n) / n * Math.PI * 2, rr = shp[i % n] * 0.58; const px = cx + Math.cos(a) * rx * rr, py = cy + Math.sin(a) * ry * rr + ry * 0.18; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.fill();
    // 협곡 단면 — 그물 셀을 두 톤 면으로 채워 색차로 경계 표현(배경 산 방식),
    // 아래로 갈수록 좁아지게(깊이로 수렴) 그린다. 패턴은 고정, 원근으로 크기만 변함.
    if (strata && strata.nodes) {
      ctx.save();
      outline(); ctx.clip();
      const topY = cy - ry * 0.9, botY = cy + ry * 0.78, wallH = botY - topY;
      const taper = 0.55;                                    // 바닥 폭 = 위 폭의 (1−taper) → 아래로 수렴
      const nd = strata.nodes, rows = strata.rows, cols = strata.cols, jit = strata.jit;
      const SX = function (nx, ny) { return cx + nx * rx * (1 - ny * taper); };
      const SY = function (ny) { return topY + ny * wallH; };
      const DARK = [9, 26, 46], LIGHT = [118, 160, 194];      // 심부:어둠 / 립(가장자리):얼음 빛
      const cl = function (v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; };
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const a = nd[r][c], b = nd[r][c + 1], d = nd[r + 1][c + 1], e = nd[r + 1][c];
        const mx = (a.x + b.x + d.x + e.x) / 4;               // -1(좌)~1(우)
        const my = (a.y + b.y + d.y + e.y) / 4;               // 0(위 립)~1(바닥 심연)
        // 오목 음영: 가장자리(|mx|↑)·위쪽 립은 밝고, 중앙·아래로 갈수록 어둡다
        let t = (Math.abs(mx) * 0.62 + 0.1) * (1 - my * 0.85);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const tone = (((r + c) & 1) ? 7 : -7) + jit[r][c];    // 면마다 미세 색차(경계)
        const R = cl(DARK[0] + (LIGHT[0] - DARK[0]) * t + tone);
        const G = cl(DARK[1] + (LIGHT[1] - DARK[1]) * t + tone);
        const B = cl(DARK[2] + (LIGHT[2] - DARK[2]) * t + tone);
        ctx.fillStyle = ctx.strokeStyle = "rgb(" + R + "," + G + "," + B + ")";
        ctx.lineWidth = 0.8;                                  // 같은 색 얇은 테두리로 면 사이 빈틈 메움
        ctx.beginPath();
        ctx.moveTo(SX(a.x, a.y), SY(a.y));
        ctx.lineTo(SX(b.x, b.y), SY(b.y));
        ctx.lineTo(SX(d.x, d.y), SY(d.y));
        ctx.lineTo(SX(e.x, e.y), SY(e.y));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // 깨진 얼음 테
    ctx.strokeStyle = "rgba(228,246,255,0.92)"; ctx.lineWidth = Math.max(1.5, 2.2 * sc); ctx.lineJoin = "round";
    outline(); ctx.stroke();
    ctx.restore();
  }

  // 구멍 기하: 판정 구간 [o.p-len, o.p]의 중심에 앵커, 구간을 세로로 덮음(판정=렌더 일치)
  function holeGeom(o, flat) {
    const backP = Math.max(0.02, o.p - o.len);
    const pC = Math.max(0.04, o.p - o.len / 2);
    const sc = projScale(pC), cx = laneToX(pC, o.lane);
    const yNear = projY(o.p), yFar = projY(backP);
    const cy = (yNear + yFar) / 2;
    const rx = halfAt(pC) * o.w;
    const ry = Math.max(rx * flat, (yNear - yFar) * 0.5);   // 최소한 판정 구간만큼은 덮음
    return { cx, cy, rx, ry, sc };
  }

  function drawCrevasse(o) {
    if (!o.strata) o.strata = makeStrata();      // 단면 패턴은 생성 시 한 번만 고정
    const G = holeGeom(o, 0.26);
    drawIceHole(G.cx, G.cy, G.rx, G.ry, G.sc, o.shape, o.strata);
  }

  // 거대 협곡 = 좌우로 넓힌 크레바스(판정 구간 중심에 맞춰 그림)
  function drawCanyon(o) {
    if (!o.strata) o.strata = makeStrata();      // 단면 패턴은 생성 시 한 번만 고정
    const G = holeGeom(o, 0.15);
    drawIceHole(G.cx, G.cy, G.rx, G.ry, G.sc, o.shape, o.strata);
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
    // 라벨 밴드(족별 색) + 원소 기호
    ctx.fillStyle = groupColor(o.el.group); ctx.fillRect(x - cw / 2, top + ch * 0.26, cw, ch * 0.5);
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(x - cw / 2, top + ch * 0.26, cw, ch * 0.08);
    ctx.fillStyle = "#16273a"; ctx.textAlign = "center"; ctx.font = "bold " + (ch * 0.42) + "px sans-serif";
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

  // 상단 보유 통조림 — 캔 모양 유지, 주기(행)·족(열) 위치에 배치, 라벨색은 족별
  function drawStored() {
    if (!stored.length) return;
    const cnt = {};
    for (const c of stored) cnt[c.symbol] = (cnt[c.symbol] || 0) + 1;
    const cell = 24, rowH = 21, y0 = 74, sx = W / 2 - (18 * cell) / 2;
    for (const el of ELEMENTS) {
      if (!cnt[el.symbol]) continue;                 // 보유한 것만
      const cx = sx + (el.group - 0.5) * cell;
      const cy = y0 + (el.period - 0.5) * rowH;
      drawTopCan(cx, cy, el.symbol, cnt[el.symbol], el.group);
    }
  }
  // 작은 통조림(상단/보관) — 라벨색은 족(group)별
  function drawTopCan(cx, cyc, symbol, n, group) {
    const w = 18, h = 13, top = cyc - h / 2;
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, "#7f93a6"); g.addColorStop(0.45, "#f3f8fc"); g.addColorStop(0.6, "#e4edf5"); g.addColorStop(1, "#7d91a3");
    ctx.fillStyle = g; ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(cx - w * 0.32, top, w * 0.09, h);          // 세로 광택
    ctx.fillStyle = groupColor(group); ctx.fillRect(cx - w / 2, top + h * 0.28, w, h * 0.5);          // 족별 라벨 밴드
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(cx - w / 2, top + h * 0.28, w, h * 0.07);
    ctx.fillStyle = "#16273a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 7px sans-serif";
    ctx.fillText(symbol, cx, top + h * 0.55);
    ctx.fillStyle = "#eef4fa"; ctx.strokeStyle = "rgba(90,120,150,0.5)"; ctx.lineWidth = 1;          // 뚜껑
    ctx.beginPath(); ctx.ellipse(cx, top, w / 2, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (n > 1) { ctx.fillStyle = "#cfe6ff"; ctx.font = "bold 8px sans-serif"; ctx.fillText("×" + n, cx, cyc + h * 0.5 + 6); }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "start";
  }
  // 기본 통조림(은색 틴 + 파란 라벨 + 정어리) — 배고픔 표시 등에 사용
  function drawBasicCan(cx, cy, s) {
    const w = 17 * s, h = 14 * s, top = cy - h / 2;
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, "#7f93a6"); g.addColorStop(0.45, "#f3f8fc"); g.addColorStop(0.6, "#e4edf5"); g.addColorStop(1, "#7d91a3");
    ctx.fillStyle = g; ctx.fillRect(cx - w / 2, top, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(cx - w * 0.32, top, w * 0.09, h);
    ctx.fillStyle = "#2f8fe0"; ctx.fillRect(cx - w / 2, top + h * 0.3, w, h * 0.42);           // 파란 라벨
    ctx.fillStyle = "#bcd6e8"; ctx.beginPath(); ctx.ellipse(cx, top + h * 0.51, w * 0.26, h * 0.09, 0, 0, Math.PI * 2); ctx.fill();   // 정어리
    ctx.fillStyle = "#eef4fa"; ctx.strokeStyle = "rgba(90,120,150,0.5)"; ctx.lineWidth = Math.max(1, s);
    ctx.beginPath(); ctx.ellipse(cx, top, w / 2, 2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // ---------- 펭귄(뒤에서 본 달리기) ----------
  function drawPlayer() {
    const x = player.x, y = player.y, lift = player.jumpY;

    // 추락 연출: 빠진 위치 → 가운데로 굴러 → 크레바스 안으로 사라짐(실제 구멍에 클립)
    if (player.falling) {
      const ox = player.holeX, gy = playerLineY();
      const tx = Math.min(1, player.fallT / 0.42);
      const ease = tx * tx * (3 - 2 * tx);                    // smoothstep
      const px = player.fallFromX + (ox - player.fallFromX) * ease;   // 가운데로 이동
      const scl = Math.max(0.42, 1 - player.fallY / 200);
      ctx.save();
      const o = player.fallHole;
      if (player.fallT >= 0.42 && o) {                        // 가운데 도달 후엔 구멍 안으로만 보이게 → 가라앉아 사라짐
        const G = holeGeom(o, o.canyon ? 0.15 : 0.26);
        ctx.beginPath(); ctx.ellipse(G.cx, G.cy, G.rx, G.ry + 4, 0, 0, Math.PI * 2); ctx.clip();
      }
      ctx.translate(px, gy - 20 + player.fallY);
      ctx.rotate(player.fallSpin);                            // 구르는 회전
      ctx.scale(scl, scl);
      drawPenguin(0, 8, 1.6, player.run, false, false, player.flapT, 0, true, 1);
      ctx.restore();
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
    // 꽁지깃(3갈래)
    ctx.fillStyle = "#0c1620";
    ctx.beginPath();
    ctx.moveTo(-4, 2); ctx.lineTo(-1.3, 10.5); ctx.lineTo(-0.3, 3);
    ctx.lineTo(0.3, 3); ctx.lineTo(1.3, 10.5); ctx.lineTo(4, 2);
    ctx.closePath(); ctx.fill();
    // 몸통 — 머리통 거의 없는 둥근 몸(아이콘 펭귄 뒷모습)
    const bg = ctx.createLinearGradient(-9, -21, 9, 7);
    bg.addColorStop(0, "#33455a"); bg.addColorStop(0.5, "#22303f"); bg.addColorStop(1, "#101a24");
    ctx.fillStyle = bg; ctx.strokeStyle = "rgba(10,16,24,0.5)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, -6, 13, 13.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 등 림라이트(부드러운 광택)
    ctx.fillStyle = "rgba(160,195,225,0.3)"; ctx.beginPath(); ctx.ellipse(-3.5, -12, 4, 7.5, -0.25, 0, Math.PI * 2); ctx.fill();
    // 빨간 배낭(등) — 캔이 늘수록 홀쭉 → 뚱뚱하게 부푼다
    {
      const pn = (typeof stored !== "undefined" && stored) ? stored.length : 0;
      const pf = Math.min(1, pn / 26);                 // 더 천천히 빵빵해짐
      const cyp = -4, rx = 3.4 + 6.6 * pf, ry = 7 + 3.2 * pf, topY = cyp - ry;
      ctx.strokeStyle = "#a82e22"; ctx.lineWidth = 1.6; ctx.lineCap = "round";    // 어깨끈(어깨에만)
      ctx.beginPath();
      ctx.moveTo(-rx * 0.55, topY + 1); ctx.lineTo(-9, -13);
      ctx.moveTo(rx * 0.55, topY + 1); ctx.lineTo(9, -13);
      ctx.stroke();
      ctx.fillStyle = "#d8392c"; ctx.strokeStyle = "#a82e22"; ctx.lineWidth = 1;  // 둥근 주머니(아래가 볼록)
      ctx.beginPath(); ctx.ellipse(0, cyp, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(120,24,16,0.3)"; ctx.beginPath(); ctx.ellipse(rx * 0.36, cyp + ry * 0.08, rx * 0.5, ry * 0.85, 0, 0, Math.PI * 2); ctx.fill();  // 측면 음영
      ctx.fillStyle = "#b62f24"; ctx.beginPath(); ctx.ellipse(0, topY + ry * 0.34, rx * 0.96, ry * 0.34, 0, 0, Math.PI * 2); ctx.fill();   // 윗뚜껑
      ctx.fillStyle = "#d8dde2"; ctx.fillRect(-1.6, cyp - 1, 3.2, 2.2);          // 은색 버클
    }
    // 날개 — 어깨에서 뻗어 몸통에 붙은 플리퍼(뿌리가 몸통에 묻힘)
    ctx.fillStyle = "#0e1a24";
    ctx.save(); ctx.translate(-9.5, -12); ctx.rotate(0.2 + flap); ctx.beginPath(); ctx.ellipse(0, wingLen * 0.55, 3.3, wingLen * 0.92, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(9.5, -12); ctx.rotate(-0.2 - flap); ctx.beginPath(); ctx.ellipse(0, wingLen * 0.55, 3.3, wingLen * 0.92, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // 날 때 반짝이는 활공 효과
    if (fly) {
      ctx.fillStyle = "rgba(180,235,255,0.5)";
      ctx.beginPath(); ctx.arc(0, 8, 5, 0, Math.PI * 2); ctx.fill();
    }
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
    startGame(); state = STATE.PLAY;
    const fh = { type: "hole", lane: 0, p: 1.0, vp: 0, len: 0.03, w: 0.7, shape: makeJagged(), done: false, cleared: false };
    items = [fh];
    player.x = W / 2 - 85; player.targetX = player.x;   // 가장자리에서 빠짐 → 가운데로 굴러감
    startFall(laneToX(1, 0), fh);
  }
  // ?boss: 보스전 즉시 시작(탄약 지급). ?boss=seal 이면 바다표범
  if (location.search.indexOf("boss") >= 0) {
    startGame(); state = STATE.PLAY;
    if (location.search.indexOf("seal") >= 0) lap = 1;
    distance = lap * LAP_LEN + (STAGES.length - 1) * STAGE_LEN + STAGE_LEN * 0.5;
    stored = [];
    for (let i = 0; i < 6; i++) { const e = BUFF_ELEMENTS[i % BUFF_ELEMENTS.length]; stored.push({ symbol: e.symbol, name: e.name, color: e.color }); }
    startBoss();
    const pm = location.search.match(/pose=([\d.]+)/);   // 포즈 고정(공격 모션 확인용)
    if (pm) { bosses.forEach(function (b) { b.intro = 0; b.baseLane = 0; b.lane = 0; b.throwT = +pm[1]; }); galleryMode = true; }
  }
  // ?cans: 상단 캔 줄·배낭 채움 확인용(보유 통조림 채움)
  if (location.search.indexOf("cans") >= 0) {
    startGame(); state = STATE.PLAY;
    const picks = [0, 0, 0, 2, 5, 5, 8, 11, 14, 20, 24];
    for (const i of picks) { const e = ELEMENTS[i]; stored.push({ symbol: e.symbol, name: e.name, color: e.color, number: e.number }); }
  }
  // ?relay: 보스 격파 귀환 화면 미리보기(=seal 이면 남극 정복)
  if (location.search.indexOf("relay") >= 0) {
    startGame(); if (location.search.indexOf("seal") >= 0) lap = 1;
    bossCleared();
  }
  // ?mina: 서울 이스터에그(롯데타워 MINA + 불꽃놀이) 미리보기
  if (location.search.indexOf("mina") >= 0) {
    startGame(); state = STATE.PLAY;
    const ki = STAGES.findIndex(function (s) { return s.key === "korea"; });
    distance = ki * STAGE_LEN + STAGE_LEN * 0.5;
    minaT = 6.5;
    items.push({ type: "secret", lane: 0, p: 0.7, vp: 0, pulse: 1.2, done: false });
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
      { type: "hole", canyon: true, lane: 0, p: 0.97, vp: 0, len: 0.08, w: 1.3, shape: makeJagged(), done: false, cleared: false },
    ];
    stored = [{ symbol: "Fe", name: "철", color: "#9aa7b0" }, { symbol: "Cu", name: "구리", color: "#d98f5a" }, { symbol: "Au", name: "금", color: "#e8c349" }];
    scenery = [
      { type: "landmark", key: stageLandmark().key, icon: stageLandmark().icon, lane: -1.3, p: 0.5, vp: 0, flip: false },
      { type: "landmark", key: stageLandmark().key, icon: stageLandmark().icon, lane: 1.32, p: 0.66, vp: 0, flip: true },
      { type: "igloo", lane: -1.3, p: 0.34, vp: 0, flip: false },
      { type: "penguin", lane: 1.28, p: 0.4, vp: 0, flip: true },
    ];
  }
})();

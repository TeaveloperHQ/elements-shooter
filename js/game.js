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
  // 굽이치는 트랙: 깊이 p에서 길 중심의 화면 X (멀수록 더 휜다)
  function curveCenterX(p) {
    const w = 0.3 + 0.7 * (1 - p);
    return W / 2 + Math.sin(curveT + (1 - p) * 1.9) * (W * 0.17) * w;
  }
  function laneToX(p, lane) { return curveCenterX(p) + lane * halfAt(p); }

  const HOLE_HALF = 0.42;   // 구덩이 반폭(길 반폭 대비) — 최대 너비 ≈ 길의 절반

  // ===================== 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, items, particles, texts;
  let score, distance, learned, runCoins;
  let spawnTimer, elapsed, speed, scrollY, shake, screenFlash;
  let curveT = 0;
  let snow = [], bergs = [];

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
    items = []; particles = []; texts = [];
    score = 0; distance = 0; learned = {}; runCoins = 0;
    spawnTimer = 0.8; elapsed = 0; speed = 150; scrollY = 0; shake = 0; screenFlash = 0; curveT = 0;
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
  function spawnObstacle() {
    const r = Math.random();
    if (r < 0.42) {
      // 얼음 구덩이
      const lane = (-1 + ((Math.random() * 3) | 0)) * 0.5;   // -0.5 / 0 / 0.5
      items.push({ type: "hole", lane: lane, p: 0, vp: 0.10 + Math.random() * 0.02, done: false });
    } else {
      // 원소 깃발 (안전 65% / 위험 35%)
      const safe = Math.random() < 0.65;
      const pool = safe ? BUFF_ELEMENTS : TRAP_ELEMENTS;
      const el = pool[(Math.random() * pool.length) | 0];
      items.push({ type: "flag", el: el, safe: safe, lane: -0.75 + Math.random() * 1.5,
        p: 0, vp: 0.10 + Math.random() * 0.02, done: false, wave: Math.random() * 6.28 });
    }
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;
    speed = 150 + elapsed * 3.2;                  // 점점 빨라짐
    distance += speed * dt;
    scrollY = (scrollY + speed * dt * 0.6) % 80;
    curveT += speed * dt * 0.0055;     // 트랙이 굽이친다
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
      if (o.type === "flag") o.wave += dt * 5;

      // 자석: 안전 깃발을 끌어당김
      if (o.type === "flag" && o.safe && META.up.magnet > 0 && o.p > 0.6 && player.onGround) {
        const ox = laneToX(o.p, o.lane);
        const range = 30 + META.up.magnet * 16;
        if (Math.abs(player.x - ox) < range) {
          o.lane += (((player.x - W / 2) / halfAt(o.p)) - o.lane) * Math.min(1, dt * 4);
        }
      }

      if (!o.done && o.p >= 1) {
        o.done = true;
        const ox = laneToX(1, o.lane);
        if (o.type === "hole") hitHole(o, ox, AIR);
        else hitFlag(o, ox, AIR);
      }
      if (o.p > 1.1) items.splice(i, 1);
    }
  }

  function hitHole(o, ox, AIR) {
    const holeHalf = halfAt(1) * HOLE_HALF;
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

  function hitFlag(o, ox, AIR) {
    const el = o.el;
    const grounded = player.jumpY <= AIR;
    if (o.safe) {
      // 안전 원소: 가까이서 주우면 획득 + 학습
      const catchR = 36 + META.up.magnet * 8;
      if (grounded && Math.abs(player.x - ox) < catchR) {
        learned[el.symbol] = true;
        score += 100; runCoins += 2;
        spawnParticles(ox, playerLineY() - 20, el.color, 14, 170);
        spawnText(player.x, playerLineY() - 60, "+100 " + el.symbol, "#ffe678", 20);
        SND.flag();
        showToast(el.symbol + " " + el.name + " — " + el.fact, false);
        updateHUD();
      }
    } else {
      // 위험 원소: 부딪히면 목숨↓ + 경고. 피하면 안전(학습은 됨)
      const hitR = 30;
      if (grounded && Math.abs(player.x - ox) < hitR) {
        learned[el.symbol] = true;
        loseLife("⚠ " + el.symbol + " " + el.name + "!");
        showToast("⚠ " + el.symbol + " " + el.name + " — " + el.fact, true);
        spawnParticles(ox, playerLineY(), "#e08080", 16, 220);
      }
    }
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

  // ---------- 아이템(구덩이/깃발) ----------
  function drawItems() {
    const sorted = items.slice().sort(function (a, b) { return a.p - b.p; });
    for (const o of sorted) { if (o.type === "hole") drawHole(o); else drawFlag(o); }
  }

  function drawHole(o) {
    const sc = projScale(o.p), y = projY(o.p);
    const cx = laneToX(o.p, o.lane);
    const rx = halfAt(o.p) * HOLE_HALF, ry = rx * 0.26;   // 납작하게(점프 타이밍 읽기 쉽게)
    ctx.save();
    const g = ctx.createRadialGradient(cx, y - ry * 0.2, 1, cx, y, rx);
    g.addColorStop(0, "#0e3550"); g.addColorStop(0.55, "#19567a"); g.addColorStop(1, "#3f86ad");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(180,225,245,0.35)"; ctx.beginPath(); ctx.ellipse(cx - rx * 0.25, y - ry * 0.25, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(225,245,255,0.9)"; ctx.lineWidth = Math.max(1.5, 2.5 * sc);
    ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(230,247,255,0.95)";
    for (let k = -2; k <= 2; k++) { const px = cx + k * rx * 0.4; ctx.beginPath(); ctx.moveTo(px - 3 * sc, y - ry); ctx.lineTo(px, y - ry - 5 * sc); ctx.lineTo(px + 3 * sc, y - ry); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // 점프 안내
    ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = "#cfe6ff"; ctx.textAlign = "center";
    ctx.font = "bold " + (9 * sc + 6) + "px sans-serif"; ctx.fillText("⬆ 점프", cx, y - ry - 8 * sc);
    ctx.textAlign = "start"; ctx.restore();
  }

  function drawFlag(o) {
    const sc = projScale(o.p);
    const x = laneToX(o.p, o.lane), gy = projY(o.p);
    const poleH = 46 * sc, topY = gy - poleH;
    const fw = 30 * sc, fh = 22 * sc;
    const wav = Math.sin(o.wave) * 2 * sc;

    // 그림자 + 막대
    ctx.fillStyle = "rgba(40,80,120,0.18)"; ctx.beginPath(); ctx.ellipse(x, gy, 7 * sc, 2.5 * sc, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#caa46a"; ctx.lineWidth = Math.max(2, 3 * sc); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, topY); ctx.stroke();
    ctx.fillStyle = "#e8c349"; ctx.beginPath(); ctx.arc(x, topY, Math.max(2, 2.5 * sc), 0, Math.PI * 2); ctx.fill();

    // 깃발(나부낌)
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x + fw, topY + wav);
    ctx.lineTo(x + fw, topY + fh + wav);
    ctx.lineTo(x, topY + fh);
    ctx.closePath();
    ctx.fillStyle = o.safe ? "#2f8fe0" : "#d8444f";
    ctx.fill();
    ctx.strokeStyle = o.safe ? "rgba(190,232,255,0.9)" : "rgba(255,190,190,0.9)";
    ctx.lineWidth = Math.max(1, 1.5 * sc); ctx.stroke();

    // 원소 기호
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
    ctx.font = "bold " + (fh * 0.7) + "px sans-serif";
    ctx.fillText(o.el.symbol, x + fw * 0.52, topY + fh * 0.72 + wav * 0.5);
    if (!o.safe) {
      ctx.fillStyle = "#ffe1e1"; ctx.font = "bold " + (8 * sc + 5) + "px sans-serif";
      ctx.fillText("⚠", x + fw * 0.52, topY - 3 * sc);
    }
    ctx.textAlign = "start";
  }

  // ---------- 펭귄(뒤에서 본 달리기) ----------
  function drawPlayer() {
    const x = player.x, y = player.y, lift = player.jumpY;
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

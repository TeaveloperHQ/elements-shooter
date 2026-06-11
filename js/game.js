/*
 * game.js — 원소 슈터: 펭귄 남극 대원정 (Elements Shooter: Penguin Antarctic March)
 *
 * 펭귄 분대를 이끌고 얼음 몬스터 호드를 막는다.
 * 내려오는 "원소 게이트" 중 안전한 원소를 골라 쏘면 동료(펭귄)가 늘고
 * 무기가 강해진다. 방사능·독성 원소는 피해야 한다.
 *
 * 메커니즘은 그대로, 비주얼은 남극탐험 + Hero Wars 광고풍으로 리메이크.
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

  // ===================== 게임 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, bullets, zombies, gates, particles, flashes;
  let score, learned;
  let spawnTimer, gateTimer, fireTimer, elapsed;
  let scrollY = 0;           // 빙판 스크롤(전진 느낌)
  let shake = 0;             // 화면 흔들림 강도

  // 배경 장식
  let snow = [];             // 떠다니는 눈송이
  let bergs = [];            // 지평선 빙산

  function newGame() {
    player = {
      x: W / 2,
      targetX: W / 2,
      y: 0,
      squad: 3,
      weapon: 1,
      shield: 0,
      fireRate: 1,
      bob: 0,                // 뒤뚱거림 위상
    };
    bullets = [];
    zombies = [];
    gates = [];
    particles = [];
    flashes = [];
    score = 0;
    learned = {};
    spawnTimer = 0;
    gateTimer = 1.2;
    fireTimer = 0;
    elapsed = 0;
    shake = 0;
    updateHUD();
  }

  function playerLineY() { return H - 78; }

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
    if (state === STATE.PLAY && e.touches[0]) {
      pointerMove(e.touches[0].clientX);
      e.preventDefault();
    }
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
  document.getElementById("retry-btn").addEventListener("click", startGame);

  function startGame() {
    newGame();
    state = STATE.PLAY;
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
  }

  function gameOver() {
    state = STATE.OVER;
    document.getElementById("final-score").textContent = Math.floor(score);
    const names = Object.keys(learned);
    document.getElementById("elements-learned").innerHTML =
      names.length
        ? "오늘 만난 원소: <b>" + names.join(", ") + "</b>"
        : "이번엔 원소를 만나지 못했어요!";
    overScreen.classList.remove("hidden");
  }

  // ===================== HUD / 토스트 =====================
  function updateHUD() {
    document.getElementById("hud-squad").textContent = player.squad;
    document.getElementById("hud-weapon").textContent = player.weapon;
    document.getElementById("hud-shield").textContent = player.shield;
    document.getElementById("hud-score").textContent = Math.floor(score);
  }

  let toastTimer = null;
  function showToast(el) {
    const t = document.getElementById("toast");
    t.textContent = el.symbol + " " + el.name + " — " + el.fact;
    t.classList.toggle("trap", el.kind === "trap");
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  // ===================== 게이트 생성 =====================
  function spawnGatePair() {
    const buff = BUFF_ELEMENTS[(Math.random() * BUFF_ELEMENTS.length) | 0];
    const trap = TRAP_ELEMENTS[(Math.random() * TRAP_ELEMENTS.length) | 0];
    const margin = 12;
    const gw = (W - margin * 3) / 2;
    const leftIsBuff = Math.random() < 0.5;
    const pair = [
      makeGate(margin, gw, leftIsBuff ? buff : trap),
      makeGate(margin * 2 + gw, gw, leftIsBuff ? trap : buff),
    ];
    gates.push(pair);
  }

  function makeGate(x, w, el) {
    return { x: x, w: w, y: -64, h: 58, el: el, count: 1, applied: false };
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;
    scrollY = (scrollY + dt * 90) % 80;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);

    // 플레이어 이동
    const speed = 540;
    if (keyLeft) player.targetX -= speed * dt;
    if (keyRight) player.targetX += speed * dt;
    player.targetX = Math.max(28, Math.min(W - 28, player.targetX));
    player.x += (player.targetX - player.x) * Math.min(1, dt * 14);
    player.y = playerLineY();
    player.bob += dt * 9;

    // 자동 사격
    const fireInterval = Math.max(0.08, 0.42 - player.fireRate * 0.03);
    fireTimer -= dt;
    if (fireTimer <= 0) {
      fireTimer = fireInterval;
      fireVolley();
    }

    // 몬스터 스폰
    const spawnInterval = Math.max(0.4, 1.4 - elapsed * 0.012);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval;
      spawnZombie();
    }

    // 게이트 스폰
    gateTimer -= dt;
    if (gateTimer <= 0) {
      gateTimer = 6.5;
      spawnGatePair();
    }

    updateBullets(dt);
    updateZombies(dt);
    updateGates(dt);
    updateParticles(dt);
    updateSnow(dt);
    updateFlashes(dt);

    score += dt * 6;
    updateHUD();
  }

  function fireVolley() {
    const n = Math.min(player.squad, 7);
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const bx = player.x - spread / 2 + spread * t;
      const by = player.y - 24;
      bullets.push({ x: bx, y: by, vy: -660, dmg: player.weapon, spin: Math.random() * 6 });
      flashes.push({ x: bx, y: by, life: 0.08 });
    }
  }

  function spawnZombie() {
    const hp = 2 + Math.floor(elapsed / 14);
    const big = Math.random() < 0.18 + elapsed * 0.002;
    const r = big ? 22 : 15;
    zombies.push({
      x: 30 + Math.random() * (W - 60),
      y: -34,
      vy: 34 + Math.random() * 16 + elapsed * 0.4,
      hp: big ? hp * 2 : hp, maxHp: big ? hp * 2 : hp,
      r: r, big: big,
      sway: Math.random() * 6.28, swaySpd: 1.5 + Math.random() * 1.5,
      hit: 0,
    });
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      b.spin += dt * 12;
      if (b.y < -20) { bullets.splice(i, 1); continue; }

      let hit = false;

      for (const pair of gates) {
        for (const g of pair) {
          if (!g.applied && b.x >= g.x && b.x <= g.x + g.w && b.y <= g.y + g.h && b.y >= g.y) {
            g.count = Math.min(99, g.count + 1);
            spawnParticles(b.x, b.y, g.el.color, 4, 90);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) { bullets.splice(i, 1); continue; }

      for (let j = zombies.length - 1; j >= 0; j--) {
        const z = zombies[j];
        const dx = b.x - z.x, dy = b.y - z.y;
        if (dx * dx + dy * dy <= z.r * z.r) {
          z.hp -= b.dmg;
          z.hit = 0.12;
          spawnParticles(b.x, b.y, "#dff3ff", 4, 120);
          if (z.hp <= 0) killZombie(j);
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  function killZombie(j) {
    const z = zombies[j];
    spawnParticles(z.x, z.y, "#bfe6ff", z.big ? 18 : 10, 160);
    spawnParticles(z.x, z.y, "#ffffff", z.big ? 10 : 5, 200);
    score += z.big ? 25 : 10;
    zombies.splice(j, 1);
  }

  function updateZombies(dt) {
    const line = playerLineY();
    for (let i = zombies.length - 1; i >= 0; i--) {
      const z = zombies[i];
      z.y += z.vy * dt;
      z.sway += dt * z.swaySpd;
      if (z.hit > 0) z.hit -= dt;
      if (z.y >= line) {
        if (player.shield > 0) player.shield--;
        else player.squad--;
        spawnParticles(z.x, z.y, "#7fd0ff", 12, 200);
        shake = Math.min(14, shake + 8);
        zombies.splice(i, 1);
        if (player.squad <= 0) { player.squad = 0; updateHUD(); gameOver(); return; }
      }
    }
  }

  function updateGates(dt) {
    const line = playerLineY();
    for (let p = gates.length - 1; p >= 0; p--) {
      const pair = gates[p];
      let remove = false;
      for (const g of pair) {
        g.y += 46 * dt;
        if (!g.applied && g.y + g.h >= line) {
          g.applied = true;
          if (player.x >= g.x && player.x <= g.x + g.w) applyGate(g);
        }
      }
      if (pair[0].y > H && pair[1].y > H) remove = true;
      if (remove) gates.splice(p, 1);
    }
  }

  function applyGate(g) {
    const el = g.el;
    const sign = el.kind === "buff" ? 1 : -1;
    const n = g.count;
    learned[el.symbol] = true;

    switch (el.effect) {
      case "squad":
        player.squad = Math.max(0, player.squad + sign * n);
        break;
      case "weapon":
        player.weapon = Math.max(1, Math.min(30, player.weapon + sign * n));
        break;
      case "firerate":
        player.fireRate = Math.max(1, Math.min(12, player.fireRate + sign * n));
        break;
      case "shield":
        player.shield += n;
        break;
      case "bomb": {
        let kills = n * 3;
        zombies.sort(function (a, b) { return b.y - a.y; });
        while (kills-- > 0 && zombies.length) killZombie(0);
        shake = Math.min(16, shake + 10);
        break;
      }
      case "score":
        score += sign * n * 300;
        break;
    }
    spawnParticles(player.x, playerLineY() - 10, el.color, 16, 180);
    showToast(el);
    updateHUD();
    if (player.squad <= 0) gameOver();
  }

  // ===================== 파티클 / 머즐 =====================
  function spawnParticles(x, y, color, n, spd) {
    spd = spd || 160;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * spd,
        vy: (Math.random() - 0.5) * spd - 30,
        life: 0.4 + Math.random() * 0.35,
        max: 0.75,
        color: color,
        r: 1.5 + Math.random() * 2,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;          // 중력
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function updateFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dt;
      if (flashes[i].life <= 0) flashes.splice(i, 1);
    }
  }

  // ===================== 배경 장식 =====================
  function buildSnow() {
    snow = [];
    const n = Math.round((W * H) / 9000);
    for (let i = 0; i < n; i++) {
      snow.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.8 + Math.random() * 2.2,
        vy: 14 + Math.random() * 26,
        vx: -8 + Math.random() * 16,
        a: 0.3 + Math.random() * 0.5,
      });
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
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground();

    if (state === STATE.PLAY || state === STATE.OVER) {
      drawGates();
      drawZombies();
      drawBullets();
      drawParticles();
      drawPlayer();
      drawFlashes();
      drawDefenseLine();
    }
    drawSnow();
    ctx.restore();
  }

  function drawBackground() {
    // 하늘(오로라 그라데이션)
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, "#0a2a4a");
    sky.addColorStop(0.28, "#16456e");
    sky.addColorStop(0.45, "#2d7fa8");
    sky.addColorStop(0.55, "#bfe8f2");
    sky.addColorStop(1.0, "#eaf6ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const horizon = H * 0.30;

    // 오로라 띠
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const yy = horizon * (0.35 + i * 0.18);
      const grad = ctx.createLinearGradient(0, yy - 30, 0, yy + 30);
      const col = i % 2 ? "rgba(120,255,200," : "rgba(140,200,255,";
      grad.addColorStop(0, col + "0)");
      grad.addColorStop(0.5, col + "0.18)");
      grad.addColorStop(1, col + "0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 24) {
        ctx.lineTo(x, yy + Math.sin(x * 0.03 + i * 2 + elapsed * 0.5) * 14);
      }
      ctx.lineTo(W, yy + 60); ctx.lineTo(0, yy + 60);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 태양(달빛 같은 차가운 태양)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const sg = ctx.createRadialGradient(W * 0.74, horizon * 0.6, 4, W * 0.74, horizon * 0.6, 60);
    sg.addColorStop(0, "rgba(255,255,255,0.95)");
    sg.addColorStop(0.4, "rgba(200,235,255,0.5)");
    sg.addColorStop(1, "rgba(200,235,255,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(W * 0.74, horizon * 0.6, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 지평선 빙산 실루엣
    ctx.fillStyle = "rgba(180, 215, 235, 0.85)";
    for (const b of bergs) {
      ctx.beginPath();
      ctx.moveTo(b.x, horizon);
      ctx.lineTo(b.x + b.w * 0.5, horizon - b.h);
      ctx.lineTo(b.x + b.w, horizon);
      ctx.closePath();
      ctx.fill();
    }

    // 빙판 바닥
    ctx.fillStyle = "#eaf6ff";
    ctx.fillRect(0, horizon, W, H - horizon);

    // 빙판 원근 줄무늬(스크롤로 전진감) — 가로선 + 세로 수렴선
    ctx.strokeStyle = "rgba(120, 170, 210, 0.22)";
    ctx.lineWidth = 1.5;
    const vanishX = W / 2;
    for (let i = 0; i < 14; i++) {
      // 0..1, 스크롤로 흐른다
      let t = (i / 14) + (scrollY / 80) / 14;
      t = t % 1;
      const y = horizon + (H - horizon) * (t * t);   // 아래로 갈수록 간격 넓게
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let gx = -2; gx <= 2; gx++) {
      const fx = vanishX + gx * (W * 0.12);
      ctx.beginPath();
      ctx.moveTo(vanishX + gx * 18, horizon);
      ctx.lineTo(fx, H);
      ctx.stroke();
    }

    // 위쪽 비네팅
    const vg = ctx.createLinearGradient(0, 0, 0, H * 0.25);
    vg.addColorStop(0, "rgba(0,10,25,0.35)");
    vg.addColorStop(1, "rgba(0,10,25,0)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H * 0.25);
  }

  function drawSnow() {
    ctx.fillStyle = "#ffffff";
    for (const s of snow) {
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawDefenseLine() {
    const y = playerLineY() + 6;
    ctx.strokeStyle = "rgba(90, 150, 210, 0.5)";
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------- 펭귄 분대 ----------
  function drawPlayer() {
    const n = Math.min(player.squad, 7);
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = player.x - spread / 2 + spread * t;
      const bob = Math.sin(player.bob + i * 1.3) * 2;
      drawPenguin(x, player.y + bob, i === Math.floor(n / 2));
    }
    // 보호막
    if (player.shield > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 220, 255, 0.7)";
      ctx.fillStyle = "rgba(140, 220, 255, 0.10)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y - 8, spread / 2 + 20, Math.PI * 0.92, Math.PI * 2.08);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPenguin(x, y, leader) {
    const s = leader ? 1.12 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // 그림자
    ctx.fillStyle = "rgba(40, 80, 120, 0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 4, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 발
    ctx.fillStyle = "#f5a623";
    ctx.beginPath(); ctx.ellipse(-4, 2, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 2, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();

    // 몸통(검정)
    ctx.fillStyle = "#1b2733";
    ctx.beginPath();
    ctx.ellipse(0, -10, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 배(흰색)
    ctx.fillStyle = "#f4fbff";
    ctx.beginPath();
    ctx.ellipse(0, -8, 6.5, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 날개
    ctx.fillStyle = "#1b2733";
    ctx.beginPath(); ctx.ellipse(-9.5, -9, 3, 7, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(9.5, -9, 3, 7, -0.3, 0, Math.PI * 2); ctx.fill();

    // 눈
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(-3, -19, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -19, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#10171f";
    ctx.beginPath(); ctx.arc(-2.6, -19, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3.4, -19, 1.2, 0, Math.PI * 2); ctx.fill();

    // 부리
    ctx.fillStyle = "#f5a623";
    ctx.beginPath();
    ctx.moveTo(-2.5, -16); ctx.lineTo(2.5, -16); ctx.lineTo(0, -12.5);
    ctx.closePath(); ctx.fill();

    if (leader) {
      // 대장 펭귄 작은 모자
      ctx.fillStyle = "#e23b3b";
      ctx.fillRect(-5, -27, 10, 3);
      ctx.beginPath(); ctx.arc(0, -27, 5, Math.PI, 0); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 얼음 몬스터 ----------
  function drawZombies() {
    for (const z of zombies) {
      const sway = Math.sin(z.sway) * (z.big ? 3 : 2);
      ctx.save();
      ctx.translate(z.x + sway, z.y);

      // 그림자
      ctx.fillStyle = "rgba(40,80,120,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, z.r * 0.9, z.r * 0.9, z.r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 몸(얼음 결정체)
      const hitFlash = z.hit > 0;
      const bodyGrad = ctx.createRadialGradient(-z.r * 0.3, -z.r * 0.3, 2, 0, 0, z.r);
      if (hitFlash) {
        bodyGrad.addColorStop(0, "#ffffff");
        bodyGrad.addColorStop(1, "#cfe9ff");
      } else {
        bodyGrad.addColorStop(0, "#bfe3ff");
        bodyGrad.addColorStop(1, "#5fa3d8");
      }
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = "rgba(30,70,110,0.5)";
      ctx.lineWidth = 1.5;
      // 울퉁불퉁한 얼음 덩어리
      ctx.beginPath();
      const spikes = z.big ? 9 : 7;
      for (let i = 0; i <= spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rr = z.r * (i % 2 ? 0.78 : 1.05);
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 화난 눈
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(-z.r * 0.32, -z.r * 0.1, z.r * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(z.r * 0.32, -z.r * 0.1, z.r * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.arc(-z.r * 0.28, -z.r * 0.05, z.r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(z.r * 0.36, -z.r * 0.05, z.r * 0.12, 0, Math.PI * 2); ctx.fill();
      // 찡그린 눈썹
      ctx.strokeStyle = "#1d3a52";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-z.r * 0.6, -z.r * 0.5); ctx.lineTo(-z.r * 0.1, -z.r * 0.28);
      ctx.moveTo(z.r * 0.6, -z.r * 0.5); ctx.lineTo(z.r * 0.1, -z.r * 0.28);
      ctx.stroke();
      // 이빨(고드름)
      ctx.fillStyle = "#eaf6ff";
      ctx.beginPath();
      ctx.moveTo(-z.r * 0.3, z.r * 0.35);
      ctx.lineTo(-z.r * 0.15, z.r * 0.7);
      ctx.lineTo(0, z.r * 0.35);
      ctx.lineTo(z.r * 0.15, z.r * 0.7);
      ctx.lineTo(z.r * 0.3, z.r * 0.35);
      ctx.closePath(); ctx.fill();

      ctx.restore();

      // 체력바
      if (z.hp < z.maxHp) {
        ctx.fillStyle = "rgba(10,30,50,0.55)";
        ctx.fillRect(z.x - z.r, z.y - z.r - 9, z.r * 2, 4);
        ctx.fillStyle = "#6fe0a0";
        ctx.fillRect(z.x - z.r, z.y - z.r - 9, z.r * 2 * (z.hp / z.maxHp), 4);
      }
    }
  }

  // ---------- 눈덩이 총알 ----------
  function drawBullets() {
    for (const b of bullets) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 9);
      g.addColorStop(0, "rgba(200,240,255,0.9)");
      g.addColorStop(1, "rgba(160,220,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(b.x, b.y, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(150,200,235,0.9)";
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(b.spin) * 1.2, b.y + Math.sin(b.spin) * 1.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFlashes() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of flashes) {
      const a = Math.max(0, f.life / 0.08);
      ctx.fillStyle = "rgba(220,245,255," + (a * 0.8) + ")";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 7 * a + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGates() {
    ctx.textAlign = "center";
    for (const pair of gates) {
      for (const g of pair) {
        const isBuff = g.el.kind === "buff";
        const cx = g.x + g.w / 2;

        // 얼음 패널
        const grad = ctx.createLinearGradient(g.x, g.y, g.x, g.y + g.h);
        if (isBuff) {
          grad.addColorStop(0, "rgba(120, 230, 200, 0.30)");
          grad.addColorStop(1, "rgba(40, 150, 130, 0.45)");
        } else {
          grad.addColorStop(0, "rgba(255, 130, 130, 0.30)");
          grad.addColorStop(1, "rgba(170, 50, 60, 0.45)");
        }
        ctx.fillStyle = grad;
        ctx.fillRect(g.x, g.y, g.w, g.h);

        // 빛나는 테두리
        ctx.strokeStyle = isBuff ? "rgba(150, 255, 210, 0.95)" : "rgba(255, 140, 140, 0.95)";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
        // 상단 광택
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(g.x + 2, g.y + 2, g.w - 4, 8);

        // 원소 기호
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 24px sans-serif";
        ctx.fillText(g.el.symbol, cx, g.y + 26);
        // 이름
        ctx.fillStyle = "#eaf6ff";
        ctx.font = "11px sans-serif";
        ctx.fillText(g.el.name, cx, g.y + 40);
        // 배수
        ctx.fillStyle = isBuff ? "#aeffd0" : "#ffb0b0";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText((isBuff ? "▲ +" : "▼ −") + g.count, cx, g.y + 54);
      }
    }
    ctx.textAlign = "start";
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ===================== 메인 루프 =====================
  let lastT = 0;
  function loop(ts) {
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0;
    lastT = ts;
    if (state === STATE.PLAY) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();

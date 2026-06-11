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

  let player, bullets, enemies, gates, particles, flashes, items;
  let score, learned;
  let spawnTimer, gateTimer, fireTimer, elapsed;
  let scrollY = 0;
  let shake = 0;

  let snow = [];
  let bergs = [];

  function newGame() {
    player = {
      x: W / 2, targetX: W / 2, y: 0,
      squad: 3, weapon: 1, shield: 0, fireRate: 1,
      bob: 0,
    };
    bullets = [];
    enemies = [];
    gates = [];
    particles = [];
    flashes = [];
    items = [];
    score = 0;
    learned = {};
    spawnTimer = 0;
    gateTimer = 1.0;
    fireTimer = 0;
    elapsed = 0;
    shake = 0;
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
      names.length ? "오늘 만난 원소: <b>" + names.join(", ") + "</b>"
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
    shake = Math.min(16, shake + 11);
    learned[panel.el.symbol] = true;
    showToast("💥 " + panel.el.symbol + " " + panel.el.name + " 폭발! 아이템 획득!", false);
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;
    scrollY = (scrollY + dt * 90) % 80;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);

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

    const spawnInterval = Math.max(0.45, 1.5 - elapsed * 0.013);
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = spawnInterval; spawnEnemy(); }

    gateTimer -= dt;
    if (gateTimer <= 0) { gateTimer = 5.5; spawnGatePair(); }

    updateBullets(dt);
    updateEnemies(dt);
    updateGates(dt);
    updateItems(dt);
    updateParticles(dt);
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
  function spawnEnemy() {
    const hp = 2 + Math.floor(elapsed / 14);
    const big = Math.random() < 0.16 + elapsed * 0.002;
    enemies.push({
      lane: -0.9 + Math.random() * 1.8,
      p: 0.0,
      vp: 0.10 + Math.random() * 0.05 + elapsed * 0.0016,
      hp: big ? hp * 2 : hp, maxHp: big ? hp * 2 : hp,
      r: big ? 22 : 15, big: big,
      sway: Math.random() * 6.28, swaySpd: 1.5 + Math.random() * 1.5,
      hit: 0,
    });
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

      // 적 충돌(원근 화면좌표 기준)
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const es = projScale(e.p);
        const ex = laneToX(e.p, e.lane), ey = projY(e.p);
        const rad = e.r * es + 6 * projScale(b.p);
        const dx = bx - ex, dy = by - ey;
        if (dx * dx + dy * dy <= rad * rad) {
          e.hp -= b.dmg;
          e.hit = 0.12;
          spawnParticles(bx, by, "#dff3ff", 4, 120);
          if (e.hp <= 0) killEnemy(j);
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  function killEnemy(j) {
    const e = enemies[j];
    const ex = laneToX(e.p, e.lane), ey = projY(e.p);
    spawnParticles(ex, ey, "#bfe6ff", e.big ? 18 : 10, 160);
    spawnParticles(ex, ey, "#ffffff", e.big ? 10 : 5, 200);
    score += e.big ? 25 : 10;
    enemies.splice(j, 1);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      // 가까울수록 빠르게(원근 가속)
      e.p += e.vp * (0.45 + e.p * 1.1) * dt;
      e.sway += dt * e.swaySpd;
      if (e.hit > 0) e.hit -= dt;
      if (e.p >= 1) {
        if (player.shield > 0) player.shield--;
        else player.squad--;
        spawnParticles(laneToX(1, e.lane), playerLineY(), "#7fd0ff", 12, 200);
        shake = Math.min(14, shake + 8);
        enemies.splice(i, 1);
        if (player.squad <= 0) { player.squad = 0; updateHUD(); gameOver(); return; }
      }
    }
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
    if (roll < 0.4) { type = "shield"; label = "🛡"; player.shield += 3; }
    else if (roll < 0.7) { type = "bomb"; label = "💥";
      let kills = 8; enemies.sort(function (a, b) { return b.p - a.p; });
      while (kills-- > 0 && enemies.length) killEnemy(0);
      shake = Math.min(16, shake + 10);
    } else { type = "score"; label = "⭐"; score += 800; }
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
      drawBullets();
      drawParticles();
      drawItems();
      drawPlayer();
      drawFlashes();
      drawDefenseLine();
    }
    drawSnow();
    ctx.restore();
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
    ctx.strokeStyle = "rgba(90, 150, 210, 0.45)";
    ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
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

      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
      if (e.hit > 0) { grad.addColorStop(0, "#ffffff"); grad.addColorStop(1, "#cfe9ff"); }
      else { grad.addColorStop(0, "#bfe3ff"); grad.addColorStop(1, "#5fa3d8"); }
      ctx.fillStyle = grad;
      ctx.strokeStyle = "rgba(30,70,110,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const spikes = e.big ? 9 : 7;
      for (let i = 0; i <= spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rr = r * (i % 2 ? 0.78 : 1.05);
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // 화난 눈
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.1, r * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.1, r * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.5); ctx.lineTo(-r * 0.1, -r * 0.28);
      ctx.moveTo(r * 0.6, -r * 0.5); ctx.lineTo(r * 0.1, -r * 0.28);
      ctx.stroke();
      // 고드름 이빨
      ctx.fillStyle = "#eaf6ff";
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, r * 0.35); ctx.lineTo(-r * 0.15, r * 0.7); ctx.lineTo(0, r * 0.35);
      ctx.lineTo(r * 0.15, r * 0.7); ctx.lineTo(r * 0.3, r * 0.35);
      ctx.closePath(); ctx.fill();
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
    if (state === STATE.PLAY) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();

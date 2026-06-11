/*
 * game.js — 원소 슈터 메인 게임 로직
 *
 * 좀비 호드를 막으면서, 내려오는 "원소 게이트" 중 안전한 원소를 골라
 * 쏘면 동료와 무기가 강해진다. 위험한 원소는 골라서 통과하면 약해진다.
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
  }
  window.addEventListener("resize", resize);
  resize();

  // ===================== 게임 상태 =====================
  const STATE = { MENU: 0, PLAY: 1, OVER: 2 };
  let state = STATE.MENU;

  let player, bullets, zombies, gates, particles;
  let score, learned;
  let spawnTimer, gateTimer, fireTimer, elapsed;

  function newGame() {
    player = {
      x: W / 2,
      targetX: W / 2,
      y: 0,            // playerLine 에서 매 프레임 갱신
      squad: 3,
      weapon: 1,
      shield: 0,
      fireRate: 1,     // 높을수록 빠름
    };
    bullets = [];
    zombies = [];
    gates = [];
    particles = [];
    score = 0;
    learned = {};      // { "Fe": true, ... }
    spawnTimer = 0;
    gateTimer = 1.2;
    fireTimer = 0;
    elapsed = 0;
    updateHUD();
  }

  // playerLine: 플레이어/게이트 판정 기준선 (아래쪽)
  function playerLineY() { return H - 70; }

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
    // 안전/위험 좌우 위치를 무작위로 섞는다.
    const leftIsBuff = Math.random() < 0.5;
    const pair = [
      makeGate(margin, gw, leftIsBuff ? buff : trap),
      makeGate(margin * 2 + gw, gw, leftIsBuff ? trap : buff),
    ];
    gates.push(pair);
  }

  function makeGate(x, w, el) {
    return {
      x: x, w: w, y: -60, h: 54,
      el: el,
      count: 1,        // 통과 시 효과 배수 (쏠수록 증가)
      applied: false,
    };
  }

  // ===================== 업데이트 =====================
  function update(dt) {
    elapsed += dt;

    // --- 플레이어 이동 ---
    const speed = 520;
    if (keyLeft) player.targetX -= speed * dt;
    if (keyRight) player.targetX += speed * dt;
    player.targetX = Math.max(24, Math.min(W - 24, player.targetX));
    player.x += (player.targetX - player.x) * Math.min(1, dt * 14);
    player.y = playerLineY();

    // --- 자동 사격 ---
    const fireInterval = Math.max(0.08, 0.42 - player.fireRate * 0.03);
    fireTimer -= dt;
    if (fireTimer <= 0) {
      fireTimer = fireInterval;
      fireVolley();
    }

    // --- 좀비 스폰 (시간이 지날수록 빨라짐) ---
    const spawnInterval = Math.max(0.4, 1.4 - elapsed * 0.012);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval;
      spawnZombie();
    }

    // --- 게이트 스폰 ---
    gateTimer -= dt;
    if (gateTimer <= 0) {
      gateTimer = 6.5;
      spawnGatePair();
    }

    updateBullets(dt);
    updateZombies(dt);
    updateGates(dt);
    updateParticles(dt);

    score += dt * 6; // 생존 점수
    updateHUD();
  }

  function fireVolley() {
    const n = Math.min(player.squad, 7);          // 보이는 사수만큼 발사
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const bx = player.x - spread / 2 + spread * t;
      bullets.push({ x: bx, y: player.y - 18, vy: -640, dmg: player.weapon });
    }
  }

  function spawnZombie() {
    const hp = 2 + Math.floor(elapsed / 14);
    zombies.push({
      x: 30 + Math.random() * (W - 60),
      y: -30,
      vy: 34 + Math.random() * 16 + elapsed * 0.4,
      hp: hp, maxHp: hp,
      r: 16,
    });
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -20) { bullets.splice(i, 1); continue; }

      let hit = false;

      // 게이트 충돌 → 효과 배수 증가
      for (const pair of gates) {
        for (const g of pair) {
          if (!g.applied && b.x >= g.x && b.x <= g.x + g.w && b.y <= g.y + g.h && b.y >= g.y) {
            g.count = Math.min(99, g.count + 1);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) { bullets.splice(i, 1); continue; }

      // 좀비 충돌
      for (let j = zombies.length - 1; j >= 0; j--) {
        const z = zombies[j];
        const dx = b.x - z.x, dy = b.y - z.y;
        if (dx * dx + dy * dy <= z.r * z.r) {
          z.hp -= b.dmg;
          spawnParticles(b.x, b.y, "#9fe0ff", 3);
          if (z.hp <= 0) {
            killZombie(j);
          }
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }

  function killZombie(j) {
    const z = zombies[j];
    spawnParticles(z.x, z.y, "#7ed957", 8);
    score += 10;
    zombies.splice(j, 1);
  }

  function updateZombies(dt) {
    const line = playerLineY();
    for (let i = zombies.length - 1; i >= 0; i--) {
      const z = zombies[i];
      z.y += z.vy * dt;
      if (z.y >= line) {
        // 방어선 돌파 → 보호막 우선 소모, 없으면 동료 감소
        if (player.shield > 0) {
          player.shield--;
        } else {
          player.squad--;
        }
        spawnParticles(z.x, z.y, "#e06666", 10);
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
        // 플레이어 선에 도달 → 플레이어가 어느 게이트 아래 있는지 판정
        if (!g.applied && g.y + g.h >= line) {
          g.applied = true;
          if (player.x >= g.x && player.x <= g.x + g.w) {
            applyGate(g);
          }
        }
      }
      // 두 게이트 모두 화면 아래로 사라지면 제거
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
        // 가장 아래쪽(위험한) 좀비부터 제거
        zombies.sort(function (a, b) { return b.y - a.y; });
        while (kills-- > 0 && zombies.length) killZombie(0);
        break;
      }
      case "score":
        score += sign * n * 300;
        break;
    }
    spawnParticles(player.x, playerLineY() - 10, el.color, 14);
    showToast(el);
    updateHUD();
    if (player.squad <= 0) gameOver();
  }

  // ===================== 파티클 =====================
  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 160,
        vy: (Math.random() - 0.5) * 160,
        life: 0.4 + Math.random() * 0.3,
        color: color,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ===================== 렌더 =====================
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();

    if (state === STATE.PLAY || state === STATE.OVER) {
      drawGates();
      drawZombies();
      drawBullets();
      drawParticles();
      drawPlayer();
      drawDefenseLine();
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#101a30");
    g.addColorStop(1, "#0a0e18");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawDefenseLine() {
    const y = playerLineY();
    ctx.strokeStyle = "rgba(120, 180, 255, 0.25)";
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPlayer() {
    const n = Math.min(player.squad, 7);
    const spread = Math.min(120, 18 + n * 12);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = player.x - spread / 2 + spread * t;
      drawShooter(x, player.y);
    }
    // 보호막 표시
    if (player.shield > 0) {
      ctx.strokeStyle = "rgba(120, 220, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y - 6, spread / 2 + 16, Math.PI, 0);
      ctx.stroke();
    }
  }

  function drawShooter(x, y) {
    // 몸통
    ctx.fillStyle = "#3f8efc";
    ctx.fillRect(x - 7, y - 16, 14, 18);
    // 머리
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.arc(x, y - 20, 6, 0, Math.PI * 2);
    ctx.fill();
    // 총
    ctx.fillStyle = "#cfd8e3";
    ctx.fillRect(x - 2, y - 26, 4, 12);
  }

  function drawZombies() {
    for (const z of zombies) {
      // 몸
      ctx.fillStyle = "#5aa05a";
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
      // 눈
      ctx.fillStyle = "#10200f";
      ctx.fillRect(z.x - 6, z.y - 4, 3, 3);
      ctx.fillRect(z.x + 3, z.y - 4, 3, 3);
      // 체력바
      if (z.hp < z.maxHp) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(z.x - z.r, z.y - z.r - 7, z.r * 2, 4);
        ctx.fillStyle = "#7ed957";
        ctx.fillRect(z.x - z.r, z.y - z.r - 7, z.r * 2 * (z.hp / z.maxHp), 4);
      }
    }
  }

  function drawBullets() {
    ctx.fillStyle = "#9fe0ff";
    for (const b of bullets) {
      ctx.fillRect(b.x - 2, b.y - 8, 4, 10);
    }
  }

  function drawGates() {
    ctx.textAlign = "center";
    for (const pair of gates) {
      for (const g of pair) {
        const isBuff = g.el.kind === "buff";
        // 패널 배경
        ctx.fillStyle = isBuff ? "rgba(40, 90, 60, 0.55)" : "rgba(100, 40, 40, 0.55)";
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.strokeStyle = isBuff ? "rgba(120, 230, 160, 0.9)" : "rgba(240, 120, 120, 0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(g.x, g.y, g.w, g.h);

        // 원소 기호
        ctx.fillStyle = g.el.color;
        ctx.font = "bold 22px sans-serif";
        ctx.fillText(g.el.symbol, g.x + g.w / 2, g.y + 22);
        // 이름
        ctx.fillStyle = "#e7ecf3";
        ctx.font = "11px sans-serif";
        ctx.fillText(g.el.name, g.x + g.w / 2, g.y + 36);
        // 배수 카운터
        ctx.fillStyle = isBuff ? "#9fe6b8" : "#f0a0a0";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText((isBuff ? "+" : "−") + g.count, g.x + g.w / 2, g.y + 50);
      }
    }
    ctx.textAlign = "start";
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
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
  requestAnimationFrame(loop);
})();

// Copyright (c) Mark Longo 2026

/**
 * Murk controls: keyboard, mouse and gamepad.
 *
 * The dungeon is a grid walked along its four diagonals, which is awkward to steer with raw axes. Input is therefore
 * expressed in screen terms ("up", "left"...) and resolved against the tunnel ahead, so holding one key follows
 * winding corridors. Fire has aim assist, and clicking a monster walks into its firing line and attacks.
 */

const MOVE_KEYS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], Numpad4: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0], Numpad6: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], Numpad8: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1], Numpad2: [0, 1],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1]
};
const FIRE_KEYS = ['Space', 'ControlLeft', 'ControlRight', 'KeyJ'];
const PREVENT_KEYS = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2'];

// Screen-space diagonals: up-left is x-1 (NW), up-right y-1 (NE), down-left y+1 (SW), down-right x+1 (SE).
function diagonalFor(ix, iy) {
  if (ix < 0) return iy < 0 ? DIR.NW : DIR.SW;
  return iy < 0 ? DIR.NE : DIR.SE;
}

// A single screen axis maps to the two diagonals on that side.
function candidatesFor(ix, iy) {
  if (ix < 0) return [DIR.NW, DIR.SW];
  if (ix > 0) return [DIR.NE, DIR.SE];
  return iy < 0 ? [DIR.NW, DIR.NE] : [DIR.SW, DIR.SE];
}

// Eight-way sector of an analogue stick as a screen intent.
const STICK_SECTORS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

Object.assign(MurkGame.prototype, {
  initControls() {
    this.keys = new Set();
    this.tap = null;
    this.attackTarget = null;
    this.hoverCell = null;
    this.hoverEntity = null;
    this.repathAt = 0;
    this.pad = { ix: 0, iy: 0, fire: false, aimDir: 0, prev: [], connected: false };
    this.modalReturn = null;
  },

  frameState() {
    return { ds: this.ds, lvl: this.lvl, entities: this.entities, player: this.player };
  },

  clearInput() {
    this.keys.clear();
    this.tap = null;
    this.mouse.left = false;
    this.mouse.right = false;
    this.mouse.leftOnEnemy = false;
    this.pad.fire = false;
  },

  // ---------- binding ----------

  bindInput() {
    const surface = this.renderer.renderer.domElement;
    surface.addEventListener('mousedown', (e) => this.onMouseDown(e));
    surface.addEventListener('dblclick', (e) => this.onDblClick(e));
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.active = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.mouse.leftOnEnemy = false; }
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('mouseleave', () => { this.mouse.active = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.zoomBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // Losing focus pauses, so alt-tabbing never costs you a fight.
    window.addEventListener('blur', () => {
      this.clearInput();
      if (this.state === 'PLAYING') this.openPause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'PLAYING') this.openPause();
    });
    // Buttons that keep focus would swallow Space / Enter presses meant for the game.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button');
      if (btn && !btn.closest('#modal-screen, #perk-screen')) btn.blur();
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('gamepadconnected', () => { this.pad.connected = true; });
  },

  // ---------- keyboard ----------

  keyIntent() {
    let ix = 0;
    let iy = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) { ix += v[0]; iy += v[1]; }
    }
    return [Math.sign(ix), Math.sign(iy)];
  },

  fireHeld() {
    return FIRE_KEYS.some((k) => this.keys.has(k)) || this.pad.fire;
  },

  onKeyDown(e) {
    if (PREVENT_KEYS.includes(e.code) && !e.ctrlKey && !e.metaKey) e.preventDefault();
    if (this.state === 'MODAL') {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.closeModal();
      }
      return;
    }
    if (this.state === 'PAUSED') {
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) this.closePause();
      return;
    }
    if (this.state === 'PERK') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
      if (n !== undefined && !e.repeat) this.choosePerk(n);
      return;
    }
    if (this.state === 'MAP') {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyM' || e.code === 'Tab') this.closeMap();
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.mapFloor(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.mapFloor(1);
      return;
    }
    if (this.state !== 'PLAYING' || e.ctrlKey && !FIRE_KEYS.includes(e.code) && !e.code.startsWith('Control')) return;

    this.keys.add(e.code);
    if (e.repeat) return;

    if (MOVE_KEYS[e.code]) {
      this.mouse.active = false;
      const [ix, iy] = this.keyIntent();
      this.tap = { ix, iy, until: this.time + 0.22 };
      this.path = [];
      this.attackTarget = null;
      this.autoUse = false;
      return;
    }
    switch (e.code) {
      case 'ShiftLeft': case 'ShiftRight': case 'KeyE': case 'Enter': this.useStairs(); break;
      case 'KeyR': this.useRing(); break;
      case 'KeyQ': case 'KeyT': this.dropRelic(this.player, true); break;
      case 'KeyM': case 'Tab': this.openMap(); break;
      case 'KeyN': this.toggleMute(); break;
      case 'KeyF': this.toggleFullscreen(); break;
      case 'KeyH': case 'F1': this.showHelp(); break;
      case 'F2': case 'KeyG': this.showObjective(); break;
      case 'KeyP': case 'Escape': this.openPause(); break;
      case 'Equal': case 'NumpadAdd': this.renderer.zoomBy(1); break;
      case 'Minus': case 'NumpadSubtract': this.renderer.zoomBy(-1); break;
      default: break;
    }
  },

  onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === 'Space') e.preventDefault();
  },

  // ---------- mouse ----------

  onMouseDown(e) {
    if (this.state !== 'PLAYING') return;
    this.audio.init();
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.active = true;
    if (e.button === 0) {
      this.mouse.left = true;
      this.lastPathCell = null;

      const now = performance.now();
      const g = this.renderer.screenToGrid(e.clientX, e.clientY);
      const isDbl = (now - (this.lastClickTime || 0) < 400 && this.lastClickCell === `${g.x},${g.y}`);
      this.lastClickTime = now;
      this.lastClickCell = `${g.x},${g.y}`;

      const foe = this.hostileUnderMouse();
      if (foe) {
        this.attackTarget = foe;
        this.mouse.leftOnEnemy = true;
        this.path = [];
        this.autoUse = false;
        this.repathAt = 0;
      } else {
        const cell = this.ds.cell(g.x, g.y, this.lvl);
        if (isDbl && cell.type === 's') {
          const p = this.player;
          this.attackTarget = null;
          this.mouse.leftOnEnemy = false;
          if (g.x === p.x && g.y === p.y) {
            this.useStairs();
            return;
          }
          const path = this.ds.findPath(this.lvl, p.x, p.y, g.x, g.y, null);
          if (path) {
            this.path = path;
            this.autoUse = true;
            return;
          }
        }
        this.attackTarget = null;
        this.mouse.leftOnEnemy = false;
        this.pathToMouse(true);
      }
    } else if (e.button === 2) {
      this.mouse.right = true;
    }
  },

  onDblClick(e) {
    if (this.state !== 'PLAYING' || e.button !== 0) return;
    const g = this.renderer.screenToGrid(e.clientX, e.clientY);
    const cell = this.ds.cell(g.x, g.y, this.lvl);
    if (cell.type === 's') {
      const p = this.player;
      if (g.x === p.x && g.y === p.y) {
        this.useStairs();
      } else {
        const path = this.ds.findPath(this.lvl, p.x, p.y, g.x, g.y, null);
        if (path) {
          this.path = path;
          this.autoUse = true;
        }
      }
    }
  },

  hostileUnderMouse() {
    const ent = this.renderer.entityAtScreen(this.mouse.x, this.mouse.y, this.frameState());
    return ent && this.hostile(this.player, ent) ? ent : null;
  },

  // ---------- gamepad ----------

  pollGamepad() {
    if (!navigator.getGamepads) return;
    const pad = Array.from(navigator.getGamepads()).find((g) => g && g.connected);
    const st = this.pad;
    if (!pad) { st.ix = st.iy = 0; st.fire = false; st.aimDir = 0; return; }

    const dead = 0.32;
    let ix = 0;
    let iy = 0;
    const sx = pad.axes[0] || 0;
    const sy = pad.axes[1] || 0;
    if (Math.hypot(sx, sy) > dead) {
      const sector = (Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) + 8) % 8;
      [ix, iy] = STICK_SECTORS[sector];
    }
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (btn(14)) ix -= 1;
    if (btn(15)) ix += 1;
    if (btn(12)) iy -= 1;
    if (btn(13)) iy += 1;
    st.ix = Math.sign(ix);
    st.iy = Math.sign(iy);

    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    st.aimDir = Math.hypot(rx, ry) > 0.5 ? diagonalFor(rx, ry) : 0;
    st.fire = btn(7) || btn(5) || btn(1) || st.aimDir !== 0;
    if (st.ix || st.iy || st.aimDir) this.mouse.active = false;

    const edge = (i, fn) => {
      const now = btn(i);
      if (now && !st.prev[i]) fn();
      st.prev[i] = now;
    };
    edge(0, () => this.useStairs());
    edge(2, () => this.useRing());
    edge(3, () => this.dropRelic(this.player, true));
    edge(8, () => this.openMap());
    edge(9, () => this.openPause());
    if (st.ix || st.iy) {
      this.path = [];
      this.attackTarget = null;
    }
  },

  // ---------- movement ----------

  canStep(e, dir) {
    const nx = e.x + DIR_VEC[dir][0];
    const ny = e.y + DIR_VEC[dir][1];
    return this.ds.walkable(nx, ny, e.lvl) && !this.entityAt(nx, ny, e.lvl, e);
  },

  // Turns a screen-space intent into one grid step, following the tunnel when only one axis is held.
  resolveIntent(p, ix, iy) {
    if (!ix && !iy) return 0;
    if (ix && iy) return diagonalFor(ix, iy);
    const cands = candidatesFor(ix, iy);
    const open = cands.filter((d) => this.canStep(p, d));
    if (open.length === 0) return cands[0];
    if (open.length === 1) return open[0];
    if (open.includes(p.dir)) return p.dir;
    const run = (d) => this.ds.castLine(p.lvl, p.x, p.y, d, 8).length;
    return run(open[1]) > run(open[0]) ? open[1] : open[0];
  },

  currentIntent() {
    let [ix, iy] = this.keyIntent();
    if (!ix && !iy) { ix = this.pad.ix; iy = this.pad.iy; }
    return [ix, iy];
  },

  tryStep(e, dir) {
    e.dir = dir;
    if (!this.canStep(e, dir)) return false;
    e.startMove(e.x + DIR_VEC[dir][0], e.y + DIR_VEC[dir][1], dir);
    return true;
  },

  updatePlayerControl() {
    const p = this.player;
    if (!p.alive || p.moving || this.transition) return;

    let dir = 0;
    let [ix, iy] = this.currentIntent();
    if (!ix && !iy && this.tap && this.tap.until > this.time) {
      ix = this.tap.ix;
      iy = this.tap.iy;
    }
    if (ix || iy) {
      this.tap = null;
      this.mouse.leftOnEnemy = false;
      dir = this.resolveIntent(p, ix, iy);
    } else {
      this.tap = null;
      if (this.mouse.left && !this.mouse.leftOnEnemy) this.pathToMouse(false);
      if (this.attackTarget && this.updateAttackTarget()) return;
      dir = this.nextPathDir();
    }

    if (dir && this.tryStep(p, dir)) {
      if ((this.stepFlip++ & 1) === 0) this.audio.play('walk.wav', 0.25);
    } else if (!dir && this.autoUse) {
      this.autoUse = false;
      if (this.ds.cell(p.x, p.y, this.lvl).type === 's') {
        this.useStairs();
      }
    }
  },

  nextPathDir() {
    const p = this.player;
    if (!this.path.length) return 0;
    const next = this.path[0];
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) {
      this.path = [];
      return 0;
    }
    if (this.entityAt(next.x, next.y, this.lvl, p)) {
      p.dir = dirFromDelta(dx, dy);
      this.path = [];
      this.lastPathCell = null;
      return 0;
    }
    this.path.shift();
    return dirFromDelta(dx, dy);
  },

  pathToMouse(force) {
    const g = this.renderer.screenToGrid(this.mouse.x, this.mouse.y);
    const key = `${g.x},${g.y}`;
    if (!force && key === this.lastPathCell) return;
    this.lastPathCell = key;
    const p = this.player;
    if (g.x === p.x && g.y === p.y) {
      if (force && this.settings.autoStairs !== false) this.useStairs();
      return;
    }
    const cell = this.ds.cell(g.x, g.y, this.lvl);
    if (!this.ds.walkable(g.x, g.y, this.lvl) || !cell.explored) return;
    const path = this.ds.findPath(this.lvl, p.x, p.y, g.x, g.y, null);
    if (path) {
      this.path = path;
      this.autoUse = cell.type === 's' && this.settings.autoStairs !== false;
    }
  },

  // ---------- attacking ----------

  // Direction to shoot `t` from `a` if they share a clear diagonal within missile range, otherwise 0.
  lineOfFire(a, t, maxDist = 10) {
    if (a.lvl !== t.lvl) return 0;
    let dir = 0;
    if (a.x === t.x && a.y !== t.y) dir = t.y < a.y ? DIR.NE : DIR.SW;
    else if (a.y === t.y && a.x !== t.x) dir = t.x < a.x ? DIR.NW : DIR.SE;
    else return 0;
    const dist = Math.abs(t.x - a.x) + Math.abs(t.y - a.y);
    if (dist > maxDist) return 0;
    return this.ds.castLine(a.lvl, a.x, a.y, dir, dist).length === dist ? dir : 0;
  },

  // Walks toward the clicked monster until it is in the firing line. Returns true while standing to shoot.
  updateAttackTarget() {
    const p = this.player;
    const t = this.attackTarget;
    const lost = !t || !t.alive || t.lvl !== this.lvl || this.renderer.entityVisibility(this.ds, t, p) <= 0 ||
      Math.abs(t.x - p.x) + Math.abs(t.y - p.y) > 22;
    if (lost) {
      this.attackTarget = null;
      return false;
    }
    const shot = this.lineOfFire(p, t);
    if (shot) {
      p.dir = shot;
      this.path = [];
      return true;
    }
    if (this.time >= this.repathAt || !this.path.length) {
      this.repathAt = this.time + 0.3;
      const blocked = (x, y) => !!this.entityAt(x, y, this.lvl, p) && !(x === t.x && y === t.y);
      const path = this.ds.findPath(this.lvl, p.x, p.y, t.x, t.y, blocked);
      if (!path) {
        this.attackTarget = null;
        this.hint('noroute', 'No way through to that target.');
        return false;
      }
      this.path = path.length > 1 ? path.slice(0, -1) : [];
    }
    return false;
  },

  // Space / fire button: shoot the nearest visible enemy lined up on any diagonal, else straight ahead.
  autoAimDir(p) {
    if (!this.settings.aim) return p.dir;
    let best = 0;
    let bestDist = 99;
    for (const dir of DIRS) {
      const cells = this.ds.castLine(p.lvl, p.x, p.y, dir, 10);
      for (const c of cells) {
        const other = this.entityAt(c.x, c.y, p.lvl, p);
        if (!other) continue;
        if (this.hostile(p, other) && this.renderer.entityVisibility(this.ds, other, p) > 0.15) {
          const d = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
          if (d < bestDist || (d === bestDist && dir === p.dir)) { best = dir; bestDist = d; }
        }
        break;
      }
    }
    return best || p.dir;
  },

  aimDirAtMouse(p) {
    const foe = this.hostileUnderMouse();
    if (foe && this.settings.aim) {
      const shot = this.lineOfFire(p, foe);
      if (shot) return shot;
    }
    const g = this.renderer.screenToGrid(this.mouse.x, this.mouse.y);
    const rc = p.renderCell();
    return dirFromDelta(g.fx - rc.x, g.fy - rc.y);
  },

  updatePlayerFire() {
    const p = this.player;
    if (!p.alive || this.transition) return;
    let dir = 0;
    if (this.pad.aimDir) dir = this.pad.aimDir;
    else if (this.mouse.right) dir = this.aimDirAtMouse(p);
    else if (this.fireHeld()) dir = this.autoAimDir(p);
    else if (this.attackTarget) dir = this.lineOfFire(p, this.attackTarget);
    if (dir) this.fire(p, dir);
  },

  // ---------- feedback for the renderer ----------

  uiState() {
    const p = this.player;
    this.hoverEntity = null;
    this.hoverCell = null;
    if (this.mouse.active && p && p.alive) {
      const foe = this.hostileUnderMouse();
      this.hoverEntity = foe;
      if (!foe) {
        const g = this.renderer.screenToGrid(this.mouse.x, this.mouse.y);
        const cell = this.ds.cell(g.x, g.y, this.lvl);
        if (cell.explored && this.ds.walkable(g.x, g.y, this.lvl)) this.hoverCell = { x: g.x, y: g.y, ok: true };
      }
    }
    return {
      hoverCell: this.hoverCell,
      hoverEntity: this.hoverEntity,
      target: this.attackTarget,
      path: this.path.length ? this.path : null
    };
  }
});

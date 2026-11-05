// Copyright (c) Mark Longo 2026

/**
 * Murk game: rules, AI, input and UI. Ports the arcade logic of the original (MurkThink.cpp, Murk.cpp)
 * to a real-time loop with click-to-move, auto-fire, exploration fog and a minimap.
 */

// Artwork for the inline icon codes used by the original episode texts ("-p", "-k", ...).
const ICON_CODES = (() => {
  const map = {};
  'abcdefghi'.split('').forEach((c, i) => { map[c] = { sheet: 'p256', x: 384, y: i * 128 + 64, w: 64, h: 64, scale: 0.6 }; });
  const tiles = {
    j: [0, 294], k: [113, 294], l: [226, 294], m: [339, 294], n: [452, 294], o: [565, 294], p: [678, 294],
    q: [458, 0], r: [226, 490], s: [571, 0], t: [684, 0], u: [678, 294], v: [339, 490], w: [565, 490],
    x: [113, 0], y: [226, 0]
  };
  Object.keys(tiles).forEach((c) => { map[c] = { sheet: 'dungeon', x: tiles[c][0], y: tiles[c][1], w: 113, h: 98, scale: 0.5 }; });
  return map;
})();
const SHEET_SIZES = { p256: [800, 1280], dungeon: [1024, 1176] };

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Turns original episode text ("~" line breaks, "-x" icons) into HTML.
function richText(text) {
  const out = [];
  const src = text || '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '~') {
      out.push('<br>');
    } else if (ch === '-' && ICON_CODES[src[i + 1]]) {
      const ic = ICON_CODES[src[i + 1]];
      const [sw, sh] = SHEET_SIZES[ic.sheet];
      const s = ic.scale;
      out.push(`<span class="icon" style="width:${Math.round(ic.w * s)}px;height:${Math.round(ic.h * s)}px;` +
        `background-image:url(assets/${ic.sheet === 'p256' ? 'p256' : 'dungeon'}.png);` +
        `background-size:${Math.round(sw * s)}px ${Math.round(sh * s)}px;` +
        `background-position:-${Math.round(ic.x * s)}px -${Math.round(ic.y * s)}px"></span>`);
      i++;
      while (src[i + 1] === ' ') i++;
    } else {
      out.push(escapeHtml(ch));
    }
  }
  return out.join('').replace(/\s{2,}/g, ' ');
}

class MurkGame {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.audio = new MurkAudio();
    this.ds = new DungeonSystem();
    this.renderer = null;

    this.state = 'LOADING';
    this.classKey = 'fighter';
    this.episodeNum = 1;
    this.lvl = 1;
    this.player = null;
    this.entities = [];
    this.projectiles = [];
    this.home = null;
    this.deaths = 0;

    this.mouse = { x: 0, y: 0, left: false, right: false, moved: 0 };
    this.path = [];
    this.autoUse = false;
    this.lastPathCell = null;
    this.transition = false;
    this.wakeTimer = 0;
    this.pitTimer = 4;
    this.minimapTimer = 0;
    this.hintCooldown = {};
    this.lastSoundAt = {};
    this.stepFlip = 0;
    this.time = 0;
    this.lastFrame = 0;

    this.initControls();
    this.initProgress();
    this.init();
  }

  async init() {
    this.renderer = new MurkRenderer(this.container);
    this.applySettings();
    try {
      const res = await fetch('assets/levels.json');
      this.ds.loadLevelDefs(await res.json());
    } catch (e) {
      console.warn('Could not load levels.json, using the built-in episode.', e);
    }
    await this.renderer.loadTextures();
    this.cacheDom();
    this.renderAvatars();
    this.bindEvents();
    this.state = 'SPLASH';
    document.getElementById('splash-screen').classList.add('ready');
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      hud: $('hud'), log: $('log'), prompt: $('prompt'), fade: $('fade'), flash: $('flash'),
      hpFill: $('hp-fill'), hpText: $('hp-text'), arFill: $('ar-fill'), arText: $('ar-text'),
      xpFill: $('xp-fill'), xpText: $('xp-text'), guide: $('guide'),
      skill: $('hud-skill'), level: $('hud-level'), rings: $('hud-rings'), floor: $('hud-floor'),
      episode: $('hud-episode'), relic: $('hud-relic'), portrait: $('hud-portrait'), minimap: $('minimap'),
      modal: $('modal-screen'), modalTitle: $('modal-title'), modalBody: $('modal-content'), modalBtn: $('modal-close'),
      btnRing: $('btn-ring')
    };
    this.mapCtx = this.dom.minimap.getContext('2d');
  }

  renderAvatars() {
    const avatars = { fighter: 0, cleric: 512, thief: 256, wizard: 384 };
    const img = new Image();
    img.src = 'assets/p256.png';
    img.onload = () => {
      this.sheetImg = img;
      Object.keys(avatars).forEach((key) => {
        const c = document.getElementById(`avatar-${key}`);
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 384, avatars[key] + 64, 64, 64, 0, 0, 64, 64);
      });
    };
  }

  // ---------- menus ----------

  bindEvents() {
    const splash = document.getElementById('splash-screen');
    splash.addEventListener('click', () => {
      this.audio.init();
      this.applySettings();
      this.audio.play('button.wav');
      splash.classList.add('hidden');
      this.showSelectScreen();
    });

    const cards = document.querySelectorAll('.char-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.classKey = card.getAttribute('data-class');
        this.audio.play('button.wav');
      });
    });

    document.getElementById('btn-select-confirm').addEventListener('click', () => {
      this.audio.play('Spawn.wav');
      document.getElementById('select-screen').classList.add('hidden');
      this.dom.hud.classList.remove('hidden');
      this.startNewGame();
    });
    document.getElementById('btn-continue').addEventListener('click', () => {
      this.audio.play('Spawn.wav');
      document.getElementById('select-screen').classList.add('hidden');
      this.dom.hud.classList.remove('hidden');
      this.continueGame();
    });

    this.dom.btnRing.addEventListener('click', () => this.useRing());
    document.getElementById('btn-drop').addEventListener('click', () => this.dropRelic(this.player, true));
    document.getElementById('btn-stairs').addEventListener('click', () => this.useStairs());
    document.getElementById('btn-map').addEventListener('click', () => this.openMap());
    document.getElementById('btn-obj').addEventListener('click', () => this.showObjective());
    document.getElementById('btn-menu').addEventListener('click', () => this.openPause());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.renderer.zoomBy(1));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.renderer.zoomBy(-1));
    this.dom.modalBtn.addEventListener('click', () => this.closeModal());

    this.bindInput();
    this.bindUi();
  }

  // ---------- game flow ----------

  startNewGame() {
    this.episodeNum = 1;
    this.player = null;
    this.pendingHero = null;
    this.deaths = 0;
    this.beginEpisode();
  }

  continueGame() {
    const save = this.loadSave();
    if (!save) { this.startNewGame(); return; }
    this.classKey = save.classKey;
    this.episodeNum = save.episodeNum;
    this.player = null;
    this.pendingHero = save.hero;
    this.deaths = save.deaths || 0;
    this.beginEpisode();
  }

  beginEpisode() {
    const def = CLASS_DEFS[this.classKey];
    const ep = this.ds.getEpisode(def.file, this.episodeNum);
    this.ds.build(ep);
    this.projectiles = [];
    this.entities = [];
    this.path = [];
    this.attackTarget = null;
    this.stairCache = {};
    this.renderer.clearEntities();
    this.epStats = { kills: 0, time: 0, deaths: 0, items: 0 };
    this.team2Lair = null;
    this.rivalsEnabled = false;
    this.dungeonAwake = false;
    this.rivalsAlerted = false;

    const home = this.ds.randomFloor(1);
    this.home = { x: home.x, y: home.y, lvl: 1 };
    this.ds.cell(home.x, home.y, 1).pad = def.pad;

    if (!this.player) {
      this.player = new Entity({
        kind: 'player', type: 'player', name: def.name, image: def.image, team: 1, classKey: this.classKey,
        x: home.x, y: home.y, lvl: 1, hp: def.hp + Math.floor(Math.random() * 10),
        armour: def.armour, rings: def.rings, dmin: def.dmin, dmax: def.dmax, shots: def.shots,
        fireCd: def.fireCd, tileTime: def.tileTime, fireSound: def.fireSound
      });
      this.player.level = 1;
      this.player.nextLevelAt = 25;
      if (this.pendingHero) this.applyHero(this.player, this.pendingHero);
      this.pendingHero = null;
    } else {
      this.player.teleport(home.x, home.y, 1);
      this.player.hp = this.player.maxHp;
      this.player.protection = 0;
      this.player.carrying = 0;
      this.player.shots = 0;
      this.player.fireTimer = 0;
    }
    this.player.dir = DIR.SE;
    this.player.alive = true;
    this.player.deathTimer = 0;
    this.player.hp = this.player.maxHp;
    this.entities.push(this.player);

    this.spawnPopulation(ep);
    this.lvl = 1;
    this.dom.prompt.classList.remove('on');
    this.setupLevelView(true);
    this.updateHUD();
    this.pitTimer = 3;
    this.saveProgress();
    this.showObjective(true);
  }

  spawnPopulation(ep) {
    const ds = this.ds;
    const maxl = ds.maxlevel;
    const monsterTotal = ep.beholders + ep.deathorb + ep.skeletons + ep.mouther + ep.ogre;

    const lairs = [];
    for (let i = 0; i < Math.ceil(monsterTotal / 5); i++) {
      const lvl = Math.min(maxl - 1, this.randInt(maxl - 1) + 2);
      const p = ds.randomFloor(Math.max(2, lvl));
      if (p) {
        ds.cell(p.x, p.y, p.lvl).pad = 4;
        lairs.push({ x: p.x, y: p.y, lvl: p.lvl });
      }
    }

    const spawnMonsters = (key, count, speed) => {
      const def = MONSTER_DEFS[key];
      for (let i = 0; i < count; i++) {
        const lvl = this.randInt(maxl - 1) + 2;
        const p = ds.randomFloor(lvl, (x, y) => this.isFarFromHome(x, y, lvl));
        if (!p) continue;
        const e = new Entity({
          kind: 'monster', type: key, name: def.name, image: def.image, team: 0, x: p.x, y: p.y, lvl,
          hp: def.hp + Math.min(30, this.episodeNum - 1) + this.randInt(3), dmin: def.dmin, dmax: def.dmax, shots: def.shots, fireCd: def.fireCd,
          aggr: def.aggr, tileTime: BASE_TILE_TIME * (1 + 0.55 * (Math.max(1, speed) - 1)),
          asleep: true, lair: lairs.length ? lairs[this.entities.length % lairs.length] : null,
          fireSound: [2, 4, 5, 9].includes(def.image) ? 'fireball.wav' : 'throw.wav'
        });
        e.dir = 1 + this.randInt(4);
        if (!e.lair) e.lair = { x: p.x, y: p.y, lvl };
        this.entities.push(e);
      }
    };
    spawnMonsters('beholder', ep.beholders, ep.bspeed);
    spawnMonsters('mouther', ep.mouther, ep.mspeed);
    spawnMonsters('ogre', ep.ogre, ep.ospeed);
    spawnMonsters('skeleton', ep.skeletons, ep.sspeed);
    spawnMonsters('deathorb', ep.deathorb, ep.dspeed);

    // Gametype 1 is a pure treasure hunt; rival squads (team 2) only exist in gametype 2.
    this.rivalsEnabled = ep.gametype === 2;
    const hasTeam2 = this.rivalsEnabled && (
      (ep.fighter > 0 && ep.fteam === 2) ||
      (ep.cleric > 0 && ep.cteam === 2) ||
      (ep.thief > 0 && ep.tteam === 2) ||
      (ep.wizard > 0 && ep.wteam === 2));
    if (hasTeam2) {
      const relic = ds.relic(2);
      const lairSpot = ds.randomFloor(maxl, (x, y) => !relic || relic.lvl !== maxl || relic.x !== x || relic.y !== y) ||
                       ds.randomFloor(maxl);
      if (lairSpot) {
        this.team2Lair = { x: lairSpot.x, y: lairSpot.y, lvl: lairSpot.lvl };
        // Use pad 5: the icon columns over from the player circle icon in dungeon.png
        ds.cell(lairSpot.x, lairSpot.y, lairSpot.lvl).pad = 5;
      }
    }

    let team2LeaderSpawned = false;
    const spawnCharacters = (key, count, team, speed) => {
      const def = CLASS_DEFS[key];
      const friendly = team === 1;
      const isTeam2 = team === 2;
      // Team 2 characters are skipped unless this episode has rivals; unknown team values never spawn.
      if (!friendly && !(isTeam2 && hasTeam2)) return;
      for (let i = 0; i < count; i++) {
        const lvl = friendly ? 1 : (this.team2Lair ? this.team2Lair.lvl : maxl);
        let p = null;
        if (friendly) {
          p = ds.randomFloor(lvl, (x, y) => Math.abs(x - this.home.x) + Math.abs(y - this.home.y) > 2);
        } else if (isTeam2 && this.team2Lair) {
          if (!team2LeaderSpawned) {
            p = { x: this.team2Lair.x, y: this.team2Lair.y, lvl: this.team2Lair.lvl };
          } else {
            p = ds.randomFloor(lvl, (x, y) => Math.abs(x - this.team2Lair.x) + Math.abs(y - this.team2Lair.y) <= 4) ||
                ds.randomFloor(lvl);
          }
        } else {
          p = ds.randomFloor(lvl);
        }
        if (!p) continue;
        const isLeader = isTeam2 && !team2LeaderSpawned;
        if (isLeader) team2LeaderSpawned = true;
        const e = new Entity({
          kind: friendly ? 'ally' : 'rival', type: key, name: def.name, image: def.image, team: friendly ? 1 : 2,
          x: p.x, y: p.y, lvl, hp: def.hp + this.randInt(10) + this.episodeNum, armour: def.armour,
          dmin: def.dmin, dmax: def.dmax, shots: def.shots, fireCd: def.fireCd + 0.15, aggr: 0.75,
          tileTime: BASE_TILE_TIME * (1 + 0.55 * (Math.max(1, speed) - 1)) * 0.9,
          asleep: false, // Awake at the start of the game
          fireSound: def.fireSound,
          isLeader
        });
        e.lair = isTeam2 && this.team2Lair ? { ...this.team2Lair } : { x: p.x, y: p.y, lvl };
        this.entities.push(e);
      }
    };
    spawnCharacters('fighter', ep.fighter, ep.fteam, ep.fspeed);
    spawnCharacters('cleric', ep.cleric, ep.cteam, ep.cspeed);
    spawnCharacters('thief', ep.thief, ep.tteam, ep.tspeed);
    spawnCharacters('wizard', ep.wizard, ep.wteam, ep.wspeed);
  }

  isFarFromHome(x, y, lvl) {
    return lvl !== 1 || Math.abs(x - this.home.x) + Math.abs(y - this.home.y) > 6;
  }

  randInt(n) {
    return Math.floor(Math.random() * n);
  }

  setupLevelView(snap) {
    this.renderer.buildLevel(this.ds, this.lvl);
    this.ds.reveal(this.lvl, this.player.x, this.player.y);
    this.renderer.syncCells(this.ds, this.lvl);
    if (snap) this.renderer.camSnap = true;
    this.updateHUD();
  }

  // ---------- stairs and falling ----------

  useStairs() {
    const p = this.player;
    if (this.state !== 'PLAYING' || this.transition || !p.alive || p.moving) return;
    const cell = this.ds.cell(p.x, p.y, this.lvl);
    if (cell.type !== 's') {
      this.hint('stairs', 'There is no ladder here.');
      return;
    }
    if (cell.stair === 'down') {
      this.changeLevel(this.lvl + 1, p.x, p.y, 'You climb down to floor');
    } else if (this.lvl > 1) {
      this.changeLevel(this.lvl - 1, p.x, p.y, 'You climb up to floor');
    }
  }

  changeLevel(target, x, y, msg, fall = false) {
    if (this.transition) return;
    this.transition = true;
    this.path = [];
    this.attackTarget = null;
    this.autoUse = false;
    this.dom.fade.classList.add('on');
    this.audio.play(fall ? 'Protection.wav' : 'walk.wav', 0.5);
    setTimeout(() => {
      const from = this.lvl;
      const followers = this.entities.filter((e) => e.kind === 'ally' && e.alive && !e.asleep && e.lvl === from &&
        Math.abs(e.x - this.player.x) + Math.abs(e.y - this.player.y) <= 5);
      this.projectiles = [];
      this.player.shots = 0;
      this.player.teleport(x, y, target);
      this.entities.forEach((e) => { if (e !== this.player) e.shots = 0; });
      for (const ally of followers) {
        const spot = this.freeSpotNear(x, y, target, ally);
        if (spot) { ally.teleport(spot.x, spot.y, target); ally.stairCd = 3; ally.restTimer = 0.3; }
      }
      this.lvl = target;
      this.setupLevelView(true);
      this.onPlayerArrive();
      this.toast(`${msg} ${target}.`);
      this.dom.fade.classList.remove('on');
      setTimeout(() => { this.transition = false; }, 200);
    }, 260);
  }

  // Nearest walkable cell to (x, y) on `lvl` that no living entity occupies.
  freeSpotNear(x, y, lvl, ignore) {
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (this.ds.walkable(nx, ny, lvl) && !this.entityAt(nx, ny, lvl, ignore)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  // Moves a non-player entity through the stairs at (sx, sy) on its level to the adjoining level.
  entityTakeStairs(e, sx, sy) {
    const cell = this.ds.cell(sx, sy, e.lvl);
    if (cell.type !== 's') return false;
    const target = cell.stair === 'down' ? e.lvl + 1 : e.lvl - 1;
    if (target < 1 || target > this.ds.maxlevel) return false;
    const spot = this.freeSpotNear(sx, sy, target, e);
    if (!spot) return false;
    const wasVisible = e.lvl === this.lvl;
    if (wasVisible) this.playAt('walk.wav', e, 0.4);
    e.teleport(spot.x, spot.y, target);
    if (e.carrying) {
      const r = this.ds.relic(e.carrying);
      if (r) { r.lvl = target; r.x = spot.x; r.y = spot.y; }
    }
    e.shots = 0;
    e.windup = 0;
    e.stairCd = 4;
    e.restTimer = 0.4;
    e.stairWander = null;
    if (target === this.lvl) {
      this.playAt('walk.wav', e, 0.4);
      this.popText(e, '!', '#ffd24a');
    }
    return true;
  }

  getTeam2Leader() {
    return this.entities.find(e => e.team === 2 && e.isLeader && e.alive) ||
           this.entities.find(e => e.team === 2 && e.isLeader) ||
           this.entities.find(e => e.team === 2 && e.alive) ||
           this.entities.find(e => e.team === 2) || null;
  }

  // The leader seeks the treasure; if the leader is down, every surviving rival takes over that role.
  isTeam2Lead(e) {
    const leader = this.getTeam2Leader();
    return e === leader || !leader || !leader.alive;
  }

  relicAtLair(relic, e) {
    return !!(relic && !relic.carrier && e.lair && relic.lvl === e.lair.lvl && relic.x === e.lair.x && relic.y === e.lair.y);
  }

  getTeam2TargetLvl(e) {
    const relic = this.ds.relic(2);
    if (e.carrying === 2) {
      return e.lair ? e.lair.lvl : e.lvl;
    }
    if (relic && relic.carrier && relic.carrier.team !== 2) {
      return relic.carrier.lvl;
    }
    const leader = this.getTeam2Leader();
    if (this.isTeam2Lead(e)) {
      if (relic && !relic.carrier && relic.lvl > 0) {
        if (this.relicAtLair(relic, e)) return e.lair.lvl;
        return relic.lvl;
      }
      return e.lair ? e.lair.lvl : e.lvl;
    } else {
      if (leader && leader.alive) return leader.lvl;
      if (relic && !relic.carrier && relic.lvl > 0) return relic.lvl;
      return e.lair ? e.lair.lvl : e.lvl;
    }
  }

  // Squad priority for tight tunnels: treasure carrier > leader > escort.
  team2Rank(e) {
    return e.carrying === 2 ? 2 : this.isTeam2Lead(e) ? 1 : 0;
  }

  // Steps a rival to the adjacent cell `next`, trading places with a lower-ranked idle squadmate blocking a
  // one-tile tunnel. Equal ranks never swap, so two rivals cannot ping-pong. Returns true if it moved.
  team2PushThrough(e, next, animate) {
    const occ = this.entityAt(next.x, next.y, e.lvl, e);
    if (occ && !(occ.team === 2 && !occ.moving && this.team2Rank(e) > this.team2Rank(occ))) return false;
    const fromX = e.x;
    const fromY = e.y;
    const dir = dirFromDelta(next.x - fromX, next.y - fromY);
    if (animate) {
      e.startMove(next.x, next.y, dir);
      if (occ) occ.startMove(fromX, fromY, dirFromDelta(fromX - next.x, fromY - next.y));
    } else {
      e.dir = dir;
      e.teleport(next.x, next.y, e.lvl);
      if (occ) occ.teleport(fromX, fromY, e.lvl);
    }
    return true;
  }

  // Where an off-screen rival walks on its current floor (simulated, since it is not rendered).
  team2OffLevelGoal(e) {
    const relic = this.ds.relic(2);
    if (e.carrying === 2) return e.lair && e.lair.lvl === e.lvl ? e.lair : null;
    if (relic && !relic.carrier && relic.lvl === e.lvl && !this.relicAtLair(relic, e) && this.isTeam2Lead(e)) {
      return { x: relic.x, y: relic.y };
    }
    const leader = this.getTeam2Leader();
    if (leader && leader.alive && leader !== e && leader.lvl === e.lvl &&
        Math.abs(leader.x - e.x) + Math.abs(leader.y - e.y) > 3) {
      return leader;
    }
    return null;
  }

  checkEntityRelicPickup(e) {
    if (!e.alive || e.carrying) return;
    const ds = this.ds;
    for (const relic of ds.relics) {
      if (relic.carrier || relic.lvl !== e.lvl || relic.x !== e.x || relic.y !== e.y) continue;
      if ((relic.dropCooldown || 0) > 0) continue;
      if (relic.id === 2 && e.team === 2) {
        // Treasure already secured in their own lair stays put; rivals guard it instead of re-carrying it.
        if (this.relicAtLair(relic, e)) continue;
        relic.carrier = e;
        e.carrying = relic.id;
        this.playAt('treasure.wav', e, 0.7);
        if (e.lvl === this.lvl) {
          const w = this.renderer.gridToWorld(e.x, e.y);
          this.renderer.burst(w.x, w.y + 30, 0x66bbff, 18, 90, 0.7, 14);
          this.popText(e, 'TREASURE!', '#66bbff');
        }
        this.toast(`${e.name} from Team 2 seized the blue treasure!`, 'warn');
        return;
      }
    }
  }

  checkEntityLairArrival(e) {
    if (!e.alive || e.carrying !== 2 || !e.lair) return;
    if (e.lvl === e.lair.lvl && e.x === e.lair.x && e.y === e.lair.y) {
      this.dropRelic(e, false);
      this.playAt('treasure.wav', e, 0.7);
      if (e.lvl === this.lvl) {
        const w = this.renderer.gridToWorld(e.x, e.y);
        this.renderer.burst(w.x, w.y + 30, 0x66bbff, 20, 100, 0.8, 16);
        this.popText(e, 'SECURED!', '#66bbff');
      }
      this.toast('Rivals secured the blue treasure in their lair! Infiltrate and take it back!', 'warn');
    }
  }

  // Awake creatures on other floors keep playing: they walk to the nearest stairs that lead toward their objective.
  updateOffLevel(e, dt) {
    if (e.asleep || e.stairCd > 0) { e.stairTimer = 0; return; }
    let targetLvl = null;
    if (e.team === 2) {
      targetLvl = this.getTeam2TargetLvl(e);
    } else if (e.kind === 'ally') {
      targetLvl = this.player.lvl;
    } else {
      const p = this.player;
      const diff = p.lvl - e.lvl;
      if (Math.abs(diff) === 1 && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 14) {
        targetLvl = p.lvl;
      }
    }

    if (targetLvl === null || targetLvl === e.lvl) {
      e.stairTimer = 0;
      if (e.team === 2) {
        const goal = this.team2OffLevelGoal(e);
        if (goal && (goal.x !== e.x || goal.y !== e.y)) {
          e.offStepTimer = (e.offStepTimer || 0) - dt;
          if (e.offStepTimer <= 0) {
            e.offStepTimer = e.tileTime;
            const blocked = (x, y) => !!this.entityAt(x, y, e.lvl, e);
            const path = this.ds.findPath(e.lvl, e.x, e.y, goal.x, goal.y, blocked, 500) ||
                         this.ds.findPath(e.lvl, e.x, e.y, goal.x, goal.y, null, 500);
            if (path && path.length && !(goal instanceof Entity && path.length === 1)) {
              this.team2PushThrough(e, path[0], false);
            }
          }
        }
        this.checkEntityRelicPickup(e);
        this.checkEntityLairArrival(e);
      }
      return;
    }

    const diff = targetLvl - e.lvl;
    const kind = diff > 0 ? 'down' : 'up';
    if (!e.stairTimer) {
      let best = null;
      let bestD = Infinity;
      for (const s of this.ds.findStairs(e.lvl, kind)) {
        const d = Math.abs(s.x - e.x) + Math.abs(s.y - e.y);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (!best) return;
      e.stairGoal = best;
      e.stairTimer = Math.max(0.5, bestD * e.tileTime * 1.2);
      return;
    }
    e.stairTimer -= dt;
    if (e.stairTimer > 0) return;
    e.stairTimer = 0;
    const s = e.stairGoal;
    e.stairGoal = null;
    if (s) {
      e.x = s.x;
      e.y = s.y;
      if (!this.entityTakeStairs(e, s.x, s.y)) e.stairCd = 1.5;
    }
  }

  // Walks toward the closest stairs of the given kind; returns true if it acted.
  seekStairs(e, kind) {
    if (e.stairCd > 0) return false;
    const cell = this.ds.cell(e.x, e.y, e.lvl);
    if (cell.type === 's' && cell.stair === kind) return this.entityTakeStairs(e, e.x, e.y);
    let best = null;
    for (const s of this.ds.findStairs(e.lvl, kind)) {
      const path = this.ds.findPath(e.lvl, e.x, e.y, s.x, s.y, (x, y) => !!this.entityAt(x, y, e.lvl, e), 300);
      if (path && path.length && (!best || path.length < best.length)) best = path;
    }
    if (!best && e.team === 2) {
      for (const s of this.ds.findStairs(e.lvl, kind)) {
        const path = this.ds.findPath(e.lvl, e.x, e.y, s.x, s.y, null, 300);
        if (path && path.length && (!best || path.length < best.length)) best = path;
      }
      return !!best && this.team2PushThrough(e, best[0], true);
    }
    if (!best) return false;
    return this.tryStep(e, dirFromDelta(best[0].x - e.x, best[0].y - e.y));
  }

  updatePits(dt) {
    const ds = this.ds;
    const ep = ds.currentEpisodeDef;
    if (ep && ep.pits) {
      this.pitTimer -= dt;
      const active = ds.pits.filter(p => p.active).length;
      if (this.pitTimer <= 0) {
        this.pitTimer = 3 + Math.random() * 4;
        if (active < Math.min(6, ep.maxpit || 6)) this.spawnPit();
      }
    }
    for (const pit of ds.pits) {
      if (!pit.active) continue;
      pit.age += dt;
      pit.frame = Math.floor(pit.age / 0.083) + 1;
      if (pit.frame >= 36) pit.active = false;
    }
    const p = this.player;
    if (!p.alive || p.moving || this.transition || p.lvl >= ds.maxlevel) return;
    for (const pit of ds.pits) {
      if (pit.active && pit.lvl === this.lvl && pit.x === p.x && pit.y === p.y && pit.frame >= 18 && pit.frame <= 29) {
        pit.active = false;
        this.toast('The floor gives way beneath you!', 'warn');
        this.renderer.addShake(8);
        this.changeLevel(this.lvl + 1, p.x, p.y, 'You fall to floor', true);
        return;
      }
    }
  }

  spawnPit() {
    const ds = this.ds;
    for (let tries = 0; tries < 60; tries++) {
      const lvl = this.randInt(ds.maxlevel - 1) + 1;
      const x = this.randInt(ds.N) + 1;
      const y = this.randInt(ds.N) + 1;
      if (!ds.isFreeFloor(x, y, lvl) || !ds.walkable(x, y, lvl + 1)) continue;
      if (ds.pits.some(p => p.active && p.x === x && p.y === y && p.lvl === lvl)) continue;
      let pit = ds.pits.find(p => !p.active);
      if (!pit) {
        pit = {};
        ds.pits.push(pit);
      }
      Object.assign(pit, { x, y, lvl, frame: 1, age: 0, active: true });
      return;
    }
  }

  // ---------- player actions ----------

  entityAt(x, y, lvl, ignore) {
    return this.entities.find(e => e !== ignore && e.alive && e.lvl === lvl && e.x === x && e.y === y) || null;
  }

  fire(e, dir) {
    if (!e.alive || e.fireTimer > 0 || e.shots >= e.maxShots) return false;
    e.dir = dir;
    e.fireTimer = e.fireCd;
    e.shots++;
    e.shotFlash = 0.1;
    const proj = new Projectile(e, dir);
    this.projectiles.push(proj);
    this.playAt(e.fireSound || 'throw.wav', e, 0.5);
    return true;
  }

  useRing() {
    const p = this.player;
    if (this.state !== 'PLAYING' || !p.alive) return;
    if (p.protection > 0) { this.hint('ring', 'The ring is already protecting you.'); return; }
    if (p.rings <= 0) { this.hint('ring', 'You have no Rings of Protection.'); return; }
    p.rings--;
    p.protection = 7;
    this.audio.play('Protection.wav', 0.6);
    this.audio.play('tcleric.wav', 0.25);
    this.toast('Ring of Protection! You are invulnerable.', 'good');
    this.updateHUD();
  }

  dropRelic(ent, voluntary) {
    if (!ent || !ent.carrying) {
      if (voluntary) this.hint('drop', 'You are not carrying a relic.');
      return;
    }
    const relic = this.ds.relic(ent.carrying);
    ent.carrying = 0;
    if (relic) {
      relic.carrier = null;
      relic.x = ent.x; relic.y = ent.y; relic.lvl = ent.lvl;
      relic.dropCooldown = voluntary ? 1.5 : 0.6;
      relic.voluntaryDrop = !!voluntary;
    }
    if (voluntary) {
      this.toast('You set down the relic.');
      this.audio.play('button.wav');
    }
    this.updateHUD();
  }

  // ---------- arrival, pickups, relics ----------

  onPlayerArrive() {
    const p = this.player;
    const ds = this.ds;
    if (ds.reveal(this.lvl, p.x, p.y)) this.renderer.syncCells(ds, this.lvl);

    const cell = ds.cell(p.x, p.y, this.lvl);
    switch (cell.item) {
      case 'e': {
        if (p.hp >= p.maxHp) { this.hint('elixir', 'You are already at full health.'); break; }
        const gain = Math.min(p.maxHp - p.hp, 10 + p.level * 2);
        p.hp += gain;
        this.popText(p, `+${gain}`, '#7dff9b');
        this.consumeItem(cell, 'Elixir restores your health.', 'item.wav');
        break;
      }
      case 'a':
        if (!CLASS_DEFS[this.classKey].wearsArmour) { this.hint('armour', 'This armour does not suit a spellcaster.'); break; }
        p.armour += 5; this.popText(p, '+5 armour', '#9fd8ff');
        this.consumeItem(cell, 'You don the armour (+5 armour).', 'item.wav');
        break;
      case 's':
        if (!CLASS_DEFS[this.classKey].readsScrolls) { this.hint('scroll', 'Only spellcasters can read this scroll.'); break; }
        p.armour += 5; this.popText(p, '+5 ward', '#9fd8ff');
        this.consumeItem(cell, 'The scroll weaves a protective ward (+5 armour).', 'item.wav');
        break;
      case 'r':
        p.rings++; this.popText(p, '+1 ring', '#ffe27a');
        this.consumeItem(cell, 'A Ring of Protection! (press R to use)', 'item.wav');
        break;
      default: break;
    }

    for (const relic of ds.relics) {
      if (relic.carrier || relic.lvl !== this.lvl || relic.x !== p.x || relic.y !== p.y) continue;
      if ((relic.dropCooldown || 0) > 0) continue;
      if (p.carrying) { this.hint('carry', 'You can only carry one relic at a time.'); continue; }
      this.playerTakeRelic(relic);
    }

    if (p.carrying && this.home && p.lvl === this.home.lvl && p.x === this.home.x && p.y === this.home.y) {
      this.deliverRelic();
    }

    this.dom.prompt.classList.toggle('on', cell.type === 's');
    if (cell.type === 's') {
      this.dom.prompt.textContent = cell.stair === 'down' ? 'Press E to climb down' : 'Press E to climb up';
    }
    this.updateHUD();
  }

  playerTakeRelic(relic) {
    const p = this.player;
    relic.carrier = p;
    p.carrying = relic.id;
    this.audio.play('treasure.wav', 0.7);
    const w = this.renderer.gridToWorld(p.x, p.y);
    this.renderer.burst(w.x, w.y + 30, relic.id === 1 ? 0xff6655 : 0x66bbff, 18, 90, 0.7, 14);
    if (relic.id === 2) {
      if (!this.dungeonAwake) {
        this.dungeonAwake = true;
        this.toast('You seized the blue treasure! Carry it back to your pad - the dungeon awakens!', 'good');
        this.wakeAll();
      } else {
        this.toast('You have the blue treasure again! Get it home!', 'good');
      }
    } else {
      this.toast('You took the treasure. Return it to your pad for a bonus.', 'good');
    }
    this.updateHUD();
  }

  // Lets a standing player re-take a relic knocked from their hands once its short drop cooldown ends.
  checkPlayerRelicRetake() {
    const p = this.player;
    if (!p.alive || p.moving || p.carrying || this.transition) return;
    for (const relic of this.ds.relics) {
      if (relic.carrier || relic.voluntaryDrop || (relic.dropCooldown || 0) > 0) continue;
      if (relic.lvl !== p.lvl || relic.x !== p.x || relic.y !== p.y) continue;
      this.playerTakeRelic(relic);
      return;
    }
  }

  consumeItem(cell, msg, sound) {
    cell.item = 0;
    this.epStats.items++;
    this.toast(msg);
    this.audio.play(sound, 0.5);
    this.renderer.syncCells(this.ds, this.lvl);
    const w = this.renderer.gridToWorld(this.player.x, this.player.y);
    this.renderer.burst(w.x, w.y + 24, 0xfff0a0, 12, 70, 0.6, 10);
  }

  deliverRelic() {
    const p = this.player;
    const id = p.carrying;
    const relic = this.ds.relic(id);
    p.carrying = 0;
    if (relic) { relic.carrier = null; relic.lvl = 0; }
    if (id === 1) {
      this.addSkill(30);
      this.toast('Relic secured! +30 skill.', 'good');
      this.audio.play('win.wav', 0.6);
      this.updateHUD();
      return;
    }
    this.audio.play('win.wav', 0.8);
    p.armour += 30;
    p.rings += 3;
    this.addSkill(30);
    this.updateHUD();
    const s = this.epStats;
    const best = this.recordBest();
    this.modalAction = () => {
      this.episodeNum++;
      this.beginEpisode();
    };
    this.showModal(
      'EPISODE COMPLETE',
      `<div class="stat-grid"><span>Monsters slain</span><b>${s.kills}</b><span>Time</span><b>${this.formatTime(s.time)}</b>` +
      `<span>Times fallen</span><b>${s.deaths}</b><span>Hero level</span><b>${p.level}</b></div>` +
      `<div class="modal-hint">Reward: +30 skill, +30 armour, +3 Rings of Protection.${best ? ' &nbsp;<b class="gold">New best!</b>' : ''}</div>` +
      `<div class="modal-hint">Next: Episode ${this.episodeNum + 1}</div>`,
      'ONWARD'
    );
  }

  wakeAll() {
    this.renderer.addShake(10);
    this.audio.play('DRAGON.WAV', 0.5);
    for (const e of this.entities) {
      if (e.asleep) e.asleep = false;
    }
  }

  // ---------- combat ----------

  hostile(a, b) {
    if (a === b || !a.alive || !b.alive) return false;
    if (a.isMonster) return !b.isMonster;
    if (b.isMonster) return true;
    return a.team !== b.team;
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.lvl === this.lvl) {
        p.t += dt * p.speed;
        while (p.alive && p.t >= 1) {
          p.t -= 1;
          const nx = p.x + DIR_VEC[p.dir][0];
          const ny = p.y + DIR_VEC[p.dir][1];
          if (!this.ds.walkable(nx, ny, p.lvl)) {
            this.missileSpark(p);
            p.alive = false;
            break;
          }
          p.x = nx; p.y = ny;
          p.travelled++;
          if (p.travelled >= p.maxRange) { p.alive = false; break; }
          this.missileHit(p);
        }
        if (p.alive) this.missileHit(p);
        if (p.alive && Math.random() < dt * 40) {
          const rc = p.renderCell();
          const w = this.renderer.gridToWorld(rc.x, rc.y);
          const colors = { 1: 0xdddddd, 2: 0xff6644, 3: 0xffa030, 4: 0x66ccff, 5: 0x999999, 6: 0x77ff55 };
          this.renderer.spawnParticle(w.x + (Math.random() - 0.5) * 6, w.y + 30 + (Math.random() - 0.5) * 6, 0, 8, 0.35, 10, colors[p.kind] || 0xffffff, -6);
        }
      } else {
        p.alive = false;
      }
      if (!p.alive) {
        p.owner.shots = Math.max(0, p.owner.shots - 1);
        this.projectiles.splice(i, 1);
      }
    }
  }

  missileSpark(p) {
    const rc = p.renderCell();
    const w = this.renderer.gridToWorld(rc.x, rc.y);
    this.renderer.burst(w.x, w.y + 28, 0xffcc88, 6, 50, 0.3, 8);
  }

  missileHit(p) {
    for (const e of this.entities) {
      if (e.lvl !== p.lvl || e.x !== p.x || e.y !== p.y || !this.hostile(p.owner, e)) continue;
      if (p.hitIds && p.hitIds.has(e.id)) continue;
      this.applyHit(p.owner, e, p.dir);
      if (p.pierce > 0) {
        p.pierce--;
        (p.hitIds = p.hitIds || new Set()).add(e.id);
        continue;
      }
      p.alive = false;
      return;
    }
  }

  applyHit(attacker, target, dir) {
    const w = this.renderer.gridToWorld(target.x, target.y);
    const dmg = attacker.rollDamage();
    const res = target.takeHit(dmg);

    if (res.blocked) {
      this.popText(target, 'BLOCKED', '#8ae8ff');
      this.audio.play('impact.wav', 0.3);
      this.renderer.burst(w.x, w.y + 34, 0x88ddff, 8, 70, 0.35, 9);
      return;
    }

    this.playAt('impact.wav', target, 0.5);
    this.renderer.burst(w.x, w.y + 34, 0xff5533, 10, 80, 0.45, 10);
    this.popText(target, `-${dmg}`, target === this.player ? '#ff6a5a' : '#ffffff');
    if (target.asleep) target.asleep = false;

    if (target.carrying) {
      this.dropRelic(target, false);
      if (target === this.player) {
        this.toast('You dropped the blue treasure!', 'warn');
      } else if (target.team === 2) {
        this.toast(`${target.name} dropped the blue treasure!`, 'warn');
      }
    }
    if (target === this.player) {
      this.audio.play('ouch.wav', 0.7);
      this.renderer.addShake(6);
      this.dom.flash.classList.remove('on');
      void this.dom.flash.offsetWidth;
      this.dom.flash.classList.add('on');
      this.updateHUD();
    }

    if (target.hp <= 0) this.kill(target, attacker);
  }

  addSkill(n) {
    const p = this.player;
    p.skill += n;
    while (p.skill >= p.nextLevelAt) {
      p.level++;
      p.levelBase = p.nextLevelAt;
      p.nextLevelAt += 40 + p.level * 10;
      p.maxHp += 10;
      p.hp = Math.min(p.maxHp, p.hp + 10);
      this.toast(`LEVEL ${p.level}! Choose a new talent.`, 'good');
      this.audio.play('win.wav', 0.5);
      const w = this.renderer.gridToWorld(p.x, p.y);
      this.renderer.burst(w.x, w.y + 30, 0xffe070, 26, 120, 0.9, 14);
      this.pendingPerks++;
    }
  }

  kill(target, killer) {
    target.alive = false;
    target.hp = 0;
    target.deathTimer = 0.8;
    const w = this.renderer.gridToWorld(target.x, target.y);
    this.renderer.burst(w.x, w.y + 30, 0xcc2222, 16, 90, 0.7, 12);
    if (target.carrying) {
      this.dropRelic(target, false);
      if (target.team === 2) {
        this.toast(`${target.name} fell and dropped the blue treasure!`, 'good');
      }
    }

    if (target === this.player) {
      this.handlePlayerDeath();
      return;
    }
    this.playAt(target.isMonster ? 'die.wav' : 'dead.wav', target, 0.6);

    if (killer === this.player || (killer && killer.team === 1)) {
      const reward = Math.max(2, Math.round(target.maxHp / 3));
      if (killer === this.player) {
        this.popText(target, `+${reward}`, '#ffe27a');
        this.epStats.kills++;
        this.addSkill(reward);
        if (killer.lifesteal > 0 && killer.hp < killer.maxHp) {
          killer.hp = Math.min(killer.maxHp, killer.hp + killer.lifesteal);
          this.popText(killer, `+${killer.lifesteal}`, '#7dff9b');
        }
        this.updateHUD();
      }
    }

    const cell = this.ds.cell(target.x, target.y, target.lvl);
    if (target.isMonster && cell.type === 'f' && cell.item === 0 && cell.pad < 0 && Math.random() < 0.7) {
      const r = this.randInt(3);
      cell.item = r === 0 ? 'a' : r === 1 ? 's' : 'e';
      if (target.lvl === this.lvl) this.renderer.syncCells(this.ds, this.lvl);
    }

    target.respawnTimer = target.isMonster ? 35 + Math.random() * 25 : 14;
  }

  handlePlayerDeath() {
    this.deaths++;
    this.epStats.deaths++;
    this.audio.play('dead.wav', 0.8);
    this.path = [];
    this.attackTarget = null;
    this.clearInput();
    this.updateHUD();
    const p = this.player;
    setTimeout(() => {
      if (p !== this.player || p.alive) return;
      this.modalAction = () => this.respawnPlayer();
      this.showModal('YOU HAVE FALLEN',
        `<div class="stat-grid">` +
        `<span>Hero level</span><b>${p.level}</b><span>Score</span><b>${p.skill}</b>` +
        `<span>Slain this episode</span><b>${this.epStats.kills}</b><span>Floor</span><b>${this.lvl} / ${this.ds.maxlevel}</b></div>` +
        `<div class="modal-hint">You rise at your home pad with full health. The dungeon and everything you found stays as you left it.</div>`,
        'RISE AGAIN', true);
    }, 900);
  }

  // Death is a setback, not a reset: return to the home pad with full health and brief protection.
  respawnPlayer() {
    const p = this.player;
    p.alive = true;
    p.deathTimer = 0;
    p.hp = p.maxHp;
    p.carrying = 0;
    p.shots = 0;
    p.fireTimer = 0.3;
    p.protection = 3;
    p.teleport(this.home.x, this.home.y, 1);
    this.projectiles = [];
    this.path = [];
    this.attackTarget = null;
    this.lvl = 1;
    this.setupLevelView(true);
    this.onPlayerArrive();
    this.toast('You rise again at your home pad.', 'good');
  }

  respawnEntity(e) {
    const lair = e.lair || e.spawn;
    if (this.entityAt(lair.x, lair.y, lair.lvl, e)) return false;
    if (lair.lvl === this.lvl && Math.abs(lair.x - this.player.x) + Math.abs(lair.y - this.player.y) < 4) return false;
    e.hp = e.maxHp;
    e.alive = true;
    e.asleep = false;
    e.shots = 0;
    e.fireTimer = 0.5;
    e.teleport(lair.x, lair.y, lair.lvl);
    if (lair.lvl === this.lvl) {
      const w = this.renderer.gridToWorld(lair.x, lair.y);
      this.renderer.burst(w.x, w.y + 28, 0xaa44ff, 14, 70, 0.6, 12);
      this.playAt('Spawn.wav', e, 0.5);
    }
    return true;
  }

  // ---------- AI ----------

  wakeNearby() {
    const p = this.player;
    for (const e of this.entities) {
      if (!e.asleep || !e.alive || e.lvl !== this.lvl) continue;
      if (Math.abs(e.x - p.x) <= 3 && Math.abs(e.y - p.y) <= 3 && this.ds.findPath(this.lvl, e.x, e.y, p.x, p.y, null, 120)) {
        e.asleep = false;
        e.restTimer = 0.4;
        this.popText(e, '!', '#ffd24a');
        const def = MONSTER_DEFS[e.type];
        if (def) this.playAt(def.wake, e, 0.5);
      }
    }
  }

  findTarget(e) {
    for (const dir of DIRS) {
      const cells = this.ds.castLine(e.lvl, e.x, e.y, dir, 9);
      for (const c of cells) {
        const other = this.entityAt(c.x, c.y, e.lvl, e);
        if (!other) continue;
        if (this.hostile(e, other)) return { dir, other, dist: Math.abs(c.x - e.x) + Math.abs(c.y - e.y) };
        break;
      }
    }
    return null;
  }

  nearestHostile(e, range) {
    let best = null;
    let bestD = range + 1;
    for (const o of this.entities) {
      if (o.lvl !== e.lvl || !this.hostile(e, o)) continue;
      const d = Math.abs(o.x - e.x) + Math.abs(o.y - e.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  think(e) {
    if (e.asleep || e.windup > 0) return;
    const shot = this.findTarget(e);
    if (shot && e.fireTimer <= 0 && e.shots < e.maxShots && e.restTimer <= 0) {
      e.dir = shot.dir;
      if (Math.random() < e.aggr) {
        // A short, visible wind-up gives the player a moment to step out of the firing line.
        e.windup = e.isMonster ? 0.26 : 0.1;
        e.windupDir = shot.dir;
      }
      e.restTimer = 0.12 + Math.random() * 0.25;
      return;
    }
    if (shot && e.restTimer > 0) return;

    let goal = null;
    if (e.kind === 'ally') {
      const foe = this.nearestHostile(e, 8);
      const d = Math.abs(this.player.x - e.x) + Math.abs(this.player.y - e.y);
      if (foe && d < 9) goal = foe;
      else if (d > 3 && this.player.lvl === e.lvl) goal = this.player;
    } else if (e.team === 2) {
      const relic = this.ds.relic(2);
      const leader = this.getTeam2Leader();
      const isLeader = this.isTeam2Lead(e);

      if (e.carrying === 2) {
        // Whoever holds the treasure brings it back to the lair
        if (e.lair) {
          if (e.lvl !== e.lair.lvl) {
            if (this.seekStairs(e, e.lair.lvl > e.lvl ? 'down' : 'up')) return;
          } else if (e.x === e.lair.x && e.y === e.lair.y) {
            this.checkEntityLairArrival(e);
            return;
          } else {
            goal = { x: e.lair.x, y: e.lair.y };
          }
        }
      } else if (isLeader) {
        if (relic && relic.carrier && relic.carrier.team !== 2) {
          // Enemy has the treasure, hunt them down
          if (relic.carrier.lvl !== e.lvl) {
            if (this.seekStairs(e, relic.carrier.lvl > e.lvl ? 'down' : 'up')) return;
          } else {
            goal = relic.carrier;
          }
        } else if (relic && !relic.carrier && relic.lvl > 0) {
          if (this.relicAtLair(relic, e)) {
            // Guard the lair and treasure, but also hunt nearby monsters and foes
            const foe = this.nearestHostile(e, 12);
            if (foe) {
              goal = foe;
            } else {
              const dLair = Math.abs(e.x - e.lair.x) + Math.abs(e.y - e.lair.y);
              if (dLair > 3) goal = { x: e.lair.x, y: e.lair.y };
            }
          } else {
            // Search for blue treasure
            if (relic.lvl !== e.lvl) {
              if (this.seekStairs(e, relic.lvl > e.lvl ? 'down' : 'up')) return;
            } else if (e.x === relic.x && e.y === relic.y) {
              this.checkEntityRelicPickup(e);
              return;
            } else {
              const foe = this.nearestHostile(e, 3);
              if (foe) goal = foe;
              else goal = { x: relic.x, y: relic.y };
            }
          }
        } else {
          // Hunt monsters and non-friends
          goal = this.nearestHostile(e, 14);
        }
      } else if (leader && leader.alive) {
        // Follower on Team 2: hover around leader, find monsters and other non-friend players
        if (leader.lvl !== e.lvl) {
          if (this.seekStairs(e, leader.lvl > e.lvl ? 'down' : 'up')) return;
        } else {
          const foe = this.nearestHostile(e, 8);
          const dToLeader = Math.abs(leader.x - e.x) + Math.abs(leader.y - e.y);
          if (foe && dToLeader < 10) {
            goal = foe;
          } else if (dToLeader > 3) {
            goal = leader;
          } else if (foe) {
            goal = foe;
          }
        }
      }
    } else {
      goal = this.nearestHostile(e, 14);
    }

    if (goal) {
      e.stairWander = null;
      // Creatures are engaged from range; tile goals (treasure, lair) must actually be stepped onto.
      const creatureGoal = goal instanceof Entity;
      const blocked = (x, y) => !!this.entityAt(x, y, e.lvl, e);
      const path = this.ds.findPath(e.lvl, e.x, e.y, goal.x, goal.y, blocked, 500);
      if (path && (path.length > 1 || (!creatureGoal && path.length === 1))) {
        const step = path[0];
        if (this.tryStep(e, dirFromDelta(step.x - e.x, step.y - e.y))) return;
      } else if (path && path.length === 1) {
        e.dir = dirFromDelta(goal.x - e.x, goal.y - e.y);
        return;
      } else if (!path && e.team === 2) {
        const open = this.ds.findPath(e.lvl, e.x, e.y, goal.x, goal.y, null, 500);
        if (open && (open.length > 1 || !creatureGoal) && this.team2PushThrough(e, open[0], true)) return;
      }
    }
    if (e.isMonster && e.stairCd <= 0) {
      if (!e.stairWander && Math.random() < 0.04) {
        const kinds = ['up', 'down'].filter((k) => (k === 'up' ? e.lvl > 1 : e.lvl < this.ds.maxlevel));
        e.stairWander = kinds[this.randInt(kinds.length)];
      }
      if (e.stairWander) {
        if (this.seekStairs(e, e.stairWander)) return;
        e.stairWander = null;
      }
    }
    if (Math.random() < 0.55) {
      this.tryStep(e, 1 + this.randInt(4));
    } else {
      e.restTimer = 0.2 + Math.random() * 0.4;
    }
  }

  updateEntities(dt) {
    for (const r of this.ds.relics) if (r.dropCooldown > 0) r.dropCooldown -= dt;
    for (const e of this.entities) {
      if (!e.alive) {
        if (e.deathTimer > 0) e.deathTimer -= dt;
        if (e !== this.player) {
          e.respawnTimer -= dt;
          if (e.respawnTimer <= 0) {
            if (!this.respawnEntity(e)) e.respawnTimer = 2;
          }
        }
        continue;
      }
      if (e.stairCd > 0) e.stairCd -= dt;
      const arrived = e.update(dt);
      if (e.carrying) {
        const r = this.ds.relic(e.carrying);
        if (r) { r.lvl = e.lvl; r.x = e.x; r.y = e.y; }
      }
      if (e === this.player) {
        if (arrived) {
          this.onPlayerArrive();
          // Start the next step in the same frame and carry leftover time so held movement never stutters.
          this.updatePlayerControl();
          if (e.moving) e.advance(e.overflow);
        }
        this.checkPlayerRelicRetake();
        continue;
      }
      if (arrived && e.team === 2) {
        this.checkEntityRelicPickup(e);
        this.checkEntityLairArrival(e);
      }
      if (e.lvl !== this.lvl || e.asleep) {
        e.windup = 0;
        if (e.lvl !== this.lvl) this.updateOffLevel(e, dt);
        continue;
      }
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          e.windup = 0;
          this.fire(e, e.windupDir);
        }
      }
      e.thinkTimer -= dt;
      if (e.thinkTimer <= 0 && !e.moving) {
        e.thinkTimer = 0.06 + Math.random() * 0.08;
        this.think(e);
      }
    }
  }

  // ---------- UI ----------

  hint(key, msg) {
    const now = performance.now();
    if (now - (this.hintCooldown[key] || 0) < 2500) return;
    this.hintCooldown[key] = now;
    this.toast(msg);
  }

  toast(msg, kind = '') {
    const line = document.createElement('div');
    line.className = `log-line ${kind}`;
    line.textContent = msg;
    this.dom.log.appendChild(line);
    while (this.dom.log.children.length > 4) this.dom.log.removeChild(this.dom.log.firstChild);
    setTimeout(() => line.classList.add('fade'), 3800);
    setTimeout(() => line.remove(), 4600);
  }

  popText(ent, text, color) {
    const rc = ent.renderCell();
    const w = this.renderer.gridToWorld(rc.x, rc.y);
    this.renderer.floatText(w.x, w.y + 70, text, color);
  }

  playAt(name, ent, vol) {
    if (!this.player) return;
    const now = performance.now();
    if (now - (this.lastSoundAt[name] || 0) < 60) return;
    this.lastSoundAt[name] = now;
    if (ent.lvl !== this.lvl) return;
    const d = Math.abs(ent.x - this.player.x) + Math.abs(ent.y - this.player.y);
    if (d > 12) return;
    const screenDx = (ent.x - this.player.x) * 49 - (ent.y - this.player.y) * 48;
    this.audio.play(name, vol * Math.max(0.2, 1 - d / 12), 1, Math.max(-0.8, Math.min(0.8, screenDx / 450)));
  }

  updateHUD() {
    const p = this.player;
    if (!p) return;
    const d = this.dom;
    const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
    d.hpFill.style.width = `${hpPct}%`;
    d.hpFill.classList.toggle('low', hpPct < 30);
    d.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;
    d.arFill.style.width = `${Math.min(100, p.armour * 2)}%`;
    d.arText.textContent = p.armour;
    const prevLevelAt = p.levelBase || 0;
    const xpPct = Math.max(0, Math.min(100, ((p.skill - prevLevelAt) / (p.nextLevelAt - prevLevelAt)) * 100));
    d.xpFill.style.width = `${xpPct}%`;
    d.xpText.textContent = `${p.skill} / ${p.nextLevelAt}`;
    d.skill.textContent = p.skill;
    d.level.textContent = p.level;
    d.rings.textContent = p.rings;
    d.floor.textContent = `${this.lvl} / ${this.ds.maxlevel}`;
    const ep = this.ds.currentEpisodeDef;
    d.episode.textContent = `Episode ${this.episodeNum}${ep && ep.title && ep.title !== 'Title' && !/^Episode/.test(ep.title) ? ` - ${ep.title}` : ''}`;
    d.btnRing.classList.toggle('active', p.protection > 0);
    d.relic.classList.toggle('on', !!p.carrying);
    d.relic.dataset.relic = p.carrying || '';
    this.drawPortrait();
  }

  drawPortrait() {
    if (!this.sheetImg || !this.player) return;
    const key = `${this.player.classKey}`;
    if (this.portraitKey === key) return;
    this.portraitKey = key;
    const rowY = { fighter: 0, cleric: 512, thief: 256, wizard: 384 }[key];
    const ctx = this.dom.portrait.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(this.sheetImg, 384, rowY + 64, 64, 64, 0, 0, 64, 64);
  }

  drawMinimap() {
    const ctx = this.mapCtx;
    const c = this.dom.minimap;
    ctx.clearRect(0, 0, c.width, c.height);
    const ds = this.ds;
    const p = this.player;
    if (!ds || !p) return;

    // Follow the player with a clear, readable scale
    const sx = 12;
    const sy = sx / 2;
    const ox = c.width / 2 - (p.x - p.y) * sx;
    const oy = c.height / 2 - (p.x + p.y) * sy;
    const at = (x, y) => [ox + (x - y) * sx, oy + (x + y) * sy];

    ds.forEachCell(this.lvl, (cell, x, y) => {
      if (!cell.explored || (cell.type !== 'f' && cell.type !== 's')) return;
      const [px, py] = at(x, y);
      if (px < -sx || px > c.width + sx || py < -sy || py > c.height + sy) return;
      ctx.fillStyle = cell.type === 's' ? '#e0a040' : '#6a5a48';
      ctx.beginPath();
      ctx.moveTo(px, py - sy); ctx.lineTo(px + sx, py); ctx.lineTo(px, py + sy); ctx.lineTo(px - sx, py);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 230, 170, 0.18)';
      ctx.stroke();

      if (cell.type === 's') {
        ctx.fillStyle = '#1a1208';
        ctx.font = `bold ${Math.max(7, Math.round(sx * 0.5))}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cell.stair === 'down' ? '\u25BC' : '\u25B2', px, py + 1);
      }

      if (cell.pad === 5) {
        ctx.fillStyle = '#55aaff';
        ctx.fillRect(px - sx * 0.22, py - sy * 0.22, sx * 0.44, sy * 0.44);
      } else if (cell.pad === 4) {
        ctx.fillStyle = '#8a3a20';
        ctx.fillRect(px - sx * 0.22, py - sy * 0.22, sx * 0.44, sy * 0.44);
      } else if (cell.pad >= 0) {
        ctx.fillStyle = '#4fe08a';
        ctx.fillRect(px - sx * 0.22, py - sy * 0.22, sx * 0.44, sy * 0.44);
      }
    });
    for (const r of ds.relics) {
      if (r.lvl === this.lvl && !r.carrier && ds.cell(r.x, r.y, this.lvl).explored) {
        const [px, py] = at(r.x, r.y);
        ctx.fillStyle = '#55aaff';
        ctx.fillRect(px - sx * 0.3, py - sy * 0.3, sx * 0.6, sy * 0.6);
      }
    }
    for (const e of this.entities) {
      if (e === p || !e.alive || e.lvl !== this.lvl) continue;
      if (this.renderer.entityVisibility(ds, e, p) <= 0) continue;
      const [px, py] = at(e.x, e.y);
      ctx.fillStyle = e.kind === 'ally' ? '#66d0ff' : (e.team === 2 ? '#ff7733' : '#ff4a3a');
      ctx.fillRect(px - sx * 0.22, py - sy * 0.22, sx * 0.44, sy * 0.44);
      if (e.carrying) {
        ctx.fillStyle = '#55aaff';
        ctx.fillRect(px - sx * 0.15, py - sy * 0.35, sx * 0.3, sy * 0.2);
      }
    }
    const [ppx, ppy] = at(p.x, p.y);
    ctx.fillStyle = '#fff36a';
    ctx.beginPath();
    ctx.arc(ppx, ppy, Math.max(3.5, sx * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  showObjective(first = false) {
    const ep = this.ds.currentEpisodeDef;
    const title = ep && ep.title && ep.title !== 'Title' ? ep.title : `Episode ${this.episodeNum}`;
    const body = richText(ep ? ep.response : 'Find the relic and return it home.');
    const hasRivals = this.entities.some(e => e.team === 2);
    const rivalHint = hasRivals ? '<div class="modal-hint warn" style="color:#ffaa55">⚔️ Rivals are hunting in the dungeon! They seek the blue treasure and will carry it to their lair.</div>' : '';
    const hint = '<div class="modal-hint">Brave the lower floors, secure the blue treasure (-p) and carry it back to your glowing home pad (-k).</div>' + rivalHint;
    this.modalAction = null;
    this.showModal(title.toUpperCase(), `<div class="objective">${body}</div>${hint}`, first ? 'ENTER THE DUNGEON' : 'CONTINUE');
  }

  showModal(title, html, buttonText = 'CONTINUE') {
    this.dom.modalTitle.textContent = title;
    this.dom.modalBody.innerHTML = html;
    this.dom.modalBtn.textContent = buttonText;
    this.dom.modal.classList.remove('hidden');
    this.dom.modalBtn.focus({ preventScroll: true });
    this.state = 'MODAL';
    this.clearInput();
  }

  closeModal() {
    this.dom.modal.classList.add('hidden');
    const action = this.modalAction;
    const back = this.modalReturn;
    this.modalAction = null;
    this.modalReturn = null;
    this.audio.play('button.wav', 0.4);
    if (back === 'PAUSED') {
      this.openPause();
      return;
    }
    this.state = 'PLAYING';
    if (action) action();
    if (!this.rivalsAlerted && this.entities && this.entities.some(e => e.team === 2)) {
      this.rivalsAlerted = true;
      this.toast('Rivals are in the area! Protect the blue treasure.', 'warn');
    }
  }

  // ---------- main loop ----------

  update(dt) {
    this.time += dt;
    this.epStats.time += dt;
    this.wakeTimer -= dt;
    if (this.wakeTimer <= 0) {
      this.wakeTimer = 0.25;
      this.wakeNearby();
    }

    this.pollGamepad();
    this.updatePlayerControl();
    this.updatePlayerFire();
    this.updateEntities(dt);
    this.updateProjectiles(dt);
    this.updatePits(dt);
    this.updateGuide();

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      this.drawMinimap();
      this.dom.btnRing.classList.toggle('active', this.player.protection > 0);
      if (this.player.protection > 0) this.dom.btnRing.dataset.left = Math.ceil(this.player.protection);
    }
    if (this.pendingPerks > 0 && this.player.alive && !this.transition) this.openPerks();
  }

  gameLoop(time) {
    requestAnimationFrame((t) => this.gameLoop(t));
    const dt = Math.min(0.05, (time - this.lastFrame) / 1000) || 0.016;
    this.lastFrame = time;

    if (this.state === 'PLAYING') this.update(dt);

    const live = ['PLAYING', 'MODAL', 'PAUSED', 'PERK', 'MAP'].includes(this.state);
    if (this.player && this.ds.levels.length && live) {
      this.renderer.frame({
        ds: this.ds, lvl: this.lvl, entities: this.entities, projectiles: this.projectiles, player: this.player,
        ui: this.state === 'PLAYING' ? this.uiState() : null
      }, this.state === 'PLAYING' ? dt : 0);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.murkGame = new MurkGame();
});

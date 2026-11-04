// Copyright (c) Mark Longo 2026

/**
 * Murk UI and progression: settings, save/continue, pause menu, level-up talents, the full map,
 * help and the objective guide arrow.
 */

const SETTINGS_KEY = 'murk.settings.v1';
const SAVE_KEY = 'murk.save.v1';
const BEST_KEY = 'murk.best.v1';

const DEFAULT_SETTINGS = { sfx: 1, amb: 1, aim: true, shake: true, hints: true, muted: false };

// Level-up talents. `can` gates ones that have hit a sensible cap; `max` limits how often one can be taken.
const PERKS = [
  { id: 'volley', icon: '\u2735', name: 'Volley', desc: '+1 missile in flight at once', max: 4, can: (p) => p.maxShots < 8, apply: (p) => { p.maxShots++; } },
  { id: 'power', icon: '\u2694', name: 'Heavy Hand', desc: '+1 maximum damage', max: 5, apply: (p) => { p.dmax++; } },
  { id: 'edge', icon: '\u2726', name: 'Keen Edge', desc: '+1 minimum damage', max: 4, can: (p) => p.dmin < p.dmax, apply: (p) => { p.dmin++; } },
  { id: 'rapid', icon: '\u27A4', name: 'Quick Draw', desc: 'Fire 12% faster', max: 4, can: (p) => p.fireCd > 0.14, apply: (p) => { p.fireCd = Math.max(0.12, p.fireCd * 0.88); } },
  { id: 'swift', icon: '\u2748', name: 'Fleet Foot', desc: 'Move 8% faster', max: 3, can: (p) => p.tileTime > 0.17, apply: (p) => { p.tileTime = Math.max(0.16, p.tileTime * 0.92); } },
  { id: 'vital', icon: '\u2665', name: 'Vitality', desc: '+15 maximum health and a full heal', apply: (p) => { p.maxHp += 15; p.hp = p.maxHp; } },
  { id: 'bulwark', icon: '\u25C8', name: 'Bulwark', desc: '+8 armour', apply: (p) => { p.armour += 8; } },
  { id: 'charm', icon: '\u25CB', name: 'Charmed Life', desc: '+1 Ring of Protection', apply: (p) => { p.rings++; } },
  { id: 'pierce', icon: '\u27B6', name: 'Piercing Shots', desc: 'Missiles pass through one more monster', max: 2, apply: (p) => { p.pierce++; } },
  { id: 'leech', icon: '\u2620', name: 'Soul Leech', desc: 'Heal 2 health for every monster you slay', max: 3, apply: (p) => { p.lifesteal += 2; } }
];

Object.assign(MurkGame.prototype, {
  initProgress() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, this.readJson(SETTINGS_KEY));
    this.pendingPerks = 0;
    this.pendingHero = null;
    this.perkChoices = [];
    this.epStats = { kills: 0, time: 0, deaths: 0, items: 0 };
    this.mapLvl = 1;
    this.stairCache = {};
  },

  readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch (e) {
      return null;
    }
  },

  writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage can be unavailable (private mode); the game works without it
    }
  },

  applySettings() {
    const s = this.settings;
    this.audio.setVolumes(s.sfx, s.amb);
    this.audio.muted = s.muted;
    if (this.audio.master) this.audio.master.gain.value = s.muted ? 0 : 1;
    if (this.renderer) this.renderer.shakeEnabled = s.shake;
    const hint = document.getElementById('controls-hint');
    if (hint) hint.classList.toggle('hidden', !s.hints);
  },

  saveSettings() {
    this.writeJson(SETTINGS_KEY, this.settings);
    this.applySettings();
  },

  // ---------- save, continue, best ----------

  serializeHero(p) {
    const keys = ['level', 'levelBase', 'skill', 'nextLevelAt', 'maxHp', 'armour', 'rings', 'dmin', 'dmax', 'maxShots', 'fireCd', 'tileTime', 'pierce', 'lifesteal'];
    const hero = { perks: Object.assign({}, p.perks) };
    keys.forEach((k) => { hero[k] = p[k]; });
    return hero;
  },

  applyHero(p, hero) {
    Object.assign(p, hero);
    p.hp = p.maxHp;
  },

  loadSave() {
    const s = this.readJson(SAVE_KEY);
    return s && s.v === 1 && CLASS_DEFS[s.classKey] && s.hero ? s : null;
  },

  // Only episode boundaries are saved: a fresh run never overwrites an older save until it earns its first reward.
  saveProgress() {
    if (this.episodeNum <= 1 || !this.player) return;
    this.writeJson(SAVE_KEY, {
      v: 1, classKey: this.classKey, episodeNum: this.episodeNum, deaths: this.deaths,
      hero: this.serializeHero(this.player)
    });
  },

  recordBest() {
    const p = this.player;
    const best = this.readJson(BEST_KEY) || { episode: 0, score: 0 };
    const isBest = this.episodeNum > best.episode || (this.episodeNum === best.episode && p.skill > best.score);
    if (isBest) this.writeJson(BEST_KEY, { episode: this.episodeNum, score: p.skill });
    return isBest;
  },

  formatTime(sec) {
    const s = Math.floor(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },

  showSelectScreen() {
    document.getElementById('select-screen').classList.remove('hidden');
    this.state = 'SELECT';
    const save = this.loadSave();
    const btn = document.getElementById('btn-continue');
    btn.classList.toggle('hidden', !save);
    if (save) {
      const cls = CLASS_DEFS[save.classKey];
      btn.textContent = `CONTINUE \u2014 ${cls.name}, Level ${save.hero.level}, Episode ${save.episodeNum}`;
    }
    const best = this.readJson(BEST_KEY);
    const line = document.getElementById('best-line');
    line.textContent = best ? `Best run: Episode ${best.episode} \u00B7 Score ${best.score}` : '';
  },

  // ---------- pause menu ----------

  bindUi() {
    const $ = (id) => document.getElementById(id);
    $('pause-resume').addEventListener('click', () => this.closePause());
    $('pause-map').addEventListener('click', () => { this.closePause(); this.openMap(); });
    $('pause-help').addEventListener('click', () => {
      $('pause-screen').classList.add('hidden');
      this.modalReturn = 'PAUSED';
      this.showHelp();
    });
    $('pause-restart').addEventListener('click', () => this.confirmThen('pause-restart', 'Restart episode?', () => {
      this.closePause();
      this.beginEpisode();
    }));
    $('pause-quit').addEventListener('click', () => this.confirmThen('pause-quit', 'Quit to title?', () => this.quitToTitle()));
    $('set-fs').addEventListener('click', () => this.toggleFullscreen());
    $('set-mute').addEventListener('click', () => this.toggleMute());

    const bindSlider = (id, key) => {
      $(id).addEventListener('input', (e) => {
        this.settings[key] = Number(e.target.value) / 100;
        this.saveSettings();
        if (key === 'sfx') this.audio.play('item.wav', 0.5);
      });
    };
    bindSlider('set-sfx', 'sfx');
    bindSlider('set-amb', 'amb');
    const bindToggle = (id, key) => {
      $(id).addEventListener('click', () => {
        this.settings[key] = !this.settings[key];
        this.saveSettings();
        this.syncSettingsUi();
      });
    };
    bindToggle('set-aim', 'aim');
    bindToggle('set-shake', 'shake');
    bindToggle('set-hints', 'hints');

    $('map-close').addEventListener('click', () => this.closeMap());
    $('map-prev').addEventListener('click', () => this.mapFloor(-1));
    $('map-next').addEventListener('click', () => this.mapFloor(1));
    document.addEventListener('fullscreenchange', () => this.syncSettingsUi());
    this.syncSettingsUi();
  },

  // Two-step buttons guard destructive actions without a modal.
  confirmThen(id, label, action) {
    const btn = document.getElementById(id);
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label;
      action();
      return;
    }
    btn.dataset.label = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = 'Click to confirm';
    setTimeout(() => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
      }
    }, 3000);
  },

  syncSettingsUi() {
    const $ = (id) => document.getElementById(id);
    const s = this.settings;
    $('set-sfx').value = Math.round(s.sfx * 100);
    $('set-amb').value = Math.round(s.amb * 100);
    const onOff = (id, label, v) => { $(id).textContent = `${label}: ${v ? 'On' : 'Off'}`; $(id).classList.toggle('on', !!v); };
    onOff('set-aim', 'Aim assist', s.aim);
    onOff('set-shake', 'Screen shake', s.shake);
    onOff('set-hints', 'Control hints', s.hints);
    $('set-mute').textContent = s.muted ? 'Sound: Off' : 'Sound: On';
    $('set-fs').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  },

  openPause() {
    if (this.state !== 'PLAYING' && this.state !== 'MODAL' && this.state !== 'PAUSED') return;
    if (this.state === 'MODAL') this.dom.modal.classList.add('hidden');
    this.state = 'PAUSED';
    this.clearInput();
    this.syncSettingsUi();
    document.getElementById('pause-screen').classList.remove('hidden');
  },

  closePause() {
    document.getElementById('pause-screen').classList.add('hidden');
    this.state = 'PLAYING';
  },

  quitToTitle() {
    document.getElementById('pause-screen').classList.add('hidden');
    this.dom.hud.classList.add('hidden');
    this.player = null;
    this.entities = [];
    this.projectiles = [];
    this.pendingPerks = 0;
    this.clearInput();
    this.showSelectScreen();
  },

  toggleMute() {
    this.settings.muted = this.audio.toggleMute();
    this.saveSettings();
    this.syncSettingsUi();
    if (this.dom && this.dom.log) this.toast(this.settings.muted ? 'Sound off.' : 'Sound on.');
  },

  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  },

  // ---------- level-up talents ----------

  openPerks() {
    const p = this.player;
    const pool = PERKS.filter((perk) => (!perk.can || perk.can(p)) && (p.perks[perk.id] || 0) < (perk.max || 99));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.perkChoices = pool.slice(0, 3);
    if (!this.perkChoices.length) {
      this.pendingPerks = 0;
      return;
    }
    this.state = 'PERK';
    this.clearInput();
    document.getElementById('perk-level').textContent = `You reached level ${p.level}`;
    const host = document.getElementById('perk-cards');
    host.innerHTML = '';
    this.perkChoices.forEach((perk, i) => {
      const rank = (p.perks[perk.id] || 0) + 1;
      const card = document.createElement('button');
      card.className = 'perk-card';
      card.innerHTML = `<span class="perk-key">${i + 1}</span><span class="perk-icon">${perk.icon}</span>` +
        `<span class="perk-name">${perk.name}</span><span class="perk-desc">${perk.desc}</span>` +
        `<span class="perk-rank">${rank > 1 ? `Rank ${rank}` : 'New'}</span>`;
      card.addEventListener('click', () => this.choosePerk(i));
      host.appendChild(card);
    });
    document.getElementById('perk-screen').classList.remove('hidden');
    this.audio.play('item.wav', 0.5);
  },

  choosePerk(i) {
    const perk = this.perkChoices[i];
    if (!perk) return;
    const p = this.player;
    perk.apply(p);
    p.perks[perk.id] = (p.perks[perk.id] || 0) + 1;
    this.pendingPerks = Math.max(0, this.pendingPerks - 1);
    document.getElementById('perk-screen').classList.add('hidden');
    this.state = 'PLAYING';
    this.audio.play('treasure.wav', 0.5);
    this.toast(`${perk.name}: ${perk.desc}.`, 'good');
    const w = this.renderer.gridToWorld(p.x, p.y);
    this.renderer.burst(w.x, w.y + 30, 0x9fd8ff, 18, 100, 0.7, 12);
    this.updateHUD();
  },

  // ---------- help ----------

  showHelp() {
    const kb = (...keys) => keys.map((k) => `<kbd>${k}</kbd>`).join('');
    const row = (keys, text) => `<div class="kv"><span class="keys">${keys}</span><span class="what">${text}</span></div>`;
    this.modalAction = null;
    this.showModal('HOW TO PLAY', `<div class="help">` +
      row(kb('W', 'A', 'S', 'D') + ' / arrows', 'Move toward a screen direction. Hold one key and you follow the tunnel around its corners.') +
      row('Click', 'Walk to a tile. Hold the button to follow the cursor, or click a monster to close in and attack it.') +
      row(kb('Space') + ' / ' + kb('J'), 'Fire. Auto-aims at the nearest monster lined up on a diagonal, otherwise straight ahead.') +
      row('Right-click', 'Fire toward the cursor.') +
      row(kb('E') + ' / ' + kb('Enter'), 'Use a ladder (or just click it).') +
      row(kb('R') + ' &nbsp; ' + kb('Q'), 'Ring of Protection &nbsp;\u00B7&nbsp; set the relic down.') +
      row(kb('M') + ' / ' + kb('Tab'), 'Full map of the explored floor.') +
      row(kb('Esc') + ' &nbsp; ' + kb('F') + ' &nbsp; ' + kb('N'), 'Pause menu &nbsp;\u00B7&nbsp; fullscreen &nbsp;\u00B7&nbsp; mute.') +
      row('Gamepad', 'Left stick move \u00B7 RT / right stick fire \u00B7 A ladder \u00B7 X ring \u00B7 Y relic \u00B7 Back map \u00B7 Start pause.') +
      `</div><div class="modal-hint">Missiles fly along the four diagonals - line up your shots, and sidestep when a monster flashes gold: it is about to fire. ` +
      `Hits make you drop the relic. Taking it wakes the whole dungeon, so use your ring and run for the home pad.</div>`, 'CONTINUE');
  },

  // ---------- full map ----------

  openMap() {
    if (this.state !== 'PLAYING' && this.state !== 'PAUSED') return;
    this.mapLvl = this.lvl;
    this.state = 'MAP';
    this.clearInput();
    document.getElementById('map-screen').classList.remove('hidden');
    this.drawBigMap();
  },

  closeMap() {
    document.getElementById('map-screen').classList.add('hidden');
    this.state = 'PLAYING';
  },

  mapFloor(step) {
    this.mapLvl = Math.max(1, Math.min(this.ds.maxlevel, this.mapLvl + step));
    this.drawBigMap();
  },

  drawBigMap() {
    const ds = this.ds;
    const lvl = this.mapLvl;
    const canvas = document.getElementById('bigmap');
    const W = Math.min(1100, Math.floor(window.innerWidth * 0.9));
    const H = Math.min(640, Math.floor(window.innerHeight * 0.66));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    document.getElementById('map-floor').textContent = `Floor ${lvl} of ${ds.maxlevel}`;

    let umin = 1e9; let umax = -1e9; let vmin = 1e9; let vmax = -1e9; let count = 0;
    ds.forEachCell(lvl, (c, x, y) => {
      if (!c.explored || (c.type !== 'f' && c.type !== 's')) return;
      count++;
      umin = Math.min(umin, x - y); umax = Math.max(umax, x - y);
      vmin = Math.min(vmin, x + y); vmax = Math.max(vmax, x + y);
    });
    if (!count) {
      ctx.fillStyle = '#8f82a8';
      ctx.font = '18px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nothing explored on this floor yet.', W / 2, H / 2);
      return;
    }
    const sx = Math.min(28, (W * 0.92) / (umax - umin + 3), (H * 0.92) / ((vmax - vmin + 3) / 2));
    const sy = sx / 2;
    const ox = W / 2 - ((umin + umax) / 2) * sx;
    const oy = H / 2 - ((vmin + vmax) / 2) * sy;
    const at = (x, y) => [ox + (x - y) * sx, oy + (x + y) * sy];
    const diamond = (px, py, rx, ry) => {
      ctx.beginPath();
      ctx.moveTo(px, py - ry); ctx.lineTo(px + rx, py); ctx.lineTo(px, py + ry); ctx.lineTo(px - rx, py);
      ctx.closePath();
    };

    ds.forEachCell(lvl, (c, x, y) => {
      if (!c.explored || (c.type !== 'f' && c.type !== 's')) return;
      const [px, py] = at(x, y);
      diamond(px, py, sx, sy);
      ctx.fillStyle = c.type === 's' ? '#d9983a' : '#6a5a48';
      ctx.fill();
    });
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,230,170,0.12)';
    ds.forEachCell(lvl, (c, x, y) => {
      if (c.explored && c.type === 'f') {
        const [px, py] = at(x, y);
        diamond(px, py, sx, sy);
        ctx.stroke();
      }
    });

    const mark = (x, y, color, r) => {
      const [px, py] = at(x, y);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, Math.min(9, r)), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    };
    ds.forEachCell(lvl, (c, x, y) => {
      if (c.explored && c.type === 's') {
        const [px, py] = at(x, y);
        ctx.fillStyle = '#1a1208';
        ctx.font = `bold ${Math.max(8, Math.round(sx * 1.2))}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.stair === 'down' ? '\u25BC' : '\u25B2', px, py + 1);
      }
    });
    if (this.home && lvl === this.home.lvl) mark(this.home.x, this.home.y, '#4fe08a', sx * 0.9);
    for (const r of ds.relics) {
      if (r.lvl === lvl && !r.carrier && ds.cell(r.x, r.y, lvl).explored) mark(r.x, r.y, r.id === 1 ? '#ff5544' : '#55aaff', sx * 0.8);
    }
    if (this.player.lvl === lvl) mark(this.player.x, this.player.y, '#fff36a', sx * 0.9);
    document.getElementById('map-prev').disabled = lvl <= 1;
    document.getElementById('map-next').disabled = lvl >= ds.maxlevel;
  },

  // ---------- objective guide ----------

  upStairs(lvl) {
    if (!this.stairCache[lvl]) this.stairCache[lvl] = this.ds.findStairs(lvl, 'up');
    return this.stairCache[lvl];
  },

  // Points toward the home pad (or the way up to it) while the relic is being carried.
  updateGuide() {
    const el = this.dom.guide;
    const p = this.player;
    let target = null;
    if (p.carrying && p.alive) {
      if (this.lvl === this.home.lvl) {
        target = this.home;
      } else {
        let bestD = 1e9;
        for (const s of this.upStairs(this.lvl)) {
          const d = Math.abs(s.x - p.x) + Math.abs(s.y - p.y);
          if (d < bestD) { bestD = d; target = s; }
        }
      }
    }
    if (!target || Math.abs(target.x - p.x) + Math.abs(target.y - p.y) < 5) {
      el.classList.remove('on');
      return;
    }
    const a = this.renderer.gridToWorld(p.renderCell().x, p.renderCell().y);
    const b = this.renderer.gridToWorld(target.x, target.y);
    const angle = Math.atan2(-(b.y - a.y), b.x - a.x);
    el.style.setProperty('--a', `${angle}rad`);
    el.classList.add('on');
  }
});

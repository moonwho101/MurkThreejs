// Copyright (c) Mark Longo 2026

/**
 * Murk audio: Web Audio playback of the original WAV effects plus an ambient loop.
 */

class MurkAudio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.muted = false;
    this.loading = null;
    this.ambient = null;
    this.dripTimer = null;
    this.sfxVolume = 1;
    this.ambVolume = 1;
    // Names as stored on disk (the server may be case sensitive); lookups are case-insensitive.
    this.files = [
      'alive.wav', 'back.wav', 'bsword.wav', 'button.wav', 'dead.wav', 'deathorb.wav', 'die.wav',
      'DRAGON.WAV', 'Drip2.wav', 'ewizard.wav', 'fireball.wav', 'impact.wav', 'item.wav', 'mouther.wav',
      'orb.wav', 'ouch.wav', 'Protection.wav', 'Skeleton.wav', 'Spawn.wav', 'tcleric.wav', 'throw.wav',
      'throw2.wav', 'treasure.wav', 'tsword.wav', 'walk.wav', 'win.wav'
    ];
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);
      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = this.ambVolume;
      this.ambBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.loading) this.loading = this.preload();
  }

  setVolumes(sfx, amb) {
    this.sfxVolume = sfx;
    this.ambVolume = amb;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.ambBus) this.ambBus.gain.value = amb;
  }

  async preload() {
    await Promise.all(this.files.map(async (file) => {
      try {
        const res = await fetch(`assets/sound/${file}`);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        this.buffers[file.toLowerCase()] = await this.ctx.decodeAudioData(data);
      } catch (err) {
        console.warn('Could not load sound', file, err);
      }
    }));
    this.startAmbience();
  }

  startAmbience() {
    if (this.ambient || !this.ctx || !this.buffers['back.wav']) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers['back.wav'];
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.18;
    src.connect(gain);
    gain.connect(this.ambBus);
    src.start(0);
    this.ambient = src;

    const drip = () => {
      this.play('drip2.wav', 0.12, 1, 0, true);
      this.dripTimer = setTimeout(drip, 4000 + Math.random() * 9000);
    };
    this.dripTimer = setTimeout(drip, 3000);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  // `pan` is -1 (left) to 1 (right); ambient one-shots go through the ambience bus.
  play(name, volume = 0.5, rate = 1, pan = 0, ambient = false) {
    if (this.muted || !this.ctx || !this.sfxBus) return;
    const buf = this.buffers[name.toLowerCase()];
    if (!buf) return;
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = rate;
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      let out = gain;
      if (pan && this.ctx.createStereoPanner) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        gain.connect(panner);
        out = panner;
      }
      out.connect(ambient ? this.ambBus : this.sfxBus);
      source.start(0);
    } catch (e) {
      // playback is best effort
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MurkAudio };
}

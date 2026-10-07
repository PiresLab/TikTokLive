// Efeitos: projéteis do castelo até o monstro (um tipo por evento), feitiços de
// gift por tier, partículas, ondas de choque, raios, números de dano e shake.
// Tudo reaproveita objetos/emissores (sem alocação por frame) e respeita
// R.fxScale (?lowfx=1) pra rodar leve 24/7.
(function fx(R) {
  /**
   * Feitiço por presente (nome em pt/en, sem depender de id, que varia por região). Pra incluir um presente novo:
   * adicione uma linha aqui. `cooldown` evita empilhar o mesmo feitiço em rajada; `alsoTier` soma o efeito do tier.
   */
  const GIFT_SPELLS = [
    { match: /\b(rose|rosa)\b/i, cooldown: 350, cast: (fx) => fx.castRose(), alsoTier: true },
    { match: /(heart|coraç|coraca|finger)/i, cooldown: 500, cast: (fx) => fx.castHeart(), alsoTier: true },
    { match: /perfum/i, cooldown: 500, cast: (fx) => fx.castPerfume(), alsoTier: true },
    { match: /^\s*(gg|good game)\s*$/i, cooldown: 600, cast: (fx) => fx.castGG(), alsoTier: true },
    { match: /(lion|le[aã]o)/i, cooldown: 1200, cast: (fx) => fx.castLion(), alsoTier: true },
    { match: /(galaxy|gal[aá]xia)/i, cooldown: 1500, cast: (fx) => fx.castGalaxy(), alsoTier: false },
    { match: /(universe|universo)/i, cooldown: 2500, cast: (fx) => fx.castUniverse(), alsoTier: false },
  ];

  class Fx {
    constructor(scene, layer, refs) {
      this.scene = scene;
      this.layer = layer;
      this.refs = refs; // { kingdom, monsters, heroes }
      this.emitters = new Map();
      this.pool = [];
      this.active = 0;
      this.budget = Math.max(6, Math.round(26 * R.fxScale));
      this.lastLikeAt = 0;
      this.lastCommentAt = 0;
      this.lastShareAt = 0;
      this.lastHighAt = -9999;
      this.lastMidAt = -9999;
      this.lastSpellAt = -9999;
      /** () => retângulos do HUD a evitar; main liga ao HUD depois que ele existe. */
      this.obstacles = null;
      this.punching = false;
      this.stopped = false;
    }

    /** Efeitos ficam acima de tudo (heróis usam depth = y, ~600). */
    addTop(obj) {
      this.layer.add(obj);
      obj.setDepth(5000); // acima dos heróis (depth = y, que no vertical passa de 1000)
      return obj;
    }

    // ---------------------------------------------------------------- partículas

    emitterFor(color, kind) {
      const key = `${kind}:${color}`;
      const cached = this.emitters.get(key);
      if (cached) return cached;

      const configs = {
        burst: {
          texture: 'spark',
          config: { speed: { min: 70, max: 280 }, lifespan: { min: 350, max: 800 }, scale: { start: 0.75, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 140, blendMode: 'ADD', tint: color },
        },
        rise: {
          texture: 'glow',
          config: { speedY: { min: -110, max: -35 }, speedX: { min: -35, max: 35 }, lifespan: { min: 700, max: 1300 }, scale: { start: 0.35, end: 0 }, alpha: { start: 0.9, end: 0 }, blendMode: 'ADD', tint: color },
        },
        smoke: {
          texture: 'glow',
          config: { speedY: { min: -60, max: -20 }, speedX: { min: -25, max: 25 }, lifespan: { min: 1200, max: 2200 }, scale: { start: 0.5, end: 1.4 }, alpha: { start: 0.5, end: 0 }, tint: color },
        },
        petal: {
          texture: 'flake',
          config: { speedX: { min: -60, max: 60 }, speedY: { min: 20, max: 90 }, gravityY: 70, lifespan: { min: 1500, max: 2300 }, scale: { start: 1.2, end: 0.5 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, tint: [0xff8fb3, 0xffb3c9, 0xff6f9c, 0xffd0dc] },
        },
        heart: {
          texture: 'heart',
          config: { speedY: { min: -130, max: -60 }, speedX: { min: -45, max: 45 }, lifespan: { min: 900, max: 1500 }, scale: { start: 0.35, end: 0.95 }, alpha: { start: 1, end: 0 }, tint: [0xff5a86, 0xff7aa5, 0xffa0bd] },
        },
        confetti: {
          texture: 'spark',
          config: { speed: { min: 120, max: 420 }, angle: { min: -125, max: -55 }, lifespan: { min: 1100, max: 1900 }, scale: { start: 0.6, end: 0.15 }, alpha: { start: 1, end: 0 }, gravityY: 460, rotate: { min: 0, max: 360 }, tint: [0xffd166, 0xff6b8a, 0x7cfc9a, 0x6ad0ff, 0xffffff] },
        },
      };
      const entry = configs[kind];
      const emitter = this.scene.add.particles(0, 0, entry.texture, { emitting: false, ...entry.config });
      this.addTop(emitter);
      this.emitters.set(key, emitter);
      return emitter;
    }

    scaled(count) {
      return Math.max(1, Math.round(count * R.fxScale));
    }

    burst(x, y, color, count) {
      this.emitterFor(color, 'burst').explode(this.scaled(count), x, y);
    }

    rise(x, y, color, count) {
      this.emitterFor(color, 'rise').explode(this.scaled(count), x, y);
    }

    smoke(x, y, count) {
      this.emitterFor(0x666a7a, 'smoke').explode(this.scaled(count), x, y);
    }

    confetti(x, y, count) {
      this.emitterFor(0xffffff, 'confetti').explode(this.scaled(count), x, y);
    }

    shockwave(x, y, color, size) {
      const ring = this.scene.add.image(x, y, 'ring').setTint(color).setBlendMode('ADD').setScale(0.1).setAlpha(0.9);
      this.addTop(ring);
      this.scene.tweens.add({ targets: ring, scale: size, alpha: 0, duration: 520, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    }

    // ---------------------------------------------------------------- câmera

    shake(duration, intensity) {
      this.scene.cameras.main.shake(duration, intensity * (R.lowfx ? 0.6 : 1));
    }

    flash(duration, r, g, b) {
      this.scene.cameras.main.flash(duration, r, g, b);
    }

    /** "Soco" de zoom: aproxima rápido e volta devagar (só no mundo; o HUD fica parado). */
    punchIn(zoom = 1.05, ms = 150) {
      if (R.lowfx || this.punching) return;
      this.punching = true;
      const cam = this.scene.cameras.main;
      cam.zoomTo(zoom, ms, Phaser.Math.Easing.Sine.Out);
      this.scene.time.delayedCall(ms, () => {
        cam.zoomTo(1, ms * 3, Phaser.Math.Easing.Sine.InOut, true, (_c, progress) => {
          if (progress >= 1) this.punching = false;
        });
      });
    }

    /** Congela o jogo por alguns ms no impacto (80–120 ms dá peso sem parecer travamento). */
    hitStop(ms = 80) {
      if (R.lowfx || this.stopped) return;
      this.stopped = true;
      const { scene } = this;
      scene.time.timeScale = 0.05;
      scene.tweens.timeScale = 0.05;
      window.setTimeout(() => {
        scene.time.timeScale = 1;
        scene.tweens.timeScale = 1;
        this.stopped = false;
      }, ms);
    }

    /** Enquadra (pan + zoom) um ponto por um tempo e volta ao normal: abertura de chefão. */
    focus(x, y, zoom = 1.1, hold = 1500) {
      if (R.lowfx) return;
      const cam = this.scene.cameras.main;
      // com zoom a câmera mostra só W/zoom x H/zoom: o centro não pode passar disso senão aparece borda preta fora do cenário
      const halfW = R.W / (2 * zoom);
      const halfH = R.H / (2 * zoom);
      x = Math.min(R.W - halfW, Math.max(halfW, x));
      y = Math.min(R.H - halfH, Math.max(halfH, y));
      cam.pan(x, y, 450, Phaser.Math.Easing.Sine.InOut, true);
      cam.zoomTo(zoom, 450, Phaser.Math.Easing.Sine.InOut, true);
      this.scene.time.delayedCall(450 + hold, () => {
        cam.pan(R.W / 2, R.H / 2, 600, Phaser.Math.Easing.Sine.InOut, true);
        cam.zoomTo(1, 600, Phaser.Math.Easing.Sine.InOut, true);
      });
    }

    /** Traço rápido de lâmina (guerreiro): linha clara que aparece e some. */
    slash(x, y, color) {
      const line = this.scene.add.image(x, y, 'px').setTint(color).setBlendMode('ADD').setDisplaySize(70, 4).setRotation(R.rand(-0.9, 0.9)).setAlpha(0.95);
      this.addTop(line);
      this.scene.tweens.add({ targets: line, alpha: 0, scaleX: line.scaleX * 1.5, duration: 160, onComplete: () => line.destroy() });
    }

    petals(x, y, count) {
      this.emitterFor(0, 'petal').explode(this.scaled(count), x, y);
    }

    hearts(x, y, count) {
      this.emitterFor(0, 'heart').explode(this.scaled(count), x, y);
    }

    // ---------------------------------------------------------------- projéteis

    acquire(texture) {
      const free = this.pool.find((img) => !img.visible);
      const img = free ?? this.scene.add.image(0, 0, texture);
      if (!free) {
        this.addTop(img);
        this.pool.push(img);
      }
      return img.setTexture(texture).setVisible(true).setActive(true);
    }

    /** Dispara um projétil em arco (bezier quadrática). Respeita o orçamento de projéteis simultâneos. */
    fire(o) {
      // `force` (gift/share) fura o orçamento normal, mas nunca passa de 3x — rajada de
      // gifts não pode virar centenas de projéteis/emissores ao mesmo tempo.
      if (this.active >= (o.force ? this.budget * 3 : this.budget)) return false;
      this.active += 1;

      const scene = this.scene;
      const img = this.acquire(o.texture)
        .setTint(o.tint)
        .setScale(o.scale)
        .setAlpha(1)
        .setBlendMode(o.normal ? 'NORMAL' : 'ADD')
        .setPosition(o.from.x, o.from.y)
        .setVisible(false);
      const ctrl = { x: (o.from.x + o.to.x) / 2, y: Math.min(o.from.y, o.to.y) - (o.arc ?? 60) };

      let trail = null;
      if (o.trail && R.fxScale >= 1) {
        trail = scene.add.particles(0, 0, 'glow', {
          lifespan: 280,
          scale: { start: o.scale * 0.55, end: 0 },
          alpha: { start: 0.7, end: 0 },
          tint: o.tint,
          blendMode: 'ADD',
          frequency: 14,
        });
        trail.startFollow(img);
        this.addTop(trail);
      }

      const progress = { p: 0 };
      scene.tweens.add({
        targets: progress,
        p: 1,
        duration: o.duration,
        delay: o.delay ?? 0,
        ease: o.ease ?? 'Quad.In',
        onStart: () => img.setVisible(true),
        onUpdate: () => {
          const t = progress.p;
          const mt = 1 - t;
          img.x = mt * mt * o.from.x + 2 * mt * t * ctrl.x + t * t * o.to.x;
          img.y = mt * mt * o.from.y + 2 * mt * t * ctrl.y + t * t * o.to.y;
          if (o.rotate) {
            const dx = 2 * mt * (ctrl.x - o.from.x) + 2 * t * (o.to.x - ctrl.x);
            const dy = 2 * mt * (ctrl.y - o.from.y) + 2 * t * (o.to.y - ctrl.y);
            img.rotation = Math.atan2(dy, dx);
          }
        },
        onComplete: () => {
          const { x, y } = img;
          img.setVisible(false).setActive(false);
          this.active -= 1;
          if (trail) {
            trail.stop();
            scene.time.delayedCall(350, () => trail.destroy());
          }
          if (o.onHit) o.onHit(x, y);
        },
      });
      return true;
    }

    targetPoint(spread = 24) {
      const c = this.refs.monsters.center();
      return { x: c.x + R.rand(-spread, spread), y: c.y + R.rand(-spread, spread) };
    }

    sourcePoint(userId) {
      const hero = userId ? this.refs.heroes.positionOf(userId) : null;
      if (hero) return { x: hero.x + 12 + R.rand(-4, 4), y: hero.y - R.HERO_SIZE.h * 0.55 + R.rand(-6, 6) };
      const m = this.refs.kingdom.muzzle();
      return { x: m.x + R.rand(-30, 30), y: m.y + R.rand(-40, 20) };
    }

    // ---------------------------------------------------------------- eventos de viewer

    /** Arma de cada classe: textura, cor, voo e o que acontece no impacto. */
    classShot(classKey) {
      const shots = {
        knight: { texture: 'spark', tint: 0xbfe6ff, scale: 0.75, duration: [160, 230], arc: [20, 50], hit: (x, y) => { this.slash(x, y, 0xdff3ff); this.burst(x, y, 0x9fd0ff, 5); } },
        archer: { texture: 'arrow', tint: 0xe8f4d0, scale: 0.8, normal: true, rotate: true, duration: [190, 270], arc: [30, 70], hit: (x, y) => this.burst(x, y, 0xd8f0b0, 4) },
        mage: { texture: 'glow', tint: 0xb08cff, scale: 0.45, trail: true, duration: [230, 320], arc: [50, 100], hit: (x, y) => { this.burst(x, y, 0xb08cff, 8); this.shockwave(x, y, 0xb08cff, 0.7); } },
        guardian: { texture: 'spark', tint: 0xffe08a, scale: 0.8, duration: [200, 280], arc: [40, 80], hit: (x, y) => { this.burst(x, y, 0xffe08a, 6); this.rise(x, y, 0xffe08a, 3); } },
      };
      return shots[classKey] ?? null;
    }

    /** Um disparo de curtida/comentário: sai do próprio herói (se estiver na tela) com o estilo da classe dele. */
    shoot(classKey, userId, { slow = 1, delay = 0, count = 1 } = {}) {
      const style = this.classShot(classKey);
      const hit = (x, y, fallback) => {
        this.refs.monsters.hit();
        if (style) style.hit(x, y);
        else fallback(x, y);
      };
      for (let i = 0; i < count; i += 1) {
        this.fire({
          from: this.sourcePoint(userId),
          to: this.targetPoint(),
          texture: style?.texture ?? 'spark',
          tint: style?.tint ?? 0x9fe8ff,
          scale: style?.scale ?? 0.55,
          normal: style?.normal,
          rotate: style?.rotate,
          trail: style?.trail,
          duration: R.rand(...(style?.duration ?? [170, 250])) * slow,
          delay: delay + i * 70,
          arc: R.rand(...(style?.arc ?? [30, 80])),
          onHit: (x, y) => hit(x, y, (px, py) => this.burst(px, py, 0x9fe8ff, 5)),
        });
      }
    }

    /** Lote grande de curtidas (o TikTok manda agrupado) vira até 3 disparos escalonados, não 1. */
    fireLike(count = 1, classKey, userId) {
      const now = this.scene.time.now;
      if (now - this.lastLikeAt < 120) return;
      this.lastLikeAt = now;
      this.shoot(classKey, userId, { count: Math.min(3, Math.max(1, Math.ceil(count / 4))) });
      if (Math.random() < 0.25) this.refs.heroes.hop();
    }

    fireComment(classKey, userId) {
      const now = this.scene.time.now;
      if (now - this.lastCommentAt < 220) return;
      this.lastCommentAt = now;
      if (classKey) {
        this.shoot(classKey, userId, { slow: 1.25 });
        return;
      }
      this.fire({
        from: this.sourcePoint(),
        to: this.targetPoint(),
        texture: 'glow',
        tint: 0x8fb8ff,
        scale: 0.3,
        duration: R.rand(230, 330),
        arc: R.rand(50, 100),
        onHit: (x, y) => {
          this.refs.monsters.hit();
          this.burst(x, y, 0x8fb8ff, 7);
        },
      });
    }

    fireShare() {
      const now = this.scene.time.now;
      if (now - this.lastShareAt < 350) return;
      this.lastShareAt = now;
      for (let i = 0; i < 8; i += 1) {
        this.fire({
          from: { x: this.refs.kingdom.muzzle().x + R.rand(-40, 20), y: this.refs.kingdom.muzzle().y + R.rand(-30, 30) },
          to: this.targetPoint(46),
          texture: 'arrow',
          tint: 0xd8ecff,
          scale: 0.9,
          normal: true,
          rotate: true,
          duration: 560,
          delay: i * 55,
          arc: 150,
          ease: 'Sine.In',
          force: true,
          onHit: (x, y) => {
            this.refs.monsters.hit();
            this.burst(x, y, 0xffffff, 4);
          },
        });
      }
      this.refs.heroes.hop();
    }

    /** Feitiços por presente conhecido (pelo nome, em pt/en); presente desconhecido usa o feitiço do tier. */
    spellFor(giftName) {
      if (!giftName) return null;
      return GIFT_SPELLS.find((spell) => spell.match.test(giftName)) ?? null;
    }

    castRose() {
      const t = this.refs.monsters.center();
      this.petals(t.x, t.y - 230, 26);
      this.petals(this.refs.kingdom.x + 60, R.GROUND_Y - 280, 14);
      this.refs.heroes.hop();
    }

    castHeart() {
      const spots = this.refs.heroes.positions(4);
      if (spots.length === 0) spots.push({ x: this.refs.kingdom.x + 60, y: R.GROUND_Y });
      spots.forEach((p) => this.hearts(p.x, p.y - 60, 5));
    }

    castPerfume() {
      const k = this.refs.kingdom;
      this.shockwave(k.x + 20, R.GROUND_Y - 40, 0xd9a8ff, 3);
      this.rise(k.x + 20, R.GROUND_Y - 40, 0xd9a8ff, 30);
      this.refs.heroes.positions(5).forEach((p) => this.rise(p.x, p.y - 20, 0xffc2e8, 6));
    }

    castGG() {
      this.floatText(R.W / 2, R.GROUND_Y - 320, 'GG!', { color: '#ffd166', size: 52, duration: 1400, rise: 80 });
      this.confetti(R.W / 2, R.GROUND_Y - 40, 40);
    }

    castLion() {
      const t = this.refs.monsters.center();
      this.flash(260, 255, 214, 120);
      [0, 140, 290].forEach((delay, i) =>
        this.scene.time.delayedCall(delay, () => {
          this.shockwave(t.x, t.y, i % 2 ? 0xffb04a : 0xffe08a, 3 + i * 1.2);
          this.shake(300, 0.008);
        }),
      );
      this.burst(t.x, t.y, 0xffd166, 40);
      this.floatText(t.x, t.y - 150, 'ROAR!', { color: '#ffd166', size: 44, duration: 1300, rise: 70 });
      this.punchIn(1.05);
      this.refs.monsters.hit();
    }

    /** Chuva de estrelas por toda a tela, em cima do raio+meteoros padrão. */
    castGalaxy() {
      this.castHigh();
      this.flash(400, 150, 90, 255);
      for (let i = 0; i < Math.round(26 * R.fxScale); i += 1) {
        this.fire({
          from: { x: R.rand(0, R.W), y: -40 },
          to: { x: R.rand(0, R.W), y: R.GROUND_Y - R.rand(0, 120) },
          texture: 'spark',
          tint: i % 2 ? 0xc59bff : 0x9fd0ff,
          scale: R.rand(0.6, 1.1),
          duration: R.rand(700, 1100),
          delay: R.rand(0, 700),
          arc: 0,
          force: true,
          onHit: (x, y) => this.burst(x, y, 0xc59bff, 4),
        });
      }
      this.punchIn(1.06, 200);
    }

    /** O feitiço máximo: clarão total, raios extras, hit-stop e zoom. */
    castUniverse() {
      this.castGalaxy();
      this.flash(650, 255, 255, 255);
      [250, 500].forEach((delay) => this.scene.time.delayedCall(delay, () => this.lightning(R.rand(R.W * 0.2, R.W * 0.8), R.GROUND_Y - 20)));
      this.floatText(R.W / 2, R.GROUND_Y - 360, 'UNIVERSO!', { color: '#ffffff', size: 54, duration: 1700, rise: 90 });
      this.hitStop(100);
      this.punchIn(1.09, 220);
    }

    fireGift(requestedTier, giftName) {
      const monsters = this.refs.monsters;
      const now = this.scene.time.now;

      // feitiço do presente (se conhecido); presentes em sequência caem no efeito do tier pra não empilhar
      const spell = this.spellFor(giftName);
      if (spell && now - this.lastSpellAt >= spell.cooldown) {
        this.lastSpellAt = now;
        spell.cast(this);
        if (!spell.alsoTier) return;
      }

      let tier = requestedTier;
      // tempestade de raio+meteoros no máximo a cada 1,2s; gifts altos seguidos viram cometa
      if (tier === R.GIFT_TIERS.high) {
        if (now - this.lastHighAt < 1200) tier = R.GIFT_TIERS.mid;
        else this.lastHighAt = now;
      }
      if (tier === R.GIFT_TIERS.mid) {
        if (now - this.lastMidAt < 150) return;
        this.lastMidAt = now;
      }

      if (tier === R.GIFT_TIERS.low) {
        for (let i = 0; i < 3; i += 1) {
          this.fire({
            from: this.sourcePoint(),
            to: this.targetPoint(30),
            texture: 'glow',
            tint: 0xffd166,
            scale: 0.55,
            duration: 520,
            delay: i * 90,
            arc: 120,
            force: true,
            trail: true,
            onHit: (x, y) => {
              monsters.hit();
              this.burst(x, y, 0xffd166, 12);
            },
          });
        }
        return;
      }

      if (tier === R.GIFT_TIERS.mid) {
        const target = this.targetPoint(14);
        this.fire({
          from: { x: this.refs.kingdom.x + 60, y: -50 },
          to: target,
          texture: 'glow',
          tint: 0xff8a3a,
          scale: 1.0,
          duration: 700,
          arc: -40,
          force: true,
          trail: true,
          onHit: (x, y) => {
            monsters.hit();
            this.burst(x, y, 0xff9a3a, 34);
            this.burst(x, y, 0xffe08a, 16);
            this.shockwave(x, y, 0xffb04a, 1.8);
            this.shake(260, 0.005);
          },
        });
        return;
      }

      this.castHigh();
    }

    /** Raio + chuva de meteoros + flash/shake: o feitiço padrão dos presentes caros. */
    castHigh() {
      // alto: raio + chuva de meteoros + flash/shake
      const monsters = this.refs.monsters;
      const target = monsters.center();
      this.lightning(target.x, target.y);
      for (let i = 0; i < 6; i += 1) {
        const to = { x: target.x + R.rand(-110, 110), y: R.GROUND_Y - R.rand(0, 40) };
        this.fire({
          from: { x: to.x + R.rand(120, 320), y: -60 },
          to,
          texture: 'glow',
          tint: i % 2 ? 0xffd166 : 0xff7a3a,
          scale: 1.1,
          duration: 520,
          delay: 160 + i * 120,
          arc: -30,
          force: true,
          trail: true,
          onHit: (x, y) => {
            monsters.hit();
            this.burst(x, y, 0xffd166, 22);
            this.shockwave(x, y, 0xffb04a, 1.4);
          },
        });
      }
      this.scene.time.delayedCall(900, () => {
        this.shockwave(target.x, target.y, 0xffe08a, 4);
        this.flash(380, 255, 214, 120);
        this.shake(520, 0.012);
        this.floatText(target.x, target.y - 140, 'CRÍTICO!', { color: '#ffd166', size: 38, duration: 1300 });
        this.punchIn(1.04);
      });
    }

    lightning(x, y) {
      const g = this.scene.add.graphics().setBlendMode('ADD');
      this.addTop(g);
      const startX = x + R.rand(-60, 60);
      const points = [{ x: startX, y: -20 }];
      const segments = 11;
      for (let i = 1; i < segments; i += 1) {
        const t = i / segments;
        points.push({ x: startX + (x - startX) * t + R.rand(-30, 30) * (1 - t * 0.4), y: -20 + (y + 20) * t });
      }
      points.push({ x, y });
      const draw = (width, color, alpha) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) g.lineTo(points[i].x, points[i].y);
        g.strokePath();
      };
      draw(16, 0x6ab0ff, 0.25);
      draw(7, 0x9fd0ff, 0.6);
      draw(2.5, 0xffffff, 1);
      this.scene.tweens.add({ targets: g, alpha: 0, duration: 420, ease: 'Cubic.In', onComplete: () => g.destroy() });
      this.burst(x, y, 0xbfe0ff, 26);
    }

    healBurst(x, y) {
      this.rise(x, y, 0x7cfc9a, 14);
    }

    // ---------------------------------------------------------------- narrativa

    waveCleared() {
      this.confetti(R.W * 0.32, R.GROUND_Y - 40, 26);
      this.confetti(R.W * 0.68, R.GROUND_Y - 40, 26);
    }

    bossSpawned() {
      this.shake(700, 0.01);
      this.flash(500, 120, 10, 20);
    }

    bossDefeated() {
      const c = this.refs.monsters.center();
      this.shockwave(c.x, c.y, 0xffd166, 5);
      this.burst(c.x, c.y, 0xffd166, 70);
      this.confetti(R.W / 2, R.GROUND_Y - 20, 60);
      this.shake(620, 0.012);
    }

    monsterDied(x, y, isBoss) {
      this.burst(x, y, isBoss ? 0xff7a3a : 0xffffff, isBoss ? 60 : 24);
      this.shockwave(x, y, isBoss ? 0xff9a3a : 0xffffff, isBoss ? 3 : 1.5);
      if (!isBoss) this.shake(140, 0.003);
    }

    kingdomFall() {
      const k = this.refs.kingdom;
      this.flash(500, 255, 30, 30);
      this.shake(900, 0.014);
      for (let i = 0; i < 6; i += 1) {
        this.scene.time.delayedCall(i * 140, () => this.smoke(k.x + R.rand(-140, 140), R.GROUND_Y - R.rand(10, 140), 10));
      }
    }

    eraUp(x, y) {
      this.rise(x, y, 0xffd166, 40);
      this.shockwave(x, y, 0xffd166, 5);
      this.confetti(x, y, 40);
      this.flash(420, 255, 230, 160);
    }

    // ---------------------------------------------------------------- texto flutuante

    /**
     * Textos flutuantes ficam no mundo, atrás do HUD: se a trajetória cruzar um painel
     * (ex.: "ROAR!" sobre o ranking à direita), empurra pra esquerda do painel, ou pra baixo dele se não couber.
     */
    avoidHud(x, y, w, h, rise) {
      let px = x;
      let py = y;
      const pad = 14;
      for (const r of this.obstacles ? this.obstacles() : []) {
        const left = px - w / 2;
        const right = px + w / 2;
        const top = py - rise - h / 2;
        const bottom = py + h / 2;
        if (right < r.x - pad || left > r.x + r.w + pad || bottom < r.y - pad || top > r.y + r.h + pad) continue;
        const leftX = r.x - pad - w / 2;
        if (leftX >= w / 2 + 8) px = leftX;
        else py = r.y + r.h + pad + h / 2 + rise;
      }
      return { x: px, y: py };
    }

    floatText(x, y, text, o = {}) {
      const t = this.scene.add
        .text(x, y, text, {
          fontFamily: R.FONT,
          fontSize: `${Math.round((o.size ?? 22) * R.UI)}px`,
          resolution: R.TEXT_RES,
          fontStyle: 'bold',
          color: o.color ?? '#ffffff',
          stroke: '#10131f',
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setScale(0.4);
      const rise = o.rise ?? 60;
      const spot = this.avoidHud(x, y, t.width, t.height, rise);
      t.setPosition(spot.x, spot.y);
      this.addTop(t);
      this.scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.Out' });
      this.scene.tweens.add({
        targets: t,
        y: spot.y - rise,
        alpha: 0,
        delay: (o.duration ?? 900) * 0.35,
        duration: (o.duration ?? 900) * 0.65,
        ease: 'Cubic.In',
        onComplete: () => t.destroy(),
      });
    }

    damageNumber(x, y, value) {
      const big = value >= 500;
      const mid = value >= 60;
      this.floatText(x + R.rand(-26, 26), y + R.rand(-30, 10), `-${Math.round(value).toLocaleString('pt-BR')}`, {
        color: big ? '#ffd166' : mid ? '#ff9a7a' : '#ffe9e9',
        size: big ? 34 : mid ? 26 : 20,
        duration: 850,
        rise: big ? 90 : 56,
      });
    }
  }

  R.Fx = Fx;
})(window.Reino);

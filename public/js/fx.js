// Efeitos: projéteis do castelo até o monstro (um tipo por evento), feitiços de
// gift por tier, partículas, ondas de choque, raios, números de dano e shake.
// Tudo reaproveita objetos/emissores (sem alocação por frame) e respeita
// R.fxScale (?lowfx=1) pra rodar leve 24/7.
(function fx(R) {
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
    }

    /** Efeitos ficam acima de tudo (heróis usam depth = y, ~600). */
    addTop(obj) {
      this.layer.add(obj);
      obj.setDepth(1000);
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

    sourcePoint() {
      const m = this.refs.kingdom.muzzle();
      return { x: m.x + R.rand(-30, 30), y: m.y + R.rand(-40, 20) };
    }

    // ---------------------------------------------------------------- eventos de viewer

    fireLike() {
      const now = this.scene.time.now;
      if (now - this.lastLikeAt < 120) return;
      this.lastLikeAt = now;
      this.fire({
        from: this.sourcePoint(),
        to: this.targetPoint(),
        texture: 'spark',
        tint: 0x9fe8ff,
        scale: 0.55,
        duration: R.rand(300, 420),
        arc: R.rand(40, 110),
        onHit: (x, y) => {
          this.refs.monsters.hit();
          this.burst(x, y, 0x9fe8ff, 5);
        },
      });
      if (Math.random() < 0.25) this.refs.heroes.hop();
    }

    fireComment() {
      const now = this.scene.time.now;
      if (now - this.lastCommentAt < 220) return;
      this.lastCommentAt = now;
      this.fire({
        from: this.sourcePoint(),
        to: this.targetPoint(),
        texture: 'glow',
        tint: 0x8fb8ff,
        scale: 0.3,
        duration: R.rand(380, 520),
        arc: R.rand(70, 140),
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

    fireGift(requestedTier) {
      const monsters = this.refs.monsters;
      const now = this.scene.time.now;
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

      // alto: raio + chuva de meteoros + flash/shake
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

    floatText(x, y, text, o = {}) {
      const t = this.scene.add
        .text(x, y, text, {
          fontFamily: R.FONT,
          fontSize: `${o.size ?? 22}px`,
          fontStyle: 'bold',
          color: o.color ?? '#ffffff',
          stroke: '#10131f',
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setScale(0.4);
      this.addTop(t);
      this.scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.Out' });
      this.scene.tweens.add({
        targets: t,
        y: y - (o.rise ?? 60),
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

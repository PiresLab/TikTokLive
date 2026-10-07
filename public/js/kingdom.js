// O Reino: castelo/base desenhado por Era (acampamento → capital), com
// bandeiras ao vento, tochas e fogueira tremeluzindo. Reage a HP baixo
// (pisca vermelho), à queda (desaba) e à reconstrução.
(function kingdom(R) {
  const FLAG_COLORS = [0xd6334e, 0x4f8cff, 0xffd166];

  class Kingdom {
    constructor(scene, layer, x) {
      this.scene = scene;
      this.layer = layer;
      this.x = x;
      this.groundY = R.GROUND_Y + 2;
      this.tier = -1;
      this.sprite = null;
      this.decor = [];
      this.hpRatio = 1;
      this.crumbling = false;
      this.tinted = false;
      /** callback(tier) quando a Era sobe com animação (main dispara efeitos) */
      this.onEraUp = null;
    }

    /** Ponto de onde saem os projéteis (lado voltado pro monstro). */
    muzzle() {
      return { x: this.x + 120, y: this.groundY - 150 };
    }

    center() {
      return { x: this.x, y: this.groundY - 130 };
    }

    setHpRatio(ratio) {
      this.hpRatio = ratio;
    }

    setEra(tier, animate) {
      const next = Math.max(0, Math.min(R.CASTLE_ANCHORS.length - 1, tier));
      if (next === this.tier) return;
      const previous = this.sprite;
      const hadPrevious = this.tier >= 0;
      this.tier = next;

      this.clearDecor();
      const textureKey = `castle_tier${next}`;
      const sprite = this.scene.add.image(this.x, this.groundY, textureKey).setOrigin(0.5, 1);
      sprite.baseScale = R.baseScale(this.scene, textureKey); // arte de maior resolução é exibida no tamanho lógico
      sprite.setScale(sprite.baseScale);
      this.layer.add(sprite);
      this.sprite = sprite;
      this.buildDecor(next);

      if (previous) {
        this.scene.tweens.add({ targets: previous, alpha: 0, duration: 700, onComplete: () => previous.destroy() });
      }
      if (animate && hadPrevious) {
        sprite.setAlpha(0).setScale(0.9 * sprite.baseScale);
        sprite.y += 14;
        this.scene.tweens.add({
          targets: sprite,
          alpha: 1,
          scale: sprite.baseScale,
          y: this.groundY,
          duration: 900,
          ease: 'Back.Out',
        });
        // bandeiras/tochas já têm tween próprio de alpha/escala: só escondo e mostro
        this.decor.forEach((d) => d.setVisible(false));
        this.scene.time.delayedCall(600, () => this.decor.forEach((d) => d.setVisible(true)));
        if (this.onEraUp) this.onEraUp(next);
      }
    }

    clearDecor() {
      this.decor.forEach((d) => {
        this.scene.tweens.killTweensOf(d);
        d.destroy();
      });
      this.decor = [];
    }

    /** Converte coordenada da textura (440x420, base em y=416) pra mundo. */
    toWorld(point) {
      return { x: this.x - 220 + point.x, y: this.groundY - R.CASTLE_H + point.y };
    }

    buildDecor(tier) {
      const anchors = R.CASTLE_ANCHORS[tier];
      const scene = this.scene;

      anchors.flags.forEach((anchor, i) => {
        const p = this.toWorld(anchor);
        const flag = scene.add.image(p.x + 1, p.y + 1, 'flag').setOrigin(0, 0.1).setTint(FLAG_COLORS[(i + tier) % FLAG_COLORS.length]);
        this.layer.add(flag);
        this.decor.push(flag);
        scene.tweens.add({
          targets: flag,
          scaleX: { from: 0.8, to: 1.12 },
          angle: { from: -3, to: 4 },
          duration: R.rand(420, 760),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
          delay: R.rand(0, 400),
        });
      });

      const lights = [...anchors.torches];
      if (anchors.fire) lights.push(anchors.fire);
      lights.forEach((anchor, i) => {
        const p = this.toWorld(anchor);
        const isFire = anchors.fire && anchor === anchors.fire;
        const glow = scene.add
          .image(p.x, p.y, 'glow')
          .setTint(0xffa23a)
          .setBlendMode('ADD')
          .setScale(isFire ? 1.3 : 0.7)
          .setAlpha(0.8);
        const flame = scene.add
          .image(p.x, p.y - 2, 'spark')
          .setTint(0xffe9a0)
          .setBlendMode('ADD')
          .setScale(isFire ? 1.1 : 0.55);
        glow.baseAlpha = 0.8;
        flame.baseAlpha = 1;
        this.layer.add([glow, flame]);
        this.decor.push(glow, flame);
        scene.tweens.add({
          targets: glow,
          alpha: { from: 0.55, to: 0.95 },
          scale: { from: glow.scale * 0.85, to: glow.scale * 1.08 },
          duration: R.rand(110, 230),
          yoyo: true,
          repeat: -1,
          delay: i * 40,
        });
        scene.tweens.add({
          targets: flame,
          scaleY: { from: flame.scaleY * 0.8, to: flame.scaleY * 1.25 },
          duration: R.rand(90, 170),
          yoyo: true,
          repeat: -1,
        });
      });
    }

    /** Monstro "bate" na muralha: balançadinha. */
    shake(strength = 3) {
      if (!this.sprite || this.crumbling) return;
      this.scene.tweens.add({
        targets: this.sprite,
        x: { from: this.x - strength, to: this.x + strength },
        duration: 45,
        yoyo: true,
        repeat: 3,
        onComplete: () => {
          if (this.sprite) this.sprite.x = this.x;
        },
      });
    }

    crumble() {
      if (!this.sprite || this.crumbling) return;
      this.crumbling = true;
      this.sprite.setTint(0x55556a);
      this.scene.tweens.add({
        targets: this.sprite,
        x: { from: this.x - 6, to: this.x + 6 },
        duration: 55,
        yoyo: true,
        repeat: 14,
      });
      this.scene.tweens.add({ targets: this.sprite, y: this.groundY + 16, scaleY: 0.92 * this.sprite.baseScale, duration: 900, delay: 300, ease: 'Quad.In' });
      this.decor.forEach((d) => d.setVisible(false));
    }

    rebuild() {
      if (!this.sprite) return;
      this.crumbling = false;
      this.tinted = false;
      this.sprite.clearTint().setX(this.x);
      this.scene.tweens.add({ targets: this.sprite, y: this.groundY, scaleY: this.sprite.baseScale, duration: 900, ease: 'Back.Out' });
      this.decor.forEach((d) => d.setVisible(true));
    }

    update(time) {
      if (!this.sprite || this.crumbling) return;
      if (this.hpRatio < 0.25) {
        const pulse = (Math.sin(time / 170) + 1) / 2;
        this.sprite.setTint(R.lerpColor(0xffffff, 0xff6a6a, 0.25 + pulse * 0.55));
        this.tinted = true;
      } else if (this.tinted) {
        this.sprite.clearTint();
        this.tinted = false;
      }
    }
  }

  R.Kingdom = Kingdom;
})(window.Reino);

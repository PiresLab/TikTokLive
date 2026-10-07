// Cenário: céu em gradiente (muda por Era / chefão / nova season), estrelas,
// lua, montanhas em parallax e chão.
(function background(R) {
  const SKY_H = R.GROUND_Y + 24;
  const GRADIENT_H = R.GROUND_Y - 145;

  class Parallax {
    constructor(scene, layer, key, y, speed) {
      this.speed = speed;
      this.images = [0, 1].map((i) => scene.add.image(i * R.W, y, key).setOrigin(0, 0));
      layer.add(this.images);
      this.offset = 0;
    }

    setTint(color) {
      this.images.forEach((img) => img.setTint(color));
    }

    update(dt) {
      if (R.lowfx) return;
      this.offset = (this.offset + this.speed * dt) % R.W;
      this.images[0].x = -this.offset;
      this.images[1].x = R.W - this.offset;
    }
  }

  class Background {
    constructor(scene, layer) {
      this.scene = scene;
      this.fromEra = 0;
      this.toEra = 0;
      this.eraT = 1;
      this.bossT = 0;
      this.bossTarget = 0;
      this.bossTween = null;
      this.eraTween = null;
      this.sunT = 0;
      this.dirty = true;

      // O gradiente corre só pela parte visível do céu (acima das montanhas, ~y<440)
      // — senão o brilho do horizonte fica escondido atrás delas e as Eras parecem iguais.
      this.sky = scene.add.image(0, 0, 'px').setOrigin(0, 0).setDisplaySize(R.W, GRADIENT_H);
      this.skyFill = scene.add.image(0, GRADIENT_H - 1, 'px').setOrigin(0, 0).setDisplaySize(R.W, SKY_H - GRADIENT_H + 1);
      layer.add([this.sky, this.skyFill]);

      const skyStarsH = R.GROUND_Y - 245; // estrelas só no céu acima das montanhas
      const starCount = Math.round(70 * R.fxScale * (skyStarsH / 330));
      for (let i = 0; i < starCount; i += 1) {
        const star = scene.add
          .image(R.rand(0, R.W), R.rand(0, skyStarsH), 'star')
          .setScale(R.rand(0.6, 1.5))
          .setAlpha(R.rand(0.25, 0.9));
        layer.add(star);
        scene.tweens.add({
          targets: star,
          alpha: { from: star.alpha, to: R.rand(0.05, 0.3) },
          duration: R.rand(900, 2800),
          yoyo: true,
          repeat: -1,
          delay: R.rand(0, 2000),
        });
      }

      // lua: canto superior direito no horizontal; no vertical desce pro horizonte (o topo é HUD/interface do TikTok)
      const mx = R.vertical ? R.W - 130 : 1010;
      const my = R.vertical ? R.GROUND_Y - 380 : 118;
      this.moonGlow = scene.add.image(mx, my, 'glow').setScale(2.6).setTint(0xcfd8ff).setAlpha(0.35).setBlendMode('ADD');
      this.moon = scene.add.circle(mx, my, 32, 0xf4f1d6);
      this.craters = [
        scene.add.circle(mx - 12, my - 8, 7, 0xd9d4b0, 0.55),
        scene.add.circle(mx + 12, my + 10, 5, 0xd9d4b0, 0.5),
        scene.add.circle(mx + 8, my - 14, 3.5, 0xd9d4b0, 0.5),
      ];
      layer.add([this.moonGlow, this.moon, ...this.craters]);

      this.far = new Parallax(scene, layer, 'mountain_far', R.GROUND_Y - 230, 3);
      this.near = new Parallax(scene, layer, 'mountain_near', R.GROUND_Y - 190, 8);

      this.ground = scene.add.image(0, R.GROUND_Y - 6, 'ground').setOrigin(0, 0);
      layer.add(this.ground);

      // vinheta vermelha do chefão
      this.vignette = scene.add.image(0, 0, 'vignette').setOrigin(0, 0).setDisplaySize(R.W, R.H).setTint(0xff1a3a).setAlpha(0);
      layer.add(this.vignette);

      this.applyColors();
    }

    /** Troca de Era: transição suave (ou instantânea na primeira carga). */
    setEra(tier, instant = false) {
      const next = Math.max(0, Math.min(R.ERAS.length - 1, tier));
      // main chama a cada estado (várias vezes por segundo): só reage a troca real
      if (next === this.toEra) return;
      this.fromEra = this.eraT >= 1 ? this.toEra : this.currentBlendEra();
      this.toEra = next;
      this.eraT = instant ? 1 : 0;
      this.dirty = true;
      if (this.eraTween) this.eraTween.stop();
      if (!instant) {
        this.eraTween = this.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: 1800,
          onUpdate: (tween) => {
            this.eraT = tween.getValue();
            this.dirty = true;
          },
        });
      }
    }

    currentBlendEra() {
      return this.eraT > 0.5 ? this.toEra : this.fromEra;
    }

    setBoss(on) {
      const target = on ? 1 : 0;
      if (this.bossTarget === target) return;
      this.bossTarget = target;
      if (this.bossTween) this.bossTween.stop();
      this.bossTween = this.scene.tweens.addCounter({
        from: this.bossT,
        to: target,
        duration: 1200,
        onUpdate: (tween) => {
          this.bossT = tween.getValue();
          this.dirty = true;
        },
      });
    }

    /** Nova season: o céu "acende" e volta (nascer do sol). */
    sunrise() {
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 2600,
        yoyo: true,
        ease: 'Sine.InOut',
        onUpdate: (tween) => {
          this.sunT = tween.getValue();
          this.dirty = true;
        },
      });
    }

    applyColors() {
      const a = R.ERAS[this.fromEra];
      const b = R.ERAS[this.toEra];
      const mix = (key) => R.lerpColor(a[key], b[key], this.eraT);
      const dark = (c) => R.lerpColor(c, 0x120508, this.bossT * 0.75);

      let top = R.lerpColor(mix('skyTop'), R.SKY_BOSS.top, this.bossT);
      let bottom = R.lerpColor(mix('skyBottom'), R.SKY_BOSS.bottom, this.bossT);
      top = R.lerpColor(top, 0x8a5aa8, this.sunT * 0.55);
      bottom = R.lerpColor(bottom, 0xffc27a, this.sunT * 0.75);

      this.sky.setTint(top, top, bottom, bottom);
      this.skyFill.setTint(bottom);
      this.far.setTint(dark(R.lerpColor(mix('far'), bottom, this.sunT * 0.3)));
      this.near.setTint(dark(mix('near')));
      this.ground.setTint(dark(mix('ground')));
      this.vignette.setAlpha(this.bossT * 0.55);
      this.moonGlow.setAlpha(0.35 * (1 - this.sunT * 0.8));
      this.dirty = false;
    }

    update(delta) {
      const dt = delta / 1000;
      this.far.update(dt);
      this.near.update(dt);
      if (this.dirty) this.applyColors();
    }
  }

  R.Background = Background;
})(window.Reino);

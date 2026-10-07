// Cenário: céu em gradiente (muda por Era / hora do dia / clima / chefão / Lua de Sangue /
// nova season), estrelas, sol e lua em arco, montanhas em parallax, adereços por Era e chão.
(function background(R) {
  const SKY_H = R.GROUND_Y + 24;
  const GRADIENT_H = R.GROUND_Y - 145;
  /** Linha do horizonte do sol/lua (atrás das montanhas) e altura do arco. */
  const HORIZON_Y = R.GROUND_Y - 215;
  const ARC_H = R.vertical ? 560 : 330;

  const NIGHT_TOP = 0x04081c;
  const NIGHT_BOTTOM = 0x141c48;
  const NIGHT_TINT = 0x0a1030;
  const BLOOD_TOP = 0x2a0508;
  const BLOOD_BOTTOM = 0x8a1c2c;

  /** Quanto cada clima apaga o céu (0..1) e a cor cinza que ele puxa. */
  const WEATHER_DIM = { clear: 0, rain: 0.3, storm: 0.55, snow: 0.15, fog: 0.25 };
  const WEATHER_GRAY = { clear: 0x6a7488, rain: 0x4a5368, storm: 0x2e3446, snow: 0x9aa6bd, fog: 0x9ba3b3 };

  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  class Parallax {
    constructor(scene, layer, key, y, speed) {
      this.speed = speed;
      // telhas de R.TILE_W: cobrem qualquer largura de tela (horizontal ou vertical) + 1 pra emenda do scroll
      const count = Math.ceil(R.W / R.TILE_W) + 1;
      this.images = Array.from({ length: count }, (_, i) => R.place(scene.add.image(i * R.TILE_W, y, key).setOrigin(0, 0), key));
      layer.add(this.images);
      this.offset = 0;
    }

    setTint(color) {
      this.images.forEach((img) => img.setTint(color));
    }

    update(dt) {
      if (R.lowfx) return;
      this.offset = (this.offset + this.speed * dt) % R.TILE_W;
      this.images.forEach((img, i) => {
        img.x = i * R.TILE_W - this.offset;
      });
    }
  }

  class Background {
    constructor(scene, layer) {
      this.scene = scene;
      this.layer = layer;
      this.fromEra = 0;
      this.toEra = 0;
      this.eraT = 1;
      this.bossT = 0;
      this.bossTarget = 0;
      this.bossTween = null;
      this.bloodT = 0;
      this.bloodTarget = 0;
      this.bloodTween = null;
      this.eraTween = null;
      this.sunT = 0;
      this.sunHeight = 1; // meio-dia até o servidor mandar a hora
      this.timeOfDay = 0.25;
      this.weather = 'clear';
      this.dirty = true;

      // O gradiente corre só pela parte visível do céu (acima das montanhas, ~y<440)
      // — senão o brilho do horizonte fica escondido atrás delas e as Eras parecem iguais.
      this.sky = scene.add.image(0, 0, 'px').setOrigin(0, 0).setDisplaySize(R.W, GRADIENT_H);
      this.skyFill = scene.add.image(0, GRADIENT_H - 1, 'px').setOrigin(0, 0).setDisplaySize(R.W, SKY_H - GRADIENT_H + 1);
      layer.add([this.sky, this.skyFill]);

      // estrelas num container só: o brilho do conjunto (noite/dia/clima) é o alpha do container
      this.stars = scene.add.container(0, 0);
      layer.add(this.stars);
      const skyStarsH = R.GROUND_Y - 245; // estrelas só no céu acima das montanhas
      const starCount = Math.round(70 * R.fxScale * (skyStarsH / 330));
      for (let i = 0; i < starCount; i += 1) {
        const star = scene.add
          .image(R.rand(0, R.W), R.rand(0, skyStarsH), 'star')
          .setScale(R.rand(0.6, 1.5))
          .setAlpha(R.rand(0.25, 0.9));
        this.stars.add(star);
        scene.tweens.add({
          targets: star,
          alpha: { from: star.alpha, to: R.rand(0.05, 0.3) },
          duration: R.rand(900, 2800),
          yoyo: true,
          repeat: -1,
          delay: R.rand(0, 2000),
        });
      }

      // sol e lua andam em arco pelo céu conforme a hora do dia (posição em updateCelestials)
      this.sunGlow = scene.add.image(0, 0, 'glow').setScale(3.6).setTint(0xffe9a0).setAlpha(0.5).setBlendMode('ADD');
      this.sun = scene.add.circle(0, 0, 38, 0xfff1b0);
      this.moonGlow = scene.add.image(0, 0, 'glow').setScale(2.6).setTint(0xcfd8ff).setAlpha(0.35).setBlendMode('ADD');
      this.moon = scene.add.circle(0, 0, 32, 0xf4f1d6);
      this.craters = [
        { shape: scene.add.circle(0, 0, 7, 0xd9d4b0, 0.55), dx: -12, dy: -8 },
        { shape: scene.add.circle(0, 0, 5, 0xd9d4b0, 0.5), dx: 12, dy: 10 },
        { shape: scene.add.circle(0, 0, 3.5, 0xd9d4b0, 0.5), dx: 8, dy: -14 },
      ];
      layer.add([this.sunGlow, this.sun, this.moonGlow, this.moon, ...this.craters.map((c) => c.shape)]);

      this.far = new Parallax(scene, layer, 'mountain_far', R.GROUND_Y - 230, 3);
      this.near = new Parallax(scene, layer, 'mountain_near', R.GROUND_Y - 190, 8);

      // chão estático: telhas lado a lado (a arte do chão pode ser mais larga/estreita que a tela)
      this.groundTiles = Array.from({ length: Math.ceil(R.W / R.TILE_W) }, (_, i) =>
        R.place(scene.add.image(i * R.TILE_W, R.GROUND_Y - 6, 'ground').setOrigin(0, 0), 'ground'),
      );
      layer.add(this.groundTiles);

      // vertical: abaixo da telha do chão a terra continua escurecendo até o fim da tela.
      // O tom de partida vem do próprio pixel de baixo da textura (serve pra arte procedural e pra arte nova).
      const fillTop = R.GROUND_Y - 6 + R.GROUND_TILE_H - 1;
      this.groundFill = null;
      if (fillTop < R.H) {
        this.groundFill = scene.add.image(0, fillTop, 'px').setOrigin(0, 0).setDisplaySize(R.W, R.H - fillTop);
        layer.add(this.groundFill);
        const frame = scene.textures.getFrame('ground');
        const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => scene.textures.getPixel(Math.floor(u * (frame.width - 1)), frame.height - 1, 'ground'));
        this.groundFillLum = samples.reduce((sum, c) => sum + (c ? (c.red + c.green + c.blue) / 765 : 0.5), 0) / samples.length;
      }

      // adereços do bioma da Era (árvores/arbustos): container criado aqui pra ficar entre o chão e os sprites
      this.propsLayer = scene.add.container(0, 0);
      layer.add(this.propsLayer);
      this.props = [];
      this.propsEra = -1;

      // vinheta vermelha do chefão / Lua de Sangue
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
      this.buildProps(next);
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

    /** Hora do dia, clima e Lua de Sangue vindos do servidor (a cada estado, ~1/s). */
    setWorld(world) {
      if (!world) return;
      const changed = world.sunHeight !== this.sunHeight || world.weather !== this.weather;
      this.sunHeight = world.sunHeight;
      this.timeOfDay = world.timeOfDay;
      this.weather = world.weather;

      const blood = world.event?.kind === 'bloodMoon' ? 1 : 0;
      if (blood !== this.bloodTarget) {
        this.bloodTarget = blood;
        if (this.bloodTween) this.bloodTween.stop();
        this.bloodTween = this.scene.tweens.addCounter({
          from: this.bloodT,
          to: blood,
          duration: 2000,
          onUpdate: (tween) => {
            this.bloodT = tween.getValue();
            this.dirty = true;
          },
        });
      }
      if (changed) this.dirty = true;
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

    /** Árvores/arbustos do bioma da Era, em duas faixas de profundidade (atrás do castelo e dos heróis). */
    buildProps(era) {
      if (this.propsEra === era) return;
      this.propsEra = era;
      this.propsLayer.removeAll(true);
      this.props = [];

      const biome = R.BIOMES[era];
      if (!biome) return;
      const count = Math.round(biome.count * R.fxScale * (R.W / 1280));
      for (let i = 0; i < count; i += 1) {
        const key = biome.kinds[i % biome.kinds.length];
        const back = i % 2 === 0;
        const x = ((i + 0.5) / count) * R.W + R.rand(-30, 30);
        const scale = (back ? 0.55 : 0.85) * R.rand(0.85, 1.15);
        const prop = this.scene.add.image(x, R.GROUND_Y + (back ? -2 : 8), key).setOrigin(0.5, 1).setScale(scale).setAlpha(0.95);
        this.propsLayer.add(prop);
        this.props.push(prop);
      }
      this.dirty = true;
    }

    /** Sol e lua em arco: x anda da esquerda pra direita pela metade do dia em que estão acima do horizonte. */
    updateCelestials() {
      const t = this.timeOfDay;
      const arc = (frac) => ({ x: R.W * (0.08 + 0.84 * frac), y: HORIZON_Y - ARC_H * Math.sin(Math.PI * frac) });

      const sunFrac = t < 0.5 ? t / 0.5 : null;
      const moonFrac = t >= 0.5 ? (t - 0.5) / 0.5 : null;

      const showSun = sunFrac !== null;
      this.sun.setVisible(showSun);
      this.sunGlow.setVisible(showSun);
      if (showSun) {
        const p = arc(sunFrac);
        const warm = 1 - smoothstep(0, 0.35, Math.sin(Math.PI * sunFrac)); // perto do horizonte fica laranja
        const color = R.lerpColor(0xfff1b0, 0xff8a3a, warm);
        this.sun.setPosition(p.x, p.y).setFillStyle(color);
        this.sunGlow.setPosition(p.x, p.y).setTint(color);
      }

      // Lua de Sangue: a lua vermelha e grande aparece mesmo de dia
      const blood = this.bloodT;
      const showMoon = moonFrac !== null || blood > 0.02;
      this.moon.setVisible(showMoon);
      this.moonGlow.setVisible(showMoon);
      this.craters.forEach((c) => c.shape.setVisible(showMoon));
      if (showMoon) {
        const p = moonFrac !== null ? arc(moonFrac) : arc(0.72);
        const big = 1 + blood * 0.35;
        const moonColor = R.lerpColor(0xf4f1d6, 0xd93a3a, blood);
        this.moon.setPosition(p.x, p.y).setFillStyle(moonColor).setScale(big);
        this.moonGlow.setPosition(p.x, p.y).setTint(R.lerpColor(0xcfd8ff, 0xff2a2a, blood)).setScale(2.6 * big);
        this.craters.forEach((c) => c.shape.setPosition(p.x + c.dx * big, p.y + c.dy * big).setScale(big));
        const baseAlpha = moonFrac !== null ? 1 : blood;
        this.moon.setAlpha(baseAlpha);
        this.craters.forEach((c) => c.shape.setAlpha(baseAlpha * 0.5));
        this.moonGlow.setAlpha((0.35 + blood * 0.3) * baseAlpha * (1 - this.sunT * 0.8));
      }
    }

    applyColors() {
      const a = R.ERAS[this.fromEra];
      const b = R.ERAS[this.toEra];
      const mix = (key) => R.lerpColor(a[key], b[key], this.eraT);

      // luz do dia (0 noite .. 1 dia), brilho do horizonte (nascer/pôr do sol) e quanto o clima apaga
      const h = this.sunHeight;
      const light = smoothstep(-0.18, 0.35, h);
      const glow = Math.exp(-((h / 0.2) ** 2));
      const dim = WEATHER_DIM[this.weather] ?? 0;
      const gray = WEATHER_GRAY[this.weather] ?? WEATHER_GRAY.clear;
      const nightShade = (1 - light) * 0.6;

      const dark = (c) => R.lerpColor(R.lerpColor(c, 0x120508, this.bossT * 0.75), NIGHT_TINT, nightShade);

      let top = R.lerpColor(NIGHT_TOP, mix('skyTop'), light);
      let bottom = R.lerpColor(NIGHT_BOTTOM, mix('skyBottom'), light);
      top = R.lerpColor(top, 0x7a4a8a, glow * 0.25);
      bottom = R.lerpColor(bottom, 0xff9a5a, glow * 0.5);
      top = R.lerpColor(top, gray, dim * 0.75);
      bottom = R.lerpColor(bottom, gray, dim * 0.65);

      top = R.lerpColor(top, R.SKY_BOSS.top, this.bossT);
      bottom = R.lerpColor(bottom, R.SKY_BOSS.bottom, this.bossT);
      top = R.lerpColor(top, BLOOD_TOP, this.bloodT);
      bottom = R.lerpColor(bottom, BLOOD_BOTTOM, this.bloodT);
      top = R.lerpColor(top, 0x8a5aa8, this.sunT * 0.55);
      bottom = R.lerpColor(bottom, 0xffc27a, this.sunT * 0.75);

      this.sky.setTint(top, top, bottom, bottom);
      this.skyFill.setTint(bottom);
      const dimmed = (c) => R.lerpColor(dark(c), gray, dim * 0.25);
      this.far.setTint(dimmed(R.lerpColor(mix('far'), bottom, this.sunT * 0.3)));
      this.near.setTint(dimmed(mix('near')));
      const groundColor = dimmed(mix('ground'));
      this.groundTiles.forEach((tile) => tile.setTint(groundColor));
      if (this.groundFill) {
        const topColor = R.lerpColor(groundColor, 0x000000, 1 - this.groundFillLum);
        const bottomColor = R.lerpColor(groundColor, 0x000000, 1 - this.groundFillLum * 0.5);
        this.groundFill.setTint(topColor, topColor, bottomColor, bottomColor);
      }
      const propColor = dimmed(R.lerpColor(mix('near'), mix('ground'), 0.5));
      this.props.forEach((p) => p.setTint(propColor));

      this.vignette.setAlpha(Math.max(this.bossT * 0.55, this.bloodT * 0.6));
      this.stars.setAlpha(Math.max(0, Math.min(1, (1 - light) * 1.3)) * (1 - dim * 0.8) * (1 - this.sunT * 0.7));
      this.updateCelestials();
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

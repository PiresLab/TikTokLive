// Clima: chuva, tempestade (chuva forte + raios + trovão), neve e névoa. O servidor decide
// o clima (state.world.weather); aqui só desenhamos, com orçamento reduzido em ?lowfx=1.
(function weather(R) {
  const FALL_Y = R.GROUND_Y + 70; // partículas morrem logo abaixo da linha do chão

  class Weather {
    constructor(scene, layer, fx) {
      this.scene = scene;
      this.fx = fx;
      this.kind = 'clear';
      this.nextBolt = 0;

      const rainSpeed = 1250;
      const rainLife = (FALL_Y / rainSpeed) * 1000;
      const common = { emitting: false, x: { min: -120, max: R.W + 120 }, y: -40 };
      this.rain = this.make(layer, 'drop', {
        ...common,
        lifespan: rainLife,
        speedY: { min: rainSpeed - 150, max: rainSpeed + 150 },
        speedX: { min: -190, max: -150 },
        rotate: 8,
        alpha: { start: 0.55, end: 0.25 },
        scale: { min: 0.8, max: 1.2 },
        tint: 0xbfd4ff,
        frequency: 16,
        quantity: Math.round(5 * R.fxScale),
      });
      this.storm = this.make(layer, 'drop', {
        ...common,
        lifespan: rainLife,
        speedY: { min: rainSpeed, max: rainSpeed + 350 },
        speedX: { min: -330, max: -260 },
        rotate: 14,
        alpha: { start: 0.65, end: 0.3 },
        scale: { min: 0.9, max: 1.4 },
        tint: 0xa9c0f0,
        frequency: 16,
        quantity: Math.round(9 * R.fxScale),
      });
      this.snow = this.make(layer, 'flake', {
        ...common,
        lifespan: (FALL_Y / 90) * 1000,
        speedY: { min: 60, max: 120 },
        speedX: { min: -35, max: 35 },
        alpha: { start: 0.9, end: 0.5 },
        scale: { min: 0.5, max: 1.1 },
        frequency: 26 / R.fxScale,
        quantity: 1,
      });

      // névoa: faixas largas que derivam devagar perto do chão
      this.fog = [0.55, 0.3, 0.8].map((shift, i) => {
        const img = scene.add
          .image(R.W / 2, R.GROUND_Y - 60 - i * 55, 'fog')
          .setDisplaySize(R.W * 1.5, 220)
          .setTint(0xc9d0dc)
          .setAlpha(0)
          .setDepth(4000);
        layer.add(img);
        scene.tweens.add({ targets: img, x: R.W / 2 + (i % 2 ? 90 : -90) * (1 + shift), duration: 14000 + i * 3500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        return img;
      });
    }

    make(layer, texture, config) {
      const emitter = this.scene.add.particles(0, 0, texture, config).setDepth(4000);
      layer.add(emitter);
      return emitter;
    }

    set(kind) {
      if (kind === this.kind) return;
      this.kind = kind;

      const on = (emitter, active) => (active ? emitter.start() : emitter.stop());
      on(this.rain, kind === 'rain');
      on(this.storm, kind === 'storm');
      on(this.snow, kind === 'snow');

      const fogAlpha = kind === 'fog' ? 0.38 : kind === 'rain' ? 0.1 : kind === 'storm' ? 0.14 : 0;
      this.fog.forEach((img) => this.scene.tweens.add({ targets: img, alpha: fogAlpha, duration: 2500 }));
      this.nextBolt = this.scene.time.now + R.rand(2500, 6000);
    }

    /** Tempestade: um raio a cada 6–14 s, com clarão e trovão. */
    update(time) {
      if (this.kind !== 'storm' || time < this.nextBolt) return;
      this.nextBolt = time + R.rand(6000, 14000);
      this.fx.lightning(R.rand(R.W * 0.1, R.W * 0.9), R.GROUND_Y - 10);
      this.fx.flash(160, 215, 225, 255);
      this.scene.time.delayedCall(R.rand(350, 900), () => Sound.thunder());
    }
  }

  R.Weather = Weather;
})(window.Reino);

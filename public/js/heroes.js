// Heróis: cada follow vira um bonequinho (com o nome em cima) que fica ao
// redor do castelo. Mostra até 12 (os mais recentes).
(function heroes(R) {
  const MAX_HEROES = 12;

  class Heroes {
    constructor(scene, layer, castleX) {
      this.scene = scene;
      this.layer = layer;
      this.castleX = castleX;
      this.map = new Map(); // key -> { container }
      this.order = []; // keys, do mais antigo pro mais novo
    }

    slotPosition(index) {
      // 5 por fileira, fileiras de trás pra frente (a da frente sobrepõe só o corpo da de trás, não o nome)
      const row = Math.floor(index / 5);
      const col = index % 5;
      return { x: this.castleX + 70 + col * 92 + (row % 2) * 46, y: R.GROUND_Y + 16 + row * 28, scale: 1 - row * 0.05 };
    }

    makeHero(nickname) {
      const scene = this.scene;
      const body = scene.add.image(0, 0, 'hero_body').setOrigin(0.5, 1).setTint(R.hashColor(nickname));
      const head = scene.add.image(-1, -53, 'hero_head').setOrigin(0.5, 0.5);
      const label = scene.add
        .text(0, -70, R.truncate(nickname, 10), {
          fontFamily: R.FONT,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#0b0e1a',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1);
      const container = scene.add.container(0, 0, [body, head, label]);
      this.layer.add(container);
      return container;
    }

    /** Reposiciona todo mundo nos slots (animado). */
    layout(animate = true) {
      this.order.forEach((key, index) => {
        const hero = this.map.get(key);
        if (!hero) return;
        const pos = this.slotPosition(index);
        hero.container.setDepth(pos.y);
        if (animate) {
          this.scene.tweens.add({ targets: hero.container, x: pos.x, y: pos.y, scale: pos.scale, duration: 400, ease: 'Sine.InOut' });
        } else {
          hero.container.setPosition(pos.x, pos.y).setScale(pos.scale);
        }
      });
    }

    startIdle(container) {
      this.scene.tweens.add({
        targets: container.list[0],
        scaleY: { from: 1, to: 0.96 },
        duration: R.rand(700, 1100),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        delay: R.rand(0, 600),
      });
    }

    /** Novo herói. `drop` = vem pulando do portão (follow ao vivo); senão só aparece (carga inicial). */
    add(key, nickname, drop) {
      if (this.map.has(key)) return;
      if (this.order.length >= MAX_HEROES) this.removeKey(this.order[0], true);

      const container = this.makeHero(nickname);
      this.map.set(key, { container });
      this.order.push(key);
      this.startIdle(container);

      const index = this.order.length - 1;
      const pos = this.slotPosition(index);
      container.setDepth(pos.y);
      if (drop) {
        container.setPosition(this.castleX + 20, R.GROUND_Y - 20).setScale(0.3).setAlpha(0);
        this.scene.tweens.add({ targets: container, alpha: 1, duration: 200 });
        this.scene.tweens.add({ targets: container, scale: pos.scale, duration: 650, ease: 'Back.Out' });
        this.scene.tweens.add({ targets: container, x: pos.x, duration: 650, ease: 'Sine.Out' });
        this.scene.tweens.add({ targets: container, y: { value: pos.y - 70, duration: 300, ease: 'Quad.Out' } });
        this.scene.tweens.add({ targets: container, y: pos.y, delay: 300, duration: 350, ease: 'Bounce.Out' });
      } else {
        container.setPosition(pos.x, pos.y).setScale(pos.scale);
      }
      return container;
    }

    removeKey(key, animate) {
      const hero = this.map.get(key);
      if (!hero) return;
      this.map.delete(key);
      this.order = this.order.filter((k) => k !== key);
      this.scene.tweens.killTweensOf(hero.container.list[0]);
      if (animate) {
        this.scene.tweens.add({ targets: hero.container, alpha: 0, duration: 300, onComplete: () => hero.container.destroy() });
      } else {
        hero.container.destroy();
      }
      this.layout(true);
    }

    /** Sincroniza com a lista do servidor (mais recentes primeiro). Só mexe se faltar/sobrar alguém. */
    sync(list) {
      const wanted = list.slice(0, MAX_HEROES).reverse(); // antigo -> novo
      const keys = wanted.map((h) => h.userId ?? h.nickname);

      for (const key of [...this.order]) {
        if (!keys.includes(key)) this.removeKey(key, false);
      }
      wanted.forEach((h) => {
        const key = h.userId ?? h.nickname;
        if (!this.map.has(key)) this.add(key, h.nickname, false);
      });
      this.layout(false);
    }

    /** Um herói aleatório dá um pulinho (reação a ataque). */
    hop() {
      if (this.order.length === 0) return;
      const key = this.order[Math.floor(Math.random() * this.order.length)];
      const hero = this.map.get(key);
      if (!hero) return;
      const baseY = hero.container.y;
      this.scene.tweens.add({
        targets: hero.container,
        y: baseY - 14,
        duration: 110,
        yoyo: true,
        ease: 'Quad.Out',
        onComplete: () => {
          hero.container.y = baseY;
        },
      });
    }
  }

  R.Heroes = Heroes;
})(window.Reino);

// Heróis: cada follow vira um bonequinho que fica ao redor do castelo, com nível,
// título e classe (o visual vem da classe: guerreiro, arqueiro, mago ou guardião;
// a cor do nome e a aura vêm da faixa de título). Mostra até 12: os de maior nível
// mais os mais recentes (o servidor escolhe quem).
(function heroes(R) {
  const MAX_HEROES = 12;

  /** Cor do nível/aura por faixa de título (Recruta → Lenda). */
  const TITLE_COLORS = [0xc3cbe0, 0x7cfc9a, 0x6ad0ff, 0xc59bff, 0xffa24a, 0xffd166];
  const CLASS_TEXTURES = { knight: 'hero_knight', archer: 'hero_archer', mage: 'hero_mage', guardian: 'hero_guardian' };
  R.TITLE_COLORS = TITLE_COLORS;

  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  class Heroes {
    constructor(scene, layer, castleX) {
      this.scene = scene;
      this.layer = layer;
      this.castleX = castleX;
      this.map = new Map(); // key -> { container, body, aura, levelText, meta }
      this.order = []; // keys, do mais antigo pro mais novo
    }

    slotPosition(index) {
      // 5 por fileira, fileiras de trás pra frente (a da frente sobrepõe só o corpo da de trás, não o nome)
      const row = Math.floor(index / 5);
      const col = index % 5;
      return { x: this.castleX + 70 + col * 92 + (row % 2) * 46, y: R.GROUND_Y + 28 + row * 28, scale: 1 - row * 0.05 };
    }

    /** Textura pela classe; sem classe (follow acabou de chegar), cai numa variação estável pelo nome. */
    textureFor(nickname, meta) {
      const byClass = meta && CLASS_TEXTURES[meta.classKey];
      if (byClass && this.scene.textures.exists(byClass)) return byClass;
      const variant = R.HERO_VARIANTS[Math.abs(R.hashInt(nickname)) % R.HERO_VARIANTS.length];
      return this.scene.textures.exists(variant) ? variant : null;
    }

    makeHero(nickname, meta) {
      const scene = this.scene;
      const textureKey = this.textureFor(nickname, meta);
      // arte pronta (manifest): herói completo; sem ela, o boneco procedural (corpo tingido + cabeça)
      const parts = textureKey
        ? [R.makeVisual(scene, textureKey).setOrigin(0.5, 1)]
        : [R.makeVisual(scene, 'hero_body').setOrigin(0.5, 1).setTint(R.hashColor(nickname)), R.makeVisual(scene, 'hero_head').setPosition(-1, -53).setOrigin(0.5, 0.5)];
      const body = parts[0];
      const height = textureKey ? R.HERO_SIZE.h : 70;

      const aura = scene.add.image(0, -height * 0.45, 'glow').setBlendMode('ADD').setVisible(false);
      const fontSize = R.vertical ? 13 : 10;
      const label = scene.add
        .text(0, -(height + 4), R.truncate(nickname, 10), {
          fontFamily: R.FONT,
          fontSize: `${fontSize}px`,
          resolution: R.TEXT_RES,
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#0b0e1a',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1);
      const levelText = scene.add
        .text(0, -(height + 4 + fontSize + 4), '', {
          fontFamily: R.FONT,
          fontSize: `${fontSize - 1}px`,
          resolution: R.TEXT_RES,
          fontStyle: 'bold',
          color: '#c3cbe0',
          stroke: '#0b0e1a',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1);

      const container = scene.add.container(0, 0, [aura, ...parts, label, levelText]);
      this.layer.add(container);
      const hero = { container, body, aura, levelText, textureKey, nickname, meta: null, auraTween: null };
      this.applyMeta(hero, meta);
      return hero;
    }

    /** Nível, cor do título e aura (faixas 2+ brilham; 4+ pulsam). */
    applyMeta(hero, meta) {
      hero.meta = meta ?? null;
      const tier = meta ? Math.max(0, Math.min(TITLE_COLORS.length - 1, meta.titleIndex)) : 0;
      const color = TITLE_COLORS[tier];
      hero.levelText.setText(meta ? `Nv ${meta.level}` : '').setColor(hex(color));

      if (hero.auraTween) {
        hero.auraTween.stop();
        hero.auraTween = null;
      }
      if (tier >= 2) {
        hero.aura.setVisible(true).setTint(color).setScale(1.5 + (tier - 2) * 0.25).setAlpha(0.2 + (tier - 2) * 0.05);
        if (tier >= 4) {
          hero.auraTween = this.scene.tweens.add({
            targets: hero.aura,
            alpha: { from: hero.aura.alpha, to: hero.aura.alpha + 0.18 },
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut',
          });
        }
      } else {
        hero.aura.setVisible(false);
      }

      // classe mudou (ex.: seguiu e depois virou mago): troca o desenho mantendo o resto
      if (meta && hero.textureKey) {
        const next = this.textureFor(hero.nickname, meta);
        if (next && next !== hero.textureKey) {
          hero.body.setTexture(next);
          hero.textureKey = next;
        }
      }
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

    startIdle(hero) {
      const { body } = hero;
      this.scene.tweens.add({
        targets: body,
        scaleY: { from: body.baseScale, to: 0.96 * body.baseScale },
        duration: R.rand(700, 1100),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        delay: R.rand(0, 600),
      });
    }

    /** Novo herói. `drop` = vem pulando do portão (follow ao vivo); senão só aparece (carga inicial). */
    add(key, nickname, drop, meta) {
      if (this.map.has(key)) return;
      if (this.order.length >= MAX_HEROES) this.removeKey(this.order[0], true);

      const hero = this.makeHero(nickname, meta);
      const { container } = hero;
      this.map.set(key, hero);
      this.order.push(key);
      this.startIdle(hero);

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

    /** Atualiza nível/classe de um herói já na tela (vem do servidor); ignora quem não está aqui. */
    update(key, meta) {
      const hero = this.map.get(key);
      if (!hero || !meta) return;
      const prev = hero.meta;
      if (prev && prev.level === meta.level && prev.titleIndex === meta.titleIndex && prev.classKey === meta.classKey) return;
      this.applyMeta(hero, meta);
    }

    /** Até `n` heróis aleatórios na tela (pra feitiços que saem dos heróis). */
    positions(n) {
      const keys = [...this.order].sort(() => Math.random() - 0.5).slice(0, n);
      return keys.map((k) => this.positionOf(k)).filter(Boolean);
    }

    /** Posição atual na tela (pra efeitos de subida de nível). Null se o herói não está visível. */
    positionOf(key) {
      const hero = this.map.get(key);
      return hero ? { x: hero.container.x, y: hero.container.y } : null;
    }

    removeKey(key, animate) {
      const hero = this.map.get(key);
      if (!hero) return;
      this.map.delete(key);
      this.order = this.order.filter((k) => k !== key);
      this.scene.tweens.killTweensOf(hero.body);
      if (hero.auraTween) hero.auraTween.stop();
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
        const meta = h.level ? { level: h.level, titleIndex: h.titleIndex ?? 0, classKey: h.classKey } : undefined;
        if (!this.map.has(key)) this.add(key, h.nickname, false, meta);
        else this.update(key, meta);
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

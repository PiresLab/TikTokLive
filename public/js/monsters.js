// Monstros/chefões: entram andando pela direita, balançam, "atacam" a muralha,
// piscam ao tomar dano e explodem ao morrer. A barra de HP fica sobre a cabeça.
(function monsters(R) {
  class Monsters {
    constructor(scene, layer, x) {
      this.scene = scene;
      this.layer = layer;
      this.x = x;
      this.groundY = R.GROUND_Y + 4;
      this.current = null;
      this.key = null;
      this.hp = 0;
      this.maxHp = 1;
      this.lastHitAt = 0;
      this.lungeTimer = null;
      /** callback(x, y, isBoss) quando um monstro morre */
      this.onDeath = null;
      /** callback() quando o monstro ataca a muralha */
      this.onAttack = null;
    }

    center() {
      const size = this.current ? this.current.size : R.NORMAL_SIZE;
      return { x: this.current ? this.current.container.x : this.x, y: this.groundY - size * 0.5 };
    }

    top() {
      const size = this.current ? this.current.size : R.NORMAL_SIZE;
      return { x: this.x, y: this.groundY - size };
    }

    identity(s) {
      return `${s.wave}|${s.monsterName}|${s.monsterMaxHp}|${s.isBoss}`;
    }

    /** Sincroniza com o estado do motor. Retorna { changed, damage } pra o main mostrar números de dano. */
    set(state, instant = false) {
      const key = this.identity(state);
      if (key !== this.key) {
        this.killCurrent();
        this.spawn(state, instant);
        this.key = key;
        this.hp = state.monsterHp;
        this.maxHp = state.monsterMaxHp;
        return { changed: true, damage: 0 };
      }

      const damage = Math.max(0, this.hp - state.monsterHp);
      this.hp = state.monsterHp;
      this.maxHp = state.monsterMaxHp;
      this.drawBar();
      return { changed: false, damage };
    }

    spawn(state, instant) {
      const scene = this.scene;
      const slug = R.MONSTER_SLUGS[state.monsterName] || 'goblin';
      const size = state.isBoss ? R.BOSS_SIZE : R.NORMAL_SIZE;
      const container = scene.add.container(instant ? this.x : this.x + 340, this.groundY);
      const parts = [];

      let aura = null;
      if (state.isBoss) {
        aura = scene.add.image(0, -size * 0.5, 'glow').setTint(0xff4a3a).setBlendMode('ADD').setScale(size / 60).setAlpha(0.45);
        parts.push(aura);
        scene.tweens.add({ targets: aura, alpha: { from: 0.25, to: 0.6 }, scale: { from: aura.scale * 0.92, to: aura.scale * 1.06 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }

      const sprite = scene.add.image(0, 0, `monster_${slug}`).setOrigin(0.5, 1);
      const bar = scene.add.graphics();
      parts.push(sprite, bar);
      container.add(parts);
      this.layer.add(container);

      this.current = { container, sprite, bar, aura, size, isBoss: state.isBoss, slug, walking: !instant };
      this.hp = state.monsterHp;
      this.maxHp = state.monsterMaxHp;
      this.drawBar();

      const floating = slug === 'wraith' || slug === 'shadowlord';
      const startIdle = () => {
        if (!this.current || this.current.container !== container) return;
        this.current.walking = false;
        scene.tweens.add({
          targets: sprite,
          y: { from: 0, to: floating ? -12 : -5 },
          scaleY: { from: 1, to: floating ? 1 : 0.985 },
          duration: floating ? 1100 : 640,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
        this.scheduleLunge();
      };

      if (instant) {
        startIdle();
      } else {
        scene.tweens.add({
          targets: sprite,
          angle: { from: -3, to: 3 },
          duration: 150,
          yoyo: true,
          repeat: 4,
          onComplete: () => sprite.setAngle(0),
        });
        scene.tweens.add({ targets: container, x: this.x, duration: 780, ease: 'Cubic.Out', onComplete: startIdle });
      }
    }

    drawBar() {
      const cur = this.current;
      if (!cur) return;
      const width = cur.isBoss ? 250 : 140;
      const ratio = Math.max(0, Math.min(1, this.hp / this.maxHp));
      const y = -cur.size - 16;
      cur.bar.clear();
      cur.bar.fillStyle(0x000000, 0.55);
      cur.bar.fillRoundedRect(-width / 2 - 2, y - 2, width + 4, 13, 5);
      cur.bar.fillStyle(cur.isBoss ? 0xffd166 : 0xe4536a, 1);
      if (ratio > 0) cur.bar.fillRoundedRect(-width / 2, y, Math.max(6, width * ratio), 9, 4);
      cur.bar.fillStyle(0xffffff, 0.28);
      if (ratio > 0) cur.bar.fillRoundedRect(-width / 2, y, Math.max(6, width * ratio), 3, 2);
    }

    scheduleLunge() {
      if (this.lungeTimer) this.lungeTimer.remove();
      this.lungeTimer = this.scene.time.addEvent({
        delay: R.rand(3500, 6500),
        loop: true,
        callback: () => this.lunge(),
      });
    }

    lunge() {
      const cur = this.current;
      if (!cur || cur.walking) return;
      this.scene.tweens.add({
        targets: cur.container,
        x: this.x - 70,
        duration: 170,
        yoyo: true,
        ease: 'Quad.Out',
        onYoyo: () => {
          if (this.onAttack) this.onAttack();
        },
      });
    }

    /** Pisca branco + tremidinha (limitado a ~11/s pra não virar estroboscópio). */
    hit() {
      const cur = this.current;
      const now = this.scene.time.now;
      if (!cur || now - this.lastHitAt < 90) return;
      this.lastHitAt = now;
      cur.sprite.setTintFill(0xffffff);
      this.scene.time.delayedCall(60, () => {
        if (cur.sprite.active) cur.sprite.clearTint();
      });
      this.scene.tweens.add({
        targets: cur.sprite,
        x: { from: -3, to: 3 },
        duration: 35,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          if (cur.sprite.active) cur.sprite.x = 0;
        },
      });
    }

    killCurrent() {
      const cur = this.current;
      if (!cur) return;
      this.current = null;
      if (this.lungeTimer) {
        this.lungeTimer.remove();
        this.lungeTimer = null;
      }
      const { container } = cur;
      const cx = container.x;
      const cy = this.groundY - cur.size * 0.5;
      this.scene.tweens.killTweensOf(cur.sprite);
      if (cur.aura) this.scene.tweens.killTweensOf(cur.aura);
      cur.bar.clear();
      cur.sprite.setTintFill(0xffffff);
      this.scene.tweens.add({
        targets: container,
        scaleX: 1.25,
        scaleY: 0.05,
        alpha: 0,
        duration: cur.isBoss ? 700 : 420,
        ease: 'Cubic.In',
        onComplete: () => container.destroy(),
      });
      if (this.onDeath) this.onDeath(cx, cy, cur.isBoss);
    }
  }

  R.Monsters = Monsters;
})(window.Reino);

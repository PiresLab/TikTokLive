// HUD: painéis estilizados (Era/Reino, placa da onda com HP do monstro,
// rankings), feed de chat em balões, fita de gift e banners narrativos.
(function ui(R) {
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');

  const TEXT = (extra) => ({
    fontFamily: R.FONT,
    color: '#eaf0ff',
    stroke: '#0b0e1a',
    strokeThickness: 3,
    ...extra,
  });

  function panel(g, x, y, w, h, o = {}) {
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(x + 2, y + 4, w, h, o.radius ?? 14);
    g.fillStyle(o.fill ?? 0x0e1430, o.alpha ?? 0.78);
    g.fillRoundedRect(x, y, w, h, o.radius ?? 14);
    g.fillStyle(0xffffff, 0.05);
    g.fillRoundedRect(x, y, w, Math.min(h / 2, 26), { tl: o.radius ?? 14, tr: o.radius ?? 14, bl: 0, br: 0 });
    g.lineStyle(2, o.border ?? 0x3a4a86, 0.9);
    g.strokeRoundedRect(x, y, w, h, o.radius ?? 14);
  }

  function bar(g, x, y, w, h, ratio, topColor, bottomColor) {
    g.fillStyle(0x05070f, 0.8);
    g.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, h / 2 + 2);
    if (ratio <= 0.002) return;
    const fillW = Math.max(h, w * ratio);
    g.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
    g.fillRect(x + h / 2, y, Math.max(0, fillW - h), h);
    g.fillStyle(bottomColor, 1);
    g.fillCircle(x + h / 2, y + h / 2, h / 2);
    g.fillStyle(bottomColor, 1);
    g.fillCircle(x + fillW - h / 2, y + h / 2, h / 2);
    g.fillStyle(0xffffff, 0.22);
    g.fillRoundedRect(x + 3, y + 2, Math.max(0, fillW - 6), h / 3, 3);
  }

  class Hud {
    constructor(scene, layer) {
      this.scene = scene;
      this.layer = layer;
      this.state = null;
      this.kDisp = 1;
      this.mDisp = 1;
      this.feed = [];
      this.giftQueue = [];
      this.giftBusy = false;

      this.buildLeft();
      this.buildWave();
      this.buildRight();
      this.buildBanner();

      this.pausedText = this.add(
        scene.add.text(R.W / 2, 112, '⏸ PAUSADO', TEXT({ fontSize: '16px', fontStyle: 'bold', color: '#ffd166' })).setOrigin(0.5, 0).setVisible(false),
      );
    }

    add(obj) {
      this.layer.add(obj);
      return obj;
    }

    // ---------------------------------------------------------------- construção

    buildLeft() {
      const s = this.scene;
      this.leftBg = this.add(s.add.graphics());
      panel(this.leftBg, 24, 16, 330, 98);
      this.eraText = this.add(s.add.text(42, 24, '', TEXT({ fontSize: '21px', fontStyle: 'bold', color: '#ffd98a' })));
      this.dayText = this.add(s.add.text(336, 29, '', TEXT({ fontSize: '14px', color: '#a9b8ea' })).setOrigin(1, 0));
      this.add(s.add.text(42, 58, '🏰 Reino', TEXT({ fontSize: '13px', color: '#bfeee9' })));
      this.kingdomNum = this.add(s.add.text(336, 59, '', TEXT({ fontSize: '12px', color: '#bfeee9' })).setOrigin(1, 0));
      this.kBar = this.add(s.add.graphics());

      this.muteText = this.add(
        s.add
          .text(42, 92, Sound.isMuted() ? '🔇 som desligado' : '🔊 som ligado', TEXT({ fontSize: '11px', color: '#8d9bc4', strokeThickness: 2 }))
          .setInteractive({ useHandCursor: true }),
      );
      this.muteText.on('pointerdown', () => {
        Sound.setMuted(!Sound.isMuted());
        this.muteText.setText(Sound.isMuted() ? '🔇 som desligado' : '🔊 som ligado');
      });
    }

    buildWave() {
      const s = this.scene;
      this.waveBg = this.add(s.add.graphics());
      panel(this.waveBg, 400, 12, 480, 96, { border: 0x5a2a3a, fill: 0x1a0e1c });
      this.waveTitle = this.add(s.add.text(R.W / 2, 20, '', TEXT({ fontSize: '24px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 4 })).setOrigin(0.5, 0));
      this.waveName = this.add(s.add.text(R.W / 2, 50, '', TEXT({ fontSize: '14px', color: '#ffc9d3' })).setOrigin(0.5, 0));
      this.mBar = this.add(s.add.graphics());
      this.monsterNum = this.add(s.add.text(R.W / 2, 78, '', TEXT({ fontSize: '12px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 3 })).setOrigin(0.5, 0.5));
    }

    buildRight() {
      const s = this.scene;
      this.rightBg = this.add(s.add.graphics());
      this.rightTexts = ['gifters', 'chatters', 'hall', 'heroes'].map((key, i) =>
        this.add(
          s.add.text(
            R.W - 40,
            0,
            '',
            TEXT({ fontSize: '13px', color: key === 'heroes' ? '#7cfc9a' : '#eaf0ff', align: 'left', lineSpacing: 4, strokeThickness: 2 }),
          ),
        ),
      );
      this.renderRight({ today: { gifters: [], chatters: [] }, hallOfFame: [], heroCount: 0 });
    }

    buildBanner() {
      const s = this.scene;
      this.bannerText = this.add(
        s.add.text(R.W / 2, 300, '', TEXT({ fontSize: '42px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 7, align: 'center' })).setOrigin(0.5).setAlpha(0),
      );
      this.subBannerText = this.add(
        s.add.text(R.W / 2, 352, '', TEXT({ fontSize: '19px', color: '#eaf0ff', strokeThickness: 4, align: 'center', wordWrap: { width: 620 } })).setOrigin(0.5, 0).setAlpha(0),
      );
    }

    // ---------------------------------------------------------------- dados

    setState(state, instant = false) {
      this.state = state;
      this.kTarget = state.kingdomHp / state.kingdomMaxHp;
      this.mTarget = state.monsterMaxHp > 0 ? state.monsterHp / state.monsterMaxHp : 0;
      if (instant) {
        this.kDisp = this.kTarget;
        this.mDisp = this.mTarget;
      }

      this.eraText.setText(state.era.name);
      this.dayText.setText(`Dia ${state.seasonDay}`);
      this.kingdomNum.setText(`${fmt(state.kingdomHp)} / ${fmt(state.kingdomMaxHp)}`);
      this.waveTitle.setText(state.isBoss ? `⚠ CHEFÃO · ONDA ${state.wave}` : `ONDA ${state.wave}`);
      this.waveTitle.setColor(state.isBoss ? '#ffd166' : '#ffffff');
      this.waveName.setText(state.monsterName);
      this.monsterNum.setText(`${fmt(state.monsterHp)} / ${fmt(state.monsterMaxHp)}`);
      this.pausedText.setVisible(Boolean(state.paused));
      this.redrawBars();
    }

    redrawBars() {
      const s = this.state;
      if (!s) return;
      this.kBar.clear();
      bar(this.kBar, 42, 78, 294, 15, this.kDisp, 0x6ee8dc, 0x2a9d96);
      this.mBar.clear();
      if (s.isBoss) bar(this.mBar, 430, 70, 420, 16, this.mDisp, 0xffe08a, 0xd49a1f);
      else bar(this.mBar, 430, 70, 420, 16, this.mDisp, 0xff7a92, 0xb83a50);
    }

    renderRight(data) {
      const lines = (rows, fn, empty) => (rows.length ? rows.map(fn).join('\n') : empty);
      const gifters = (data.today?.gifters ?? []).slice(0, 5);
      const chatters = (data.today?.chatters ?? []).slice(0, 3);
      const hall = (data.hallOfFame ?? []).slice(0, 3);

      const blocks = [
        `🏆 Presentes hoje\n${lines(gifters, (g, i) => `${i + 1}. ${R.truncate(g.nickname, 15)} — ${fmt(g.value)}💎`, '—')}`,
        `💬 Chat hoje\n${lines(chatters, (c, i) => `${i + 1}. ${R.truncate(c.nickname, 15)} — ${fmt(c.value)}`, '—')}`,
        `👑 Hall da Fama\n${lines(hall, (h) => `Dia ${h.day}: ${R.truncate(h.topGifterNickname ?? '—', 12)} (${fmt(h.topGifterValue)}💎)`, '—')}`,
        `⚔️ ${fmt(data.heroCount ?? 0)} heróis no Reino`,
      ];

      let y = 30;
      this.rightTexts.forEach((text, i) => {
        text.setText(blocks[i]).setPosition(R.W - 40 - 262, y);
        y += text.height + 14;
      });
      this.rightBg.clear();
      panel(this.rightBg, R.W - 300 - 24, 16, 300, y - 8 - 8 + 6);
    }

    setLeaderboard(data) {
      this.renderRight(data);
    }

    // ---------------------------------------------------------------- feed

    addFeed(text, color = '#9fd3ff') {
      const s = this.scene;
      const label = s.add.text(10, 4, R.truncate(text, 38), TEXT({ fontSize: '14px', color, strokeThickness: 2 }));
      const w = label.width + 20;
      const h = label.height + 8;
      const bg = s.add.graphics();
      bg.fillStyle(0x0b1020, 0.62);
      bg.fillRoundedRect(0, 0, w, h, 10);
      const container = s.add.container(-w, R.H - 16 - h, [bg, label]);
      container.entryHeight = h;
      this.add(container);
      this.feed.push(container);

      if (this.feed.length > 4) {
        const oldest = this.feed.shift();
        oldest.destroy();
      }
      this.layoutFeed();
      s.tweens.add({ targets: container, x: 24, duration: 260, ease: 'Back.Out' });
      s.time.delayedCall(6500, () => {
        if (!container.active) return;
        s.tweens.add({
          targets: container,
          alpha: 0,
          duration: 400,
          onComplete: () => {
            this.feed = this.feed.filter((c) => c !== container);
            container.destroy();
            this.layoutFeed();
          },
        });
      });
    }

    layoutFeed() {
      let y = R.H - 16;
      for (let i = this.feed.length - 1; i >= 0; i -= 1) {
        const c = this.feed[i];
        y -= c.entryHeight;
        this.scene.tweens.add({ targets: c, y, duration: 200, ease: 'Sine.Out' });
        y -= 6;
      }
    }

    // ---------------------------------------------------------------- gifts (fita)

    queueGift(event, tier) {
      if (this.giftQueue.length >= 6) {
        const idx = this.giftQueue.findIndex((g) => g.tier === R.GIFT_TIERS.low);
        this.giftQueue.splice(idx === -1 ? 0 : idx, 1);
      }
      this.giftQueue.push({ event, tier });
      this.nextGift();
    }

    nextGift() {
      if (this.giftBusy || this.giftQueue.length === 0) return;
      this.giftBusy = true;
      const { event, tier } = this.giftQueue.shift();
      const s = this.scene;

      const styles = {
        [R.GIFT_TIERS.low]: { fill: 0x25305a, border: 0xffe9a8, size: 20, hold: 800, color: '#ffffff' },
        [R.GIFT_TIERS.mid]: { fill: 0x5e3210, border: 0xffb04a, size: 25, hold: 1200, color: '#ffe3b0' },
        [R.GIFT_TIERS.high]: { fill: 0x6e1a38, border: 0xffd166, size: 32, hold: 2000, color: '#ffd166' },
      };
      const st = styles[tier];
      const text = s.add
        .text(0, 0, `${R.truncate(event.user.nickname, 18)} enviou ${event.giftName ?? 'um presente'}!`, TEXT({ fontSize: `${st.size}px`, fontStyle: 'bold', color: st.color, strokeThickness: 5 }))
        .setOrigin(0.5);
      const w = text.width + 90;
      const h = text.height + 26;

      const g = s.add.graphics();
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, h / 2);
      g.fillStyle(st.fill, 0.95);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      g.fillStyle(0xffffff, 0.1);
      g.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 2 - 3, h / 4);
      g.lineStyle(3, st.border, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);

      const items = [g, text];
      const sparks = [-w / 2 + 22, w / 2 - 22].map((x) => s.add.image(x, 0, 'spark').setTint(st.border).setScale(tier === R.GIFT_TIERS.high ? 0.9 : 0.6).setBlendMode('ADD'));
      items.push(...sparks);
      if (tier === R.GIFT_TIERS.high) {
        const glow = s.add.image(0, 0, 'glow').setTint(0xffd166).setBlendMode('ADD').setDisplaySize(w * 1.6, h * 3).setAlpha(0.5);
        items.unshift(glow);
      }
      const ribbon = s.add.container(R.W / 2, 40, items).setAlpha(0).setScale(0.7);
      this.add(ribbon);

      sparks.forEach((sp, i) => s.tweens.add({ targets: sp, angle: i ? -360 : 360, duration: 1800, repeat: -1 }));
      s.tweens.add({ targets: ribbon, y: 160, alpha: 1, scale: 1, duration: 340, ease: 'Back.Out' });
      s.time.delayedCall(340 + st.hold, () => {
        s.tweens.add({
          targets: ribbon,
          y: 130,
          alpha: 0,
          duration: 280,
          onComplete: () => {
            ribbon.destroy();
            this.giftBusy = false;
            this.nextGift();
          },
        });
      });
    }

    // ---------------------------------------------------------------- banner narrativo

    banner(text, color, hold = 1600, sub = '') {
      const s = this.scene;
      s.tweens.killTweensOf([this.bannerText, this.subBannerText]);
      this.bannerText.setText(text).setColor(color).setAlpha(0).setScale(0.6);
      this.subBannerText.setText(sub).setAlpha(0);
      s.tweens.add({ targets: this.bannerText, alpha: 1, scale: 1, duration: 320, ease: 'Back.Out' });
      s.tweens.add({ targets: this.subBannerText, alpha: 1, duration: 320, delay: 120 });
      s.tweens.add({ targets: [this.bannerText, this.subBannerText], alpha: 0, delay: 320 + hold, duration: 450 });
    }

    update() {
      if (!this.state) return;
      const kd = this.kTarget - this.kDisp;
      const md = this.mTarget - this.mDisp;
      if (Math.abs(kd) > 0.0008 || Math.abs(md) > 0.0008) {
        this.kDisp += kd * 0.18;
        this.mDisp += md * 0.18;
        this.redrawBars();
      }
    }
  }

  R.Hud = Hud;
})(window.Reino);

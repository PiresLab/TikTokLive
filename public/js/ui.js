// HUD: painéis estilizados (Era/Reino, placa da onda com HP do monstro,
// rankings), feed de chat em balões, fita de gift e banners narrativos.
(function ui(R) {
  const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
  const EVENT_LOOK = {
    bloodMoon: { icon: '🌑', color: '#ff8a8a', fill: 0x2a0a10, border: 0xd93a4a },
    dawnBlessing: { icon: '🌅', color: '#ffe3a0', fill: 0x2a1c08, border: 0xffc24a },
  };
  /** Prefixo de nível nos rankings (vazio se o servidor não mandou). */
  const lv = (entry) => (entry.level ? `Nv${entry.level} ` : '');

  // Os blocos do HUD são desenhados num espaço de design 1280 de largura (coordenadas
  // originais) dentro de containers âncora que posicionam/escalam por orientação.
  const DESIGN_W = 1280;
  const DESIGN_CX = DESIGN_W / 2;
  const K = R.UI;

  const TEXT = (extra) => ({
    fontFamily: R.FONT,
    color: '#eaf0ff',
    stroke: '#0b0e1a',
    strokeThickness: 3,
    resolution: R.TEXT_RES,
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

      this.waveTop = R.vertical ? R.SAFE.top : 12; // topo do painel da onda
      this.legendTop = R.vertical ? R.SAFE.top + 96 * K + 10 : 116; // faixa "como jogar" logo abaixo do painel da onda
      this.rowTop = R.vertical ? this.legendTop + 30 * K + 16 : 16; // topo da fileira Reino / rankings
      this.feedBottom = R.H - 16 - R.SAFE.bottom;

      this.buildLeft();
      this.buildWave();
      this.buildRight();
      this.buildBanner();
      this.buildLegend();
      this.buildEventBadge();
      this.buildGoal();
      this.buildToasts();

      this.pausedText = this.add(
        scene.add
          .text(R.W / 2, this.waveTop + 96 * K + 8, '⏸ PAUSADO', TEXT({ fontSize: `${Math.round(16 * K)}px`, fontStyle: 'bold', color: '#ffd166' }))
          .setOrigin(0.5, 0)
          .setVisible(false),
      );
    }

    add(obj, parent = this.layer) {
      parent.add(obj);
      return obj;
    }

    /** Container escalado por K em que o ponto local (lx, ly) cai em (x, y) da tela. */
    anchor(x, y, lx, ly) {
      return this.add(this.scene.add.container(x - K * lx, y - K * ly).setScale(K));
    }

    // ---------------------------------------------------------------- construção

    buildLeft() {
      const s = this.scene;
      const c = this.anchor(R.SAFE.side, this.rowTop, 24, 16);
      this.leftBg = this.add(s.add.graphics(), c);
      panel(this.leftBg, 24, 16, 330, 98);
      this.eraText = this.add(s.add.text(42, 24, '', TEXT({ fontSize: '21px', fontStyle: 'bold', color: '#ffd98a' })), c);
      this.dayText = this.add(s.add.text(336, 29, '', TEXT({ fontSize: '14px', color: '#a9b8ea' })).setOrigin(1, 0), c);
      this.add(s.add.text(42, 58, '🏰 Reino', TEXT({ fontSize: '13px', color: '#bfeee9' })), c);
      this.kingdomNum = this.add(s.add.text(336, 59, '', TEXT({ fontSize: '12px', color: '#bfeee9' })).setOrigin(1, 0), c);
      this.kBar = this.add(s.add.graphics(), c);

      this.muteText = this.add(
        s.add
          .text(42, 92, Sound.isMuted() ? '🔇 som desligado' : '🔊 som ligado', TEXT({ fontSize: '11px', color: '#8d9bc4', strokeThickness: 2 }))
          .setInteractive({ useHandCursor: true }),
        c,
      );
      this.muteText.on('pointerdown', () => {
        Sound.setMuted(!Sound.isMuted());
        this.muteText.setText(Sound.isMuted() ? '🔇 som desligado' : '🔊 som ligado');
      });
    }

    buildWave() {
      const s = this.scene;
      const c = this.anchor(R.W / 2, this.waveTop, DESIGN_CX, 12);
      this.waveBg = this.add(s.add.graphics(), c);
      panel(this.waveBg, 400, 12, 480, 96, { border: 0x5a2a3a, fill: 0x1a0e1c });
      this.waveTitle = this.add(s.add.text(DESIGN_CX, 20, '', TEXT({ fontSize: '24px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 4 })).setOrigin(0.5, 0), c);
      this.waveName = this.add(s.add.text(DESIGN_CX, 50, '', TEXT({ fontSize: '14px', color: '#ffc9d3' })).setOrigin(0.5, 0), c);
      this.mBar = this.add(s.add.graphics(), c);
      this.monsterNum = this.add(s.add.text(DESIGN_CX, 78, '', TEXT({ fontSize: '12px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 3 })).setOrigin(0.5, 0.5), c);
    }

    buildRight() {
      const s = this.scene;
      const c = this.anchor(R.W - R.SAFE.right - 300 * K, this.rowTop, DESIGN_W - 300 - 24, 16);
      this.rightBg = this.add(s.add.graphics(), c);
      this.rightTexts = ['gifters', 'chatters', 'hall', 'heroes'].map((key) =>
        this.add(
          s.add.text(
            DESIGN_W - 40,
            0,
            '',
            TEXT({ fontSize: '13px', color: key === 'heroes' ? '#7cfc9a' : '#eaf0ff', align: 'left', lineSpacing: 4, strokeThickness: 2 }),
          ),
          c,
        ),
      );
      this.renderRight({ today: { gifters: [], chatters: [] }, hallOfFame: [], heroCount: 0 });
    }

    buildBanner() {
      const s = this.scene;
      const by = R.vertical ? 760 : 300;
      const bk = R.vertical ? 1.25 : 1;
      this.bannerText = this.add(
        s.add
          .text(R.W / 2, by, '', TEXT({ fontSize: `${Math.round(42 * bk)}px`, fontStyle: 'bold', color: '#ffffff', strokeThickness: 7, align: 'center', wordWrap: { width: R.W - 80 } }))
          .setOrigin(0.5)
          .setAlpha(0),
      );
      this.subBannerText = this.add(
        s.add
          .text(R.W / 2, by + 52 * bk, '', TEXT({ fontSize: `${Math.round(19 * bk)}px`, color: '#eaf0ff', strokeThickness: 4, align: 'center', wordWrap: { width: R.vertical ? R.W - 140 : 620 } }))
          .setOrigin(0.5, 0)
          .setAlpha(0),
      );
    }

    /** Faixa fixa "como jogar": alterna a cada poucos segundos o que cada ação do público faz. */
    buildLegend() {
      const s = this.scene;
      const tips = [
        ['👍 Curta para atacar o monstro!', '#ffb3c8'],
        ['💬 Comente para lançar flechas!', '#9fd3ff'],
        ['➕ Siga para virar herói e curar o Reino!', '#7cfc9a'],
        ['↗️ Compartilhe para chamar reforços!', '#b69cff'],
        ['🎁 Presentes invocam feitiços enormes!', '#ffd166'],
      ];
      const c = this.anchor(R.W / 2, this.legendTop, DESIGN_CX, 116);
      this.legend = c;
      const bg = this.add(s.add.graphics(), c);
      panel(bg, DESIGN_CX - 240, 116, 480, 30, { radius: 15, fill: 0x0e1430, alpha: 0.7, border: 0x3a4a86 });
      this.legendText = this.add(s.add.text(DESIGN_CX, 131, '', TEXT({ fontSize: '15px', fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5), c);

      let i = 0;
      const show = () => {
        const [text, color] = tips[i % tips.length];
        this.legendText.setText(text).setColor(color);
        i += 1;
      };
      show();
      s.time.addEvent({
        delay: 4000,
        loop: true,
        callback: () => {
          s.tweens.add({
            targets: this.legendText,
            alpha: 0,
            duration: 200,
            onComplete: () => {
              show();
              s.tweens.add({ targets: this.legendText, alpha: 1, duration: 200 });
            },
          });
        },
      });
    }

    /** Selo do evento do Reino (Lua de Sangue, Bênção): ocupa o lugar da faixa "como jogar" com contagem regressiva. */
    buildEventBadge() {
      const s = this.scene;
      const c = this.anchor(R.W / 2, this.legendTop, DESIGN_CX, 116);
      c.setVisible(false);
      this.eventBadge = c;
      this.eventBg = this.add(s.add.graphics(), c);
      this.eventText = this.add(s.add.text(DESIGN_CX, 131, '', TEXT({ fontSize: '15px', fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5), c);
      this.eventActive = null;
      this.clockOffset = 0;
    }

    /** Hora/clima/evento do servidor: só o selo do evento mora no HUD (o resto é o cenário). */
    setWorld(world) {
      if (!world) return;
      this.clockOffset = world.now - Date.now();
      const event = world.event;
      const changed = (event?.kind ?? null) !== (this.eventActive?.kind ?? null);
      this.eventActive = event;
      if (changed && event) {
        const look = EVENT_LOOK[event.kind] ?? EVENT_LOOK.bloodMoon;
        this.eventBg.clear();
        panel(this.eventBg, DESIGN_CX - 240, 116, 480, 30, { radius: 15, fill: look.fill, alpha: 0.9, border: look.border });
        this.eventLook = look;
      }
      this.refreshStrip();
    }

    /** Faixa de cima do HUD: evento ativo > pausado > legenda "como jogar". */
    refreshStrip() {
      const paused = Boolean(this.state?.paused);
      this.eventBadge.setVisible(Boolean(this.eventActive) && !paused);
      this.legend.setVisible(!this.eventActive && !paused);
    }

    updateEventBadge() {
      if (!this.eventActive || !this.eventLook) return;
      const left = Math.max(0, this.eventActive.endsAt - (Date.now() + this.clockOffset));
      const mm = Math.floor(left / 60000);
      const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      this.eventText.setText(`${this.eventLook.icon} ${this.eventActive.name} · ${mm}:${ss}`).setColor(this.eventLook.color);
    }

    /** Meta coletiva: barra com progresso/alvo e o prêmio. No vertical fica sob o painel do Reino; no horizontal, embaixo ao centro. */
    buildGoal() {
      const s = this.scene;
      const x = R.vertical ? R.SAFE.side : R.W / 2 - 165;
      const y = R.vertical ? this.rowTop + 98 * K + 14 : R.H - 66;
      const c = this.anchor(x, y, 0, 0);
      this.goalBox = c;
      this.goalBg = this.add(s.add.graphics(), c);
      panel(this.goalBg, 0, 0, 330, 58, { border: 0x2f6b4a, fill: 0x0c1a1a });
      this.goalTitle = this.add(s.add.text(12, 5, '', TEXT({ fontSize: '14px', fontStyle: 'bold', color: '#ffe9a8', strokeThickness: 3 })), c);
      this.goalCount = this.add(s.add.text(318, 6, '', TEXT({ fontSize: '13px', fontStyle: 'bold', color: '#ffffff', strokeThickness: 3 })).setOrigin(1, 0), c);
      this.goalBar = this.add(s.add.graphics(), c);
      this.goalReward = this.add(s.add.text(12, 41, '', TEXT({ fontSize: '11px', color: '#a9f5c8', strokeThickness: 2 })), c);
      this.goal = null;
      this.gDisp = 0;
      this.gTarget = 0;
    }

    drawGoalBar() {
      const kind = this.goal?.kind;
      const colors = {
        like: [0xff9ec0, 0xd04a7a],
        comment: [0x9fd3ff, 0x3a7fc4],
        follow: [0x7cfc9a, 0x2f9d56],
        share: [0xc4b0ff, 0x6a45d1],
      };
      const [top, bottom] = colors[kind] ?? colors.like;
      this.goalBar.clear();
      bar(this.goalBar, 14, 25, 302, 12, this.gDisp, top, bottom);
    }

    setGoal(goal, instant) {
      const sameGoal = this.goal && this.goal.kind === goal.kind && this.goal.target === goal.target;
      this.goal = goal;
      this.gTarget = goal.target > 0 ? goal.progress / goal.target : 0;
      if (instant || !sameGoal) this.gDisp = this.gTarget;
      this.goalTitle.setText(R.truncate(goal.title, 30));
      this.goalCount.setText(`${fmt(goal.progress)} / ${fmt(goal.target)}`);
      this.goalReward.setText(goal.rewardText);
      this.drawGoalBar();
    }

    /** Meta cumprida: o painel dá um "pulo" e pisca em dourado. */
    goalDone() {
      this.scene.tweens.add({ targets: this.goalBox, scale: K * 1.1, duration: 160, yoyo: true, repeat: 1, ease: 'Sine.Out' });
      this.goalTitle.setColor('#7cfc9a');
      this.scene.time.delayedCall(900, () => this.goalTitle.setColor('#ffe9a8'));
    }

    // ---------------------------------------------------------------- progressão: toasts e cartão de perfil

    buildToasts() {
      this.toasts = [];
      // vertical: logo abaixo da meta coletiva; horizontal: sob o painel do Reino
      this.toastLeft = R.SAFE.side;
      this.toastTop = R.vertical ? this.rowTop + 98 * K + 14 + 58 * K + 14 : 124;
      this.profile = null;
    }

    /** Aviso empilhado (nível, missão, conquista). Some sozinho; no máximo 3 na tela. */
    toast({ icon, title, sub, color = 0xffd166 }) {
      const s = this.scene;
      const hexColor = `#${color.toString(16).padStart(6, '0')}`;
      const w = 330;
      const h = sub ? 46 : 32;
      const box = s.add.container(0, 0).setScale(K).setAlpha(0);
      const bg = s.add.graphics();
      panel(bg, 0, 0, w, h, { radius: 12, border: color, fill: 0x0c1226, alpha: 0.88 });
      const iconText = s.add.text(10, h / 2, icon, TEXT({ fontSize: '22px', strokeThickness: 0 })).setOrigin(0, 0.5);
      const titleText = s.add.text(44, sub ? 5 : 6, R.truncate(title, 28), TEXT({ fontSize: '14px', fontStyle: 'bold', color: hexColor, strokeThickness: 3 }));
      box.add([bg, iconText, titleText]);
      if (sub) box.add(s.add.text(44, 25, R.truncate(sub, 36), TEXT({ fontSize: '12px', color: '#dfe6ff', strokeThickness: 2 })));
      box.entryHeight = h * K;
      box.y = this.toastTop;
      this.add(box);

      this.toasts.unshift(box);
      while (this.toasts.length > 3) this.toasts.pop().destroy();
      this.layoutToasts();
      box.x = this.toastLeft - 40;
      s.tweens.add({ targets: box, alpha: 1, x: this.toastLeft, duration: 240, ease: 'Back.Out' });
      s.time.delayedCall(4200, () => {
        if (!box.active) return;
        s.tweens.add({
          targets: box,
          alpha: 0,
          duration: 350,
          onComplete: () => {
            this.toasts = this.toasts.filter((t) => t !== box);
            box.destroy();
            this.layoutToasts();
          },
        });
      });
    }

    layoutToasts() {
      let y = this.toastTop;
      for (const t of this.toasts) {
        this.scene.tweens.add({ targets: t, y, duration: 180, ease: 'Sine.Out' });
        y += t.entryHeight + 8;
      }
    }

    /** Cartão do `!perfil` (nível, título, classe, XP, missões do dia e emblemas). Substitui o anterior. */
    showProfile(card) {
      const s = this.scene;
      if (this.profile) {
        s.tweens.killTweensOf(this.profile);
        this.profile.destroy();
      }
      const classIcon = { knight: '⚔️', archer: '🏹', mage: '🔮', guardian: '🛡️' }[card.classKey] ?? '⚔️';
      const tierColor = R.TITLE_COLORS[Math.min(R.TITLE_COLORS.length - 1, card.titleIndex)];
      const tierHex = `#${tierColor.toString(16).padStart(6, '0')}`;

      const w = 420;
      const rows = card.missions.length;
      const h = 134 + rows * 22 + 30;
      const box = s.add.container(0, 0);
      const bg = s.add.graphics();
      panel(bg, 0, 0, w, h, { radius: 16, border: tierColor, fill: 0x0b1020, alpha: 0.94 });
      box.add(bg);
      box.add(s.add.text(16, 12, `${classIcon} ${R.truncate(card.nickname, 16)}`, TEXT({ fontSize: '22px', fontStyle: 'bold', strokeThickness: 4 })));
      box.add(s.add.text(w - 16, 14, `Nv ${card.level}`, TEXT({ fontSize: '22px', fontStyle: 'bold', color: tierHex, strokeThickness: 4 })).setOrigin(1, 0));
      box.add(s.add.text(16, 44, `${card.title} · ${card.className}`, TEXT({ fontSize: '14px', color: tierHex, strokeThickness: 2 })));

      const xpBar = s.add.graphics();
      bar(xpBar, 16, 70, w - 32, 12, card.progress, 0xffe08a, 0xd49a1f);
      box.add(xpBar);
      const xpLabel = card.xpForNext > 0 ? `${fmt(card.xpIntoLevel)} / ${fmt(card.xpForNext)} XP pro próximo nível` : 'Nível máximo!';
      box.add(s.add.text(16, 86, xpLabel, TEXT({ fontSize: '12px', color: '#c9d4ff', strokeThickness: 2 })));

      box.add(s.add.text(16, 110, 'Missões de hoje', TEXT({ fontSize: '13px', fontStyle: 'bold', color: '#ffd98a', strokeThickness: 2 })));
      card.missions.forEach((m, i) => {
        const line = `${m.done ? '✅' : '▫️'} ${m.title}  (${fmt(m.progress)}/${fmt(m.target)})`;
        box.add(s.add.text(16, 132 + i * 22, line, TEXT({ fontSize: '13px', color: m.done ? '#7cfc9a' : '#eaf0ff', strokeThickness: 2 })));
      });
      const badgesY = 132 + rows * 22 + 6;
      const badges = card.achievements.map((a) => a.icon).join(' ') || '—';
      box.add(s.add.text(16, badgesY, `Emblemas ${card.achievements.length}/${card.achievementTotal}:  ${badges}`, TEXT({ fontSize: '13px', color: '#dfe6ff', strokeThickness: 2 })));

      const scale = Math.min(K, (R.W - 40) / w);
      box.setScale(scale * 0.85).setAlpha(0);
      const cy = R.vertical ? 880 : 150;
      box.setPosition(R.W / 2 - (w * scale) / 2, cy);
      this.add(box);
      this.profile = box;
      s.tweens.add({ targets: box, alpha: 1, scale, duration: 260, ease: 'Back.Out' });
      s.time.delayedCall(7000, () => {
        if (this.profile !== box) return;
        s.tweens.add({
          targets: box,
          alpha: 0,
          duration: 400,
          onComplete: () => {
            if (this.profile === box) this.profile = null;
            box.destroy();
          },
        });
      });
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
      const titleBase = state.isBoss ? (state.affix ? '⚠ CHEFÃO ELITE' : '⚠ CHEFÃO') : state.horde ? '⚔ HORDA' : '';
      this.waveTitle.setText(titleBase ? `${titleBase} · ONDA ${state.wave}` : `ONDA ${state.wave}`);
      this.waveTitle.setColor(state.isBoss ? '#ffd166' : state.horde ? '#ffb27a' : '#ffffff');
      this.waveName.setText(state.affix ? `${state.monsterName} · Blindado` : state.horde ? `${state.horde}× ${state.monsterName}` : state.monsterName);
      this.monsterNum.setText(`${fmt(state.monsterHp)} / ${fmt(state.monsterMaxHp)}`);
      this.pausedText.setVisible(Boolean(state.paused));
      this.refreshStrip();
      if (state.goal) this.setGoal(state.goal, instant);
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
        `🏆 Presentes hoje\n${lines(gifters, (g, i) => `${i + 1}. ${lv(g)}${R.truncate(g.nickname, 12)} — ${fmt(g.value)}💎`, '—')}`,
        `💬 Chat hoje\n${lines(chatters, (c, i) => `${i + 1}. ${lv(c)}${R.truncate(c.nickname, 12)} — ${fmt(c.value)}`, '—')}`,
        `👑 Hall da Fama\n${lines(hall, (h) => `Dia ${h.day}: ${R.truncate(h.topGifterNickname ?? '—', 12)} (${fmt(h.topGifterValue)}💎)`, '—')}`,
        `⚔️ ${fmt(data.heroCount ?? 0)} heróis no Reino`,
      ];

      let y = 30;
      this.rightTexts.forEach((text, i) => {
        text.setText(blocks[i]).setPosition(DESIGN_W - 40 - 262, y);
        y += text.height + 14;
      });
      this.rightBg.clear();
      panel(this.rightBg, DESIGN_W - 300 - 24, 16, 300, y - 8 - 8 + 6);
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
      const container = s.add.container(-w * K, this.feedBottom - h * K, [bg, label]).setScale(K);
      container.entryHeight = h * K;
      this.add(container);
      this.feed.push(container);

      if (this.feed.length > 4) {
        const oldest = this.feed.shift();
        oldest.destroy();
      }
      this.layoutFeed();
      s.tweens.add({ targets: container, x: R.SAFE.side, duration: 260, ease: 'Back.Out' });
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
      let y = this.feedBottom;
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
      // vertical: a fita desce pro céu acima do castelo (o topo é HUD) e nunca passa da largura da tela
      const yShow = R.vertical ? 800 : 160;
      const scaleShow = Math.min(K, (R.W - 60) / w);
      const ribbon = s.add.container(R.W / 2, yShow - 120, items).setAlpha(0).setScale(0.7 * scaleShow);
      this.add(ribbon);

      sparks.forEach((sp, i) => s.tweens.add({ targets: sp, angle: i ? -360 : 360, duration: 1800, repeat: -1 }));
      s.tweens.add({ targets: ribbon, y: yShow, alpha: 1, scale: scaleShow, duration: 340, ease: 'Back.Out' });
      s.time.delayedCall(340 + st.hold, () => {
        s.tweens.add({
          targets: ribbon,
          y: yShow - 30,
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
      this.updateEventBadge();
      const kd = this.kTarget - this.kDisp;
      const md = this.mTarget - this.mDisp;
      const gd = this.gTarget - this.gDisp;
      if (Math.abs(gd) > 0.0008) {
        this.gDisp += gd * 0.18;
        this.drawGoalBar();
      }
      if (Math.abs(kd) > 0.0008 || Math.abs(md) > 0.0008) {
        this.kDisp += kd * 0.18;
        this.mDisp += md * 0.18;
        this.redrawBars();
      }
    }
  }

  R.Hud = Hud;
})(window.Reino);

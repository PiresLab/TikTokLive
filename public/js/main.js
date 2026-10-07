// Cena principal: monta cenário/castelo/monstro/heróis/efeitos/HUD e liga o
// WebSocket do servidor (state / fx / narrative) a eles.
(function main(R) {
  const WS_URL = `ws://${location.hostname}:8787/?role=${R.role}`;
  const LEADERBOARD_POLL_MS = 15_000;
  const CASTLE_X = R.LAYOUT.castleX;
  const MONSTER_X = R.LAYOUT.monsterX;

  if (R.role === 'preview') Sound.forceMute(true); // o som sai só do jogo de verdade (OBS), não do iframe do painel

  class GameScene extends Phaser.Scene {
    constructor() {
      super('game');
    }

    preload() {
      R.loadManifest(this);
    }

    create() {
      R.generateTextures(this);
      R.createAnims(this);

      // Duas camadas/câmeras: o mundo treme com shake/flash, o HUD fica parado.
      this.worldLayer = this.add.layer();
      this.uiLayer = this.add.layer();
      this.uiCam = this.cameras.add(0, 0, R.W, R.H);
      this.cameras.main.ignore(this.uiLayer);
      this.uiCam.ignore(this.worldLayer);

      this.bg = new R.Background(this, this.worldLayer);
      this.kingdom = new R.Kingdom(this, this.worldLayer, CASTLE_X);
      this.monsters = new R.Monsters(this, this.worldLayer, MONSTER_X);
      this.heroes = new R.Heroes(this, this.worldLayer, CASTLE_X);
      this.fx = new R.Fx(this, this.worldLayer, { kingdom: this.kingdom, monsters: this.monsters, heroes: this.heroes });
      this.hud = new R.Hud(this, this.uiLayer);

      this.firstState = true;
      this.eraTier = -1;
      this.pendingDamage = 0;
      this.lastKingdomHp = null;
      this.lastWaveBannerAt = 0;

      this.kingdom.onEraUp = () => {
        this.fx.eraUp(this.kingdom.x, R.GROUND_Y - 150);
      };
      this.monsters.onDeath = (x, y, isBoss) => this.fx.monsterDied(x, y, isBoss);
      this.monsters.onAttack = () => {
        this.kingdom.shake(3);
        this.fx.shake(120, 0.002);
      };

      // números de dano agregados (a cada ~220ms) a partir da queda de HP do monstro
      this.time.addEvent({
        delay: 110,
        loop: true,
        callback: () => {
          if (this.pendingDamage < 1) return;
          const top = this.monsters.top();
          this.fx.damageNumber(top.x, top.y + 30, this.pendingDamage);
          this.pendingDamage = 0;
        },
      });

      this.connectWs();
      this.pollLeaderboard();
      setInterval(() => this.pollLeaderboard(), LEADERBOARD_POLL_MS);

      R.scene = this; // depuração (ex.: R.scene.game.loop.actualFps)
    }

    update(time, delta) {
      this.bg.update(delta);
      this.kingdom.update(time);
      this.hud.update();
    }

    // ---------------------------------------------------------------- rede

    connectWs() {
      const ws = new WebSocket(WS_URL);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') this.applyState(msg.payload);
        else if (msg.type === 'fx') this.applyFx(msg.payload);
        else if (msg.type === 'narrative') this.applyNarrative(msg.payload);
        else if (msg.type === 'progress') this.applyProgress(msg.payload);
        else if (msg.type === 'profile') this.hud.showProfile(msg.payload);
      };
      ws.onclose = () => setTimeout(() => this.connectWs(), 2000);
      ws.onerror = () => ws.close();
    }

    async pollLeaderboard() {
      try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        this.hud.setLeaderboard(data);
        this.heroes.sync(data.heroes ?? []);
      } catch {
        // a live segue no ar mesmo se o painel falhar uma vez; tenta de novo no próximo poll
      }
    }

    // ---------------------------------------------------------------- estado

    applyState(s) {
      const first = this.firstState;
      this.firstState = false;

      if (R.forceEra !== null && Number.isFinite(R.forceEra)) {
        s.era = { ...s.era, tier: R.forceEra, name: R.ERAS[R.forceEra]?.name ?? s.era.name };
      }

      if (s.era.tier !== this.eraTier) {
        const up = this.eraTier >= 0 && s.era.tier > this.eraTier;
        this.eraTier = s.era.tier;
        this.bg.setEra(s.era.tier, first);
        this.kingdom.setEra(s.era.tier, !first);
        if (up) {
          this.hud.banner(`✨ Nova Era: ${s.era.name}!`, '#ffd166', 2200, 'O Reino cresce com a força de vocês');
          Sound.newSeason();
        }
      }

      this.bg.setBoss(s.isBoss);

      const { changed, damage } = this.monsters.set(s, first);
      if (!changed && damage > 0) {
        this.pendingDamage += damage;
        this.monsters.hit();
      }

      this.kingdom.setHpRatio(s.kingdomHp / s.kingdomMaxHp);
      if (!first && this.lastKingdomHp !== null && !this.kingdom.crumbling) {
        const healed = s.kingdomHp - this.lastKingdomHp;
        if (healed >= 8 && healed < s.kingdomMaxHp * 0.6) {
          this.fx.floatText(this.kingdom.x + 90, R.GROUND_Y - 190, `+${Math.round(healed)}`, { color: '#7cfc9a', size: 24, rise: 50 });
        }
      }
      this.lastKingdomHp = s.kingdomHp;

      this.hud.setState(s, first);
    }

    // ---------------------------------------------------------------- eventos de viewer

    applyFx(e) {
      switch (e.type) {
        case 'like':
          this.fx.fireLike(e.likeCount ?? 1);
          break;
        case 'comment':
          this.hud.addFeed(`${this.levelTag(e)}${e.user.nickname}: ${R.truncate(e.comment, 40)}`, '#9fd3ff');
          this.fx.fireComment();
          break;
        case 'gift': {
          const tier = R.giftTier(e.totalDiamondValue ?? 0);
          this.hud.queueGift(e, tier);
          this.fx.fireGift(tier);
          if (tier === R.GIFT_TIERS.high) Sound.giftHigh();
          else if (tier === R.GIFT_TIERS.mid) Sound.giftMedium();
          else Sound.giftLow();
          break;
        }
        case 'follow':
          this.hud.addFeed(`${this.levelTag(e)}${e.user.nickname} entrou no exército do Reino!`, '#7cfc9a');
          // quem acabou de seguir é Guardião; o servidor refina classe/nível no próximo sync
          this.heroes.add(
            e.user.userId ?? e.user.nickname,
            e.user.nickname,
            true,
            e.level ? { level: e.level, titleIndex: R.titleIndexForLevel(e.level), classKey: 'guardian' } : undefined,
          );
          this.fx.healBurst(this.kingdom.x + 20, R.GROUND_Y - 40);
          Sound.follow();
          break;
        case 'share':
          this.hud.addFeed(`${this.levelTag(e)}${e.user.nickname} convocou reforços!`, '#7cc4fc');
          this.fx.fireShare();
          Sound.share();
          break;
        default:
          break;
      }
    }

    /** "Nv12 " na frente do nome no feed (vazio se o servidor não mandou o nível). */
    levelTag(e) {
      return e.level ? `Nv${e.level} ` : '';
    }

    // ---------------------------------------------------------------- progressão

    /** Nível/missão/conquista de alguém: toast no HUD, atualização do herói na tela e efeito no mundo. */
    applyProgress(m) {
      const now = this.time.now;
      const quiet = now - (this.lastProgressSoundAt ?? 0) < 400; // rajada de avisos não vira rajada de som
      if (!quiet) this.lastProgressSoundAt = now;

      switch (m.kind) {
        case 'levelUp': {
          const color = R.TITLE_COLORS[Math.min(R.TITLE_COLORS.length - 1, m.titleIndex)];
          this.hud.toast({ icon: '⬆️', title: `${m.user.nickname} → Nível ${m.level}`, sub: m.title, color });
          this.heroes.update(m.user.userId, { level: m.level, titleIndex: m.titleIndex, classKey: m.classKey });
          const pos = this.heroes.positionOf(m.user.userId);
          if (pos) {
            this.fx.rise(pos.x, pos.y - 40, color, 24);
            this.fx.shockwave(pos.x, pos.y - 30, color, 2);
            this.fx.floatText(pos.x, pos.y - 140, `NÍVEL ${m.level}!`, { color: R.hex(color), size: 24, rise: 70 });
          }
          if (!quiet) Sound.giftMedium();
          break;
        }
        case 'mission':
          this.hud.toast({ icon: '🎯', title: `${m.user.nickname}: missão cumprida`, sub: `${m.title} (+${m.xp} XP)`, color: 0x7cfc9a });
          if (!quiet) Sound.follow();
          break;
        case 'achievement':
          this.hud.toast({ icon: m.icon, title: `${m.user.nickname}: ${m.title}`, sub: 'Nova conquista!', color: 0xffd166 });
          if (!quiet) Sound.waveCleared();
          break;
        default:
          break;
      }
    }

    // ---------------------------------------------------------------- narrativa

    applyNarrative(n) {
      switch (n.kind) {
        case 'waveCleared': {
          // várias ondas seguidas (gift gigante) não podem virar spam de banner
          const now = this.time.now;
          if (now - this.lastWaveBannerAt > 900) {
            this.lastWaveBannerAt = now;
            this.hud.banner(`Onda ${n.wave} derrotada!`, '#9fd3ff', 700);
            this.fx.waveCleared();
            Sound.waveCleared();
          }
          break;
        }
        case 'bossSpawned':
          this.hud.banner(`⚠ CHEFÃO: ${n.name}!`, '#ffd166', 2000, 'Derrotem-no antes que o Reino caia');
          this.fx.bossSpawned();
          Sound.bossSpawned();
          break;
        case 'bossDefeated':
          this.hud.banner(`${n.name} foi derrotado!`, '#ffd166', 2000, n.by ? `🎉 Golpe final de ${n.by.nickname}!` : '🎉');
          this.fx.bossDefeated();
          Sound.bossDefeated();
          break;
        case 'kingdomFall':
          this.hud.banner('O REINO CAIU!', '#ff6b6b', 2200, 'Reconstruindo...');
          this.kingdom.crumble();
          this.fx.kingdomFall();
          Sound.kingdomFall();
          this.time.delayedCall(2300, () => this.kingdom.rebuild());
          break;
        case 'goalCompleted':
          this.hud.banner('🎯 Meta cumprida!', '#7cfc9a', 1500, n.rewardText);
          this.hud.goalDone();
          if (n.reward === 'heal') this.fx.healBurst(this.kingdom.x + 20, R.GROUND_Y - 40);
          else this.fx.confetti(this.monsters.x, R.GROUND_Y - 60, 30);
          Sound.waveCleared();
          break;
        case 'newSeason':
          this.hud.banner(`🌅 Dia ${n.day} do Cerco`, '#ffe9a8', 3000, n.flavorText);
          this.bg.sunrise();
          Sound.newSeason();
          this.pollLeaderboard();
          break;
        default:
          break;
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: R.W,
    height: R.H,
    transparent: true,
    banner: false,
    fps: { target: R.lowfx ? 30 : 60 },
    // Qualidade máxima: antialias ligado, sem arredondar pixels (movimento sub-pixel suave)
    // e GPU de alto desempenho. A resolução interna já é a de saída (1280x720 ou 1080x1920).
    render: { antialias: true, antialiasGL: true, roundPixels: false, powerPreference: 'high-performance' },
    // FIT escala (com letterbox) mantendo a resolução interna — as posições
    // continuam válidas em qualquer tamanho de janela/Browser Source.
    scale: {
      mode: Phaser.Scale.FIT,
      autoRound: false,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: R.W,
      height: R.H,
    },
    scene: GameScene,
  });
  R.game = game;
})(window.Reino);

// Cena principal: monta cenário/castelo/monstro/heróis/efeitos/HUD e liga o
// WebSocket do servidor (state / fx / narrative) a eles.
(function main(R) {
  const WS_URL = `ws://${location.hostname}:8787/?role=${R.role}`;
  const LEADERBOARD_POLL_MS = 15_000;
  const CASTLE_X = R.LAYOUT.castleX;
  const MONSTER_X = R.LAYOUT.monsterX;
  const EVENT_BANNER = {
    bloodMoon: { icon: '🌑', color: 0xff6b6b },
    dawnBlessing: { icon: '🌅', color: 0xffd98a },
    horde: { icon: '⚔️', color: 0xffb27a },
    eliteBoss: { icon: '🛡️', color: 0x9fc8ff },
  };

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
      this.weather = new R.Weather(this, this.worldLayer, this.fx);
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
      this.monsters.strikeX = CASTLE_X + 235;
      // ataque em 3 tempos: aviso (faíscas vermelhas) → investida → impacto (poeira, tremor; chefão racha a muralha)
      this.monsters.onWindup = (x, y, isBoss) => {
        this.fx.rise(x, y, 0xff5a3a, isBoss ? 18 : 8);
      };
      this.monsters.onImpact = (x, y, isBoss) => {
        this.fx.smoke(x + 20, R.GROUND_Y + 4, isBoss ? 12 : 6);
        this.fx.burst(x, R.GROUND_Y - 10, 0xd8c8a0, isBoss ? 18 : 8);
        this.fx.shockwave(x, R.GROUND_Y, 0xd8c8a0, isBoss ? 2.2 : 1.2);
        this.fx.shake(isBoss ? 260 : 120, isBoss ? 0.006 : 0.003);
        this.kingdom.shake(isBoss ? 5 : 3);
        this.heroes.hop();
        if (isBoss) {
          this.kingdom.crack();
          this.hud.flashKingdom();
          this.fx.hitStop(70);
        }
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
      this.weather.update(time);
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
      if (s.world && (R.forceTod !== null || R.forceWeather)) {
        const tod = R.forceTod !== null && Number.isFinite(R.forceTod) ? R.forceTod : s.world.timeOfDay;
        s.world = { ...s.world, timeOfDay: tod, sunHeight: Math.sin(2 * Math.PI * tod), weather: R.forceWeather || s.world.weather };
      }
      if (s.world) {
        this.bg.setWorld(s.world);
        this.weather.set(s.world.weather);
        this.hud.setWorld(s.world);
        // Bênção do Amanhecer: faíscas de cura subindo do castelo enquanto dura
        if (s.world.event?.kind === 'dawnBlessing' && this.time.now - (this.lastBlessAt ?? 0) > 1600) {
          this.lastBlessAt = this.time.now;
          this.fx.healBurst(this.kingdom.x + R.rand(-60, 100), R.GROUND_Y - 40);
        }
      }

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
          this.fx.fireLike(e.likeCount ?? 1, e.heroClass, e.user.userId);
          break;
        case 'comment':
          this.hud.addFeed(`${this.levelTag(e)}${e.user.nickname}: ${R.truncate(e.comment, 40)}`, '#9fd3ff');
          this.fx.fireComment(e.heroClass, e.user.userId);
          break;
        case 'gift': {
          const tier = R.giftTier(e.totalDiamondValue ?? 0);
          this.hud.queueGift(e, tier);
          this.fx.fireGift(tier, e.giftName);
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

    /** Evento do Reino começou: banner, clarão e som próprios. Chefão Elite usa o banner de chefão (bossSpawned). */
    applyEventStarted(n) {
      const look = EVENT_BANNER[n.event];
      if (!look) return;
      if (n.event === 'eliteBoss') this.nextBossElite = true;
      if (n.event !== 'eliteBoss') this.hud.banner(`${look.icon} ${n.name}`, R.hex(look.color), 2600, n.flavor);
      switch (n.event) {
        case 'bloodMoon':
          this.fx.flash(500, 120, 10, 20);
          this.fx.shake(500, 0.008);
          Sound.bossSpawned();
          break;
        case 'dawnBlessing':
          this.fx.flash(420, 255, 230, 160);
          Sound.newSeason();
          break;
        case 'horde':
          this.fx.shake(450, 0.007);
          Sound.bossSpawned();
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
        case 'bossSpawned': {
          // abertura de chefão: faixas de cinema, nome grande e câmera enquadrando o monstro entrando
          const elite = this.nextBossElite;
          this.nextBossElite = false;
          this.hud.cinematic(
            `⚠ ${n.name.toUpperCase()}`,
            elite ? 'CHEFÃO ELITE BLINDADO — curtidas valem metade, comentários valem o dobro' : 'Derrotem-no antes que o Reino caia',
            elite ? '#9fc8ff' : '#ffd166',
          );
          this.fx.focus(this.monsters.x, R.GROUND_Y - 120, 1.08, 1500);
          this.fx.bossSpawned();
          Sound.bossSpawned();
          break;
        }
        case 'bossDefeated':
          this.hud.banner(`${n.name} foi derrotado!`, '#ffd166', 2000, n.by ? `🎉 Golpe final de ${n.by.nickname}!` : '🎉');
          this.fx.bossDefeated();
          this.fx.hitStop(110);
          this.fx.punchIn(1.07, 180);
          Sound.bossDefeated();
          break;
        case 'kingdomFall':
          this.hud.banner('O REINO CAIU!', '#ff6b6b', 2200, 'Reconstruindo...');
          this.kingdom.crumble();
          this.fx.kingdomFall();
          this.fx.punchIn(1.04, 200);
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
        case 'eventStarted':
          this.applyEventStarted(n);
          break;
        case 'eventEnded': {
          const look = EVENT_BANNER[n.event];
          if (look) this.hud.toast({ icon: look.icon, title: `${n.name} terminou`, color: look.color });
          break;
        }
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

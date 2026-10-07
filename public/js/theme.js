// Tema/constantes compartilhadas. Tudo no namespace global `Reino` (scripts
// simples, sem bundler — Phaser e o resto são servidos localmente).
window.Reino = window.Reino || {};

(function theme(R) {
  const params = new URLSearchParams(location.search);

  /**
   * Vertical (9:16) é o formato nativo do TikTok. Liga com ?vertical=1 (ou
   * ?orientation=portrait); ?vertical=0 força horizontal. Sem parâmetro, detecta
   * pelo tamanho da janela/Browser Source (altura > largura = vertical).
   */
  const orientation = params.get('orientation');
  R.vertical = params.has('vertical')
    ? params.get('vertical') !== '0'
    : orientation === 'portrait' || (orientation === null && window.innerHeight > window.innerWidth);

  // Resolução interna = resolução de saída do TikTok (1080x1920) pra render 1:1, sem reescala.
  R.W = R.vertical ? 1080 : 1280;
  R.H = R.vertical ? 1920 : 720;

  /** Todas as posições dependentes de orientação ficam aqui (e só aqui). */
  R.LAYOUT = R.vertical
    ? {
        groundY: 1240, // linha do chão: pés do castelo/monstro/heróis
        castleX: 250,
        monsterX: 800,
        // fator do HUD: no celular o canvas 1080 aparece ~390pt de largura, então texto/painéis crescem
        ui: 1.4,
        // zonas cobertas pela interface do TikTok (barra de cima, comentários/botões de baixo, ícones à direita)
        safe: { top: 170, bottom: 430, side: 30, right: 30 },
      }
    : { groundY: 575, castleX: 250, monsterX: 900, ui: 1, safe: { top: 0, bottom: 0, side: 24, right: 24 } };
  R.GROUND_Y = R.LAYOUT.groundY;
  R.UI = R.LAYOUT.ui;
  R.SAFE = R.LAYOUT.safe;

  /** Largura lógica de uma "telha" de fundo (montanhas/chão): repete na horizontal e cobre qualquer R.W. */
  R.TILE_W = 1280;
  /** Altura lógica da telha do chão; no vertical o que sobra até o fim da tela é preenchido por degradê (background.js). */
  R.GROUND_TILE_H = Math.min(185, R.H - R.GROUND_Y + 40);
  /** Spritesheets declarados no manifest: { chave: { frameWidth, frameHeight, anims } } — preenchido em boot.js. */
  R.SHEETS = {};
  /** Supersampling dos textos (renderizados em 2x e reduzidos): bordas nítidas em qualquer escala. */
  R.TEXT_RES = 2;

  /**
   * render  = o jogo de verdade (OBS); preview = iframe do painel admin.
   * O servidor só conta `render` pra detectar queda do OBS.
   */
  R.role = params.get('role') === 'preview' ? 'preview' : 'render';
  R.lowfx = params.has('lowfx');
  /** ?era=0..4 força o visual de uma Era (pra ajustar arte/gravar prévia) sem mexer no jogo. */
  R.forceEra = params.has('era') ? Number(params.get('era')) : null;
  /** 1 = tudo; <1 reduz partículas/estrelas pra máquinas fracas. */
  R.fxScale = R.lowfx ? 0.4 : 1;

  R.FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif';

  R.hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  R.lerpColor = (a, b, t) => {
    const ar = (a >> 16) & 255;
    const ag = (a >> 8) & 255;
    const ab = a & 255;
    const br = (b >> 16) & 255;
    const bg = (b >> 8) & 255;
    const bb = b & 255;
    return (
      (Math.round(ar + (br - ar) * t) << 16) |
      (Math.round(ag + (bg - ag) * t) << 8) |
      Math.round(ab + (bb - ab) * t)
    );
  };

  /** Paleta por Era (índice = tier do motor): céu, montanhas, chão, brilho das janelas. */
  R.ERAS = [
    { name: 'Acampamento', skyTop: 0x080d26, skyBottom: 0x27306a, far: 0x2c3566, near: 0x1b2248, ground: 0x2c4a2a },
    { name: 'Vila', skyTop: 0x150f3d, skyBottom: 0x6a3b86, far: 0x4a3470, near: 0x2f2250, ground: 0x2f5a30 },
    { name: 'Vila Fortificada', skyTop: 0x10224f, skyBottom: 0x3d78b5, far: 0x335a8e, near: 0x223f69, ground: 0x346a36 },
    { name: 'Cidade', skyTop: 0x1a3770, skyBottom: 0xf0a266, far: 0x6a5a86, near: 0x3f3a62, ground: 0x3a7438 },
    { name: 'Capital do Reino', skyTop: 0x231a63, skyBottom: 0xf27aa0, far: 0x7a4f88, near: 0x4a3068, ground: 0x3f7f3a },
  ];
  R.SKY_BOSS = { top: 0x1a0509, bottom: 0x6b1424 };

  R.MONSTER_SLUGS = {
    Goblin: 'goblin',
    'Lobo Sombrio': 'wolf',
    'Orc Batedor': 'orc',
    'Troll da Ponte': 'troll',
    Espectro: 'wraith',
    'Dragão Ancião': 'dragon',
    'Titã de Pedra': 'titan',
    'Senhor das Sombras': 'shadowlord',
    'Golem de Gelo': 'icegolem',
  };

  R.GIFT_TIERS = { low: 'baixo', mid: 'medio', high: 'alto' };
  R.giftTier = (value) => (value >= 1000 ? 'alto' : value >= 50 ? 'medio' : 'baixo');

  R.truncate = (text, max) => {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  R.rand = (min, max) => Math.random() * (max - min) + min;

  /** Hash estável (nickname -> cor de herói). */
  R.hashColor = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    const palette = [0xe4536a, 0x4fd1c5, 0xffd166, 0x8e7dff, 0x7cfc9a, 0xff9f5a, 0x5aa9ff, 0xf78fd4];
    return palette[Math.abs(hash) % palette.length];
  };
})(window.Reino);

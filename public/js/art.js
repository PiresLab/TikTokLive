// Arte procedural: todas as texturas são desenhadas por código na inicialização
// (Phaser Graphics/Canvas -> textura). Se existir um arquivo de imagem com a
// mesma chave em assets/manifest.json, o arquivo vence e o desenho é pulado —
// é assim que sprites são opcionais e trocáveis sem tocar no motor.
(function art(R) {
  const CX = 220; // centro horizontal dos castelos
  const B = 416; // linha do chão dentro da textura do castelo
  R.CASTLE_W = 440;
  R.CASTLE_H = 420;

  // ---------------------------------------------------------------- helpers

  function ensureGraphics(scene, key, w, h, draw) {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  function ensureCanvas(scene, key, w, h, draw) {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h);
    draw(tex.getContext(), w, h);
    tex.refresh();
  }

  const fill = (g, color, alpha = 1) => g.fillStyle(color, alpha);

  function poly(g, color, pts, alpha = 1) {
    g.fillStyle(color, alpha);
    g.fillPoints(pts.map(([x, y]) => ({ x, y })), true);
  }

  function stoneBlock(g, x, y, w, h, base = 0x8d93a8) {
    fill(g, base);
    g.fillRect(x, y, w, h);
    fill(g, 0xffffff, 0.14);
    g.fillRect(x, y, w, 3);
    fill(g, 0x000000, 0.2);
    g.fillRect(x, y + h - 4, w, 4);
    g.lineStyle(1, 0x000000, 0.14);
    for (let yy = y + 11; yy < y + h - 4; yy += 12) g.lineBetween(x, yy, x + w, yy);
  }

  function crenellations(g, x, y, w, color) {
    fill(g, color);
    const merlon = 9;
    for (let xx = x; xx + merlon <= x + w + 0.5; xx += merlon * 2) g.fillRect(xx, y - 9, merlon, 9);
  }

  function windowRect(g, x, y, w, h, lit = true) {
    fill(g, 0x1a1420);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    fill(g, lit ? 0xffd27a : 0x2b2740);
    g.fillRect(x, y, w, h);
    if (lit) {
      fill(g, 0xfff0b8, 0.7);
      g.fillRect(x, y, w, Math.max(2, h / 3));
    }
  }

  function roof(g, x, y, w, h, color) {
    poly(g, color, [[x, y + h], [x + w / 2, y], [x + w, y + h]]);
    poly(g, 0xffffff, [[x, y + h], [x + w / 2, y], [x + w / 2, y + h]], 0.1);
    fill(g, 0x000000, 0.18);
    g.fillRect(x, y + h - 3, w, 3);
  }

  function house(g, cx, baseY, w, h, wall, roofColor) {
    fill(g, wall);
    g.fillRect(cx - w / 2, baseY - h, w, h);
    fill(g, 0xffffff, 0.1);
    g.fillRect(cx - w / 2, baseY - h, w, 3);
    fill(g, 0x000000, 0.18);
    g.fillRect(cx - w / 2, baseY - 4, w, 4);
    roof(g, cx - w / 2 - 6, baseY - h - h * 0.55, w + 12, h * 0.55, roofColor);
    windowRect(g, cx - w * 0.28, baseY - h * 0.7, w * 0.2, h * 0.28);
    windowRect(g, cx + w * 0.08, baseY - h * 0.7, w * 0.2, h * 0.28);
    fill(g, 0x4a2c18);
    g.fillRect(cx - w * 0.09, baseY - h * 0.38, w * 0.18, h * 0.38);
  }

  function tower(g, x, baseY, w, h, stone, roofColor, roofH) {
    stoneBlock(g, x, baseY - h, w, h, stone);
    if (roofColor) {
      poly(g, roofColor, [[x - 6, baseY - h], [x + w / 2, baseY - h - roofH], [x + w + 6, baseY - h]]);
      poly(g, 0xffffff, [[x - 6, baseY - h], [x + w / 2, baseY - h - roofH], [x + w / 2, baseY - h]], 0.1);
    } else {
      crenellations(g, x, baseY - h, w, stone);
    }
    windowRect(g, x + w / 2 - 4, baseY - h + 24, 8, 16);
    windowRect(g, x + w / 2 - 4, baseY - h + 62, 8, 16, false);
  }

  function gate(g, cx, baseY, w, h, glow = 0xffb04a) {
    fill(g, 0x14101c);
    g.fillRect(cx - w / 2, baseY - h + w / 2, w, h - w / 2);
    g.fillCircle(cx, baseY - h + w / 2, w / 2);
    fill(g, glow, 0.55);
    g.fillRect(cx - w / 2 + 5, baseY - h + w / 2 + 2, w - 10, h - w / 2 - 2);
    g.fillCircle(cx, baseY - h + w / 2 + 2, w / 2 - 5);
    g.lineStyle(2, 0x000000, 0.35);
    g.lineBetween(cx, baseY - h + 6, cx, baseY);
  }

  // ---------------------------------------------------------------- castelos por Era

  /**
   * Âncoras (px na textura 440x420, origem embaixo-centro = (220, 416)) pro
   * kingdom.js pendurar o que se mexe: bandeiras, tochas, fogueira.
   */
  // `flags` = topo do mastro (a bandeira pende pra direita a partir dali).
  R.CASTLE_ANCHORS = [
    { fire: { x: CX, y: B - 12 }, flags: [{ x: CX - 70, y: B - 110 }], torches: [] },
    {
      fire: null,
      flags: [{ x: CX, y: B - 188 }],
      torches: [{ x: CX - 165, y: B - 26 }, { x: CX + 172, y: B - 26 }],
    },
    {
      fire: null,
      flags: [{ x: CX - 164, y: B - 182 }, { x: CX + 164, y: B - 182 }, { x: CX, y: B - 208 }],
      torches: [{ x: CX - 44, y: B - 52 }, { x: CX + 44, y: B - 52 }],
    },
    {
      fire: null,
      flags: [{ x: CX - 184, y: B - 256 }, { x: CX + 184, y: B - 256 }, { x: CX, y: B - 316 }],
      torches: [{ x: CX - 48, y: B - 56 }, { x: CX + 48, y: B - 56 }],
    },
    {
      fire: null,
      flags: [
        { x: CX - 184, y: B - 278 },
        { x: CX + 184, y: B - 278 },
        { x: CX - 74, y: B - 341 },
        { x: CX + 74, y: B - 341 },
        { x: CX, y: B - 398 },
      ],
      torches: [{ x: CX - 58, y: B - 60 }, { x: CX + 58, y: B - 60 }],
    },
  ];

  function pole(g, x, topY) {
    g.lineStyle(3, 0x4a2c18, 1);
    g.lineBetween(x, topY + 22, x, topY);
  }

  const CASTLES = [
    // 0 — Acampamento
    (g) => {
      for (let x = CX - 130; x <= CX + 130; x += 14) {
        const hgt = 34 + ((x * 7) % 9);
        fill(g, 0x6b4a2a);
        g.fillRect(x, B - hgt, 10, hgt);
        poly(g, 0x6b4a2a, [[x, B - hgt], [x + 5, B - hgt - 9], [x + 10, B - hgt]]);
        fill(g, 0x000000, 0.2);
        g.fillRect(x + 6, B - hgt, 4, hgt);
      }
      const tent = (cx, w, h, color, flap) => {
        poly(g, color, [[cx - w / 2, B], [cx, B - h], [cx + w / 2, B]]);
        poly(g, 0xffffff, [[cx - w / 2, B], [cx, B - h], [cx, B]], 0.1);
        poly(g, flap, [[cx - w * 0.14, B], [cx, B - h * 0.62], [cx + w * 0.14, B]]);
        g.lineStyle(2, 0x000000, 0.25);
        g.lineBetween(cx, B - h, cx, B);
        g.lineStyle(3, 0x4a2c18, 1);
        g.lineBetween(cx, B - h, cx, B - h - 22);
      };
      tent(CX - 70, 118, 88, 0xc9a46a, 0x3a2a1c);
      tent(CX + 80, 96, 70, 0xb5483c, 0x2b1a14);
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        fill(g, 0x8a8f9c);
        g.fillCircle(CX + Math.cos(a) * 17, B - 4 + Math.sin(a) * 4, 5);
      }
      fill(g, 0x5a3a20);
      g.fillRect(CX - 11, B - 8, 22, 5);
    },
    // 1 — Vila
    (g) => {
      tower(g, CX - 22, B, 44, 130, 0x9a8f80, 0x8a3a2e, 36);
      house(g, CX - 118, B, 92, 62, 0xb08a5a, 0x8a3a2e);
      house(g, CX + 108, B, 96, 70, 0xa88556, 0x7a3a8a);
      house(g, CX - 20, B, 108, 76, 0xb89466, 0xa3402f);
      pole(g, CX, B - 188);
      fill(g, 0x4a2c18);
      g.fillRect(CX - 168, B - 20, 5, 20);
      g.fillRect(CX + 170, B - 20, 5, 20);
    },
    // 2 — Vila Fortificada
    (g) => {
      house(g, CX - 100, B - 30, 70, 60, 0xa88556, 0x8a3a2e);
      house(g, CX + 100, B - 30, 70, 60, 0xa88556, 0x7a3a8a);
      stoneBlock(g, CX - 40, B - 176, 80, 120, 0x8d93a8);
      crenellations(g, CX - 40, B - 176, 80, 0x8d93a8);
      windowRect(g, CX - 8, B - 150, 16, 26);
      stoneBlock(g, CX - 150, B - 84, 300, 84, 0x959bb0);
      crenellations(g, CX - 150, B - 84, 300, 0x959bb0);
      gate(g, CX, B, 60, 66);
      tower(g, CX - 192, B, 56, 150, 0x8a90a6, null, 0);
      tower(g, CX + 136, B, 56, 150, 0x8a90a6, null, 0);
      pole(g, CX - 164, B - 182);
      pole(g, CX + 164, B - 182);
      pole(g, CX, B - 208);
    },
    // 3 — Cidade
    (g) => {
      for (const dx of [-120, -86, 90, 124]) house(g, CX + dx, B - 40, 44, 50, 0xa88556, 0x8a3a2e);
      stoneBlock(g, CX - 54, B - 224, 108, 150, 0x9aa0b6);
      poly(g, 0xb0382c, [[CX - 62, B - 224], [CX, B - 224 - 70], [CX + 62, B - 224]]);
      poly(g, 0xffffff, [[CX - 62, B - 224], [CX, B - 224 - 70], [CX, B - 224]], 0.1);
      for (const [wx, wy] of [[-30, 190], [14, 190], [-30, 150], [14, 150], [-8, 112]]) windowRect(g, CX + wx, B - wy, 16, 24);
      stoneBlock(g, CX - 170, B - 92, 340, 92, 0xa0a6bb);
      crenellations(g, CX - 170, B - 92, 340, 0xa0a6bb);
      gate(g, CX, B, 66, 74);
      tower(g, CX - 216, B, 64, 176, 0x8a90a6, 0x3f6aa8, 58);
      tower(g, CX + 152, B, 64, 176, 0x8a90a6, 0x3f6aa8, 58);
      pole(g, CX - 184, B - 256);
      pole(g, CX + 184, B - 256);
      pole(g, CX, B - 316);
    },
    // 4 — Capital do Reino
    (g) => {
      const GOLD = 0xe0a93a;
      tower(g, CX - 100, B - 20, 52, 235, 0x9aa0b6, GOLD, 64);
      tower(g, CX + 48, B - 20, 52, 235, 0x9aa0b6, GOLD, 64);
      stoneBlock(g, CX - 56, B - 270, 112, 190, 0xa6acc2);
      poly(g, GOLD, [[CX - 66, B - 270], [CX, B - 270 - 98], [CX + 66, B - 270]]);
      poly(g, 0xffffff, [[CX - 66, B - 270], [CX, B - 270 - 98], [CX, B - 270]], 0.18);
      fill(g, GOLD);
      g.fillRect(CX - 2, B - 270 - 118, 4, 24);
      g.fillCircle(CX, B - 270 - 120, 6);
      for (const [wx, wy] of [[-34, 232], [18, 232], [-34, 188], [18, 188], [-8, 142]]) windowRect(g, CX + wx, B - wy, 16, 28);
      stoneBlock(g, CX - 182, B - 98, 364, 98, 0xaab0c6);
      crenellations(g, CX - 182, B - 98, 364, 0xaab0c6);
      fill(g, GOLD);
      g.fillRect(CX - 182, B - 98, 364, 4);
      for (const bx of [-130, 130]) {
        fill(g, 0xb0243a);
        g.fillRect(CX + bx - 10, B - 92, 20, 44);
        poly(g, 0xb0243a, [[CX + bx - 10, B - 48], [CX + bx, B - 38], [CX + bx + 10, B - 48]]);
        fill(g, GOLD);
        g.fillRect(CX + bx - 10, B - 92, 20, 3);
      }
      gate(g, CX, B, 78, 86, 0xffc860);
      tower(g, CX - 220, B, 72, 192, 0x8a90a6, GOLD, 64);
      tower(g, CX + 148, B, 72, 192, 0x8a90a6, GOLD, 64);
      pole(g, CX - 184, B - 278);
      pole(g, CX + 184, B - 278);
      pole(g, CX - 74, B - 341);
      pole(g, CX + 74, B - 341);
      pole(g, CX, B - 398);
    },
  ];

  // ---------------------------------------------------------------- monstros (desenho 100x100, olhando pra esquerda)

  const SHADOW = (g) => {
    fill(g, 0x000000, 0.25);
    g.fillEllipse(50, 96, 52, 7);
  };

  const MONSTERS = {
    goblin: (g) => {
      SHADOW(g);
      fill(g, 0x3f7d2c);
      g.fillRect(38, 80, 9, 16);
      g.fillRect(54, 80, 9, 16);
      fill(g, 0x5fae3c);
      g.fillEllipse(50, 66, 40, 38);
      fill(g, 0x8ad05a);
      g.fillEllipse(48, 70, 24, 22);
      g.fillStyle(0x5fae3c);
      g.fillEllipse(33, 66, 10, 24);
      g.fillEllipse(67, 64, 10, 24);
      poly(g, 0x7a4a24, [[68, 40], [76, 38], [84, 72], [74, 74]]);
      fill(g, 0xc9a46a);
      g.fillCircle(77, 46, 2);
      g.fillCircle(80, 58, 2);
      fill(g, 0x5fae3c);
      poly(g, 0x5fae3c, [[31, 36], [6, 28], [30, 48]]);
      poly(g, 0x5fae3c, [[61, 36], [86, 28], [62, 48]]);
      fill(g, 0x6fc047);
      g.fillCircle(46, 40, 17);
      fill(g, 0xffffff);
      g.fillCircle(40, 38, 5);
      g.fillCircle(53, 38, 5);
      fill(g, 0x111111);
      g.fillCircle(38, 39, 2.4);
      g.fillCircle(51, 39, 2.4);
      g.lineStyle(2, 0x1d3a14, 1);
      g.lineBetween(33, 31, 44, 34);
      g.lineBetween(59, 31, 48, 34);
      fill(g, 0x1a0f0f);
      g.fillRect(39, 48, 14, 5);
      poly(g, 0xffffff, [[41, 48], [43, 52], [45, 48]]);
      poly(g, 0xffffff, [[48, 48], [50, 52], [52, 48]]);
    },
    wolf: (g) => {
      SHADOW(g);
      poly(g, 0x2d3142, [[82, 62], [98, 42], [92, 68]]);
      fill(g, 0x2b2f3f);
      for (const x of [34, 42, 66, 74]) g.fillRect(x, 78, 7, 18);
      fill(g, 0x3a3f52);
      g.fillEllipse(58, 66, 56, 32);
      for (let x = 44; x <= 76; x += 8) poly(g, 0x2b2f3f, [[x - 4, 54], [x, 44], [x + 4, 54]]);
      poly(g, 0x464b61, [[10, 58], [30, 44], [46, 50], [44, 68], [22, 70]]);
      poly(g, 0x2b2f3f, [[34, 48], [36, 30], [46, 46]]);
      poly(g, 0x2b2f3f, [[44, 48], [52, 32], [54, 50]]);
      fill(g, 0xffd84d);
      g.fillCircle(35, 54, 3.4);
      fill(g, 0x111111);
      g.fillRect(34, 52, 2, 5);
      g.fillCircle(11, 60, 3);
      poly(g, 0xffffff, [[18, 67], [21, 74], [24, 67]]);
      poly(g, 0xffffff, [[27, 68], [30, 75], [33, 68]]);
      g.lineStyle(2, 0x1a1c28, 1);
      g.lineBetween(26, 50, 38, 53);
    },
    orc: (g) => {
      SHADOW(g);
      fill(g, 0x4d5a3a);
      g.fillRect(36, 78, 11, 18);
      g.fillRect(54, 78, 11, 18);
      poly(g, 0x6b7f4a, [[30, 52], [70, 52], [76, 82], [24, 82]]);
      poly(g, 0x6b4a2a, [[34, 54], [66, 54], [62, 76], [38, 76]]);
      g.lineStyle(2, 0x2a1a0c, 1);
      g.lineBetween(36, 54, 62, 76);
      g.lineBetween(64, 54, 40, 76);
      fill(g, 0x3a2a18);
      g.fillRect(26, 76, 48, 7);
      fill(g, 0x6b7f4a);
      g.fillEllipse(22, 64, 12, 28);
      g.fillEllipse(78, 62, 12, 28);
      fill(g, 0x5a3a20);
      g.fillRect(80, 32, 4, 54);
      poly(g, 0xaab2c4, [[84, 32], [98, 28], [98, 52], [84, 48]]);
      fill(g, 0x7d9457);
      g.fillCircle(50, 40, 14);
      poly(g, 0x8a8f9c, [[36, 38], [40, 22], [60, 22], [64, 38]]);
      poly(g, 0xe9e2c8, [[38, 28], [26, 14], [42, 24]]);
      poly(g, 0xe9e2c8, [[62, 28], [74, 14], [58, 24]]);
      fill(g, 0xff3b3b);
      g.fillCircle(44, 41, 3);
      g.fillCircle(56, 41, 3);
      fill(g, 0x1a0f0f);
      g.fillRect(43, 49, 14, 4);
      poly(g, 0xffffff, [[43, 52], [41, 43], [47, 51]]);
      poly(g, 0xffffff, [[57, 52], [59, 43], [53, 51]]);
    },
    troll: (g) => {
      SHADOW(g);
      fill(g, 0x6a5a4a);
      g.fillRect(34, 80, 14, 16);
      g.fillRect(54, 80, 14, 16);
      fill(g, 0x7b6a58);
      g.fillEllipse(52, 64, 54, 50);
      fill(g, 0x9a8970);
      g.fillEllipse(50, 70, 30, 28);
      fill(g, 0x4f7a3a);
      g.fillCircle(64, 52, 6);
      g.fillCircle(38, 60, 5);
      g.fillCircle(70, 72, 4);
      fill(g, 0x7b6a58);
      g.fillEllipse(24, 72, 12, 36);
      g.fillEllipse(78, 56, 12, 30);
      poly(g, 0x5a3a20, [[78, 22], [91, 18], [96, 58], [82, 62]]);
      fill(g, 0x3e2812);
      g.fillCircle(88, 34, 3);
      g.fillCircle(90, 48, 3);
      fill(g, 0x8a7a66);
      g.fillCircle(44, 36, 13);
      fill(g, 0x9a8970);
      g.fillCircle(35, 40, 4);
      fill(g, 0xffe066);
      g.fillCircle(40, 33, 2.6);
      g.fillCircle(49, 33, 2.6);
      g.lineStyle(2, 0x2a2016, 1);
      g.lineBetween(36, 28, 45, 30);
      poly(g, 0xf3ecd2, [[36, 46], [37, 41], [40, 46]]);
      poly(g, 0xf3ecd2, [[46, 46], [47, 41], [50, 46]]);
      fill(g, 0x2a2016);
      for (const x of [38, 44, 50]) poly(g, 0x2a2016, [[x, 24], [x + 3, 14], [x + 6, 24]]);
    },
    wraith: (g) => {
      fill(g, 0x000000, 0.12);
      g.fillEllipse(50, 96, 40, 6);
      poly(g, 0x9fd8ff, [[50, 18], [66, 30], [72, 60], [82, 90], [68, 84], [60, 95], [50, 86], [40, 95], [32, 84], [18, 90], [28, 60], [34, 30]], 0.78);
      poly(g, 0xd8f2ff, [[50, 24], [62, 34], [66, 60], [72, 82], [58, 78], [50, 82], [42, 78], [28, 82], [34, 60], [38, 34]], 0.5);
      poly(g, 0x9fd8ff, [[34, 50], [12, 62], [22, 68], [36, 58]], 0.7);
      poly(g, 0x9fd8ff, [[66, 50], [88, 62], [78, 68], [64, 58]], 0.7);
      fill(g, 0x16203a, 0.92);
      g.fillEllipse(50, 38, 24, 28);
      fill(g, 0xffffff);
      g.fillCircle(44, 38, 4.2);
      g.fillCircle(56, 38, 4.2);
      fill(g, 0x6ad0ff);
      g.fillCircle(44, 38, 2);
      g.fillCircle(56, 38, 2);
      fill(g, 0x0a0f20);
      g.fillEllipse(50, 50, 8, 10);
    },
    dragon: (g) => {
      SHADOW(g);
      poly(g, 0xa8281c, [[70, 70], [97, 58], [99, 72], [72, 86]]);
      for (const [x, y] of [[80, 66], [88, 63], [95, 62]]) poly(g, 0x5a0f0a, [[x - 3, y + 2], [x, y - 7], [x + 3, y + 2]]);
      poly(g, 0x7a1c14, [[50, 52], [58, 4], [94, 28], [82, 46], [92, 60], [62, 58]]);
      g.lineStyle(2, 0x3a0a08, 1);
      g.lineBetween(58, 6, 62, 56);
      g.lineBetween(76, 16, 70, 56);
      g.lineBetween(92, 28, 78, 56);
      fill(g, 0xa8281c);
      g.fillRect(40, 82, 9, 14);
      g.fillRect(62, 82, 9, 14);
      poly(g, 0xf0e6c8, [[38, 96], [40, 92], [44, 96]]);
      poly(g, 0xf0e6c8, [[60, 96], [62, 92], [66, 96]]);
      fill(g, 0xc8362a);
      g.fillEllipse(56, 66, 56, 40);
      fill(g, 0xf0b24a);
      g.fillEllipse(50, 75, 34, 20);
      for (let x = 48; x <= 74; x += 9) poly(g, 0x5a0f0a, [[x - 3, 48], [x, 38], [x + 3, 48]]);
      poly(g, 0xc8362a, [[38, 56], [26, 40], [22, 30], [34, 34], [46, 48]]);
      poly(g, 0xd8412f, [[6, 36], [24, 24], [36, 30], [34, 44], [16, 46]]);
      poly(g, 0xf0e6c8, [[24, 24], [28, 6], [33, 25]]);
      poly(g, 0xf0e6c8, [[33, 27], [41, 9], [38, 30]]);
      fill(g, 0xffe03a);
      g.fillCircle(24, 32, 3.4);
      fill(g, 0x111111);
      g.fillRect(23.2, 29.8, 1.8, 5);
      fill(g, 0xff9a2e);
      g.fillCircle(12, 42, 6);
      fill(g, 0xffe08a);
      g.fillCircle(12, 42, 3);
      poly(g, 0xffffff, [[14, 44], [16, 49], [19, 44]]);
      poly(g, 0xffffff, [[21, 44], [23, 49], [26, 43]]);
    },
    titan: (g) => {
      SHADOW(g);
      poly(g, 0x6e7480, [[32, 78], [48, 78], [50, 96], [30, 96]]);
      poly(g, 0x6e7480, [[52, 78], [68, 78], [70, 96], [50, 96]]);
      poly(g, 0x858c99, [[28, 36], [72, 36], [78, 62], [68, 82], [32, 82], [22, 62]]);
      poly(g, 0x000000, [[50, 36], [72, 36], [78, 62], [68, 82], [50, 82]], 0.15);
      fill(g, 0x727986);
      g.fillCircle(24, 40, 12);
      g.fillCircle(76, 40, 12);
      poly(g, 0x727986, [[14, 44], [24, 44], [26, 74], [12, 76]]);
      poly(g, 0x727986, [[76, 44], [86, 44], [88, 76], [74, 74]]);
      fill(g, 0x6e7480);
      g.fillCircle(18, 80, 9);
      g.fillCircle(82, 80, 9);
      poly(g, 0x9aa1ae, [[40, 18], [60, 18], [62, 34], [38, 34]]);
      fill(g, 0x6af2ff);
      g.fillRect(43, 24, 5, 4);
      g.fillRect(53, 24, 5, 4);
      fill(g, 0x14161c);
      g.fillRect(45, 30, 10, 2);
      g.lineStyle(2, 0x6af2ff, 0.85);
      g.lineBetween(40, 46, 48, 58);
      g.lineBetween(48, 58, 44, 72);
      g.lineBetween(62, 50, 56, 64);
      fill(g, 0x4f7a3a);
      g.fillCircle(30, 70, 4);
      g.fillCircle(66, 44, 3);
    },
    shadowlord: (g) => {
      fill(g, 0x9a4dff, 0.12);
      g.fillCircle(50, 55, 46);
      poly(g, 0x2a1a4a, [[50, 14], [70, 30], [80, 60], [92, 92], [78, 86], [70, 97], [58, 88], [50, 97], [42, 88], [30, 97], [22, 86], [8, 92], [20, 60], [30, 30]]);
      poly(g, 0x180c30, [[50, 24], [64, 36], [70, 62], [76, 86], [62, 80], [50, 90], [38, 80], [24, 86], [30, 62], [36, 36]]);
      fill(g, 0x5a3a20);
      g.fillRect(82, 26, 4, 68);
      fill(g, 0x9a4dff);
      g.fillCircle(84, 22, 8);
      fill(g, 0xe2c8ff);
      g.fillCircle(84, 22, 3.5);
      fill(g, 0x0b0614);
      g.fillEllipse(50, 36, 24, 26);
      fill(g, 0xff3b5c);
      g.fillCircle(44, 36, 3.6);
      g.fillCircle(56, 36, 3.6);
      poly(g, 0xb9a7d9, [[40, 26], [34, 6], [47, 22]]);
      poly(g, 0xb9a7d9, [[60, 26], [66, 6], [53, 22]]);
      poly(g, 0xb9a7d9, [[48, 22], [50, 8], [52, 22]]);
      fill(g, 0xd8d0ff);
      g.fillCircle(30, 62, 4.5);
      g.fillCircle(78, 60, 4.5);
    },
    icegolem: (g) => {
      SHADOW(g);
      poly(g, 0x5aa6d8, [[34, 84], [48, 84], [50, 96], [32, 96]]);
      poly(g, 0x5aa6d8, [[52, 84], [66, 84], [68, 96], [50, 96]]);
      poly(g, 0x7fc8f0, [[30, 40], [70, 40], [76, 74], [62, 90], [38, 90], [24, 74]]);
      poly(g, 0xaee4ff, [[50, 40], [70, 40], [76, 74], [50, 70]]);
      poly(g, 0x5aa6d8, [[30, 40], [50, 40], [50, 70], [24, 74]]);
      poly(g, 0x7fc8f0, [[24, 44], [6, 16], [34, 40]]);
      poly(g, 0xaee4ff, [[76, 44], [94, 16], [66, 40]]);
      poly(g, 0x7fc8f0, [[16, 52], [4, 76], [18, 86], [30, 60]]);
      poly(g, 0x7fc8f0, [[84, 52], [96, 76], [82, 86], [70, 60]]);
      poly(g, 0xaee4ff, [[42, 22], [58, 22], [62, 36], [38, 36]]);
      poly(g, 0xaee4ff, [[44, 22], [50, 8], [56, 22]]);
      poly(g, 0xdff6ff, [[36, 24], [30, 12], [42, 22]]);
      fill(g, 0xffffff);
      g.fillCircle(45, 29, 3.2);
      g.fillCircle(55, 29, 3.2);
      fill(g, 0x6ad0ff);
      g.fillCircle(45, 29, 1.5);
      g.fillCircle(55, 29, 1.5);
      fill(g, 0xffffff, 0.9);
      for (const [x, y] of [[40, 56], [60, 62], [48, 78], [66, 50]]) g.fillCircle(x, y, 1.8);
    },
  };

  const BOSS_SLUGS = ['dragon', 'titan', 'shadowlord', 'icegolem'];

  /**
   * Tamanho LÓGICO (em pixels do jogo) de cada textura trocável. Uma imagem do
   * manifest pode ter qualquer resolução (ex.: 2x ou 3x): é exibida neste tamanho.
   */
  R.sizeOf = function sizeOf(key) {
    if (/^castle_tier\d+$/.test(key)) return { w: R.CASTLE_W, h: R.CASTLE_H };
    if (key.startsWith('monster_')) {
      const size = BOSS_SLUGS.includes(key.slice(8)) ? R.BOSS_SIZE : R.NORMAL_SIZE;
      return { w: size, h: size };
    }
    if (key === 'hero_body') return { w: 40, h: 64 };
    if (key === 'hero_head') return { w: 20, h: 20 };
    if (key === 'mountain_far' || key === 'mountain_near') return { w: R.TILE_W, h: 240 };
    if (key === 'ground') return { w: R.TILE_W, h: R.GROUND_TILE_H };
    return null;
  };

  /** Fator que leva a textura (qualquer resolução) ao tamanho lógico — 1 pra arte procedural. */
  R.baseScale = function baseScale(scene, key) {
    const size = R.sizeOf(key);
    if (!size || !scene.textures.exists(key)) return 1;
    const sheet = R.SHEETS[key];
    const frameWidth = sheet ? sheet.frameWidth : scene.textures.getFrame(key).width;
    return frameWidth > 0 ? size.w / frameWidth : 1;
  };

  /** Ajusta uma imagem sem animação de escala (fundo) ao tamanho lógico, esticando se a proporção diferir. */
  R.place = function place(image, key) {
    const size = R.sizeOf(key);
    if (size) image.setDisplaySize(size.w, size.h);
    return image;
  };
  R.NORMAL_SIZE = 190;
  R.BOSS_SIZE = 330;

  // ---------------------------------------------------------------- herói

  function drawHeroBody(g) {
    poly(g, 0xffffff, [[8, 26], [32, 26], [37, 62], [3, 62]], 0.9); // capa
    fill(g, 0xe8ecff);
    g.fillRect(12, 24, 16, 22);
    fill(g, 0xcfd4e6);
    g.fillRect(13, 46, 6, 16);
    g.fillRect(21, 46, 6, 16);
    fill(g, 0x9aa1ae);
    g.fillRect(31, 28, 3, 22);
    poly(g, 0xdfe3ee, [[30, 28], [32.5, 18], [35, 28]]);
  }

  function drawHeroHead(g) {
    fill(g, 0xf3c9a0);
    g.fillCircle(10, 11, 8);
    fill(g, 0x5a3a20);
    g.fillRect(2, 3, 16, 5);
    fill(g, 0x1a1420);
    g.fillCircle(7.5, 11, 1.1);
    g.fillCircle(12.5, 11, 1.1);
  }

  // ---------------------------------------------------------------- geração

  R.generateTextures = function generateTextures(scene) {
    ensureCanvas(scene, 'px', 4, 4, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 4, 4);
    });

    ensureCanvas(scene, 'glow', 128, 128, (ctx) => {
      const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
    });

    ensureCanvas(scene, 'spark', 32, 32, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.quadraticCurveTo(17.5, 14.5, 32, 16);
      ctx.quadraticCurveTo(17.5, 17.5, 16, 32);
      ctx.quadraticCurveTo(14.5, 17.5, 0, 16);
      ctx.quadraticCurveTo(14.5, 14.5, 16, 0);
      ctx.fill();
    });

    ensureCanvas(scene, 'star', 8, 8, (ctx) => {
      const grd = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 8, 8);
    });

    ensureCanvas(scene, 'ring', 128, 128, (ctx) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(64, 64, 58, 0, Math.PI * 2);
      ctx.stroke();
    });

    ensureCanvas(scene, 'vignette', R.W, R.H, (ctx, w, h) => {
      const grd = ctx.createRadialGradient(w / 2, h / 2, 180, w / 2, h / 2, 780);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    });

    ensureCanvas(scene, 'flag', 30, 20, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(30, 4);
      ctx.lineTo(23, 10);
      ctx.lineTo(30, 16);
      ctx.lineTo(0, 19);
      ctx.closePath();
      ctx.fill();
    });

    ensureCanvas(scene, 'arrow', 44, 10, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 4, 34, 2);
      ctx.beginPath();
      ctx.moveTo(44, 5);
      ctx.lineTo(32, 0);
      ctx.lineTo(32, 10);
      ctx.fill();
      ctx.fillRect(0, 2, 6, 6);
    });

    const ridge = (key, base, amp, phases, alphaTop) =>
      ensureCanvas(scene, key, R.TILE_W, 240, (ctx, w, h) => {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) {
          const t = (x / w) * Math.PI * 2;
          const y =
            base -
            (Math.sin(t * 2 + phases[0]) * amp[0] + Math.sin(t * 5 + phases[1]) * amp[1] + Math.sin(t * 11 + phases[2]) * amp[2]);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, `rgba(255,255,255,${alphaTop})`);
        grd.addColorStop(1, 'rgba(255,255,255,0.7)');
        ctx.fillStyle = grd;
        ctx.fill();
      });
    ridge('mountain_far', 120, [34, 16, 6], [0.3, 1.7, 0.4], 0.95);
    ridge('mountain_near', 150, [28, 14, 8], [2.1, 0.6, 1.3], 1);

    ensureCanvas(scene, 'ground', R.TILE_W, R.GROUND_TILE_H, (ctx, w, h) => {
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.08, '#d6d6d6');
      grd.addColorStop(1, '#6a6a6a');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      for (let x = 0; x + 6 <= w; x += 7) {
        const hgt = 4 + ((x * 13) % 7);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(x, 6);
        ctx.lineTo(x + 3, 6 - hgt);
        ctx.lineTo(x + 6, 6);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let i = 0; i < 90; i += 1) ctx.fillRect((i * 97) % w, 24 + ((i * 53) % (h - 30)), 8 + (i % 5) * 4, 2);
    });

    CASTLES.forEach((draw, tier) => ensureGraphics(scene, `castle_tier${tier}`, R.CASTLE_W, R.CASTLE_H, draw));

    Object.entries(MONSTERS).forEach(([slug, draw]) => {
      const size = BOSS_SLUGS.includes(slug) ? R.BOSS_SIZE : R.NORMAL_SIZE;
      ensureGraphics(scene, `monster_${slug}`, size, size, (g) => {
        g.save();
        g.scaleCanvas(size / 100, size / 100);
        draw(g);
        g.restore();
      });
    });

    ensureGraphics(scene, 'hero_body', 40, 64, drawHeroBody);
    ensureGraphics(scene, 'hero_head', 20, 20, drawHeroHead);
  };
})(window.Reino);

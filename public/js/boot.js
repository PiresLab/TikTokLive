// Arte opcional: `assets/manifest.json` pode listar
//   { "images": { chave: "arquivo.png" },
//     "spritesheets": { chave: { "file": "x.png", "frameWidth": 190, "frameHeight": 190,
//                                "anims": { "idle": { "frames": [0,1,2,3], "frameRate": 8 }, "attack": {...}, "hit": {...} } } } }
// Cada imagem SUBSTITUI a arte procedural da mesma chave (art.js só desenha o que
// ainda não existe como textura). A imagem pode ter qualquer resolução (2x, 3x...):
// é exibida no tamanho lógico de R.sizeOf(chave). Sem manifest/arquivos, 100% procedural.
(function boot(R) {
  const isFrameList = (frames) => Array.isArray(frames) && frames.length > 0 && frames.every((n) => Number.isInteger(n) && n >= 0);

  R.loadManifest = function loadManifest(scene) {
    scene.load.setPath('assets/');
    scene.load.json('manifest', 'manifest.json');
    scene.load.on('filecomplete-json-manifest', (_key, _type, data) => {
      const images = data && typeof data.images === 'object' && data.images ? data.images : {};
      for (const [textureKey, file] of Object.entries(images)) {
        if (typeof file === 'string') scene.load.image(textureKey, file);
      }

      const sheets = data && typeof data.spritesheets === 'object' && data.spritesheets ? data.spritesheets : {};
      for (const [textureKey, def] of Object.entries(sheets)) {
        const valid = def && typeof def.file === 'string' && def.frameWidth > 0 && def.frameHeight > 0;
        if (!valid) {
          console.warn(`[arte] spritesheet inválido (${textureKey}): precisa de file, frameWidth e frameHeight`);
          continue;
        }
        R.SHEETS[textureKey] = {
          frameWidth: def.frameWidth,
          frameHeight: def.frameHeight,
          anims: def.anims && typeof def.anims === 'object' ? def.anims : {},
        };
        scene.load.spritesheet(textureKey, def.file, { frameWidth: def.frameWidth, frameHeight: def.frameHeight });
      }
    });
    scene.load.on('loaderror', (file) => {
      delete R.SHEETS[file.key]; // spritesheet que não carregou: volta pra arte procedural
      console.warn(`[arte] arquivo ausente (${file.key}) — usando arte procedural`);
    });
  };

  /** Cria as animações declaradas no manifest como `${chave}:${nome}` (idle repete; as outras tocam uma vez). */
  R.createAnims = function createAnims(scene) {
    for (const [textureKey, sheet] of Object.entries(R.SHEETS)) {
      if (!scene.textures.exists(textureKey)) continue;
      for (const [name, def] of Object.entries(sheet.anims)) {
        if (!def || !isFrameList(def.frames)) {
          console.warn(`[arte] animação inválida (${textureKey}:${name}): "frames" deve ser uma lista de números`);
          continue;
        }
        scene.anims.create({
          key: `${textureKey}:${name}`,
          frames: scene.anims.generateFrameNumbers(textureKey, { frames: def.frames }),
          frameRate: def.frameRate > 0 ? def.frameRate : 8,
          repeat: name === 'idle' ? -1 : 0,
        });
      }
    }
  };

  /** Cria Sprite (se a chave é spritesheet carregado) ou Image, já na escala lógica, tocando `idle` se existir. */
  R.makeVisual = function makeVisual(scene, textureKey) {
    const animated = Boolean(R.SHEETS[textureKey]) && scene.textures.exists(textureKey);
    const visual = animated ? scene.add.sprite(0, 0, textureKey, 0) : scene.add.image(0, 0, textureKey);
    visual.baseScale = R.baseScale(scene, textureKey);
    visual.setScale(visual.baseScale);
    if (animated && scene.anims.exists(`${textureKey}:idle`)) visual.play(`${textureKey}:idle`);
    return visual;
  };

  /** Toca uma animação pontual (ataque/dano) e volta pro idle. Sem animação no manifest, não faz nada. */
  R.playOnce = function playOnce(scene, visual, textureKey, name) {
    const key = `${textureKey}:${name}`;
    if (!visual.anims || !scene.anims.exists(key)) return;
    visual.play(key);
    if (scene.anims.exists(`${textureKey}:idle`)) visual.chain(`${textureKey}:idle`);
  };
})(window.Reino);

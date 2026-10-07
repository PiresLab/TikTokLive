// Sprites opcionais: se `assets/manifest.json` listar { "images": { chave: arquivo } },
// cada imagem é carregada com essa chave e SUBSTITUI a arte procedural
// correspondente (art.js só desenha o que ainda não existe como textura).
// Sem manifest/arquivos, o jogo usa 100% arte gerada por código.
(function boot(R) {
  R.loadManifest = function loadManifest(scene) {
    scene.load.setPath('assets/');
    scene.load.json('manifest', 'manifest.json');
    scene.load.on('filecomplete-json-manifest', (_key, _type, data) => {
      const images = data && typeof data.images === 'object' && data.images ? data.images : {};
      for (const [textureKey, file] of Object.entries(images)) {
        if (typeof file === 'string') scene.load.image(textureKey, file);
      }
    });
    scene.load.on('loaderror', (file) => {
      console.warn(`[arte] arquivo ausente (${file.key}) — usando arte procedural`);
    });
  };
})(window.Reino);

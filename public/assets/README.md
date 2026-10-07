# Arte opcional (sprites)

O jogo se desenha **sozinho** (arte procedural em `public/js/art.js`) — nada aqui é obrigatório.
Pra trocar qualquer elemento por uma imagem sua:

1. Coloque o PNG nesta pasta.
2. Liste em `manifest.json` com a **chave** do elemento.
3. Recarregue a página (ou a Browser Source do OBS). Não precisa reiniciar o servidor.

```json
{
  "images": {
    "castle_tier2": "castelo-fortificado.png",
    "monster_goblin": "goblin.png"
  },
  "spritesheets": {
    "monster_wolf": {
      "file": "lobo.png",
      "frameWidth": 380,
      "frameHeight": 380,
      "anims": {
        "idle":   { "frames": [0, 1, 2, 3], "frameRate": 8 },
        "attack": { "frames": [4, 5, 6],    "frameRate": 12 },
        "hit":    { "frames": [7],          "frameRate": 12 }
      }
    }
  }
}
```

Chave no manifest + arquivo existente = a imagem substitui o desenho. Arquivo ausente = continua o desenho procedural (aparece só um aviso no console).

## Resolução: faça em 2x (ou 3x)

Cada imagem pode ter **qualquer resolução**: o jogo a exibe no **tamanho lógico** da tabela abaixo (a escala é calculada sozinha pelo tamanho do arquivo). Arte em 2x fica nítida no modo vertical 1080×1920 e quando o TikTok reescala o vídeo. Só mantenha a **mesma proporção** do tamanho lógico.

## Chaves e tamanhos

| Chave | Tamanho lógico | Em 2x | Observação |
|---|---|---|---|
| `castle_tier0` … `castle_tier4` | 440×420 | 880×840 | Acampamento, Vila, Vila Fortificada, Cidade, Capital. Pés do castelo na linha y=416 (centro-baixo). |
| `monster_goblin` `monster_wolf` `monster_orc` `monster_troll` `monster_wraith` | 190×190 | 380×380 | Monstros normais. **Olhando pra esquerda** (pro castelo), pés perto da borda de baixo. |
| `monster_dragon` `monster_titan` `monster_shadowlord` `monster_icegolem` | 330×330 | 660×660 | Chefões, mesma regra. |
| `hero_body` | 40×64 | 80×128 | Pintado com a cor do herói (hash do nome): desenhe em branco/cinza claro. |
| `hero_head` | 20×20 | 40×40 | Cabeça, sem tinta. |
| `mountain_far`, `mountain_near` | 1280×240 | 2560×480 | **Telha horizontal**: repete (parallax), então a borda esquerda tem que emendar com a direita. Funciona em horizontal e vertical. Pintadas pela cor da Era: use branco/cinza. |
| `ground` | 1280 × (altura do chão) | — | Também repete na horizontal e recebe a cor da Era. A altura lógica é **185** no horizontal e **720** no vertical (a imagem é esticada na vertical até lá): faça o topo com a grama e deixe a parte de baixo lisa. |
| `glow` `spark` `star` `ring` `flag` `arrow` `vignette` `px` | vários | — | Texturas de efeito (brilho, faísca, estrela, onda de choque, bandeira, flecha, vinheta do chefão). Brancas: o jogo aplica a cor. Mantenha o tamanho original. |

## Spritesheets e animações

- Só `monster_*` e `hero_body`/`hero_head` aceitam spritesheet (tira de quadros iguais, lidos da esquerda pra direita, de cima pra baixo; quadro 0 = primeiro).
- `frameWidth`/`frameHeight` são do **arquivo** (ex.: 380 pra um monstro 2x). A proporção do quadro deve ser a do tamanho lógico.
- Animações reconhecidas: `idle` (repete; toca sozinha), `attack` (quando o monstro investe na muralha) e `hit` (quando leva dano). `attack` e `hit` tocam uma vez e voltam pro `idle`. Todas são opcionais; sem elas o jogo usa os movimentos procedurais de sempre (balançar, piscar branco).
- `frames` é uma lista de números de quadro; `frameRate` em quadros/segundo (padrão 8).

## Guia de estilo (cartoon 2D polido) pra quem gera a arte

Mantenha **todas** as peças consistentes entre si:

- Contorno escuro e suave (cor do material bem escurecida, nunca preto puro), espessura parecida em todas as peças.
- 3 tons por material (sombra, base, luz), com **luz vinda de cima e da esquerda**.
- Paleta das Eras: Acampamento (noite azul/roxa), Vila (roxo), Vila Fortificada (azul), Cidade (laranja ao fim da tarde), Capital (rosa/dourado). Cores vivas, sem cinza sujo.
- Fundo **transparente** em castelos, monstros e heróis; sem sombra projetada embutida (o jogo desenha a sua).
- Monstros de perfil, olhando pra esquerda; formas grandes e legíveis (a tela é vista no celular).

## Âncoras do castelo (bandeiras, tochas, fogueira)

Bandeiras, tochas e fogueira são desenhadas **por cima** do castelo. Pra arte nova, declare onde ficam no `manifest.json`, em pixels **lógicos** da textura de 440×420 (a base do castelo está em y=416; arte 2x: divida as coordenadas do arquivo por 2):

```json
"anchors": {
  "castle_tier2": {
    "flags":   [{ "x": 84, "y": 64 }, { "x": 220, "y": 50 }],
    "torches": [{ "x": 132, "y": 360 }],
    "fire":    { "x": 220, "y": 386 }
  }
}
```

`flags` = topo do mastro (a bandeira pende pra direita), `torches` = luz tremeluzindo, `fire` = fogueira. Todos opcionais; sem `anchors` o castelo usa as posições do desenho procedural.

## Atenção

- Imagens são carregadas uma vez no início: mantenha PNGs leves (o jogo roda 24/7).
- `?lowfx=1` na URL reduz estrelas, partículas e parallax (máquina fraca). `?era=0..4` força o visual de uma Era (pra ajustar arte). `?vertical=1` mostra o layout 1080×1920.

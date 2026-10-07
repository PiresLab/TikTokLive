# Sprites opcionais

O jogo se desenha **sozinho** (arte procedural em `public/js/art.js`) — nada aqui é obrigatório.
Pra trocar qualquer elemento por uma imagem sua:

1. Coloque o PNG nesta pasta.
2. Liste em `manifest.json` com a **chave** do elemento:

```json
{
  "images": {
    "monster_goblin": "goblin.png",
    "castle_tier2": "castelo-fortificado.png"
  }
}
```

Chave presente no manifest + arquivo existente = a imagem substitui o desenho. Arquivo ausente = continua o desenho procedural (aparece só um aviso no console). Não precisa reiniciar o servidor; é só recarregar a página (ou a Browser Source do OBS).

## Chaves e tamanhos

| Chave | Tamanho | Observação |
|---|---|---|
| `castle_tier0` … `castle_tier4` | 440×420 | Acampamento, Vila, Vila Fortificada, Cidade, Capital. Pés do castelo na linha y=416 (centro-baixo). |
| `monster_goblin` `monster_wolf` `monster_orc` `monster_troll` `monster_wraith` | 190×190 | Monstros normais. **Olhando pra esquerda** (pro castelo), pés perto da borda de baixo. |
| `monster_dragon` `monster_titan` `monster_shadowlord` `monster_icegolem` | 330×330 | Chefões, mesma regra. |
| `hero_body` | 40×64 | Pintado com a cor do herói (hash do nome): desenhe em branco/cinza claro. |
| `hero_head` | 20×20 | Cabeça, sem tinta. |
| `mountain_far`, `mountain_near` | 1280×240 | Repetem na horizontal (parallax): a borda esquerda tem que emendar com a direita. Pintadas pela cor da Era: use branco/cinza. |
| `ground` | 1280×185 | Chão; também recebe a cor da Era. |
| `glow` `spark` `star` `ring` `flag` `arrow` `vignette` `px` | vários | Texturas de efeito (brilho, faísca, estrela, onda de choque, bandeira, flecha, vinheta do chefão). Brancas: o jogo aplica a cor. |

## Atenção

- Bandeiras, tochas e fogueira são desenhadas **por cima** do castelo em posições fixas (`R.CASTLE_ANCHORS` em `public/js/art.js`). Se a silhueta do seu castelo for outra, ajuste essas âncoras.
- Imagens são carregadas uma vez no início: deixe PNGs leves (o jogo roda 24/7).
- `?lowfx=1` na URL reduz estrelas, partículas e parallax (máquina fraca). `?era=0..4` força o visual de uma Era (pra ajustar arte).

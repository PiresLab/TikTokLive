export type GameEventType =
  | 'like'
  | 'comment'
  | 'gift'
  | 'follow'
  | 'share'
  | 'connected'
  | 'disconnected'
  | 'streamEnd';

export interface GameEventUser {
  userId: string;
  username: string;
  nickname: string;
}

export interface GameEvent {
  type: GameEventType;
  user: GameEventUser;
  timestamp: number;

  /** Injetado pelo painel admin: afeta o jogo/efeitos, mas não grava no banco nem nos totais vitalícios. */
  isTest?: boolean;

  /** Nível de progressão de quem causou o evento (preenchido ao transmitir pro client; não vem do TikTok). */
  level?: number;
  /** Classe do herói de quem causou o evento (guerreiro/arqueiro/mago/guardião): define o estilo do projétil no client. */
  heroClass?: 'knight' | 'archer' | 'mage' | 'guardian';

  /** like: curtidas no lote recebido */
  likeCount?: number;
  /** like: total acumulado de curtidas na sessão */
  totalLikes?: number;

  /** comment: texto da mensagem de chat */
  comment?: string;

  /** gift: identificação e valor do presente */
  giftId?: string;
  giftName?: string;
  diamondValue?: number;
  repeatCount?: number;
  comboEnded?: boolean;
  totalDiamondValue?: number;

  /** follow: contagem de seguidores reportada pelo evento (quando disponível) */
  followerCount?: number;

  /** share: quantidade de compartilhamentos reportada no evento */
  shareCount?: number;
}

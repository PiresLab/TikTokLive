import type { UserProgress } from '../persistence/db.js';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Verdadeiro quando o estado atual da pessoa já merece a conquista. */
  earned: (p: UserProgress, level: number) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_follow', title: 'Alistado', description: 'Seguiu o canal e entrou no exército', icon: '⚔️', earned: (p) => p.totalFollows >= 1 },
  { id: 'first_gift', title: 'Mecenas', description: 'Enviou o primeiro presente', icon: '🎁', earned: (p) => p.totalDiamondValue > 0 },
  { id: 'whale', title: 'Tesouro Real', description: '1.000 diamantes em presentes', icon: '💎', earned: (p) => p.totalDiamondValue >= 1000 },
  { id: 'herald', title: 'Arauto', description: 'Compartilhou a live', icon: '📣', earned: (p) => p.totalShares >= 1 },
  { id: 'bard', title: 'Bardo', description: '100 comentários', icon: '🎤', earned: (p) => p.totalComments >= 100 },
  { id: 'tireless', title: 'Mão Incansável', description: '1.000 curtidas', icon: '👍', earned: (p) => p.totalLikes >= 1000 },
  { id: 'regular', title: 'Frequentador', description: 'Ativo em 3 dias diferentes', icon: '📅', earned: (p) => p.daysActive >= 3 },
  { id: 'veteran', title: 'Veterano', description: 'Ativo em 7 dias diferentes', icon: '🏆', earned: (p) => p.daysActive >= 7 },
  { id: 'level10', title: 'Cavaleiro do Reino', description: 'Chegou ao nível 10', icon: '🛡️', earned: (_p, level) => level >= 10 },
  { id: 'level25', title: 'Herói Lendário', description: 'Chegou ao nível 25', icon: '⭐', earned: (_p, level) => level >= 25 },
  // concedida direto pelo serviço (depende de quem deu o golpe final no chefão)
  { id: 'boss_slayer', title: 'Mata-Chefões', description: 'Deu o golpe final em um chefão', icon: '🐉', earned: () => false },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

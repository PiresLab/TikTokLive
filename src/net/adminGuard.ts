/**
 * Barreira do painel admin. Ele NÃO tem senha (decisão do usuário: só
 * localhost), então a proteção é: a conexão tem que vir do próprio computador
 * E de uma página servida por ele. Isso barra:
 *  - outra máquina da rede (IP remoto não-loopback);
 *  - DNS rebinding (Host diferente de localhost/127.0.0.1/[::1]);
 *  - CSRF de qualquer site aberto no navegador (Origin estranho, e POST exige
 *    JSON + header `X-Admin`, que um formulário cross-site não consegue enviar).
 * Não é segurança pra expor a outra interface/porta pública.
 */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

function hostnameOf(hostHeader: string): string {
  // "[::1]:8080" -> "[::1]"; "localhost:8080" -> "localhost"
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  return hostHeader.split(':')[0];
}

export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOSTNAMES.has(hostnameOf(host).toLowerCase());
}

/** Ausência de Origin é aceita (curl/ferramentas locais); presença tem que ser local. */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    // URL.hostname de IPv6 já vem com colchetes ("[::1]")
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface AdminRequestInfo {
  remoteAddress: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  method: string;
  contentType: string | undefined;
  adminHeader: string | undefined;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkAdminHttp(req: AdminRequestInfo): GuardResult {
  if (!isLoopbackAddress(req.remoteAddress)) return { ok: false, reason: 'admin só aceita conexões locais' };
  if (!isLocalHostHeader(req.host)) return { ok: false, reason: 'Host inválido' };
  if (!isLocalOrigin(req.origin)) return { ok: false, reason: 'Origin inválido' };

  if (req.method === 'POST') {
    if (!req.contentType?.toLowerCase().startsWith('application/json')) {
      return { ok: false, reason: 'Content-Type deve ser application/json' };
    }
    if (req.adminHeader !== '1') return { ok: false, reason: 'header X-Admin ausente' };
  }
  return { ok: true };
}

export function checkAdminWs(req: Pick<AdminRequestInfo, 'remoteAddress' | 'host' | 'origin'>): GuardResult {
  if (!isLoopbackAddress(req.remoteAddress)) return { ok: false, reason: 'admin só aceita conexões locais' };
  if (!isLocalHostHeader(req.host)) return { ok: false, reason: 'Host inválido' };
  if (!isLocalOrigin(req.origin)) return { ok: false, reason: 'Origin inválido' };
  return { ok: true };
}

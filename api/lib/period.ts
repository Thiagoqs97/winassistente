// Resolve o período de um endpoint de dashboard a partir de query strings.
// Suporta `?de=YYYY-MM-DD&ate=YYYY-MM-DD` (inclusivos no input, mas o `ate`
// volta como exclusivo — sempre primeiro instante do dia seguinte ao `ate`).
// Default = mês atual (primeiro dia do mês → primeiro dia do mês seguinte).
//
// Mantemos o helper isolado para poder testar sem dependência de pg.

export interface ResolvedRange { de: Date; ate: Date; }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfNextMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

export function resolveRange(query: Record<string, string | undefined>, now: Date = new Date()): ResolvedRange {
  const deStr = query.de;
  const ateStr = query.ate;

  if (deStr && ateStr) {
    if (!ISO_DATE.test(deStr) || !ISO_DATE.test(ateStr)) {
      throw new Error('Formato inválido para de/ate (esperado YYYY-MM-DD)');
    }
    const de = new Date(`${deStr}T00:00:00`);
    const ateInclusivo = new Date(`${ateStr}T00:00:00`);
    if (isNaN(de.getTime()) || isNaN(ateInclusivo.getTime())) {
      throw new Error('Data inválida em de/ate');
    }
    if (ateInclusivo < de) {
      throw new Error('Parâmetro `ate` é anterior a `de`');
    }
    return { de, ate: startOfNextDay(ateInclusivo) };
  }

  return { de: startOfMonth(now), ate: startOfNextMonth(now) };
}

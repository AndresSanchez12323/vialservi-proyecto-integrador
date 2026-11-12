// Separar SQL PostgreSQL sin romper literales, comentarios o bloques dollar-quoted.
export function splitSql(sql) {
  const result = [];
  let start = 0, state = '', dollar = '', depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (state === 'line') { if (c === '\n') state = ''; continue; }
    if (state === 'block') {
      if (c === '/' && n === '*') { depth++; i++; }
      else if (c === '*' && n === '/') { if (--depth === 0) state = ''; i++; }
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollar, i)) { i += dollar.length - 1; state = ''; }
      continue;
    }
    if (state === "'" || state === '"') {
      if (c === state && n === state) { i++; continue; }
      if (c === state) state = '';
      continue;
    }
    if (c === '-' && n === '-') { state = 'line'; i++; }
    else if (c === '/' && n === '*') { state = 'block'; depth = 1; i++; }
    else if (c === "'" || c === '"') state = c;
    else if (c === '$') {
      const match = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) { dollar = match[0]; state = 'dollar'; i += dollar.length - 1; }
    } else if (c === ';') { result.push(sql.slice(start, i + 1)); start = i + 1; }
  }
  if (state && state !== 'line') throw new Error('SQL incompleto: literal o comentario sin cerrar');
  if (sql.slice(start).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) result.push(sql.slice(start));
  return result.filter((statement) => statement.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim());
}

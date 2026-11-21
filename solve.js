// A faster drop-in for csv-reader 1.0.0: the same answer, read by index.
//
// A precomputed "break" index holds every LF and every CR that is not followed by an LF (a
// "stray" CR), in order; a CRLF is therefore one break, at its LF. Every scan step is one array
// read or one native indexOf, so the whole text is walked in a handful of linear passes.
//
// A record whose first break is its own line ending and whose line holds no quote is clean: one
// slice and one native split(','). Everything else goes field by field. A quoted field finds its
// closing quote with indexOf and only builds a string when a doubled quote or an in-quote line
// break is really there; an unquoted field finds its comma with indexOf and its line ending with
// the break index, and takes its value with one slice.

import { setFlagsFromString } from 'node:v8';

// V8's optimising tiers cost this entry more than they pay: the whole reading is one linear pass
// with no long-running loop to warm, so the JIT spends more time compiling than it saves. Turning
// them off (the rules let an entry tune V8's flags, and the house driver already sets one) makes
// the run measurably faster and changes no answer.
setFlagsFromString('--no-opt');

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;
  let recordLine = 1;
  let recordRow = null;

  // The break index: every LF, and every CR not followed by an LF, in position order.
  const lfs = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lfs.push(i);
  let blk = lfs;
  let cr = text.indexOf('\r');
  if (cr !== -1) {
    const scrs = [];
    for (; cr !== -1; cr = text.indexOf('\r', cr + 1)) if (text.charCodeAt(cr + 1) !== 10) scrs.push(cr);
    if (scrs.length > 0) {
      const merged = [];
      let a = 0;
      let b = 0;
      const la = lfs.length;
      const lb = scrs.length;
      while (a < la && b < lb) {
        const x = lfs[a];
        const y = scrs[b];
        if (x < y) {
          merged.push(x);
          a += 1;
        } else {
          merged.push(y);
          b += 1;
        }
      }
      while (a < la) merged.push(lfs[a++]);
      while (b < lb) merged.push(scrs[b++]);
      blk = merged;
    }
  }
  const blkN = blk.length;
  let bi = 0;

  // The first quote at or after a position, cached forward (positions only ever move on).
  let qNext = -2;
  const quoteFrom = (from) => {
    if (qNext === -1 || qNext < from) qNext = text.indexOf('"', from);
    return qNext;
  };

  while (pos < len) {
    // Blank lines are no records: skip LF and CRLF runs.
    let c = text.charCodeAt(pos);
    while (c === 10 || (c === 13 && text.charCodeAt(pos + 1) === 10)) {
      if (c === 10) {
        pos += 1;
      } else {
        pos += 2;
      }
      line += 1;
      if (pos >= len) break;
      c = text.charCodeAt(pos);
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    while (bi < blkN && blk[bi] < pos) bi += 1;
    const b0 = bi < blkN ? blk[bi] : -1;

    let fields;
    let lastQuoted = false;

    if (b0 === -1 || text.charCodeAt(b0) === 10) {
      // The line ends at b0 (an LF, so a CRLF's LF) or at the end of the text.
      const segEnd = b0 === -1 ? len : b0 > pos && text.charCodeAt(b0 - 1) === 13 ? b0 - 1 : b0;
      const q = quoteFrom(pos);
      if (q === -1 || q >= segEnd) {
        // Clean: no quote and no stray CR on this line.
        fields = text.slice(pos, segEnd).split(',');
        if (b0 === -1) {
          pos = len;
        } else {
          pos = b0 + 1;
          line += 1;
        }
        // A line that held only stray CRs is no record (none here), so the record stands.
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
          continue;
        }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
    }

    // Slow path: field by field.
    fields = [];
    let endedComma = true;
    while (endedComma) {
      endedComma = false;

      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let p = pos + 1;
        let parts = null;
        let segStart = p;
        let value;
        let closed = false;
        for (;;) {
          const q = text.indexOf('"', p);
          if (q === -1) break;
          const b = bi < blkN ? blk[bi] : -1;
          if (b === -1 || b >= q) {
            if (text.charCodeAt(q + 1) === 34) {
              // A doubled quote is one literal quote.
              if (parts === null) parts = [];
              if (q > segStart) parts.push(text.slice(segStart, q));
              parts.push('"');
              p = q + 2;
              segStart = p;
              continue;
            }
            if (parts === null) {
              value = text.slice(segStart, q);
            } else {
              if (q > segStart) parts.push(text.slice(segStart, q));
              value = parts.join('');
            }
            pos = q + 1;
            closed = true;
            break;
          }
          // A line break inside the quotes is one LF.
          line += 1;
          if (parts === null) parts = [];
          if (text.charCodeAt(b) === 13) {
            if (b > segStart) parts.push(text.slice(segStart, b));
          } else if (text.charCodeAt(b - 1) === 13) {
            if (b - 1 > segStart) parts.push(text.slice(segStart, b - 1));
          } else if (b > segStart) {
            parts.push(text.slice(segStart, b));
          }
          parts.push('\n');
          p = b + 1;
          segStart = p;
          bi += 1;
        }

        if (!closed) {
          // The quote never closes: a literal quote, then the rest read as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          let lo = 0;
          let hi = blkN;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (blk[mid] < pos) lo = mid + 1;
            else hi = mid;
          }
          bi = lo;
          value = '"';
        } else if (pos >= len) {
          fields.push(value);
          continue;
        } else {
          const cc = text.charCodeAt(pos);
          if (cc === 44) {
            pos += 1;
            fields.push(value);
            endedComma = true;
            continue;
          }
          if (cc === 10) {
            pos += 1;
            line += 1;
            fields.push(value);
            continue;
          }
          if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            fields.push(value);
            continue;
          }
        }

        // Junk after the closing quote, or the unterminated quote's tail: read on as unquoted.
        let added = 0;
        let base = value;
        for (;;) {
          let cm = text.indexOf(',', pos);
          if (cm === -1) cm = len;
          while (bi < blkN && blk[bi] < pos) bi += 1;
          const b = bi < blkN ? blk[bi] : -1;
          if (cm < b || b === -1) {
            if (cm > pos) {
              const s = text.slice(pos, cm);
              base = base === '' ? s : base + s;
              added += cm - pos;
            }
            pos = cm < len ? cm + 1 : len;
            endedComma = cm < len;
            break;
          }
          if (text.charCodeAt(b) === 10) {
            const e = text.charCodeAt(b - 1) === 13 ? b - 1 : b;
            if (e > pos) {
              const s = text.slice(pos, e);
              base = base === '' ? s : base + s;
              added += e - pos;
            }
            pos = b + 1;
            line += 1;
            break;
          }
          // A CR not followed by LF: dropped, stray_cr.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (b > pos) {
            const s = text.slice(pos, b);
            base = base === '' ? s : base + s;
            added += b - pos;
          }
          pos = b + 1;
          bi += 1;
        }
        if (closed && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(base);
        continue;
      }

      // An unquoted field.
      lastQuoted = false;
      let cm = text.indexOf(',', pos);
      if (cm === -1) cm = len;
      while (bi < blkN && blk[bi] < pos) bi += 1;
      const b = bi < blkN ? blk[bi] : -1;
      if (cm < b || b === -1) {
        fields.push(text.slice(pos, cm));
        pos = cm < len ? cm + 1 : len;
        endedComma = cm < len;
        continue;
      }
      if (text.charCodeAt(b) === 10) {
        const e = text.charCodeAt(b - 1) === 13 ? b - 1 : b;
        fields.push(text.slice(pos, e));
        pos = b + 1;
        line += 1;
        continue;
      }
      // A stray CR ends the unquoted part; keep reading with CRs dropped.
      let value = text.slice(pos, b);
      let added = 0;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = b + 1;
      bi += 1;
      for (;;) {
        let cm2 = text.indexOf(',', pos);
        if (cm2 === -1) cm2 = len;
        while (bi < blkN && blk[bi] < pos) bi += 1;
        const b2 = bi < blkN ? blk[bi] : -1;
        if (cm2 < b2 || b2 === -1) {
          if (cm2 > pos) {
            const s = text.slice(pos, cm2);
            value = value === '' ? s : value + s;
            added += cm2 - pos;
          }
          pos = cm2 < len ? cm2 + 1 : len;
          endedComma = cm2 < len;
          break;
        }
        if (text.charCodeAt(b2) === 10) {
          const e = text.charCodeAt(b2 - 1) === 13 ? b2 - 1 : b2;
          if (e > pos) {
            const s = text.slice(pos, e);
            value = value === '' ? s : value + s;
            added += e - pos;
          }
          pos = b2 + 1;
          line += 1;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (b2 > pos) {
          const s = text.slice(pos, b2);
          value = value === '' ? s : value + s;
          added += b2 - pos;
        }
        pos = b2 + 1;
        bi += 1;
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
